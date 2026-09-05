#!/usr/bin/env bash
# Copyright (c) 2026 HOOX · PYNE · jango-blockchained
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Fail CI/deploy if TradingView® built-in Pine sources or forbidden
# knowledge dumps are present in the git tree.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "== pyne-agent-worker legal-check =="

fail=0

# Tracked .pine files are forbidden (templates use .pine.example only).
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  tracked_pine="$(git ls-files '*.pine' '*.pinescript' 2>/dev/null || true)"
  if [[ -n "${tracked_pine}" ]]; then
    echo "ERROR: tracked Pine Script™ sources are not allowed:"
    echo "${tracked_pine}"
    fail=1
  fi
fi

# Language-reference dumps and llm packs must stay untracked.
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  tracked_kb="$(git ls-files 'knowledge/pineDocs.json' 'knowledge/axisDocs.json' 'knowledge/pyneDocs.json' 'knowledge/*-llm.txt' 'knowledge/llm.txt' 2>/dev/null || true)"
  if [[ -n "${tracked_kb}" ]]; then
    echo "ERROR: knowledge dumps must not be tracked (ingest to R2/Vectorize only):"
    echo "${tracked_kb}"
    fail=1
  fi
fi

# Working tree dumps under knowledge/ must stay untracked / gitignored.
for d in knowledge/data knowledge/raw knowledge/corpus knowledge/builtins knowledge/docs-cache; do
  if [[ -d "$d" ]] && find "$d" -type f ! -name '.gitkeep' 2>/dev/null | grep -q .; then
    # Only fail if git would track them
    if git check-ignore -q "$d" 2>/dev/null || git check-ignore -q "$d/*" 2>/dev/null; then
      echo "OK: $d is gitignored (local operator data allowed)."
    else
      # If directory exists with files and is not ignored, warn hard
      if git status --porcelain "$d" 2>/dev/null | grep -q .; then
        echo "ERROR: $d has unignored content — do not commit knowledge dumps."
        fail=1
      fi
    fi
  fi
done

# Heuristic: refuse known TV built-in script name dumps if committed as .pine
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  suspects="$(git ls-files | grep -E -i '(builtin|built-in).*\.(pine|pinescript)$|tv[_-]?builtin' || true)"
  if [[ -n "${suspects}" ]]; then
    echo "ERROR: suspected TradingView® built-in sources tracked:"
    echo "${suspects}"
    fail=1
  fi
fi

# Require trademark notice in README
if [[ -f README.md ]]; then
  if ! grep -q 'Pine Script™' README.md || ! grep -q 'TradingView®' README.md; then
    echo "ERROR: README.md must mention Pine Script™ and TradingView® marks."
    fail=1
  fi
  if ! grep -q 'Cloudflare®' README.md; then
    echo "ERROR: README.md must mention Cloudflare® mark."
    fail=1
  fi
fi

if [[ "$fail" -ne 0 ]]; then
  echo "legal-check FAILED"
  exit 1
fi

echo "legal-check OK"
exit 0
