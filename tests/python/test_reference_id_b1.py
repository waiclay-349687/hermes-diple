"""B-1: the provider expands only well-formed batch ids.

The host's plugin-reference pattern hands the provider whatever non-blank text
(or backticked text) follows the prefix. A chat message that merely *mentions*
the prefix — "the `@diple:` prefix", "`@diple:` 建议改成 …" — reached the
provider as target "`" or "建议改成", and the provider answered with "batch
missing, ask the user to resend", misleading the AI. Batch ids are generated
by the desktop half as ``b`` + 26 lowercase base32 characters
(shared/ids.js ``newBatchId``); anything else is not ours and is not expanded.
"""

from __future__ import annotations

import asyncio

import pytest

from test_diple_backend import PLUGIN_DIR, api, plugin, provider  # noqa: F401  (fixtures)
from conftest import load_plugin_package

PREFIX = load_plugin_package(PLUGIN_DIR, "hermes_plugins_b1_prefix").provider.PREFIX
VALID = "b" + "q7k2m6" + "a" * 20  # b + 26 base32 chars
assert len(VALID) == 27


def expand(p, target):
    return asyncio.run(p.expand(target))


@pytest.mark.parametrize("target", [
    "`",                      # "the `@diple:` prefix"
    "`@diple:`",            # backticked mention
    "建议改成",                # Chinese word right after the prefix
    "前缀",
    "b1",                     # too short
    "b7k2m9",                 # old test-style id: wrong length, 9 is not base32
    "B" + "a" * 26,           # upper case
    "b" + "a" * 25,           # one short
    "b" + "a" * 27,           # one long
    "b" + "a" * 25 + "1",     # 1 is not in the base32 alphabet
    "x" + "a" * 26,           # wrong lead letter
    "../../etc",
    "",
])
def test_malformed_targets_are_not_expanded(provider, target):
    assert expand(provider, target) is None
    assert provider.sleeps == [] and provider.events == []


def test_a_wellformed_id_still_expands(api, provider):
    api.put(f"/api/plugins/diple/batches/{VALID}", json={"sessionId": "s1", "full": "FULL"})
    assert expand(provider, VALID) == "FULL"


def test_a_wellformed_unknown_id_still_says_missing(provider):
    text = expand(provider, VALID)
    assert VALID in text and "missing" in text


@pytest.mark.parametrize("tail", ["。", "，", "）", "」", "、"])
def test_a_wellformed_id_followed_by_punctuation_expands_the_id(api, provider, tail):
    api.put(f"/api/plugins/diple/batches/{VALID}", json={"sessionId": "s1", "full": "FULL"})
    assert expand(provider, VALID + tail) == "FULL"


def _through_host(provider, message, tmp_path):
    from agent.context_references import (
        _context_reference_providers, preprocess_context_references, register_context_reference_provider,
    )

    _context_reference_providers.pop(PREFIX, None)
    register_context_reference_provider(provider)
    try:
        return preprocess_context_references(message, cwd=tmp_path, context_length=200_000)
    finally:
        _context_reference_providers.pop(PREFIX, None)


@pytest.mark.parametrize("message", [
    f"代码里的 `@{PREFIX}:` 前缀要改",
    f"`@{PREFIX}:` 建议改成 `@other:`",
    f"@{PREFIX}:建议改成",
    f"@{PREFIX}:b1 是个短串",
])
def test_host_mentions_of_the_prefix_inject_nothing(provider, tmp_path, message):
    r = _through_host(provider, message, tmp_path)
    assert "丢失" not in r.message and "missing" not in r.message
    assert "Attached Context" not in r.message
    assert provider.sleeps == []


@pytest.mark.parametrize("tail", [".", ",", "!", "。"])
def test_host_wellformed_id_followed_by_punctuation_attaches(api, provider, tmp_path, tail):
    api.put(f"/api/plugins/diple/batches/{VALID}", json={"sessionId": "s1", "full": "FULL"})
    r = _through_host(provider, f"看这里 @{PREFIX}:{VALID}{tail}", tmp_path)
    assert "--- Attached Context ---" in r.message and r.message.endswith("FULL")
