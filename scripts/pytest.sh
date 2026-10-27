#!/bin/bash
# Run the Python backend tests. They import a few Hermes Agent host modules,
# so they need a Hermes Agent checkout on PYTHONPATH:
#   HERMES_AGENT_ROOT  the checkout (default: ~/.hermes/hermes-agent, read only)
#   PYTHON             the interpreter (default: that checkout's venv python)
# pytest is installed into tests/.pydeps when the interpreter lacks it, so the
# host venv is never modified. HERMES_HOME is a throwaway temp dir (conftest.py).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AGENT="${HERMES_AGENT_ROOT:-$HOME/.hermes/hermes-agent}"
PY="${PYTHON:-${AGENT}/venv/bin/python}"
if ! "${PY}" -c 'import pytest' 2>/dev/null && [ ! -d "${ROOT}/tests/.pydeps/_pytest" ]; then
  if command -v uv >/dev/null 2>&1; then
    uv pip install --python "${PY}" --target "${ROOT}/tests/.pydeps" pytest >/dev/null
  else
    "${PY}" -m pip install --quiet --target "${ROOT}/tests/.pydeps" pytest
  fi
fi
cd "${ROOT}"
PYTHONPATH="${ROOT}/tests/.pydeps:${AGENT}" PYTHONDONTWRITEBYTECODE=1 exec "${PY}" -m pytest -p no:cacheprovider tests/python "$@"
