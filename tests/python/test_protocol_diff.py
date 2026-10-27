"""fix-r5 — differential test of the hand-off protocol's shared decision functions.

packages/core/test/protocol-diff.mjs generates inputs (malformed ones included) and
the JS reference's output for each; the Python twins must give the SAME output on
every one of them:

  settledFromBatch / settledForHandoff / settledForPeer → plugins/diple/python/store.py
  ledgerStep (random request sequences)                 → DipleStore (SQLite)

Several seeds, PER_FUNCTION generated cases each.
"""

from __future__ import annotations

import json
import shutil
import sqlite3
import subprocess
from pathlib import Path

import pytest

from conftest import load_api_module
from test_diple_backend import plugin  # noqa: F401  (fixture)

ROOT = Path(__file__).resolve().parents[2]
SEEDS = (1, 7, 2026)
PER_FUNCTION = 1000


def _generate(seed: int) -> dict:
    node = shutil.which("node") or ""
    if not node:
        pytest.skip("node is needed for the JS half")
    out = subprocess.run([node, str(ROOT / "packages/core/test/protocol-diff.mjs"), str(seed), str(PER_FUNCTION)],
                         check=True, capture_output=True, text=True, timeout=120)
    return json.loads(out.stdout)


@pytest.fixture(scope="module", params=SEEDS, ids=[f"seed{s}" for s in SEEDS])
def corpus(request):
    return _generate(request.param)


# itemOutcomes cases belong to the md review plugin (not in this repository).
PEER_CASES = [c for c in json.loads((ROOT / "packages/core/test/handoff-peer.cases.json").read_text()) if c["fn"] == "settledForPeer"]


@pytest.mark.parametrize("case", PEER_CASES, ids=[c["fn"] + ": " + c["name"] for c in PEER_CASES])
def test_shared_peer_cases(plugin, case):
    """handoff-peer.cases.json — the same file the JS core runs."""
    assert plugin.store.settled_for_peer(case["settled"], case["caps"]) == case["expect"]


def _mismatches(cases, run):
    bad = []
    for c in cases:
        got = json.loads(json.dumps(run(c), ensure_ascii=False))
        if got != c["out"]:
            bad.append({**c, "python": got})
    return bad


def test_settled_from_batch_agrees(plugin, corpus):
    bad = _mismatches(corpus["batches"], lambda c: plugin.store.settled_from_batch(c["batch"]))
    assert len(corpus["batches"]) >= PER_FUNCTION
    assert not bad, json.dumps(bad[:3], ensure_ascii=False)


def test_settled_for_handoff_agrees(plugin, corpus):
    bad = _mismatches(corpus["settle"], lambda c: plugin.store.settled_for_handoff(c["batch"], "h1", c["accepted"]))
    assert len(corpus["settle"]) >= PER_FUNCTION
    assert not bad, json.dumps(bad[:3], ensure_ascii=False)


def test_settled_for_peer_agrees(plugin, corpus):
    bad = _mismatches(corpus["peer"], lambda c: plugin.store.settled_for_peer(c["settled"], c["caps"]))
    assert len(corpus["peer"]) >= PER_FUNCTION
    assert not bad, json.dumps(bad[:3], ensure_ascii=False)


def _subset(actual, expected) -> bool:
    if isinstance(expected, dict):
        return isinstance(actual, dict) and all(_subset(actual.get(k), v) for k, v in expected.items())
    return actual == expected


def test_ledger_agrees_on_random_request_sequences(plugin, corpus):
    """Status of every step equal; every field the JS ledger answers is answered the same
    by the SQLite store (which may say more: a claim's replayed receipt)."""
    bad = []
    for seq in corpus["ledger"]:
        now = [0.0]
        conn = sqlite3.connect(":memory:", check_same_thread=False)
        store = plugin.store.DipleStore(connect=lambda: conn, clock=lambda: now[0])
        h = "h-1234"
        for i, step in enumerate(seq["steps"]):
            now[0] = step["at"] / 1000.0
            req = step["req"]
            op = req["op"]
            if op == "claim":
                status, res = 200, store.claim(h, owner=req["owner"], batch_id=req.get("batchId"))
            elif op == "advance":
                ok = store.advance_handoff(h, owner=req["owner"], generation=req["generation"], stage=req["stage"],
                                           accepted=req.get("accepted"))
                status, res = (200, {"ok": True, "generation": req["generation"]}) if ok else (409, {"detail": "lost-claim"})
            elif op == "receipt":
                stored = store.save_handoff_receipt(h, req["receipt"], owner=req["owner"], generation=req["generation"])
                status, res = (200, {"ok": True, "receipt": stored}) if stored is not None else (409, {"detail": "lost-claim"})
            else:
                before = store.handoff_settled(h)
                stored = store.save_handoff_settled(h, req["settled"])
                status, res = 200, {"settled": stored, "first": before is None}
            if status != step["status"] or not _subset(res, step["res"]):
                bad.append({"steps": seq["steps"][: i + 1], "python": {"status": status, "res": res}})
                break
        conn.close()
    assert len(corpus["ledger"]) >= PER_FUNCTION
    assert not bad, json.dumps(bad[:2], ensure_ascii=False)
