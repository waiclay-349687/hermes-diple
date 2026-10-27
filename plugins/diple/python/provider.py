"""The ``@diple:<batchId>`` context-reference provider (ADR 0006).

The display text of a send ends with ``@diple:<batchId>``. When the host
starts the turn it expands that reference (agent/context_references.py) by
calling :meth:`DipleReferenceProvider.expand`, which returns the full
envelope the desktop half registered through ``PUT /batches/<id>``. The call
itself is the delivery receipt: the batch is marked ``expanded`` and
``plugin.diple.batch.sent`` is broadcast the first time.
"""

from __future__ import annotations

import asyncio
import logging
import re
from typing import Any, Awaitable, Callable, Optional

from agent.context_references import ContextCompletionItem, ContextReferenceProvider

from .store import PLUGIN_ID

logger = logging.getLogger(__name__)

PREFIX = PLUGIN_ID  # one name for the plugin id, its event namespace and the @-prefix
RETRY_DELAY_S = 2.0

# The exact shape shared/ids.js `newBatchId` produces: "b" + 26 lowercase
# base32 characters (130 random bits). The host hands the provider any
# non-blank (or backticked) text after the prefix, so a message that only
# mentions the prefix ("the `@diple:` prefix") must not be read as a batch
# (B-1). A well-formed id may be followed by punctuation the host does not strip
# (e.g. "。"): the id ends at the first character that cannot be part of an id.
BATCH_REF_RE = re.compile(r"(b[a-z2-7]{26})(?![A-Za-z0-9_-])")


def batch_id_of(target: str) -> Optional[str]:
    """The batch id a reference target names, or None when it names none."""
    m = BATCH_REF_RE.match((target or "").strip())
    return m.group(1) if m else None


def missing_batch_text(batch_id: str) -> str:
    return (
        f"[标注批次 {batch_id} 的内容丢失 / annotation batch {batch_id} is missing] "
        "插件没有找到这批标注的登记，AI 没有收到原文和意见。请告诉用户：这批标注没有送达，"
        "需要在待发列表里重新发送。 The plugin has no record of this batch, so its annotations "
        "did not reach you; tell the user to resend them from the pending list."
    )


def other_session_text(batch_id: str) -> str:
    return (
        f"[标注批次 {batch_id} 属于另一个会话 / annotation batch {batch_id} belongs to another session] "
        "这批标注已经在别的会话里发送过，这里不附上它的内容。 Its annotations were sent in another "
        "session and are not attached here."
    )


def _default_current_sessions() -> Optional[set[str]]:
    """Ids of the session this turn runs for, from the host's task-local session
    context (tui_gateway binds HERMES_SESSION_ID / HERMES_SESSION_KEY before it
    expands @-references, and the sync wrapper copies the context). None when no
    session is bound here (CLI, or the host changed): no check is possible."""
    try:
        from gateway import session_context as sc
    except Exception:
        return None
    ids = set()
    for var in (getattr(sc, "_SESSION_ID", None), getattr(sc, "_SESSION_KEY", None)):
        try:
            value = var.get() if var is not None else None
        except Exception:
            value = None
        if isinstance(value, str) and value:
            ids.add(value)
    return ids or None


def _default_broadcast(event: str, payload: dict) -> None:
    from hermes_cli.plugin_events import broadcast_plugin_event

    broadcast_plugin_event(PREFIX, event, payload)


def _origin_of(item: Any) -> Any:
    origin = item.get("origin") if isinstance(item, dict) else None
    return origin if isinstance(origin, dict) else None


class DipleReferenceProvider(ContextReferenceProvider):
    prefix = PREFIX
    description = "Annotations attached by the Diple plugin"

    def __init__(self, store_factory: Callable[[], Any],
                 broadcast: Callable[[str, dict], None] = _default_broadcast,
                 sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
                 retry_delay: float = RETRY_DELAY_S,
                 current_sessions: Callable[[], Optional[set]] = _default_current_sessions) -> None:
        self._store_factory = store_factory
        self._current_sessions = current_sessions
        self._broadcast = broadcast
        self._sleep = sleep
        self._retry_delay = retry_delay

    async def autocomplete(self, query: str, *, limit: int = 10) -> list[ContextCompletionItem]:
        return []

    async def expand(self, target: str) -> str | None:
        batch_id = batch_id_of(target)
        if batch_id is None:
            return None  # not one of ours: leave the text alone (B-1)
        try:
            # Resolved per call: follows the active profile, and the data dir
            # need not exist when the plugin registers.
            store = self._store_factory()
            batch = store.get_batch(batch_id)
            if batch is None:
                # The registration PUT may still be in flight: look once more.
                await self._sleep(self._retry_delay)
                batch = store.get_batch(batch_id)
            if batch is None:
                return missing_batch_text(batch_id)
            # A batch already delivered is re-expanded only in its own session
            # (R1 XE-14): an old `@diple:` token pasted elsewhere must not pull
            # its annotations into another session. The first expansion is the send
            # itself (the 130-bit id was known only to the sender until then).
            delivered = batch.get("status") in ("expanded", "answered") or batch.get("expandedAt") is not None
            if delivered and batch.get("sessionId"):
                current = self._current_sessions()
                if current is not None and batch["sessionId"] not in current:
                    return other_session_text(batch_id)
            batch, first = store.mark_expanded(batch_id)
        except Exception:  # never fail the user's turn because of the plugin
            logger.warning("annotation: expand %s failed", batch_id, exc_info=True)
            return missing_batch_text(batch_id)
        if first:
            try:
                self._broadcast("batch.sent", {
                    "v": 1,
                    "batchId": batch_id,
                    "sessionId": batch.get("sessionId", ""),
                    "items": [{"origin": _origin_of(it)} for it in batch.get("items") or []],
                })
            except Exception:
                logger.debug("annotation: batch.sent broadcast failed", exc_info=True)
        return batch["full"]
