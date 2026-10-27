"""ADR 0007 — the hand-off protocol, Diple backend half (fix-r3).

The ledger cases are the SAME file the core state machine runs
(packages/core/test/handoff-ledger.cases.json): SQLite and the JS reference
must agree on every step. The rest are R3 findings reproduced on the real
store and routes: XE2-03 (an expired claim is fenced), XE3-01 / XR3-02 (the
final word survives a lost request: it is derived from the batch and replayed),
XE3-02 / XR3-03 (one batch, several hand-offs, each settled).
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from test_diple_backend import api, plugin  # noqa: F401  (fixtures)

URL = "/api/plugins/diple"
CASES = json.loads((Path(__file__).resolve().parents[2] / "packages/core/test/handoff-ledger.cases.json").read_text())


def _subset(actual, expected, path=""):
    for k, v in expected.items():
        if isinstance(v, dict):
            _subset((actual or {}).get(k), v, f"{path}.{k}")
        else:
            assert (actual or {}).get(k) == v, f"{path}.{k}: {actual!r}"


def _memory_store(plugin, now):
    conn = sqlite3.connect(":memory:", check_same_thread=False)
    return plugin.store.DipleStore(connect=lambda: conn, clock=lambda: now[0])


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_ledger_cases_shared_with_the_core(plugin, case):
    now = [0.0]
    store = _memory_store(plugin, now)
    h = "h-1234"
    for i, step in enumerate(case["steps"]):
        now[0] = step["at"] / 1000.0
        req = step["req"]
        op = req["op"]
        if op == "claim":
            status, res = 200, store.claim(h, owner=req["owner"], batch_id=req.get("batchId"))
        elif op == "advance":
            ok = store.advance_handoff(h, owner=req["owner"], generation=req["generation"], stage=req["stage"],
                                       accepted=req.get("accepted"))
            status, res = (200, {"ok": True}) if ok else (409, {"detail": "lost-claim"})
        elif op == "receipt":
            stored = store.save_handoff_receipt(h, req["receipt"], owner=req["owner"], generation=req["generation"])
            status, res = (200, {"ok": True, "receipt": stored}) if stored is not None else (409, {"detail": "lost-claim"})
        else:
            before = store.handoff_settled(h)
            stored = store.save_handoff_settled(h, req["settled"])
            status, res = 200, {"settled": stored, "first": before is None}
        assert status == step["status"], f"step {i}: {res}"
        _subset(res, step["res"], f"step {i}")


# -- XE2-03 (R3 r3-backend.py): a claim that expired is fenced off -----------------------------
def test_r3_expired_claimant_cannot_record_progress_or_a_second_receipt(api, monkeypatch):
    mod = __import__("sys").modules["hermes_diple_api_store"]
    now = [1000.0]
    monkeypatch.setattr(mod.store_for_current_home(), "_clock", lambda: now[0])
    a = api.post(f"{URL}/handoff/h-lease/claim", json={"sessionId": "s1", "owner": "A", "batchId": "batch20"}).json()
    now[0] += 31
    b = api.post(f"{URL}/handoff/h-lease/claim", json={"sessionId": "s1", "owner": "B", "batchId": "batch40"}).json()
    assert a["claimed"] and b["claimed"]
    assert (a["generation"], b["generation"]) == (1, 2)
    assert b["batchId"] == "batch20", "the batch id fixed at the first claim"
    ok = api.post(f"{URL}/handoff/h-lease/progress", json={"owner": "B", "generation": 2, "stage": "sending", "accepted": ["r1"]})
    assert ok.status_code == 200
    r = api.post(f"{URL}/events/handoff-receipt", json={"handoffId": "h-lease", "owner": "B", "generation": 2, "accepted": ["r1"], "batchId": "batch20"})
    assert r.status_code == 200
    late = api.post(f"{URL}/handoff/h-lease/progress", json={"owner": "A", "generation": 1, "stage": "sending", "accepted": ["r1"]})
    assert late.status_code == 409 and late.json()["detail"] == "lost-claim"
    late_receipt = api.post(f"{URL}/events/handoff-receipt", json={"handoffId": "h-lease", "owner": "A", "generation": 1, "accepted": ["r1"], "batchId": "batch40"})
    assert late_receipt.status_code == 409
    assert mod.store_for_current_home().handoff_receipt("h-lease")["batchId"] == "batch20"


def test_progress_and_receipt_need_the_holder(api):
    api.post(f"{URL}/handoff/h-07/claim", json={"owner": "A"})
    assert api.post(f"{URL}/handoff/h-07/progress", json={"stage": "added", "accepted": []}).status_code == 400
    assert api.post(f"{URL}/events/handoff-receipt", json={"handoffId": "h-07", "accepted": []}).status_code == 400
    assert api.post(f"{URL}/handoff/h-07/progress", json={"owner": "A", "generation": "1", "stage": "added"}).status_code == 400


def test_a_batch_with_a_final_outcome_cannot_be_registered_again(plugin):
    now = [1.0]
    store = _memory_store(plugin, now)
    store.put_batch("batch20", session_id="s1", full="F", items=[], handoff_ids=["h-1234"])
    store.mark_failed("batch20", "submit-refused")
    store.put_batch("batch20", session_id="s1", full="F", items=[])  # a retry before the end is fine
    store.final_batch("batch20", delivered=False, reason="turn-error")
    with pytest.raises(plugin.store.BatchConflict):
        store.put_batch("batch20", session_id="s1", full="F", items=[])


# -- XE3-01 / XR3-02: the final word does not depend on one request ----------------------------
def test_final_settles_every_handoff_of_the_batch_once_and_broadcasts_them(api):
    for h, owner in (("h-qa", "A"), ("h-qb", "A")):
        api.post(f"{URL}/handoff/{h}/claim", json={"owner": owner, "batchId": "batch40"})
    api.put(f"{URL}/batches/batch40", json={"sessionId": "s1", "full": "F", "items": [], "handoffIds": ["h-qa"]})
    r = api.post(f"{URL}/batches/batch40/final", json={"delivered": False, "reason": "turn-error", "handoffIds": ["h-qa", "h-qb"]})
    assert r.status_code == 200
    assert [s["handoffId"] for s in r.json()["settled"]] == ["h-qa", "h-qb"]
    sent = [p for e, p in api.events if e == "handoff.settled"]
    assert sent == [{"v": 1, "handoffId": h, "batchId": "batch40", "delivered": False, "reason": "turn-error"} for h in ("h-qa", "h-qb")]
    # a late, different final changes nothing
    again = api.post(f"{URL}/batches/batch40/final", json={"delivered": True, "handoffIds": ["h-qa", "h-qb"]}).json()
    assert all(s["delivered"] is False for s in again["settled"])
    assert again["batch"]["outcome"] == "failed"


def test_a_final_for_a_batch_that_never_registered_still_settles_its_handoffs(api):
    api.post(f"{URL}/handoff/h-cx/claim", json={"owner": "A", "batchId": "batch77"})
    r = api.post(f"{URL}/batches/batch77/final", json={"delivered": False, "reason": "cancelled", "handoffIds": ["h-cx"]}).json()
    assert r["batch"]["status"] == "failed" and r["batch"]["outcome"] == "failed", "a spent id"
    assert r["settled"] == [{"handoffId": "h-cx", "batchId": "batch77", "delivered": False, "reason": "cancelled"}]


def test_settled_is_derived_from_the_batch_when_no_one_recorded_it(api):
    """XE3-01: the settled request was lost, but the batch's outcome is known → claim and
    replay still give the true result (here: an answered batch → delivered)."""
    store = __import__("sys").modules["hermes_diple_api_store"].store_for_current_home()
    c = api.post(f"{URL}/handoff/h-dv/claim", json={"owner": "A", "batchId": "batch55"}).json()
    # the batch carries r1 (R5: a registered batch's entries ARE its membership)
    r1 = {"origin": {"plugin": "diple-docs", "itemId": "r1", "revision": 1}, "text": "t"}
    api.put(f"{URL}/batches/batch55", json={"sessionId": "s1", "full": "F", "items": [r1], "handoffIds": ["h-dv"]})
    api.post(f"{URL}/events/handoff-receipt", json={"handoffId": "h-dv", "owner": "A", "generation": c["generation"], "accepted": ["r1"], "batchId": "batch55", "settles": True})
    assert store.handoff_settled("h-dv") is None, "nothing final yet"
    store.mark_expanded("batch55")
    store.mark_answered("batch55", answered=[], missing=[])
    claim = api.post(f"{URL}/handoff/h-dv/claim", json={"owner": "B"}).json()
    assert claim["settled"] == {"handoffId": "h-dv", "batchId": "batch55", "delivered": True}
    api.events.clear()
    replay = api.post(f"{URL}/handoff/h-dv/replay").json()
    assert replay["settled"]["delivered"] is True
    assert [e for e, _ in api.events] == ["handoff.receipt", "handoff.settled"]
    assert api.events[0][1]["settles"] is True


def test_a_failed_outcome_recorded_late_is_what_the_replay_says(api):
    store = __import__("sys").modules["hermes_diple_api_store"].store_for_current_home()
    c = api.post(f"{URL}/handoff/h-fl/claim", json={"owner": "A", "batchId": "batch66"}).json()
    r1 = {"origin": {"plugin": "diple-docs", "itemId": "r1", "revision": 1}, "text": "t"}  # it rides in the batch
    api.put(f"{URL}/batches/batch66", json={"sessionId": "s1", "full": "F", "items": [r1], "handoffIds": ["h-fl"]})
    api.post(f"{URL}/events/handoff-receipt", json={"handoffId": "h-fl", "owner": "A", "generation": c["generation"], "accepted": ["r1"], "batchId": "batch66"})
    store.mark_expanded("batch66")
    store.mark_failed("batch66", "turn-error", rejected=True)
    assert api.get(f"{URL}/handoff/h-fl").json()["settled"] is None, "a failed status alone may still be retried"
    api.post(f"{URL}/batches/batch66/final", json={"delivered": False, "reason": "turn-error", "handoffIds": ["h-fl"]})
    got = api.get(f"{URL}/handoff/h-fl").json()
    assert got["settled"] == {"handoffId": "h-fl", "batchId": "batch66", "delivered": False, "reason": "turn-error"}


def test_handoff_settled_route_keeps_the_first_word(api):
    api.post(f"{URL}/handoff/h-mo/claim", json={"owner": "A"})
    api.post(f"{URL}/events/handoff-settled", json={"handoffId": "h-mo", "batchId": "b7k2m9", "delivered": False, "reason": "turn-error"})
    r = api.post(f"{URL}/events/handoff-settled", json={"handoffId": "h-mo", "batchId": "b7k2m9", "delivered": True}).json()
    assert r["payload"] == {"v": 1, "handoffId": "h-mo", "batchId": "b7k2m9", "delivered": False, "reason": "turn-error"}


# -- migration: an R2 database gains owner / generation / batch_id / outcome ------------------
def test_an_r2_database_is_migrated_and_its_claims_can_be_taken_over(plugin):
    conn = sqlite3.connect(":memory:", check_same_thread=False)
    conn.executescript(
        "CREATE TABLE handoff_claims (handoff_id TEXT PRIMARY KEY, claimed_at REAL NOT NULL, session_id TEXT NOT NULL DEFAULT '',"
        " receipt_json TEXT, progress_json TEXT, settled_json TEXT);"
        "CREATE TABLE batches (batch_id TEXT PRIMARY KEY, session_id TEXT NOT NULL DEFAULT '', full TEXT NOT NULL,"
        " display TEXT NOT NULL DEFAULT '', items_json TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'registered',"
        " fail_reason TEXT, answer_json TEXT, created_at REAL NOT NULL, expanded_at REAL, answer_checked_at REAL);"
        "INSERT INTO handoff_claims VALUES ('h-r2', 1, 's1', NULL, '{\"stage\": \"queued\", \"accepted\": [\"r1\"], \"batchId\": \"b20aaaa\"}', NULL);"
        "INSERT INTO batches (batch_id, full, created_at) VALUES ('b20aaaa', 'F', 1);"
    )
    now = [100.0]
    store = plugin.store.DipleStore(connect=lambda: conn, clock=lambda: now[0])
    cols = {r[1] for r in conn.execute("PRAGMA table_info(handoff_claims)")}
    assert {"owner", "generation", "batch_id"} <= cols
    assert {"outcome", "outcome_reason"} <= {r[1] for r in conn.execute("PRAGMA table_info(batches)")}
    r = store.claim("h-r2", owner="B", batch_id="bnew0001")
    assert r["claimed"] is True and r["generation"] == 1
    assert r["progress"] == {"stage": "sending", "accepted": ["r1"], "batchId": "b20aaaa"}, "R2's recorded batch id stays"
    assert store.get_batch("b20aaaa")["outcome"] is None
    plugin.store.DipleStore(connect=lambda: conn)  # idempotent


def test_a_settled_handoff_whose_receipt_was_lost_replays_the_receipt_its_progress_implies(api):
    c = api.post(f"{URL}/handoff/h-nr/claim", json={"owner": "A", "batchId": "batch88"}).json()
    api.post(f"{URL}/handoff/h-nr/progress", json={"owner": "A", "generation": c["generation"], "stage": "sending", "accepted": ["r1"]})
    api.put(f"{URL}/batches/batch88", json={"sessionId": "s1", "full": "F", "items": [], "handoffIds": ["h-nr"]})
    api.post(f"{URL}/batches/batch88/final", json={"delivered": False, "reason": "turn-error", "handoffIds": ["h-nr"]})
    api.events.clear()
    r = api.post(f"{URL}/handoff/h-nr/replay").json()
    assert r["receipt"] == {"handoffId": "h-nr", "accepted": ["r1"], "settles": True, "batchId": "batch88"}
    assert [e for e, _ in api.events] == ["handoff.receipt", "handoff.settled"]
    claim = api.post(f"{URL}/handoff/h-nr/claim", json={"owner": "B"}).json()
    assert claim["claimed"] is False and claim["receipt"]["batchId"] == "batch88" and claim["settled"]["delivered"] is False


def test_a_batch_id_settled_before_it_was_registered_is_spent(plugin):
    store = _memory_store(plugin, [1.0])
    store.claim("h-sp", owner="B", batch_id="bdead1")
    _, settled = store.final_batch("bdead1", delivered=False, reason="lost", handoff_ids=["h-sp"])
    assert settled == [{"handoffId": "h-sp", "batchId": "bdead1", "delivered": False, "reason": "lost"}]
    with pytest.raises(plugin.store.BatchConflict):
        store.put_batch("bdead1", session_id="s1", full="F", items=[])
