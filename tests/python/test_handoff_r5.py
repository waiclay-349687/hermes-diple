"""fix-r5 — R5 backend: membership of a registered batch, and what a sender may be told.

XE4-02 residual: a batch put_batch registered holds its whole membership, so a
hand-off whose item is not among the entries was 'removed' — also when no entry
is a hand-off item (manual annotations only) or there is none. Unknown membership
(a final_batch placeholder, a row from before R5 that carries no hand-off item)
keeps the batch's word.

XE5-02: a sender that did not declare caps ['partial'] is never told a partly
carried hand-off was delivered: it hears delivered:false, reason:'partial', and
an older Review backend then puts every item back as pending.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from conftest import load_api_module
from test_diple_backend import api, plugin  # noqa: F401  (fixtures)

ROOT = Path(__file__).resolve().parents[2]
URL = "/api/plugins/diple"
MANUAL = {"origin": {"sessionId": "s1", "role": "assistant", "rowId": 123}, "text": "a chat capture", "comment": "c"}


def _review_item(item_id, revision=1):
    return {"origin": {"plugin": "diple-docs", "itemId": item_id, "revision": revision, "path": "/w/a.md"},
            "text": "t " + item_id, "comment": "c"}


def _handoff(api, hid, accepted, batch, caps=None):
    body = {"owner": "A", "batchId": batch, **({"caps": caps} if caps is not None else {})}
    c = api.post(f"{URL}/handoff/{hid}/claim", json=body).json()
    api.post(f"{URL}/events/handoff-receipt", json={"handoffId": hid, "owner": "A", "generation": c["generation"],
                                                   "accepted": accepted, "queued": True, "settles": True})


@pytest.mark.parametrize("entries", [[MANUAL], [MANUAL, MANUAL], []], ids=["one-manual", "two-manual", "no-entries"])
@pytest.mark.parametrize("declared", [True, False], ids=["handoffItems", "receipt-only"])
def test_registered_batch_without_the_handoff_item_settles_it_removed(api, entries, declared):
    _handoff(api, "h-man", ["r0001"], "batchM1")
    body = {"sessionId": "s1", "full": "F", "items": entries, "handoffIds": ["h-man"]}
    if declared:
        body["handoffItems"] = {"h-man": [{"itemId": "r0001", "revision": 1}]}
    assert api.put(f"{URL}/batches/batchM1", json=body).status_code == 200
    st = api.post(f"{URL}/batches/batchM1/final", json={"delivered": True, "handoffIds": ["h-man"]}).json()["settled"][0]
    assert st["delivered"] is False and st["reason"] == "removed"
    broadcast = [p for e, p in api.events if e == "handoff.settled"]
    assert broadcast[-1]["delivered"] is False


def test_a_placeholder_batch_is_unknown_membership(api):
    _handoff(api, "h-ph", ["r0001"], "batchPH")
    st = api.post(f"{URL}/batches/batchPH/final", json={"delivered": False, "reason": "cancelled", "handoffIds": ["h-ph"]}).json()["settled"][0]
    assert st == {"handoffId": "h-ph", "batchId": "batchPH", "delivered": False, "reason": "cancelled"}


def test_a_row_from_before_r5_without_any_handoff_item_keeps_the_batchs_word(plugin):
    """Upgrade safety: an old answered row (no members_known) whose items name no hand-off
    item cannot be told apart from a legacy row with no items on record."""
    conn = sqlite3.connect(":memory:", check_same_thread=False)
    conn.executescript(
        "CREATE TABLE handoff_claims (handoff_id TEXT PRIMARY KEY, claimed_at REAL NOT NULL, session_id TEXT NOT NULL DEFAULT '', "
        "receipt_json TEXT, progress_json TEXT, settled_json TEXT); CREATE TABLE batches (batch_id TEXT PRIMARY KEY, "
        "session_id TEXT NOT NULL DEFAULT '', full TEXT NOT NULL, display TEXT NOT NULL DEFAULT '', items_json TEXT NOT NULL "
        "DEFAULT '[]', status TEXT NOT NULL DEFAULT 'registered', fail_reason TEXT, answer_json TEXT, created_at REAL NOT NULL, "
        "expanded_at REAL, answer_checked_at REAL);")
    conn.execute("INSERT INTO handoff_claims VALUES (?,?,?,?,?,NULL)",
                 ("h-old", 1, "s1", json.dumps({"handoffId": "h-old", "accepted": ["r1"], "batchId": "batchOld"}),
                  json.dumps({"stage": "sending", "accepted": ["r1"], "batchId": "batchOld"})))
    conn.execute("INSERT INTO batches(batch_id,full,status,created_at) VALUES ('batchOld','F','answered',1)")
    conn.commit()
    store = plugin.store.DipleStore(connect=lambda: conn, clock=lambda: 100)
    assert store.handoff_settled("h-old")["delivered"] is True
    # the same store registers a new batch now: its membership is known
    store.claim("h-new", owner="A", batch_id="batchNew")
    store.put_batch("batchNew", session_id="s1", full="F", items=[MANUAL], handoff_ids=["h-new"])
    store.save_handoff_receipt("h-new", {"handoffId": "h-new", "accepted": ["r2"]}, owner="A", generation=1)
    store.mark_expanded("batchNew")
    store.mark_answered("batchNew", answered=[], missing=[])
    assert store.handoff_settled("h-new")["reason"] == "removed"


def _partly(api, caps):
    _handoff(api, "h-part", ["r1", "r2"], "batchP", caps=caps)
    api.put(f"{URL}/batches/batchP", json={"sessionId": "s1", "full": "F", "items": [_review_item("r2")], "handoffIds": ["h-part"],
                                            "handoffItems": {"h-part": [{"itemId": "r1", "revision": 1}, {"itemId": "r2", "revision": 1}]}})
    return api.post(f"{URL}/batches/batchP/final", json={"delivered": True, "handoffIds": ["h-part"]}).json()["settled"][0]


def test_a_sender_that_declared_partial_hears_which_item_went_out(api):
    st = _partly(api, ["partial"])
    assert st["delivered"] is True
    assert st["items"] == [{"itemId": "r1", "delivered": False, "reason": "removed"}, {"itemId": "r2", "delivered": True}]
    wire = [p for e, p in api.events if e == "handoff.settled"][-1]
    assert wire["delivered"] is True and wire["items"] == st["items"]


@pytest.mark.parametrize("caps", [None, [], ["other"]], ids=["absent", "empty", "other"])
def test_an_older_sender_is_told_partial_never_delivered(api, caps):
    st = _partly(api, caps)
    assert st == {"handoffId": "h-part", "batchId": "batchP", "delivered": False, "reason": "partial"}
    wire = [p for e, p in api.events if e == "handoff.settled"][-1]
    assert wire["delivered"] is False and wire["reason"] == "partial" and "items" not in wire
    # every other way it is read back says the same
    assert api.get(f"{URL}/handoff/h-part").json()["settled"] == st
    assert api.post(f"{URL}/handoff/h-part/claim", json={"owner": "B"}).json()["settled"] == st
    assert api.post(f"{URL}/handoff/h-part/replay", json={}).json()["settled"] == st


def test_caps_must_be_short_strings(api):
    assert api.post(f"{URL}/handoff/h-caps/claim", json={"owner": "A", "caps": "partial"}).status_code == 400
    assert api.post(f"{URL}/handoff/h-caps/claim", json={"owner": "A", "caps": [1]}).status_code == 400

