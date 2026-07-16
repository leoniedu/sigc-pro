#!/bin/sh
# SIGC-PRO privacy gate: extension code must make no outbound requests and
# keep no storage. With --staged, checks the content being committed (used
# by the pre-commit hook); otherwise checks the working tree.
#
# This is a heuristic tripwire, not a proof: the hard guarantees remain the
# empty permissions list in manifest.json and code review of extension/.

PATTERN='fetch\(|["'\''"]fetch["'\''"]|import\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|RTCPeerConnection|importScripts|new Image|\.src\s*=|chrome\.storage|localStorage|sessionStorage|indexedDB|document\.cookie|eval\(|new Function'

if [ "$1" = "--staged" ]; then
  MATCHES=$(git grep --cached -nE "$PATTERN" -- extension/ 2>/dev/null)
else
  MATCHES=$(grep -rnE "$PATTERN" extension/ 2>/dev/null)
fi

if [ -n "$MATCHES" ]; then
  echo "PRIVACY GATE FAILED — request/storage APIs found in extension/:" >&2
  echo "$MATCHES" >&2
  exit 1
fi

# Unlisted-distribution gate: the Chrome Web Store item is unlisted, so its
# URL must never land in this public repo (docs, README, Pages, anywhere) —
# publishing the link would effectively de-unlist it. Checked repo-wide,
# not just extension/.
STORE_PATTERN='chromewebstore\.google\.com/detail|chrome\.google\.com/webstore/detail'
if [ "$1" = "--staged" ]; then
  STORE_MATCHES=$(git grep --cached -nE "$STORE_PATTERN" -- . 2>/dev/null)
else
  STORE_MATCHES=$(git grep -nE "$STORE_PATTERN" -- . 2>/dev/null)
fi

if [ -n "$STORE_MATCHES" ]; then
  echo "PRIVACY GATE FAILED — unlisted Chrome Web Store URL found in repo:" >&2
  echo "$STORE_MATCHES" >&2
  exit 1
fi
echo "privacy gate: CLEAN"
