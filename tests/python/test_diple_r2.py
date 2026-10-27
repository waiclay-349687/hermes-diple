"""fix-a2 — GPT code review R2, the Diple backend half: XE2-01, XE2-03 (XE-04), XR-09 settled."""

from __future__ import annotations

import sqlite3
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest

from test_diple_backend import api, plugin  # noqa: F401  (fixtures)

URL = "/api/plugins/diple"
OLD_CLAIMS = "CREATE TABLE handoff_claims (handoff_id TEXT PRIMARY KEY, claimed_at REAL NOT NULL, session_id TEXT NOT NULL DEFAULT '')"


# -- XE2-01: two module instances migrating the same old database at once ------------------
def test_two_stores_migrate_one_old_database_concurrently(plugin, tmp_path):
    path = tmp_path / "old.sqlite"
    conn = sqlite3.connect(path)
    conn.execute(OLD_CLAIMS)
    conn.execute("INSERT INTO handoff_claims VALUES ('h-old', 1, 's1')")
    conn.commit()
    conn.close()

    # Hold both migrations right after they read the table's columns, so each
    # sees the old table (the interleaving the R2 probe forced). A store that
    # serialises its migration blocks the second reader; the barrier then
    # times out and lets the first one go on.
    barrier = threading.Barrier(2, timeout=1.5)

    class GateCursor:
        def __init__(self, c):
            self.c = c

        def fetchall(self):
            rows = self.c.fetchall()
            try:
                barrier.wait()
            except threading.BrokenBarrierError:
                pass
            return rows

    class GateConnection(sqlite3.Connection):
        def execute(self, sql, *args, **kwargs):
            c = super().execute(sql, *args, **kwargs)
            return GateCursor(c) if sql.startswith("PRAGMA table_info(handoff_claims)") else c

    def open_store(_):
        try:
            s = plugin.store.DipleStore(connect=lambda: sqlite3.connect(path, timeout=10, check_same_thread=False, factory=GateConnection))
            s.close()
            return "ok"
        except Exception as e:  # noqa: BLE001
            return f"{type(e).__name__}: {e}"

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(open_store, [1, 2]))
    assert results == ["ok", "ok"]
    store = plugin.store.DipleStore(connect=lambda: sqlite3.connect(path, check_same_thread=False))
    cols = {r[1] for r in store._conn.execute("PRAGMA table_info(handoff_claims)")}
    assert {"receipt_json", "progress_json", "settled_json", "owner", "generation", "batch_id"} <= cols
    c = store.claim("h-old", owner="A")
    store.save_handoff_receipt("h-old", {"handoffId": "h-old", "accepted": ["r1"]}, owner="A", generation=c["generation"])
    assert store.handoff_receipt("h-old") == {"handoffId": "h-old", "accepted": ["r1"]}


def test_a_database_from_r1_gains_the_new_columns_and_keeps_its_receipts(plugin):
    conn = sqlite3.connect(":memory:", check_same_thread=False)
    conn.executescript(OLD_CLAIMS[:-1] + ", receipt_json TEXT);"
                       "INSERT INTO handoff_claims VALUES ('h-r1', 1, 's1', '{\"handoffId\": \"h-r1\", \"accepted\": [\"a\"]}');")
    store = plugin.store.DipleStore(connect=lambda: conn)
    assert store.handoff_receipt("h-r1") == {"handoffId": "h-r1", "accepted": ["a"]}
    assert store.handoff_settled("h-r1") is None
    plugin.store.DipleStore(connect=lambda: conn)  # idempotent


# -- XE2-03: a take-over gets the progress the dead window recorded --------------------------
def test_take_over_returns_the_recorded_progress(plugin, hermes_home):
    now = [1000.0]
    store = plugin.store.DipleStore(clock=lambda: now[0])
    a = store.claim("h-01", owner="A", batch_id="b20aaaa")
    assert store.advance_handoff("h-01", owner="A", generation=a["generation"], stage="sending", accepted=["r1"])
    now[0] += plugin.store.CLAIM_STALE_S + 1
    b = store.claim("h-01", owner="B", batch_id="bOther1")
    assert b["progress"] == {"stage": "sending", "accepted": ["r1"], "batchId": "b20aaaa"}
    store.save_handoff_receipt("h-01", {"handoffId": "h-01", "accepted": ["r1"]}, owner="B", generation=b["generation"])
    # finished: progress is frozen
    assert not store.advance_handoff("h-01", owner="B", generation=b["generation"], stage="sending", accepted=[])
    assert store.handoff_progress("h-01")["stage"] == "sending"


def test_claim_route_hands_progress_to_the_window_that_takes_over(api, monkeypatch):
    mod = __import__("sys").modules["hermes_diple_api_store"]
    now = [5000.0]
    monkeypatch.setattr(mod.store_for_current_home(), "_clock", lambda: now[0])
    first = api.post(f"{URL}/handoff/h-02/claim", json={"sessionId": "s1", "owner": "A", "batchId": "b20aaaa"}).json()
    assert first == {"claimed": True, "owner": "A", "generation": 1, "batchId": "b20aaaa"}
    r = api.post(f"{URL}/handoff/h-02/progress", json={"owner": "A", "generation": 1, "stage": "sending", "accepted": ["r1"]})
    assert r.status_code == 200
    assert api.post(f"{URL}/handoff/h-02/claim", json={"sessionId": "s1", "owner": "B"}).json() == {"claimed": False}
    now[0] += mod.CLAIM_STALE_S + 1
    assert api.post(f"{URL}/handoff/h-02/claim", json={"sessionId": "s1", "owner": "B"}).json() == {
        "claimed": True, "owner": "B", "generation": 2, "batchId": "b20aaaa",
        "progress": {"stage": "sending", "accepted": ["r1"], "batchId": "b20aaaa"}}


@pytest.mark.parametrize("body", [{"stage": "nope", "owner": "A", "generation": 1}, {"stage": "sending", "accepted": "r1", "owner": "A", "generation": 1},
                                  {"stage": "queued", "owner": "A", "generation": 1}, {"stage": "sending"}])
def test_progress_rejects_malformed_bodies(api, body):
    api.post(f"{URL}/handoff/h-03/claim", json={})
    assert api.post(f"{URL}/handoff/h-03/progress", json=body).status_code == 400


# -- XR-09: handoff.settled — the outcome of a sendNow hand-off, kept and replayed -----------
def test_settled_is_broadcast_kept_and_replayed_with_the_claim(api):
    api.post(f"{URL}/handoff/h-04/claim", json={"sessionId": "s1", "owner": "A"})
    api.post(f"{URL}/events/handoff-receipt", json={"handoffId": "h-04", "owner": "A", "generation": 1, "accepted": ["r1"], "batchId": "b7k2m9"})
    r = api.post(f"{URL}/events/handoff-settled", json={"handoffId": "h-04", "batchId": "b7k2m9", "delivered": False, "reason": "turn-error"})
    assert r.status_code == 200
    payload = {"v": 1, "handoffId": "h-04", "batchId": "b7k2m9", "delivered": False, "reason": "turn-error"}
    assert ("handoff.settled", payload) in api.events
    again = api.post(f"{URL}/handoff/h-04/claim", json={"sessionId": "s1"}).json()
    assert again == {
        "claimed": False,
        "receipt": {"handoffId": "h-04", "accepted": ["r1"], "batchId": "b7k2m9"},
        "settled": {"handoffId": "h-04", "batchId": "b7k2m9", "delivered": False, "reason": "turn-error"},
    }


def test_settled_delivered_has_no_reason(api):
    api.post(f"{URL}/handoff/h-05/claim", json={})
    r = api.post(f"{URL}/events/handoff-settled", json={"handoffId": "h-05", "batchId": "b7k2m9", "delivered": True})
    assert r.json()["payload"] == {"v": 1, "handoffId": "h-05", "batchId": "b7k2m9", "delivered": True}


@pytest.mark.parametrize("body", [
    {"handoffId": "h-06", "batchId": "b7k2m9"},
    {"handoffId": "h-06", "batchId": "b7k2m9", "delivered": "yes"},
    {"handoffId": "h-06", "batchId": "../x", "delivered": True},
    {"handoffId": "h-06", "batchId": "b7k2m9", "delivered": False, "reason": 3},
    {"handoffId": "x", "batchId": "b7k2m9", "delivered": True},
])
def test_settled_rejects_malformed_bodies(api, body):
    assert api.post(f"{URL}/events/handoff-settled", json=body).status_code == 400
