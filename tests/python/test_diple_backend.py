"""Diple backend: @diple provider, REST routes, events, cross-instance sharing."""

from __future__ import annotations

import asyncio
import sqlite3
import threading

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from conftest import REPO, load_api_module, load_plugin_package

PLUGIN_DIR = REPO / "plugins" / "diple" / "python"


@pytest.fixture
def plugin(hermes_home):
    return load_plugin_package(PLUGIN_DIR, "hermes_plugins_diple_test")


@pytest.fixture
def api(hermes_home, monkeypatch):
    mod = load_api_module(PLUGIN_DIR, "diple", "hermes_diple_api_store")
    events = []
    monkeypatch.setattr(mod, "_broadcast", lambda event, payload: events.append((event, payload)))
    app = FastAPI()
    app.include_router(mod.router, prefix="/api/plugins/diple")
    client = TestClient(app)
    client.events = events
    return client


@pytest.fixture
def provider(plugin):
    events = []
    sleeps = []

    async def fake_sleep(s):
        sleeps.append(s)

    p = plugin.provider.DipleReferenceProvider(
        plugin.store.store_for_current_home,
        broadcast=lambda e, payload: events.append((e, payload)),
        sleep=fake_sleep,
    )
    p.events, p.sleeps = events, sleeps
    return p


def expand(provider, target):
    return asyncio.run(provider.expand(target))


BATCH = {
    "sessionId": "sess-1",
    "full": "FULL TEXT ::ann{b=\"b7k2m6qqqqqqqqqqqqqqqqqqqqq\" n=\"1\"}",
    "display": "—— 附 1 条标注 ——\n@diple:b7k2m6qqqqqqqqqqqqqqqqqqqqq",
    "items": [{"id": "a", "origin": {"sessionId": "sess-1", "role": "assistant", "ordinal": 2}, "comment": "x"}],
}


def test_register_adds_the_diple_prefix(plugin):
    class Ctx:
        def __init__(self):
            self.providers = []

        def register_context_reference(self, p):
            self.providers.append(p)

    ctx = Ctx()
    plugin.register(ctx)
    assert [p.prefix for p in ctx.providers] == ["diple"]
    from agent.context_references import ContextReferenceProvider

    assert isinstance(ctx.providers[0], ContextReferenceProvider)


def test_api_put_then_provider_expand_across_module_instances(api, provider, plugin, hermes_home):
    """The REST module and the provider are separate module instances; SQLite links them."""
    import sys

    assert sys.modules["hermes_diple_api_store"] is not plugin.store
    r = api.put("/api/plugins/diple/batches/b7k2m6qqqqqqqqqqqqqqqqqqqqq", json=BATCH)
    assert r.status_code == 200 and r.json()["status"] == "registered"
    assert expand(provider, "b7k2m6qqqqqqqqqqqqqqqqqqqqq") == BATCH["full"]
    got = api.get("/api/plugins/diple/batches/b7k2m6qqqqqqqqqqqqqqqqqqqqq").json()
    assert got["status"] == "expanded" and got["expandedAt"] and got["full"] == BATCH["full"]
    assert (hermes_home / "plugin-data" / "diple" / "data.db").exists()


def test_first_expansion_broadcasts_batch_sent_once(api, provider):
    api.put("/api/plugins/diple/batches/b7k2m6qqqqqqqqqqqqqqqqqqqqq", json=BATCH)
    expand(provider, "b7k2m6qqqqqqqqqqqqqqqqqqqqq")
    again = expand(provider, "b7k2m6qqqqqqqqqqqqqqqqqqqqq")
    assert again == BATCH["full"], "re-expansion (retry) returns the same content"
    assert provider.events == [("batch.sent", {
        "v": 1, "batchId": "b7k2m6qqqqqqqqqqqqqqqqqqqqq", "sessionId": "sess-1",
        "items": [{"origin": BATCH["items"][0]["origin"]}],
    })]


def test_unregistered_batch_waits_once_then_says_missing(provider):
    text = expand(provider, "bnopeaaaaaaaaaaaaaaaaaaaaaa")
    assert provider.sleeps == [2.0]
    assert "bnopeaaaaaaaaaaaaaaaaaaaaaa" in text and "丢失" in text and "missing" in text


def test_registration_landing_during_the_retry_wait_is_found(plugin):
    store = plugin.store.store_for_current_home()

    async def late_put(_):
        store.put_batch("blateaaaaaaaaaaaaaaaaaaaaaa", session_id="s", full="LATE")

    p = plugin.provider.DipleReferenceProvider(plugin.store.store_for_current_home, broadcast=lambda *a: None,
                                                 sleep=late_put)
    assert expand(p, "blateaaaaaaaaaaaaaaaaaaaaaa") == "LATE"


def test_invalid_target_is_not_expanded_and_not_an_exception(provider):
    assert expand(provider, "../../etc") is None


def test_provider_survives_a_broken_store(plugin):
    def broken():
        raise sqlite3.OperationalError("disk I/O error")

    p = plugin.provider.DipleReferenceProvider(broken, broadcast=lambda *a: None)
    assert "丢失" in expand(p, "b7k2m6qqqqqqqqqqqqqqqqqqqqq")


def test_host_expansion_pipeline_attaches_full_text(provider, api, tmp_path):
    """Through the host's own preprocess: the reference stays, Attached Context holds the full text."""
    from agent.context_references import (
        _context_reference_providers, preprocess_context_references, register_context_reference_provider,
    )

    api.put("/api/plugins/diple/batches/b7k2m6qqqqqqqqqqqqqqqqqqqqq", json=BATCH)
    _context_reference_providers.pop("diple", None)
    register_context_reference_provider(provider)
    try:
        r = preprocess_context_references("正文\n@diple:b7k2m6qqqqqqqqqqqqqqqqqqqqq", cwd=tmp_path, context_length=200_000)
    finally:
        _context_reference_providers.pop("diple", None)
    assert not r.blocked
    assert r.message.startswith("正文\n@diple:b7k2m6qqqqqqqqqqqqqqqqqqqqq\n\n--- Attached Context ---\n\n📌 @diple:b7k2m6qqqqqqqqqqqqqqqqqqqqq (")
    assert r.message.endswith(BATCH["full"])


def test_put_after_expansion_is_a_conflict(api, provider):
    api.put("/api/plugins/diple/batches/b7k2m6qqqqqqqqqqqqqqqqqqqqq", json=BATCH)
    expand(provider, "b7k2m6qqqqqqqqqqqqqqqqqqqqq")
    r = api.put("/api/plugins/diple/batches/b7k2m6qqqqqqqqqqqqqqqqqqqqq", json={**BATCH, "full": "CHANGED"})
    assert r.status_code == 409
    assert api.get("/api/plugins/diple/batches/b7k2m6qqqqqqqqqqqqqqqqqqqqq").json()["full"] == BATCH["full"]


def test_put_updates_a_registered_batch(api):
    api.put("/api/plugins/diple/batches/b7k2m6qqqqqqqqqqqqqqqqqqqqq", json=BATCH)
    r = api.put("/api/plugins/diple/batches/b7k2m6qqqqqqqqqqqqqqqqqqqqq", json={**BATCH, "full": "NEWER"})
    assert r.status_code == 200 and r.json()["full"] == "NEWER"


@pytest.mark.parametrize("body,code", [({}, 422), ({"full": ""}, 400), ({"full": "x", "items": "no"}, 400)])
def test_put_validation(api, body, code):
    assert api.put("/api/plugins/diple/batches/b7k2m6qqqqqqqqqqqqqqqqqqqqq", json=body or None).status_code == code


def test_bad_batch_id_is_rejected(api):
    assert api.get("/api/plugins/diple/batches/a b").status_code in (400, 404)
    assert api.get("/api/plugins/diple/batches/abc").status_code == 400
    assert api.get("/api/plugins/diple/batches/zzzz9999").status_code == 404


def test_answered_is_idempotent_and_only_after_expansion(api, provider):
    api.put("/api/plugins/diple/batches/b7k2m6qqqqqqqqqqqqqqqqqqqqq", json=BATCH)
    early = api.post("/api/plugins/diple/batches/b7k2m6qqqqqqqqqqqqqqqqqqqqq/answered", json={"answered": [1], "missing": []}).json()
    assert early["first"] is False and early["batch"]["status"] == "registered"
    expand(provider, "b7k2m6qqqqqqqqqqqqqqqqqqqqq")
    first = api.post("/api/plugins/diple/batches/b7k2m6qqqqqqqqqqqqqqqqqqqqq/answered", json={"answered": [1], "missing": [3]}).json()
    second = api.post("/api/plugins/diple/batches/b7k2m6qqqqqqqqqqqqqqqqqqqqq/answered", json={"answered": [], "missing": [1]}).json()
    assert first["first"] is True and second["first"] is False
    assert second["batch"]["status"] == "answered"
    assert second["batch"]["answer"] == {"answered": [1], "missing": [3], "noMarkers": False}


def test_failed_only_before_expansion(api, provider):
    api.put("/api/plugins/diple/batches/b7k2m6qqqqqqqqqqqqqqqqqqqqq", json=BATCH)
    assert api.post("/api/plugins/diple/batches/b7k2m6qqqqqqqqqqqqqqqqqqqqq/failed", json={"reason": "submit-refused"}).json()["status"] == "failed"
    # a failed batch can be retried: re-register, then it expands normally
    assert api.put("/api/plugins/diple/batches/b7k2m6qqqqqqqqqqqqqqqqqqqqq", json=BATCH).json()["status"] == "registered"
    expand(provider, "b7k2m6qqqqqqqqqqqqqqqqqqqqq")
    assert api.post("/api/plugins/diple/batches/b7k2m6qqqqqqqqqqqqqqqqqqqqq/failed", json={}).json()["status"] == "expanded"


def test_rejected_after_expansion_can_be_marked_failed(api, provider):
    api.put("/api/plugins/diple/batches/b7k2m6qqqqqqqqqqqqqqqqqqqqq", json=BATCH)
    expand(provider, "b7k2m6qqqqqqqqqqqqqqqqqqqqq")
    before = list(api.events)
    # the old call is unchanged: an expanded batch stays expanded
    assert api.post("/api/plugins/diple/batches/b7k2m6qqqqqqqqqqqqqqqqqqqqq/failed", json={"reason": "turn-error"}).json()["status"] == "expanded"
    assert api.post("/api/plugins/diple/batches/b7k2m6qqqqqqqqqqqqqqqqqqqqq/failed", json={"reason": "x", "rejected": "yes"}).json()["status"] == "expanded"
    # W3: the host refused the turn after expanding it
    r = api.post("/api/plugins/diple/batches/b7k2m6qqqqqqqqqqqqqqqqqqqqq/failed", json={"reason": "turn-error", "rejected": True}).json()
    assert r["status"] == "failed" and r["batchId"] == "b7k2m6qqqqqqqqqqqqqqqqqqqqq"
    assert api.get("/api/plugins/diple/batches/b7k2m6qqqqqqqqqqqqqqqqqqqqq").json()["status"] == "failed"
    assert list(api.events) == before, "no event is broadcast by /failed"


def test_rejected_flag_never_fails_an_answered_batch(api, provider):
    api.put("/api/plugins/diple/batches/b7k2m6qqqqqqqqqqqqqqqqqqqqq", json=BATCH)
    expand(provider, "b7k2m6qqqqqqqqqqqqqqqqqqqqq")
    api.post("/api/plugins/diple/batches/b7k2m6qqqqqqqqqqqqqqqqqqqqq/answered", json={"answered": [1], "missing": []})
    r = api.post("/api/plugins/diple/batches/b7k2m6qqqqqqqqqqqqqqqqqqqqq/failed", json={"reason": "late", "rejected": True}).json()
    assert r["status"] == "answered"


def test_list_batches_by_session_and_status(api, provider):
    api.put("/api/plugins/diple/batches/aaaa1111", json={**BATCH, "sessionId": "s1"})
    api.put("/api/plugins/diple/batches/bbbbb2222222222222222222222", json={**BATCH, "sessionId": "s1"})
    api.put("/api/plugins/diple/batches/cccc3333", json={**BATCH, "sessionId": "s2"})
    expand(provider, "bbbbb2222222222222222222222")
    ids = lambda r: [b["batchId"] for b in r.json()["batches"]]
    assert ids(api.get("/api/plugins/diple/batches", params={"sessionId": "s1"})) == ["bbbbb2222222222222222222222", "aaaa1111"]
    assert ids(api.get("/api/plugins/diple/batches", params={"sessionId": "s1", "status": "expanded"})) == ["bbbbb2222222222222222222222"]
    assert api.get("/api/plugins/diple/batches", params={"status": "bogus"}).status_code == 400


def test_handoff_claim_is_first_come_only(api):
    a = api.post("/api/plugins/diple/handoff/h-123/claim", json={"sessionId": "s1", "owner": "A", "batchId": "b7k2m6qqqqqqqqqqqqqqqqqqqqq"}).json()
    b = api.post("/api/plugins/diple/handoff/h-123/claim", json={"sessionId": "s2", "owner": "B"}).json()
    assert (a, b) == ({"claimed": True, "owner": "A", "generation": 1, "batchId": "b7k2m6qqqqqqqqqqqqqqqqqqqqq"}, {"claimed": False})
    assert api.post("/api/plugins/diple/handoff/x/claim").status_code == 400


def test_handoff_claim_is_atomic_across_threads_and_instances(plugin, hermes_home):
    stores = [plugin.store.DipleStore() for _ in range(8)]
    results = []
    barrier = threading.Barrier(len(stores))

    def claim(store):
        barrier.wait()
        results.append(store.claim_handoff("race-handoff", "s"))

    threads = [threading.Thread(target=claim, args=(s,)) for s in stores]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert sorted(results) == [False] * 7 + [True]


def test_event_routes_broadcast_versioned_payloads(api):
    r = api.post("/api/plugins/diple/events/batch-answered",
                 json={"batchId": "b7k2m6qqqqqqqqqqqqqqqqqqqqq", "answered": [{"origin": {"plugin": "diple-docs", "itemId": "i1"}}]})
    assert r.status_code == 200
    api.post("/api/plugins/diple/handoff/h-123/claim", json={"owner": "A"})
    r2 = api.post("/api/plugins/diple/events/handoff-receipt",
                  json={"handoffId": "h-123", "owner": "A", "generation": 1, "accepted": ["i1"], "batchId": "b7k2m6qqqqqqqqqqqqqqqqqqqqq"})
    assert r2.status_code == 200
    assert api.events == [
        ("batch.answered", {"v": 1, "batchId": "b7k2m6qqqqqqqqqqqqqqqqqqqqq", "answered": [{"origin": {"plugin": "diple-docs", "itemId": "i1"}}]}),
        ("handoff.receipt", {"v": 1, "handoffId": "h-123", "accepted": ["i1"], "batchId": "b7k2m6qqqqqqqqqqqqqqqqqqqqq"}),
    ]
    assert api.post("/api/plugins/diple/events/handoff-receipt", json={"handoffId": "?"}).status_code == 400


def test_real_broadcast_helper_names_the_event(hermes_home, monkeypatch):
    """Without monkeypatching: the module's _broadcast goes through the official door."""
    mod = load_api_module(PLUGIN_DIR, "diple", "hermes_diple_api_store")
    sent = []
    import hermes_cli.plugin_events as pe

    monkeypatch.setattr(pe, "broadcast_plugin_event", lambda pid, ev, payload=None: sent.append(pe.plugin_event_name(pid, ev)))
    mod._broadcast("batch.answered", {})
    assert sent == ["plugin.diple.batch.answered"]


def test_data_survives_a_restart(api, plugin, hermes_home):
    api.put("/api/plugins/diple/batches/b7k2m6qqqqqqqqqqqqqqqqqqqqq", json=BATCH)
    fresh = plugin.store.DipleStore()  # a new process would open the file anew
    assert fresh.get_batch("b7k2m6qqqqqqqqqqqqqqqqqqqqq")["full"] == BATCH["full"]
