"""Diple — Hermes plugin (agent half).

Registers the ``@diple:`` context-reference provider. The REST routes live
in ``dashboard/plugin_api.py``; both talk only through the plugin's SQLite.
"""

from __future__ import annotations

from .provider import DipleReferenceProvider
from .store import store_for_current_home


def register(ctx) -> None:
    ctx.register_context_reference(DipleReferenceProvider(store_for_current_home))
