"""Diple — REST routes, mounted by the host at ``/api/plugins/diple/``.

Imported by the host as a standalone module (``hermes_dashboard_plugin_diple``),
so the storage module is loaded from ``../store.py`` by path: a second, separate
instance of it. Everything shared with the ``@diple:`` provider goes through
SQLite (ADR 0005).
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body, HTTPException

_STORE_MODULE = "hermes_diple_api_store"


def _load_store_module():
    mod = sys.modules.get(_STORE_MODULE)
    if mod is not None:
        return mod
    path = Path(__file__).resolve().parent.parent / "store.py"
    spec = importlib.util.spec_from_file_location(_STORE_MODULE, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load {path}")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[_STORE_MODULE] = mod
    spec.loader.exec_module(mod)
    return mod


_store_mod = _load_store_module()
PLUGIN_ID = _store_mod.PLUGIN_ID
router = APIRouter()


def get_store():
    """The active profile's store (this module instance's own cache)."""
    return _store_mod.store_for_current_home()


def _broadcast(event: str, payload: dict) -> None:
    from hermes_cli.plugin_events import broadcast_plugin_event

    broadcast_plugin_event(PLUGIN_ID, event, payload)


def _require_batch_id(batch_id: str) -> None:
    if not _store_mod.valid_batch_id(batch_id):
        raise HTTPException(status_code=400, detail="invalid batch id")


# -- input shapes (R1 XE-15): malformed nested input is a 400, never a 500 -----------
def _bad(detail: str):
    raise HTTPException(status_code=400, detail=detail)


def _origin_ok(origin: Any) -> bool:
    return origin is None or isinstance(origin, dict)


def _items(value: Any) -> list:
    """Batch items: objects whose origin is an object (or null), text/comment strings."""
    if value is None:
        return []
    if not isinstance(value, list):
        _bad("items must be a list")
    for it in value:
        if not isinstance(it, dict) or not _origin_ok(it.get("origin")):
            _bad("items must be objects with an object origin")
        for key in ("text", "comment"):
            if it.get(key) is not None and not isinstance(it.get(key), str):
                _bad(f"item {key} must be a string")
    return value


def _numbers(value: Any, name: str) -> list[int]:
    if value is None:
        return []
    if not isinstance(value, list) or any(isinstance(n, bool) or not isinstance(n, int) for n in value):
        _bad(f"{name} must be a list of integers")
    return value


def _strings(value: Any, name: str) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list) or any(not isinstance(v, str) for v in value):
        _bad(f"{name} must be a list of strings")
    return value


@router.get("/health")
async def health() -> dict:
    return {"ok": True, "plugin": PLUGIN_ID, "v": 1}


@router.put("/batches/{batch_id}")
async def put_batch(batch_id: str, body: dict = Body(...)) -> dict:
    _require_batch_id(batch_id)
    full = body.get("full")
    if not isinstance(full, str) or not full.strip():
        raise HTTPException(status_code=400, detail="full is required")
    items = _items(body.get("items"))
    handoff_ids = _strings(body.get("handoffIds"), "handoffIds")
    if any(not _store_mod.valid_handoff_id(h) for h in handoff_ids):
        _bad("invalid handoff id")
    handoff_items = _handoff_items(body.get("handoffItems"))
    try:
        return get_store().put_batch(
            batch_id, session_id=str(body.get("sessionId") or ""), full=full,
            display=str(body.get("display") or ""), items=items, handoff_ids=handoff_ids,
            handoff_items=handoff_items,
        )
    except _store_mod.BatchConflict:
        raise HTTPException(status_code=409, detail="batch already delivered")


@router.get("/batches/{batch_id}")
async def get_batch(batch_id: str) -> dict:
    _require_batch_id(batch_id)
    batch = get_store().get_batch(batch_id)
    if batch is None:
        raise HTTPException(status_code=404, detail="unknown batch")
    return batch


@router.get("/batches")
async def list_batches(sessionId: str | None = None, status: str | None = None, limit: int = 20) -> dict:
    if status is not None and status not in _store_mod.STATUSES:
        raise HTTPException(status_code=400, detail="invalid status")
    return {"batches": get_store().list_batches(session_id=sessionId, status=status, limit=limit)}


@router.post("/batches/{batch_id}/answered")
async def batch_answered(batch_id: str, body: dict = Body(default={})) -> dict:
    """Record the answer check (idempotent per batch): ``first`` is true only once."""
    _require_batch_id(batch_id)
    answered = _numbers(body.get("answered"), "answered")
    missing = _numbers(body.get("missing"), "missing")
    batch, first = get_store().mark_answered(batch_id, answered=answered, missing=missing,
                                             no_markers=bool(body.get("noMarkers")))
    if batch is None:
        raise HTTPException(status_code=404, detail="unknown batch")
    return {"first": first, "batch": batch}


@router.post("/batches/{batch_id}/failed")
async def batch_failed(batch_id: str, body: dict = Body(default={})) -> dict:
    """Mark a send as failed. Only ``registered`` batches by default; with
    ``{"rejected": true}`` an ``expanded`` one too (the host refused the turn
    after expanding it). Response shape unchanged; no event is broadcast."""
    _require_batch_id(batch_id)
    batch = get_store().mark_failed(batch_id, str(body.get("reason") or "unknown"),
                                    rejected=body.get("rejected") is True)
    if batch is None:
        raise HTTPException(status_code=404, detail="unknown batch")
    return batch


def _require_handoff_id(handoff_id: Any) -> None:
    if not _store_mod.valid_handoff_id(handoff_id):
        raise HTTPException(status_code=400, detail="invalid handoff id")


def _holder(body: dict) -> tuple[str, int]:
    """owner + generation of the claim a request acts under (ADR 0007)."""
    owner, generation = body.get("owner"), body.get("generation")
    if not isinstance(owner, str) or not owner or len(owner) > 128:
        _bad("owner is required")
    if isinstance(generation, bool) or not isinstance(generation, int):
        _bad("generation must be an integer")
    return owner, generation


def _lost() -> None:
    raise HTTPException(status_code=409, detail="lost-claim")


def _settled_payload(settled: dict) -> dict:
    """The broadcast of a stored settled — as its sender may be told (R5 XE5-02: a per-item
    word only to a sender that declared caps ['partial'], else a partly carried hand-off
    goes out as not delivered)."""
    settled = get_store().settled_for_peer(settled)
    out: dict[str, Any] = {"v": 1, "handoffId": settled["handoffId"], "delivered": bool(settled.get("delivered"))}
    if settled.get("batchId"):
        out["batchId"] = settled["batchId"]
    if settled.get("reason") and not settled.get("delivered"):
        out["reason"] = str(settled["reason"])[:100]
    if isinstance(settled.get("items"), list):  # optional (R4 XE4-02): per-item word when not every item went out
        out["items"] = settled["items"]
    return out


def _told(store: Any, out: dict) -> dict:
    """A response carrying a hand-off's settled gives it as its sender may be told (R5 XE5-02):
    the per-item word never leaves this backend toward a sender that cannot read it."""
    if isinstance(out.get("settled"), dict):
        out = {**out, "settled": store.settled_for_peer(out["settled"])}
    return out


def _handoff_items(value: Any) -> dict:
    """``handoffItems``: {handoffId: [{itemId, revision}]} — what each hand-off handed over (R4 XE4-02)."""
    if value is None:
        return {}
    if not isinstance(value, dict):
        _bad("handoffItems must be an object")
    for h, versions in value.items():
        if not _store_mod.valid_handoff_id(h) or not isinstance(versions, list):
            _bad("invalid handoffItems")
        for v in versions:
            if not isinstance(v, dict) or not isinstance(v.get("itemId"), str):
                _bad("handoffItems entries need an itemId")
    return value


def _receipt_payload(receipt: dict) -> dict:
    return {"v": 1, **{k: v for k, v in receipt.items() if k != "v"}}


@router.post("/handoff/{handoff_id}/claim")
async def claim_handoff(handoff_id: str, body: dict = Body(default={})) -> dict:
    """``{owner, batchId?, sessionId?}`` → ``{claimed: true, owner, generation, batchId, progress?}``
    or ``{claimed: false, receipt?, settled?}`` (a finished hand-off: replay it, XE-04)."""
    _require_handoff_id(handoff_id)
    owner = body.get("owner")
    if not isinstance(owner, str) or not owner or len(owner) > 128:
        import uuid

        owner = uuid.uuid4().hex
    batch_id = body.get("batchId")
    if batch_id is not None:
        _require_batch_id(batch_id if isinstance(batch_id, str) else "")
    caps = body.get("caps")
    if caps is not None and (not isinstance(caps, list) or len(caps) > 16
                             or any(not isinstance(c, str) or not c or len(c) > 32 for c in caps)):
        _bad("caps must be a list of short strings")
    store = get_store()
    out = store.claim(handoff_id, owner=owner, batch_id=batch_id, session_id=str(body.get("sessionId") or ""), caps=caps)
    return _told(store, out)


@router.get("/handoff/{handoff_id}")
async def get_handoff(handoff_id: str) -> dict:
    """What the backend knows of a hand-off: its receipt and settled (derived when missing)."""
    _require_handoff_id(handoff_id)
    store = get_store()
    return _told(store, {"handoffId": handoff_id, "receipt": store.handoff_receipt(handoff_id), "settled": store.handoff_settled(handoff_id)})


@router.post("/handoff/{handoff_id}/progress")
async def handoff_progress(handoff_id: str, body: dict = Body(...)) -> dict:
    """``{owner, generation, stage, accepted}`` — CAS before each side effect (XE2-03, ADR 0007).
    409 ``lost-claim``: the caller no longer holds the claim and must stop."""
    _require_handoff_id(handoff_id)
    stage = body.get("stage")
    if stage not in _store_mod.PROGRESS_STAGES:
        _bad("invalid stage")
    accepted = _strings(body.get("accepted"), "accepted")
    owner, generation = _holder(body)
    if not get_store().advance_handoff(handoff_id, owner=owner, generation=generation, stage=stage, accepted=accepted):
        _lost()
    return {"ok": True, "generation": generation}


@router.post("/handoff/{handoff_id}/replay")
async def replay_handoff(handoff_id: str) -> dict:
    """Broadcast again what is stored for a hand-off — its receipt and its settled (derived
    from the batch when missing) — for a review page that missed them (XR3-02)."""
    _require_handoff_id(handoff_id)
    store = get_store()
    settled = store.handoff_settled(handoff_id)
    receipt = store.replay_receipt(handoff_id)
    if receipt:
        _broadcast("handoff.receipt", _receipt_payload(receipt))
    if settled:
        _broadcast("handoff.settled", _settled_payload(settled))
    return _told(store, {"receipt": receipt, "settled": settled})


@router.post("/batches/{batch_id}/final")
async def batch_final(batch_id: str, body: dict = Body(...)) -> dict:
    """``{delivered, reason?, handoffIds}``: how the send of a batch ended (ADR 0007 §4).
    The outcome and every hand-off's settled are stored once (the first word stays),
    then ``plugin.diple.handoff.settled`` is broadcast for each hand-off of the batch."""
    _require_batch_id(batch_id)
    delivered = body.get("delivered")
    if not isinstance(delivered, bool):
        _bad("delivered must be a boolean")
    reason = body.get("reason")
    if reason is not None and not isinstance(reason, str):
        _bad("reason must be a string")
    handoff_ids = _strings(body.get("handoffIds"), "handoffIds")
    if any(not _store_mod.valid_handoff_id(h) for h in handoff_ids):
        _bad("invalid handoff id")
    batch, settled = get_store().final_batch(batch_id, delivered=delivered, reason=reason, handoff_ids=handoff_ids)
    for st in settled:
        _broadcast("handoff.settled", _settled_payload(st))
    # one first terminal per batch (R4): an opposite late /final is ignored; the existing word comes back
    conflict = bool(batch and batch.get("outcome") and batch["outcome"] != ("delivered" if delivered else "failed"))
    store = get_store()
    return {"batch": batch, "settled": [store.settled_for_peer(st) for st in settled], **({"conflict": True} if conflict else {})}


@router.post("/events/batch-answered")
async def emit_batch_answered(body: dict = Body(...)) -> dict:
    """Broadcast ``plugin.diple.batch.answered`` {v:1, batchId, answered:[{origin}]}.

    With ``numbers`` (comment numbers) and a stored batch, the origins come
    from the stored items, not from the request (XE-15)."""
    batch_id = body.get("batchId")
    _require_batch_id(batch_id if isinstance(batch_id, str) else "")
    numbers = _numbers(body.get("numbers"), "numbers") if "numbers" in body else None
    batch = get_store().get_batch(batch_id) if numbers is not None else None
    if batch is not None:
        items = batch.get("items") or []
        if any(n < 1 or n > len(items) for n in numbers):
            _bad("numbers out of range")
        origins = [(items[n - 1] if isinstance(items[n - 1], dict) else {}).get("origin") for n in numbers]
    else:
        answered = body.get("answered") or []
        if not isinstance(answered, list) or any(not isinstance(a, dict) or not _origin_ok(a.get("origin")) for a in answered):
            _bad("answered must be a list of {origin} objects")
        origins = [a.get("origin") for a in answered]
    payload = {"v": 1, "batchId": batch_id, "answered": [{"origin": o} for o in origins]}
    _broadcast("batch.answered", payload)
    return {"ok": True, "event": f"plugin.{PLUGIN_ID}.batch.answered", "payload": payload}


@router.post("/events/handoff-receipt")
async def emit_handoff_receipt(body: dict = Body(...)) -> dict:
    """``{handoffId, owner, generation, accepted, batchId?, queued?}``: stored (CAS, first one
    stays) with the claim, then broadcast as ``plugin.diple.handoff.receipt``
    {v:1, handoffId, accepted:[itemId], batchId?, queued?, settles?}. 409 when the caller
    no longer holds the claim — its receipt would contradict the holder's."""
    handoff_id = body.get("handoffId")
    _require_handoff_id(handoff_id)
    accepted = _strings(body.get("accepted"), "accepted")
    receipt: dict[str, Any] = {"handoffId": handoff_id, "accepted": accepted}
    if body.get("batchId"):
        _require_batch_id(body["batchId"] if isinstance(body["batchId"], str) else "")
        receipt["batchId"] = body["batchId"]
    if body.get("queued") is True:  # sendNow into a busy session: queued behind the answer
        receipt["queued"] = True
    if body.get("settles") is True:  # the receiver declares it sends handoff.settled (ADR 0007 §6)
        receipt["settles"] = True
    owner, generation = _holder(body)
    stored = get_store().save_handoff_receipt(handoff_id, receipt, owner=owner, generation=generation)
    if stored is None:
        _lost()
    payload = _receipt_payload(stored)
    _broadcast("handoff.receipt", payload)
    return {"ok": True, "event": f"plugin.{PLUGIN_ID}.handoff.receipt", "payload": payload}


@router.post("/events/handoff-settled")
async def emit_handoff_settled(body: dict = Body(...)) -> dict:
    """``{handoffId, batchId, delivered, reason?}`` for one hand-off. Stored once (the first
    word stays, ADR 0007 §3) and the STORED result is broadcast. The send flow uses
    ``/batches/{id}/final``; this stays for a hand-off with no batch to speak of."""
    handoff_id = body.get("handoffId")
    _require_handoff_id(handoff_id)
    batch_id = body.get("batchId")
    _require_batch_id(batch_id if isinstance(batch_id, str) else "")
    delivered = body.get("delivered")
    if not isinstance(delivered, bool):
        _bad("delivered must be a boolean")
    reason = body.get("reason")
    if reason is not None and not isinstance(reason, str):
        _bad("reason must be a string")
    settled: dict[str, Any] = {"handoffId": handoff_id, "batchId": batch_id, "delivered": delivered}
    if reason and not delivered:
        settled["reason"] = reason[:100]
    stored = get_store().save_handoff_settled(handoff_id, settled)
    payload = _settled_payload(stored)
    _broadcast("handoff.settled", payload)
    return {"ok": True, "event": f"plugin.{PLUGIN_ID}.handoff.settled", "payload": payload}
