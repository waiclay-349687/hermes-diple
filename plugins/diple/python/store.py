"""Diple backend storage: the plugin's own SQLite (ADR 0005).

One module, imported twice in a running Hermes: once as part of the plugin
package (``hermes_plugins.diple.store`` — the ``@diple:`` provider runs in
the agent turn) and once by ``dashboard/plugin_api.py`` (the REST routes).
The two instances share nothing in memory; every exchange goes through the
database file, so the API and the provider stay consistent across module
instances, plugin-host isolation and app restarts.
"""

from __future__ import annotations

import json
import re
import sqlite3
import threading
import time
from typing import Any, Callable, Optional

PLUGIN_ID = "diple"
BATCH_ID_RE = re.compile(r"^[A-Za-z0-9_-]{4,64}$")
HANDOFF_ID_RE = re.compile(r"^[A-Za-z0-9_.:-]{4,128}$")
STATUSES = ("registered", "expanded", "answered", "failed")
# A claim with no receipt this old belongs to a window that died mid-way (R1
# XE-04): another window may take it over. Normal processing takes seconds.
CLAIM_STALE_S = 30.0

_SCHEMA = """
CREATE TABLE IF NOT EXISTS batches (
    batch_id          TEXT PRIMARY KEY,
    session_id        TEXT NOT NULL DEFAULT '',
    full              TEXT NOT NULL,
    display           TEXT NOT NULL DEFAULT '',
    items_json        TEXT NOT NULL DEFAULT '[]',
    status            TEXT NOT NULL DEFAULT 'registered',
    fail_reason       TEXT,
    answer_json       TEXT,
    created_at        REAL NOT NULL,
    expanded_at       REAL,
    answer_checked_at REAL,
    outcome           TEXT,
    outcome_reason    TEXT
);
CREATE INDEX IF NOT EXISTS batches_session ON batches(session_id, created_at);
CREATE TABLE IF NOT EXISTS handoff_claims (
    handoff_id    TEXT PRIMARY KEY,
    claimed_at    REAL NOT NULL,
    session_id    TEXT NOT NULL DEFAULT '',
    receipt_json  TEXT,
    progress_json TEXT,
    settled_json  TEXT,
    owner         TEXT,
    generation    INTEGER NOT NULL DEFAULT 0,
    batch_id      TEXT
);
CREATE TABLE IF NOT EXISTS batch_handoffs (
    batch_id      TEXT NOT NULL,
    handoff_id    TEXT NOT NULL,
    accepted_json TEXT,
    PRIMARY KEY (batch_id, handoff_id)
);
"""
# Columns added after the first release, oldest first: (table, column, type).
# R1 added receipt_json; R2 progress_json (XE2-03) and settled_json (XR-09);
# R3 (ADR 0007) owner / generation / batch_id and the batches' final outcome.
_ADDED_COLUMNS = (
    ("handoff_claims", "receipt_json", "TEXT"),
    ("handoff_claims", "progress_json", "TEXT"),
    ("handoff_claims", "settled_json", "TEXT"),
    ("handoff_claims", "owner", "TEXT"),
    ("handoff_claims", "generation", "INTEGER NOT NULL DEFAULT 0"),
    ("handoff_claims", "batch_id", "TEXT"),
    ("batches", "outcome", "TEXT"),
    ("batches", "outcome_reason", "TEXT"),
    # R4 (XE4-02): the hand-off's accepted items [{itemId, revision}] as declared at put_batch
    ("batch_handoffs", "accepted_json", "TEXT"),
    # R5 (XE5-02): the sender's caps from the hand-off payload (what it may be told)
    ("handoff_claims", "caps_json", "TEXT"),
    # R5 (XE4-02 residual): 1 = put_batch wrote this row's items, which are then the
    # batch's whole membership; NULL = a row from before R5, or final_batch's placeholder
    ("batches", "members_known", "INTEGER"),
)
# Where a claiming window got to (XE2-03), only ever forward (ADR 0007): a
# window taking over a dead claim resumes from here instead of running
# "add + send" again.
PROGRESS_STAGES = ("claimed", "added", "sending")


class BatchConflict(Exception):
    """The batch was already delivered; its content can no longer change."""


def valid_batch_id(batch_id: Any) -> bool:
    return isinstance(batch_id, str) and bool(BATCH_ID_RE.fullmatch(batch_id))


def valid_handoff_id(handoff_id: Any) -> bool:
    return isinstance(handoff_id, str) and bool(HANDOFF_ID_RE.fullmatch(handoff_id))


# -- settling a hand-off from its batch: twins of packages/core/src/handoff-protocol.js ----------
# settledFromBatch / settledForHandoff / settledForPeer. Same cases file
# (handoff-settle.cases.json) and a differential test against the JS over generated
# inputs (tests/python/test_protocol_diff.py): ids are strings, revisions integers,
# reasons cut to REASON_MAX code points — malformed input included.
REASON_MAX = 100
CAP_PARTIAL = "partial"


def _is_int(x: Any) -> bool:
    if isinstance(x, bool):
        return False
    return isinstance(x, int) or (isinstance(x, float) and x.is_integer())


def _reason_or(r: Any, fallback: str) -> str:
    return r[:REASON_MAX] if isinstance(r, str) and r else fallback


def _accepted_versions(accepted: Any) -> list[dict]:
    out = []
    for a in accepted if isinstance(accepted, list) else []:
        if isinstance(a, str):
            out.append({"itemId": a})
        elif isinstance(a, dict) and isinstance(a.get("itemId"), str):
            v = {"itemId": a["itemId"]}
            if _is_int(a.get("revision")):
                v["revision"] = a["revision"]
            out.append(v)
    return out


def settled_from_batch(batch: Any) -> Optional[dict]:
    """handoff-protocol.js settledFromBatch: an outcome, or an answer, is final."""
    if not isinstance(batch, dict) or not isinstance(batch.get("batchId"), str) or not batch["batchId"]:
        return None
    outcome = batch.get("outcome")
    if outcome == "delivered" or (outcome is None and batch.get("status") == "answered"):
        return {"batchId": batch["batchId"], "delivered": True}
    if outcome == "failed":
        return {"batchId": batch["batchId"], "delivered": False, "reason": _reason_or(batch.get("outcomeReason"), "failed")}
    return None


def settled_for_handoff(batch: Any, handoff_id: str, accepted: Any) -> Optional[dict]:
    """handoff-protocol.js settledForHandoff (R4 XE4-02, R5): only the accepted items
    that really ride in the batch share its outcome; one that is not in it was removed
    ('removed') or replaced by another version ('replaced'). ``batch["items"]`` a list =
    the batch was registered with exactly these entries, so membership is known even
    when none is a hand-off item; None = never registered. Unknown membership (no
    accepted list, or an unregistered batch) keeps the batch's word for the whole hand-off."""
    st = settled_from_batch(batch)
    if st is None:
        return None
    base = {"handoffId": handoff_id, **st}
    want = _accepted_versions(accepted)
    if not want or not isinstance(batch.get("items"), list):
        return base
    carried: dict[str, set] = {}
    for it in batch["items"]:
        o = it.get("origin") if isinstance(it, dict) else None
        if isinstance(o, dict) and isinstance(o.get("itemId"), str):
            carried.setdefault(o["itemId"], set()).add(o.get("revision") if _is_int(o.get("revision")) else None)
    rows = []
    for a in want:
        revs = carried.get(a["itemId"])
        inside = revs is not None and ("revision" not in a or a["revision"] in revs)
        rows.append((a["itemId"], inside, None if inside else ("replaced" if revs is not None else "removed")))
    if all(r[1] for r in rows):
        return base
    items = []
    for item_id, inside, missing in rows:
        if inside:
            items.append({"itemId": item_id, "delivered": True} if st["delivered"]
                         else {"itemId": item_id, "delivered": False, "reason": st["reason"]})
        else:
            items.append({"itemId": item_id, "delivered": False, "reason": missing})
    if not any(r[1] for r in rows):
        reason = "replaced" if any(r[2] == "replaced" for r in rows) else "removed"
        return {"handoffId": handoff_id, "batchId": st["batchId"], "delivered": False, "reason": reason, "items": items}
    return {**base, "items": items}


def settled_for_peer(settled: Any, caps: Any) -> Any:
    """handoff-protocol.js settledForPeer (R5 XE5-02): what a peer may be TOLD. A sender
    that did not declare CAP_PARTIAL reads only ``delivered``: a partly carried hand-off
    goes out as ``delivered: false, reason: 'partial'`` (its items come back as pending,
    never shown as sent). The stored settled is unchanged."""
    if not isinstance(settled, dict):
        return settled
    if isinstance(caps, list) and CAP_PARTIAL in caps:
        return settled
    if "items" not in settled:
        return settled
    rest = {k: v for k, v in settled.items() if k != "items"}
    items = settled["items"]
    partial = rest.get("delivered") is True and isinstance(items, list) and any(
        not (isinstance(x, dict) and x.get("delivered") is True) for x in items)
    if not partial:
        return rest
    out = {k: v for k, v in rest.items() if k != "reason"}
    return {**out, "delivered": False, "reason": "partial"}


def _default_connect() -> sqlite3.Connection:
    from plugins.plugin_storage import plugin_db

    return plugin_db(PLUGIN_ID)


class DipleStore:
    """Batches (sent annotation envelopes) and hand-off claims."""

    def __init__(self, connect: Callable[[], sqlite3.Connection] = _default_connect,
                 clock: Callable[[], float] = time.time) -> None:
        self._conn = connect()
        self._conn.row_factory = sqlite3.Row
        self._clock = clock
        self._lock = threading.Lock()
        with self._lock:
            self._conn.executescript(_SCHEMA)
            self._migrate()
            self._link_old_claims()

    def _missing_columns(self) -> list[tuple[str, str, str]]:
        out = []
        for table in {t for t, _, _ in _ADDED_COLUMNS}:
            cols = {r[1] for r in self._conn.execute(f"PRAGMA table_info({table})").fetchall()}
            out += [c for c in _ADDED_COLUMNS if c[0] == table and c[1] not in cols]
        return out

    def _migrate(self) -> None:
        """Add the columns older databases lack. The API and the provider each
        load their own module instance over one SQLite file, so two instances
        may migrate at once (R2 XE2-01): the check-and-alter runs under the
        database's write lock (BEGIN IMMEDIATE) and re-checks there; a
        duplicate-column error from any other writer is taken as done."""
        if not self._missing_columns():
            return
        self._conn.execute("BEGIN IMMEDIATE")
        try:
            for table, column, decl in self._missing_columns():
                try:
                    self._conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")
                except sqlite3.OperationalError as e:
                    if "duplicate column" not in str(e).lower():
                        raise
            self._conn.commit()
        except BaseException:
            self._conn.rollback()
            raise

    def _link_old_claims(self) -> None:
        """R4 XE4-03: claims written before ``batch_handoffs`` existed name their batch
        only in the receipt / progress (or the claim's batch_id). Link them, so a
        settled can be derived from that batch. Idempotent (INSERT OR IGNORE)."""
        self._conn.execute(
            "INSERT OR IGNORE INTO batch_handoffs (batch_id, handoff_id) "
            "SELECT bid, handoff_id FROM (SELECT handoff_id, COALESCE("
            "json_extract(receipt_json, '$.batchId'), json_extract(progress_json, '$.batchId'), batch_id) AS bid "
            "FROM handoff_claims WHERE settled_json IS NULL AND (receipt_json IS NOT NULL OR progress_json IS NOT NULL)) "
            "WHERE bid IS NOT NULL AND bid != ''")
        self._conn.commit()

    # -- batches ---------------------------------------------------------------
    @staticmethod
    def _row(row: Optional[sqlite3.Row]) -> Any:
        if row is None:
            return None
        return {
            "batchId": row["batch_id"],
            "sessionId": row["session_id"],
            "full": row["full"],
            "display": row["display"],
            "items": json.loads(row["items_json"] or "[]"),
            "status": row["status"],
            "failReason": row["fail_reason"],
            "answer": json.loads(row["answer_json"]) if row["answer_json"] else None,
            "createdAt": row["created_at"],
            "expandedAt": row["expanded_at"],
            "answerCheckedAt": row["answer_checked_at"],
            "outcome": row["outcome"],
            "outcomeReason": row["outcome_reason"],
        }

    def get_batch(self, batch_id: str) -> Optional[dict]:
        if not valid_batch_id(batch_id):
            return None
        with self._lock:
            row = self._conn.execute("SELECT * FROM batches WHERE batch_id = ?", (batch_id,)).fetchone()
        return self._row(row)

    def put_batch(self, batch_id: str, *, session_id: str, full: str, display: str = "",
                  items: Optional[list] = None, handoff_ids: Optional[list] = None,
                  handoff_items: Optional[dict] = None) -> dict:
        """Register or update a batch. Raises BatchConflict once it was expanded or its send
        has a final outcome (ADR 0007: a late window cannot send a settled hand-off again).
        ``handoff_ids``: the hand-offs queued into this send. ``handoff_items``: per hand-off,
        the items it handed over [{itemId, revision}] (R4 XE4-02): the batch's items say
        which of them really went out."""
        if not valid_batch_id(batch_id):
            raise ValueError("invalid batch id")
        if not isinstance(full, str) or not full.strip():
            raise ValueError("full must be a non-empty string")
        items_json = json.dumps(items or [], ensure_ascii=False)
        with self._lock:
            cur = self._conn.execute(
                """INSERT INTO batches (batch_id, session_id, full, display, items_json, status, created_at, members_known)
                   VALUES (?, ?, ?, ?, ?, 'registered', ?, 1)
                   ON CONFLICT(batch_id) DO UPDATE SET
                       session_id = excluded.session_id, full = excluded.full, display = excluded.display,
                       items_json = excluded.items_json, status = 'registered', fail_reason = NULL, members_known = 1
                   WHERE batches.status IN ('registered', 'failed') AND batches.outcome IS NULL""",
                (batch_id, session_id or "", full, display or "", items_json, self._clock()),
            )
            if cur.rowcount:
                hmap = handoff_items if isinstance(handoff_items, dict) else {}
                for h in [*(handoff_ids or []), *[k for k in hmap if k not in (handoff_ids or [])]]:
                    if valid_handoff_id(h):
                        self._conn.execute("INSERT OR IGNORE INTO batch_handoffs (batch_id, handoff_id) VALUES (?, ?)",
                                           (batch_id, h))
                        versions = _accepted_versions(hmap.get(h))
                        if versions:
                            self._conn.execute("UPDATE batch_handoffs SET accepted_json = ? WHERE batch_id = ? AND handoff_id = ?",
                                               (json.dumps(versions, ensure_ascii=False), batch_id, h))
            self._conn.commit()
            changed = cur.rowcount
            row = self._conn.execute("SELECT * FROM batches WHERE batch_id = ?", (batch_id,)).fetchone()
        if not changed:
            raise BatchConflict(batch_id)
        return self._row(row)

    def mark_expanded(self, batch_id: str) -> tuple[Optional[dict], bool]:
        """Record that the host expanded the batch into a turn. Returns (batch, first_time)."""
        if not valid_batch_id(batch_id):
            return None, False
        with self._lock:
            cur = self._conn.execute(
                "UPDATE batches SET status = 'expanded', expanded_at = ? "
                "WHERE batch_id = ? AND status IN ('registered', 'failed')",
                (self._clock(), batch_id),
            )
            self._conn.commit()
            row = self._conn.execute("SELECT * FROM batches WHERE batch_id = ?", (batch_id,)).fetchone()
        return self._row(row), cur.rowcount == 1

    def mark_answered(self, batch_id: str, *, answered: list, missing: list,
                      no_markers: bool = False) -> tuple[Optional[dict], bool]:
        """Record the answer check of an expanded batch, once. Returns (batch, first_time)."""
        if not valid_batch_id(batch_id):
            return None, False
        answer = json.dumps({"answered": sorted(set(answered)), "missing": sorted(set(missing)),
                             "noMarkers": bool(no_markers)})
        with self._lock:
            cur = self._conn.execute(
                "UPDATE batches SET status = 'answered', answer_checked_at = ?, answer_json = ? "
                "WHERE batch_id = ? AND status = 'expanded'",
                (self._clock(), answer, batch_id),
            )
            # one first terminal per batch (R4): the answer IS the delivery — fixed now, so a
            # later opposite /final can only get this word back
            self._conn.execute("UPDATE batches SET outcome = 'delivered' WHERE batch_id = ? AND status = 'answered' "
                               "AND outcome IS NULL", (batch_id,))
            self._conn.commit()
            row = self._conn.execute("SELECT * FROM batches WHERE batch_id = ?", (batch_id,)).fetchone()
        return self._row(row), cur.rowcount == 1

    def mark_failed(self, batch_id: str, reason: str, *, rejected: bool = False) -> Optional[dict]:
        """A send that never reached the model. No-op once expanded.

        ``rejected=True`` (W3): the host expanded the batch but then refused the
        turn (hard context limit, turn error, never persisted), so an
        ``expanded`` batch may become ``failed`` too. ``answered`` never does.
        """
        if not valid_batch_id(batch_id):
            return None
        froms = "('registered', 'expanded')" if rejected else "('registered')"
        with self._lock:
            self._conn.execute(
                f"UPDATE batches SET status = 'failed', fail_reason = ? WHERE batch_id = ? AND status IN {froms}",
                (str(reason)[:500], batch_id),
            )
            self._conn.commit()
            row = self._conn.execute("SELECT * FROM batches WHERE batch_id = ?", (batch_id,)).fetchone()
        return self._row(row)

    def list_batches(self, *, session_id: Optional[str] = None, status: Optional[str] = None,
                     limit: int = 20) -> list[dict]:
        sql, args = "SELECT * FROM batches WHERE 1=1", []
        if session_id is not None:
            sql += " AND session_id = ?"
            args.append(session_id)
        if status is not None:
            sql += " AND status = ?"
            args.append(status)
        sql += " ORDER BY created_at DESC, rowid DESC LIMIT ?"
        args.append(max(1, min(int(limit), 200)))
        with self._lock:
            rows = self._conn.execute(sql, args).fetchall()
        return [self._row(r) for r in rows]

    # -- hand-off claims (ADR 0007; packages/core/src/handoff-protocol.js ledgerStep) ----------
    # One row per hand-off. owner + generation identify the window holding the
    # claim; every advance is a compare-and-set on them (0 rows = the claim was
    # lost: the route answers 409). batch_id is fixed at the first claim. The
    # receipt and settled are written once; settled is also derived from the
    # final outcome of the batch the hand-off went out in.
    def _claim_row(self, handoff_id: str) -> Optional[sqlite3.Row]:
        return self._conn.execute("SELECT * FROM handoff_claims WHERE handoff_id = ?", (handoff_id,)).fetchone()

    @staticmethod
    def _loads(value: Optional[str]) -> Any:
        return json.loads(value) if value else None

    def claim(self, handoff_id: str, *, owner: str, batch_id: Optional[str] = None, session_id: str = "",
              caps: Optional[list] = None) -> dict:
        """``{claimed: True, owner, generation, batchId, progress?}`` for the first caller,
        or for a later one once the lease (CLAIM_STALE_S) ran out with no receipt and
        no settled — the next generation, the SAME batch id. Otherwise
        ``{claimed: False, receipt?, settled?}`` (settled derived when missing)."""
        if not valid_handoff_id(handoff_id):
            raise ValueError("invalid handoff id")
        now = self._clock()
        with self._lock:
            cur = self._conn.execute(
                "INSERT OR IGNORE INTO handoff_claims (handoff_id, claimed_at, session_id, owner, generation, batch_id, "
                "progress_json) VALUES (?, ?, ?, ?, 1, ?, ?)",
                (handoff_id, now, session_id or "", owner, batch_id, json.dumps({"stage": "claimed", "accepted": []})),
            )
            taken = cur.rowcount == 1
            if caps:  # the sender's caps (R5 XE5-02): the first claim that carries them keeps them
                self._conn.execute("UPDATE handoff_claims SET caps_json = ? WHERE handoff_id = ? AND caps_json IS NULL",
                                   (json.dumps([c for c in caps if isinstance(c, str)]), handoff_id))
            if not taken:
                cur = self._conn.execute(
                    "UPDATE handoff_claims SET claimed_at = ?, session_id = ?, owner = ?, generation = generation + 1, "
                    "batch_id = COALESCE(batch_id, json_extract(progress_json, '$.batchId'), ?) "
                    "WHERE handoff_id = ? AND receipt_json IS NULL AND settled_json IS NULL AND claimed_at < ?",
                    (now, session_id or "", owner, batch_id, handoff_id, now - CLAIM_STALE_S),
                )
                taken = cur.rowcount == 1
            self._conn.commit()
            row = self._claim_row(handoff_id)
        if taken:
            out: dict[str, Any] = {"claimed": True, "owner": row["owner"], "generation": row["generation"]}
            if row["batch_id"]:
                out["batchId"] = row["batch_id"]
            progress = self._loads(row["progress_json"])
            if progress and progress.get("stage") not in (None, "claimed"):
                # R2 rows may say "queued": it was past "sending" (a send may be on its way)
                stage = "sending" if progress["stage"] == "queued" else progress["stage"]
                p = {"stage": stage, "accepted": progress.get("accepted") or []}
                bid = row["batch_id"] or progress.get("batchId")
                if bid:
                    p["batchId"] = bid
                out["progress"] = p
            return out
        settled = self.handoff_settled(handoff_id) if row["receipt_json"] or row["settled_json"] else None
        receipt = self.replay_receipt(handoff_id)
        return {"claimed": False, **({"receipt": receipt} if receipt else {}), **({"settled": settled} if settled else {})}

    def claim_handoff(self, handoff_id: str, session_id: str = "") -> bool:
        """Kept for callers that only need yes/no (a fresh owner each time)."""
        import uuid

        return bool(self.claim(handoff_id, owner=uuid.uuid4().hex, session_id=session_id)["claimed"])

    def advance_handoff(self, handoff_id: str, *, owner: str, generation: int, stage: str,
                        accepted: Optional[list] = None) -> bool:
        """CAS the claim's progress forward (and renew its lease). False = the claim is no
        longer this caller's (taken over, finished or settled): it must stop."""
        if not valid_handoff_id(handoff_id) or stage not in PROGRESS_STAGES:
            raise ValueError("invalid hand-off progress")
        now = self._clock()
        with self._lock:
            row = self._claim_row(handoff_id)
            cur_stage = (self._loads(row["progress_json"]) or {}).get("stage", "claimed") if row else "claimed"
            if cur_stage not in PROGRESS_STAGES:
                cur_stage = "sending" if cur_stage == "queued" else "claimed"
            if row is None or PROGRESS_STAGES.index(stage) < PROGRESS_STAGES.index(cur_stage):
                return False
            progress = {"stage": stage, "accepted": list(accepted or [])}
            cur = self._conn.execute(
                "UPDATE handoff_claims SET progress_json = ?, claimed_at = ? WHERE handoff_id = ? AND owner IS NOT NULL "
                "AND owner = ? AND generation = ? AND receipt_json IS NULL AND settled_json IS NULL",
                (json.dumps(progress, ensure_ascii=False), now, handoff_id, owner, int(generation)),
            )
            self._conn.commit()
        return cur.rowcount == 1

    def save_handoff_receipt(self, handoff_id: str, receipt: dict, *, owner: str, generation: int) -> Optional[dict]:
        """CAS the receipt (first one only). Returns the stored receipt, or None when the
        claim is not this caller's any more (the route answers 409)."""
        if not valid_handoff_id(handoff_id):
            raise ValueError("invalid handoff id")
        with self._lock:
            self._conn.execute(
                "UPDATE handoff_claims SET receipt_json = ?, claimed_at = ? WHERE handoff_id = ? AND owner IS NOT NULL "
                "AND owner = ? AND generation = ? AND receipt_json IS NULL",
                (json.dumps(receipt, ensure_ascii=False), self._clock(), handoff_id, owner, int(generation)),
            )
            self._conn.commit()
            row = self._claim_row(handoff_id)
        if row is None or row["owner"] != owner or row["generation"] != int(generation):
            return None
        return self._loads(row["receipt_json"])

    def _claim_json(self, handoff_id: str, column: str) -> Optional[dict]:
        if not valid_handoff_id(handoff_id):
            return None
        with self._lock:
            row = self._conn.execute(f"SELECT {column} FROM handoff_claims WHERE handoff_id = ?", (handoff_id,)).fetchone()
        return json.loads(row[column]) if row and row[column] else None

    def handoff_receipt(self, handoff_id: str) -> Optional[dict]:
        return self._claim_json(handoff_id, "receipt_json")

    def replay_receipt(self, handoff_id: str) -> Optional[dict]:
        """The stored receipt; for a hand-off that settled before its holder could store one
        (the receipt POST was lost, the window then went away), the one its progress implies."""
        receipt = self.handoff_receipt(handoff_id)
        if receipt:
            return receipt
        settled = self._claim_json(handoff_id, "settled_json")
        progress = self.handoff_progress(handoff_id) or {}
        if not settled or progress.get("stage") in (None, "claimed"):
            return None
        out = {"handoffId": handoff_id, "accepted": [x for x in progress.get("accepted") or [] if isinstance(x, str)],
               "settles": True}
        if settled.get("batchId") and progress.get("stage") == "sending":
            out["batchId"] = settled["batchId"]
        return out

    def handoff_caps(self, handoff_id: str) -> list:
        """The caps its sender declared (R5 XE5-02); [] when none (an older Review)."""
        caps = self._claim_json(handoff_id, "caps_json")
        return caps if isinstance(caps, list) else []

    def settled_for_peer(self, settled: dict) -> dict:
        """What the hand-off's sender may be told (settled_for_peer over its caps)."""
        return settled_for_peer(settled, self.handoff_caps(str(settled.get("handoffId") or "")))

    def handoff_progress(self, handoff_id: str) -> Optional[dict]:
        return self._claim_json(handoff_id, "progress_json")

    def _settle_locked(self, handoff_id: str, settled: dict) -> tuple[dict, bool]:
        """Write settled once (first wins). Inside the lock; the caller commits."""
        cur = self._conn.execute(
            "UPDATE handoff_claims SET settled_json = ? WHERE handoff_id = ? AND settled_json IS NULL",
            (json.dumps(settled, ensure_ascii=False), handoff_id),
        )
        first = cur.rowcount == 1
        if not first and self._claim_row(handoff_id) is None:
            self._conn.execute(
                "INSERT INTO handoff_claims (handoff_id, claimed_at, session_id, settled_json, generation) "
                "VALUES (?, ?, '', ?, 0)", (handoff_id, self._clock(), json.dumps(settled, ensure_ascii=False)))
            first = True
        return self._loads(self._claim_row(handoff_id)["settled_json"]), first

    def save_handoff_settled(self, handoff_id: str, settled: dict) -> dict:
        """Record a hand-off's final result; the FIRST one stays (ADR 0007 §3). Returns it."""
        if not valid_handoff_id(handoff_id):
            raise ValueError("invalid handoff id")
        with self._lock:
            stored, _ = self._settle_locked(handoff_id, settled)
            self._conn.commit()
        return stored

    def _accepted_locked(self, handoff_id: str, batch_id: str) -> Any:
        """What the hand-off handed over: the versions declared at put_batch, else the
        receipt's / progress's accepted ids, else None (unknown)."""
        link = self._conn.execute("SELECT accepted_json FROM batch_handoffs WHERE batch_id = ? AND handoff_id = ?",
                                  (batch_id, handoff_id)).fetchone()
        if link is not None and link["accepted_json"]:
            return json.loads(link["accepted_json"])
        claim = self._claim_row(handoff_id)
        if claim is None:
            return None
        for col in ("receipt_json", "progress_json"):
            v = (self._loads(claim[col]) or {}).get("accepted")
            if isinstance(v, list) and v:
                return v
        return None

    def _settled_from_batch(self, handoff_id: str, row: sqlite3.Row) -> Optional[dict]:
        """settled_for_handoff over a batch row (inside the lock). Its items count as the
        batch's whole membership (R5: even when none is a hand-off item) when this row was
        registered by put_batch since R5 (members_known), or the link's versions were
        declared at that put_batch (R4). An older row counts only when it carries some
        hand-off item (the R4 rule); final_batch's placeholder for an id settled before it
        was registered never does: unknown → the batch's word."""
        batch = self._row(row)
        accepted = self._accepted_locked(handoff_id, row["batch_id"])
        if not self._members_known_locked(handoff_id, row):
            carried = any(isinstance(it, dict) and isinstance(it.get("origin"), dict)
                          and isinstance(it["origin"].get("itemId"), str) for it in batch.get("items") or [])
            if not carried:
                batch["items"] = None
        return settled_for_handoff(batch, handoff_id, accepted)

    def _members_known_locked(self, handoff_id: str, row: sqlite3.Row) -> bool:
        if row["members_known"]:
            return True
        link = self._conn.execute("SELECT accepted_json FROM batch_handoffs WHERE batch_id = ? AND handoff_id = ?",
                                  (row["batch_id"], handoff_id)).fetchone()
        return bool(row["full"]) and link is not None and bool(link["accepted_json"])

    def _fix_answered_outcome_locked(self, row: sqlite3.Row) -> sqlite3.Row:
        """Cross-layer terminal (R4): a batch has ONE first terminal. An answered batch
        whose outcome is still open gets 'delivered' fixed the moment a settled is
        derived from the answer, so a later opposite /final finds it set."""
        if row["outcome"] is None and row["status"] == "answered":
            self._conn.execute("UPDATE batches SET outcome = 'delivered' WHERE batch_id = ? AND outcome IS NULL", (row["batch_id"],))
            row = self._conn.execute("SELECT * FROM batches WHERE batch_id = ?", (row["batch_id"],)).fetchone()
        return row

    def handoff_settled(self, handoff_id: str) -> Optional[dict]:
        """The stored settled, else one derived from the final outcome of a batch the
        hand-off went out in (then stored): replays never depend on one request."""
        if not valid_handoff_id(handoff_id):
            return None
        with self._lock:
            row = self._claim_row(handoff_id)
            if row is None:
                return None
            if row["settled_json"]:
                return self._loads(row["settled_json"])
            batches = self._conn.execute(
                "SELECT b.* FROM batches b WHERE b.batch_id IN "
                "(SELECT batch_id FROM batch_handoffs WHERE handoff_id = ? UNION SELECT ?) ORDER BY b.created_at",
                (handoff_id, row["batch_id"] or ""),
            ).fetchall()
            for b in batches:
                settled = self._settled_from_batch(handoff_id, b)
                if settled:
                    self._fix_answered_outcome_locked(b)
                    stored, _ = self._settle_locked(handoff_id, settled)
                    self._conn.commit()
                    return stored
        return None

    def batch_handoffs(self, batch_id: str) -> list[str]:
        with self._lock:
            rows = self._conn.execute("SELECT handoff_id FROM batch_handoffs WHERE batch_id = ? ORDER BY rowid",
                                      (batch_id,)).fetchall()
        return [r["handoff_id"] for r in rows]

    def final_batch(self, batch_id: str, *, delivered: bool, reason: Optional[str] = None,
                    handoff_ids: Optional[list] = None) -> tuple[Optional[dict], list[dict]]:
        """The send of a batch ended (ADR 0007 §4). In one transaction: the batch's outcome
        (first one stays), its hand-offs (linked now if new), and each hand-off's settled
        (first one stays). Returns (batch | None, [stored settled per hand-off])."""
        if not valid_batch_id(batch_id):
            raise ValueError("invalid batch id")
        ids = [h for h in (handoff_ids or []) if valid_handoff_id(h)]
        with self._lock:
            if not delivered:
                # a batch id settled before it was registered is spent: put_batch refuses it
                self._conn.execute(
                    "INSERT OR IGNORE INTO batches (batch_id, session_id, full, display, items_json, status, fail_reason, "
                    "created_at) VALUES (?, '', '', '', '[]', 'failed', ?, ?)",
                    (batch_id, str(reason or "failed")[:500], self._clock()),
                )
            self._conn.execute(
                "UPDATE batches SET outcome = ?, outcome_reason = ? WHERE batch_id = ? AND outcome IS NULL",
                ("delivered" if delivered else "failed", None if delivered else str(reason or "failed")[:500], batch_id),
            )
            for h in ids:
                self._conn.execute("INSERT OR IGNORE INTO batch_handoffs (batch_id, handoff_id) VALUES (?, ?)", (batch_id, h))
            row = self._conn.execute("SELECT * FROM batches WHERE batch_id = ?", (batch_id,)).fetchone()
            linked = [r["handoff_id"] for r in self._conn.execute(
                "SELECT handoff_id FROM batch_handoffs WHERE batch_id = ? ORDER BY rowid", (batch_id,)).fetchall()]
            out = []
            for h in linked:
                if row is not None:
                    settled = self._settled_from_batch(h, row)
                else:  # never registered (a queued send cancelled before it went out)
                    settled = {"handoffId": h, "batchId": batch_id, "delivered": bool(delivered)}
                    if not delivered:
                        settled["reason"] = str(reason or "failed")[:100]
                if settled:
                    stored, _ = self._settle_locked(h, settled)
                    out.append(stored)
            self._conn.commit()
        return self._row(row), out

    def close(self) -> None:
        with self._lock:
            self._conn.close()


_STORES: dict[str, DipleStore] = {}
_STORES_LOCK = threading.Lock()


def store_for_current_home() -> DipleStore:
    """The store of the active profile (HERMES_HOME is resolved on every call)."""
    from hermes_constants import get_hermes_home

    home = str(get_hermes_home())
    with _STORES_LOCK:
        store = _STORES.get(home)
        if store is None:
            store = _STORES[home] = DipleStore()
        return store
