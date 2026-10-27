"""fix-a — GPT code review R1, the Diple backend half: XE-04, XE-14, XE-15."""

from __future__ import annotations

import asyncio

import pytest

from test_diple_backend import BATCH, api, expand, plugin, provider  # noqa: F401  (fixtures)

URL = "/api/plugins/diple"


# -- XE-04: hand-off claims keep their receipt; a dead claim can be taken over -----------
def test_claim_returns_the_stored_receipt_to_a_later_window(api):
    assert api.post(f"{URL}/handoff/h-123/claim", json={"sessionId": "s1", "owner": "A"}).json() == {"claimed": True, "owner": "A", "generation": 1}
    api.post(f"{URL}/events/handoff-receipt", json={"handoffId": "h-123", "owner": "A", "generation": 1, "accepted": ["i1"], "batchId": "b7k2m6qqqqqqqqqqqqqqqqqqqqq"})
    again = api.post(f"{URL}/handoff/h-123/claim", json={"sessionId": "s1"}).json()
    assert again == {"claimed": False, "receipt": {"handoffId": "h-123", "accepted": ["i1"], "batchId": "b7k2m6qqqqqqqqqqqqqqqqqqqqq"}}


def test_a_claim_without_receipt_can_be_taken_over_once_stale(plugin, hermes_home):
    now = [1000.0]
    store = plugin.store.DipleStore(clock=lambda: now[0])
    assert store.claim_handoff("h-dead", "s1") is True
    assert store.claim_handoff("h-dead", "s1") is False  # the first window may still be working
    now[0] += plugin.store.CLAIM_STALE_S + 1
    assert store.claim_handoff("h-dead", "s1") is True  # it died: take over
    assert store.claim_handoff("h-dead", "s1") is False
    store.claim("h-dead", owner="C")  # (not stale: no claim)
    now[0] += plugin.store.CLAIM_STALE_S + 1
    c = store.claim("h-dead", owner="C")
    assert c["generation"] == 3
    store.save_handoff_receipt("h-dead", {"handoffId": "h-dead", "accepted": []}, owner="C", generation=3)
    now[0] += plugin.store.CLAIM_STALE_S + 1
    assert store.claim_handoff("h-dead", "s1") is False  # finished claims are never re-run
    assert store.handoff_receipt("h-dead") == {"handoffId": "h-dead", "accepted": []}


def test_old_claims_table_is_migrated(plugin, hermes_home):
    import sqlite3

    conn = sqlite3.connect(":memory:", check_same_thread=False)
    conn.executescript("CREATE TABLE handoff_claims (handoff_id TEXT PRIMARY KEY, claimed_at REAL NOT NULL, session_id TEXT NOT NULL DEFAULT '');"
                       "INSERT INTO handoff_claims VALUES ('h-old', 1, '');")
    store = plugin.store.DipleStore(connect=lambda: conn)
    c = store.claim("h-old", owner="A")  # an R0 claim is long stale: taken over
    store.save_handoff_receipt("h-old", {"handoffId": "h-old", "accepted": ["a"]}, owner="A", generation=c["generation"])
    assert store.handoff_receipt("h-old")["accepted"] == ["a"]


# -- XE-14: an already delivered batch only expands again in its own session -------------
def _expand_in(provider, target, session_id, session_key=""):
    from gateway import session_context as sc

    async def run():
        sc._SESSION_ID.set(session_id)
        sc._SESSION_KEY.set(session_key)
        return await provider.expand(target)

    return asyncio.run(run())  # asyncio.run copies the context: nothing leaks


def test_first_expansion_is_allowed_from_the_sending_turn(api, provider):
    api.put(f"{URL}/batches/b7k2m6qqqqqqqqqqqqqqqqqqqqq", json=BATCH)
    assert _expand_in(provider, "b7k2m6qqqqqqqqqqqqqqqqqqqqq", "sess-1") == BATCH["full"]
    # the same session may expand it again (retry / regenerate)
    assert _expand_in(provider, "b7k2m6qqqqqqqqqqqqqqqqqqqqq", "sess-1") == BATCH["full"]
    assert _expand_in(provider, "b7k2m6qqqqqqqqqqqqqqqqqqqqq", "other", session_key="sess-1") == BATCH["full"]


def test_a_delivered_batch_does_not_expand_in_another_session(api, provider):
    api.put(f"{URL}/batches/b7k2m6qqqqqqqqqqqqqqqqqqqqq", json=BATCH)
    assert _expand_in(provider, "b7k2m6qqqqqqqqqqqqqqqqqqqqq", "sess-1") == BATCH["full"]
    events = list(provider.events)
    other = _expand_in(provider, "b7k2m6qqqqqqqqqqqqqqqqqqqqq", "sess-2")
    assert other != BATCH["full"] and "FULL TEXT" not in other
    assert "b7k2m6qqqqqqqqqqqqqqqqqqqqq" in other
    assert provider.events == events, "no batch.sent for a refused expansion"


def test_no_bound_session_keeps_the_old_behaviour(api, provider):
    api.put(f"{URL}/batches/b7k2m6qqqqqqqqqqqqqqqqqqqqq", json=BATCH)
    expand(provider, "b7k2m6qqqqqqqqqqqqqqqqqqqqq")
    assert expand(provider, "b7k2m6qqqqqqqqqqqqqqqqqqqqq") == BATCH["full"]  # CLI / no session context
    assert _expand_in(provider, "b7k2m6qqqqqqqqqqqqqqqqqqqqq", "") == BATCH["full"]  # cleared context


# -- XE-15: nested shapes are validated; broadcasts come from trusted data ---------------
@pytest.mark.parametrize("items", [[7], ["x"], [{"origin": 5, "text": "t"}], [{"text": 5}], [{"comment": []}]])
def test_put_rejects_malformed_items(api, items):
    assert api.put(f"{URL}/batches/b7k2m6qqqqqqqqqqqqqqqqqqqqq", json={**BATCH, "items": items}).status_code == 400


@pytest.mark.parametrize("body", [{"answered": 1}, {"missing": "1,2"}, {"answered": [True]}, {"answered": ["1"]}])
def test_answered_rejects_malformed_numbers(api, provider, body):
    api.put(f"{URL}/batches/b7k2m6qqqqqqqqqqqqqqqqqqqqq", json=BATCH)
    expand(provider, "b7k2m6qqqqqqqqqqqqqqqqqqqqq")
    assert api.post(f"{URL}/batches/b7k2m6qqqqqqqqqqqqqqqqqqqqq/answered", json=body).status_code == 400


@pytest.mark.parametrize("answered", [[7], "x", [{"origin": 3}]])
def test_batch_answered_event_rejects_malformed_items(api, answered):
    assert api.post(f"{URL}/events/batch-answered", json={"batchId": "b7k2m6qqqqqqqqqqqqqqqqqqqqq", "answered": answered}).status_code == 400


def test_batch_answered_event_takes_origins_from_the_stored_batch(api, provider):
    api.put(f"{URL}/batches/b7k2m6qqqqqqqqqqqqqqqqqqqqq", json=BATCH)
    expand(provider, "b7k2m6qqqqqqqqqqqqqqqqqqqqq")
    r = api.post(f"{URL}/events/batch-answered",
                 json={"batchId": "b7k2m6qqqqqqqqqqqqqqqqqqqqq", "numbers": [1], "answered": [{"origin": {"forged": True}}]})
    assert r.status_code == 200
    assert api.events[-1] == ("batch.answered", {"v": 1, "batchId": "b7k2m6qqqqqqqqqqqqqqqqqqqqq", "answered": [{"origin": BATCH["items"][0]["origin"]}]})
    assert api.post(f"{URL}/events/batch-answered", json={"batchId": "b7k2m6qqqqqqqqqqqqqqqqqqqqq", "numbers": [9]}).status_code == 400


@pytest.mark.parametrize("accepted", ["r1", [1], [{"id": "r1"}]])
def test_handoff_receipt_rejects_non_string_ids(api, accepted):
    assert api.post(f"{URL}/events/handoff-receipt", json={"handoffId": "h-123", "accepted": accepted}).status_code == 400


def test_batch_sent_broadcast_survives_odd_stored_items(plugin, provider):
    store = plugin.store.store_for_current_home()
    store.put_batch("b7k2m6qqqqqqqqqqqqqqqqqqqqq", session_id="s", full="F", items=[{"id": "a", "origin": None}, {"id": "b"}])
    assert expand(provider, "b7k2m6qqqqqqqqqqqqqqqqqqqqq") == "F"
    assert provider.events[0][1]["items"] == [{"origin": None}, {"origin": None}]


# -- XR-09 (receiver half): a busy-session sendNow reports queued, and the replay keeps it ------
def test_handoff_receipt_carries_queued_and_replays_it(api):
    assert api.post(f"{URL}/handoff/h-q1/claim", json={"sessionId": "s1", "owner": "A"}).json()["claimed"] is True
    r = api.post(f"{URL}/events/handoff-receipt", json={"handoffId": "h-q1", "owner": "A", "generation": 1, "accepted": ["i1"], "queued": True, "settles": True}).json()
    assert r["payload"] == {"v": 1, "handoffId": "h-q1", "accepted": ["i1"], "queued": True, "settles": True}
    again = api.post(f"{URL}/handoff/h-q1/claim", json={"sessionId": "s1"}).json()
    assert again == {"claimed": False, "receipt": {"handoffId": "h-q1", "accepted": ["i1"], "queued": True, "settles": True}}
    api.post(f"{URL}/handoff/h-q2/claim", json={"owner": "A"})
    plain = api.post(f"{URL}/events/handoff-receipt", json={"handoffId": "h-q2", "owner": "A", "generation": 1, "accepted": [], "queued": "yes"}).json()
    assert "queued" not in plain["payload"], "only a literal true counts"
