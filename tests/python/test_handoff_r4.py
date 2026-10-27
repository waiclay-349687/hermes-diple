"""fix-r4 — GPT code review R4, Diple backend half.

XE4-02: a hand-off is settled from what REALLY rode in its batch: the shared
cases (packages/core/test/handoff-settle.cases.json) run against the store's
twin of ``settledForHandoff``; the reviewer's "queued → removed → another
hand-off's batch succeeds" sequence through the real routes.
Cross-layer terminal: a settled derived from ``answered`` fixes the batch's
outcome too; a later opposite /final gets the existing word back.
XE4-03: a pre-R3 claim with a receipt is linked to its batch at migration.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from test_diple_backend import api, plugin  # noqa: F401  (fixtures)

URL = "/api/plugins/diple"
CASES = json.loads((Path(__file__).resolve().parents[2] / "packages/core/test/handoff-settle.cases.json").read_text())


def _store(plugin, now=None):
    conn = sqlite3.connect(":memory:", check_same_thread=False)
    return plugin.store.DipleStore(connect=lambda: conn, clock=(lambda: now[0]) if now else (lambda: 1.0))


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_settled_for_handoff_cases_shared_with_the_core(plugin, case):
    assert plugin.store.settled_for_handoff(case["batch"], "h1", case["accepted"]) == case["expect"]


def _review_item(item_id, revision=1):
    return {"origin": {"plugin": "diple-docs", "itemId": item_id, "revision": revision, "path": "/w/a.md"},
            "text": "t " + item_id, "comment": "c"}


def _handoff(api, hid, item_id, revision=1, batch="batchQ1"):
    # a current Review declares it reads a per-item settled (R5 XE5-02)
    c = api.post(f"{URL}/handoff/{hid}/claim", json={"owner": "A", "batchId": batch, "caps": ["partial"]}).json()
    api.post(f"{URL}/events/handoff-receipt", json={"handoffId": hid, "owner": "A", "generation": c["generation"],
                                                   "accepted": [item_id], "queued": True, "settles": True})


@pytest.mark.parametrize("delivered,reason", [(True, None), (False, "turn-error"), (False, "cancelled")])
def test_xe4_02_a_removed_queued_item_is_never_settled_by_another_items_batch(api, delivered, reason):
    """R4: hR31 queued r0001; the user removed it; hR32 sent r0002; the merged batch
    carries only r0002. hR31 is 'removed' whatever the batch did; hR32 follows the batch."""
    _handoff(api, "hR31", "r0001")
    _handoff(api, "hR32", "r0002")
    api.put(f"{URL}/batches/batchQ1", json={
        "sessionId": "s1", "full": "F", "items": [_review_item("r0002")], "handoffIds": ["hR31", "hR32"],
        "handoffItems": {"hR31": [{"itemId": "r0001", "revision": 1}], "hR32": [{"itemId": "r0002", "revision": 1}]}})
    body = {"delivered": delivered, "handoffIds": ["hR31", "hR32"], **({"reason": reason} if reason else {})}
    settled = {s["handoffId"]: s for s in api.post(f"{URL}/batches/batchQ1/final", json=body).json()["settled"]}
    assert settled["hR31"] == {"handoffId": "hR31", "batchId": "batchQ1", "delivered": False, "reason": "removed",
                               "items": [{"itemId": "r0001", "delivered": False, "reason": "removed"}]}
    assert settled["hR32"]["delivered"] is delivered
    assert "items" not in settled["hR32"]
    broadcast = {p["handoffId"]: p for e, p in api.events if e == "handoff.settled"}
    assert broadcast["hR31"]["delivered"] is False and broadcast["hR31"]["reason"] == "removed"


def test_xe4_02_without_explicit_versions_the_receipt_decides(api):
    """The reviewer's backend probe: no handoffItems, the receipt names an item the
    batch does not carry → not delivered."""
    _handoff(api, "h-deleted", "r0001", batch="batchDelete")
    api.put(f"{URL}/batches/batchDelete", json={"sessionId": "s1", "full": "F", "items": [_review_item("r0002")],
                                                "handoffIds": ["h-deleted"]})
    st = api.post(f"{URL}/batches/batchDelete/final", json={"delivered": True, "handoffIds": ["h-deleted"]}).json()["settled"]
    assert st[0]["delivered"] is False and st[0]["reason"] == "removed"


def test_xe4_02_a_replaced_revision_did_not_go_out(api):
    """hR31 handed over r0001@1; the review page then sent r0001@2 (hR32), which
    upgraded the card. The batch carries r0001@2 only: hR31 'replaced', hR32 delivered."""
    _handoff(api, "hR31", "r0001")
    _handoff(api, "hR32", "r0001")
    api.put(f"{URL}/batches/batchQ1", json={
        "sessionId": "s1", "full": "F", "items": [_review_item("r0001", 2)], "handoffIds": ["hR31", "hR32"],
        "handoffItems": {"hR31": [{"itemId": "r0001", "revision": 1}], "hR32": [{"itemId": "r0001", "revision": 2}]}})
    settled = {s["handoffId"]: s for s in api.post(f"{URL}/batches/batchQ1/final", json={"delivered": True, "handoffIds": ["hR31", "hR32"]}).json()["settled"]}
    assert settled["hR31"]["delivered"] is False and settled["hR31"]["reason"] == "replaced"
    assert settled["hR32"] == {"handoffId": "hR32", "batchId": "batchQ1", "delivered": True}


def test_xe4_02_partly_carried_handoff_says_which_items_went_out(api):
    c = api.post(f"{URL}/handoff/h-part/claim", json={"owner": "A", "batchId": "batchP1", "caps": ["partial"]}).json()
    api.post(f"{URL}/events/handoff-receipt", json={"handoffId": "h-part", "owner": "A", "generation": c["generation"],
                                                   "accepted": ["r1", "r2"], "settles": True})
    api.put(f"{URL}/batches/batchP1", json={"sessionId": "s1", "full": "F", "items": [_review_item("r1")], "handoffIds": ["h-part"]})
    st = api.post(f"{URL}/batches/batchP1/final", json={"delivered": True, "handoffIds": ["h-part"]}).json()["settled"][0]
    assert st["delivered"] is True
    assert st["items"] == [{"itemId": "r1", "delivered": True}, {"itemId": "r2", "delivered": False, "reason": "removed"}]


def test_cross_layer_answered_fixes_the_outcome_a_later_opposite_final_gets_it_back(plugin):
    """R4 'derivedVersusFinal': answered → settled derived true; a later /final false
    neither flips the batch nor the hand-off — the existing terminal comes back."""
    es = _store(plugin)
    es.claim("h-answer", owner="A", batch_id="batchAnswer")
    es.put_batch("batchAnswer", session_id="s1", full="F", items=[], handoff_ids=["h-answer"])
    es.mark_expanded("batchAnswer")
    es.mark_answered("batchAnswer", answered=[], missing=[])
    first = es.handoff_settled("h-answer")
    assert first == {"handoffId": "h-answer", "batchId": "batchAnswer", "delivered": True}
    assert es.get_batch("batchAnswer")["outcome"] == "delivered", "the derivation fixed the batch's outcome"
    batch, last = es.final_batch("batchAnswer", delivered=False, reason="put-back", handoff_ids=["h-answer"])
    assert batch["outcome"] == "delivered"
    assert last == [first]


def test_cross_layer_answered_is_the_first_terminal_even_before_anyone_derives(plugin):
    """The answer fixes the outcome itself: a /final false that arrives before any read
    gets 'delivered' back, and the hand-off follows the batch — both layers agree."""
    es = _store(plugin)
    es.claim("h-a2", owner="A", batch_id="batchA2")
    es.put_batch("batchA2", session_id="s1", full="F", items=[], handoff_ids=["h-a2"])
    es.mark_expanded("batchA2")
    es.mark_answered("batchA2", answered=[], missing=[])
    assert es.get_batch("batchA2")["outcome"] == "delivered"
    batch, settled = es.final_batch("batchA2", delivered=False, reason="put-back", handoff_ids=["h-a2"])
    assert batch["outcome"] == "delivered" and settled[0]["delivered"] is True
    assert es.handoff_settled("h-a2")["delivered"] is True


def test_cross_layer_opposite_final_route_says_conflict(api):
    store = __import__("sys").modules["hermes_diple_api_store"].store_for_current_home()
    api.post(f"{URL}/handoff/h-cf/claim", json={"owner": "A", "batchId": "batchCF"})
    api.put(f"{URL}/batches/batchCF", json={"sessionId": "s1", "full": "F", "items": [], "handoffIds": ["h-cf"]})
    store.mark_expanded("batchCF")
    store.mark_answered("batchCF", answered=[], missing=[])
    r = api.post(f"{URL}/batches/batchCF/final", json={"delivered": False, "reason": "turn-error", "handoffIds": ["h-cf"]}).json()
    assert r["conflict"] is True and r["batch"]["outcome"] == "delivered"
    assert r["settled"] == [{"handoffId": "h-cf", "batchId": "batchCF", "delivered": True}]


def test_xe4_03_an_old_claim_with_a_receipt_is_linked_to_its_batch(plugin):
    """R4 'oldReceiptMigration': pre-R3 schema, receipt + sending progress naming an
    answered batch. After migration the link exists and the settled is derived."""
    conn = sqlite3.connect(":memory:", check_same_thread=False)
    conn.executescript(
        "CREATE TABLE handoff_claims (handoff_id TEXT PRIMARY KEY, claimed_at REAL NOT NULL, session_id TEXT NOT NULL DEFAULT '', "
        "receipt_json TEXT, progress_json TEXT, settled_json TEXT); "
        "CREATE TABLE batches (batch_id TEXT PRIMARY KEY, session_id TEXT NOT NULL DEFAULT '', full TEXT NOT NULL, display TEXT NOT NULL DEFAULT '', "
        "items_json TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'registered', fail_reason TEXT, answer_json TEXT, "
        "created_at REAL NOT NULL, expanded_at REAL, answer_checked_at REAL);")
    conn.execute("INSERT INTO handoff_claims VALUES (?,?,?,?,?,NULL)", ("h-old", 1, "s1",
                 json.dumps({"handoffId": "h-old", "accepted": ["r1"], "batchId": "batchOld"}),
                 json.dumps({"stage": "sending", "accepted": ["r1"], "batchId": "batchOld"})))
    conn.execute("INSERT INTO handoff_claims VALUES (?,?,?,?,?,NULL)", ("h-old2", 1, "s1", None,
                 json.dumps({"stage": "sending", "accepted": ["r2"], "batchId": "batchOld2"})))
    conn.execute("INSERT INTO batches(batch_id, full, status, items_json, created_at) VALUES ('batchOld','F','answered',?,1)",
                 (json.dumps([_review_item("r1")]),))
    conn.commit()
    old = plugin.store.DipleStore(connect=lambda: conn, clock=lambda: 100)
    assert old.batch_handoffs("batchOld") == ["h-old"]
    assert old.batch_handoffs("batchOld2") == ["h-old2"], "from progress when there is no receipt"
    assert old.claim("h-old", owner="B", batch_id="batchNew")["settled"] == {"handoffId": "h-old", "batchId": "batchOld", "delivered": True}
    assert old.handoff_settled("h-old")["delivered"] is True
    # idempotent: a second instance over the same file links nothing twice
    again = plugin.store.DipleStore(connect=lambda: conn, clock=lambda: 100)
    assert again.batch_handoffs("batchOld") == ["h-old"]
