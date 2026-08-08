#!/bin/sh
# SIGC-PRO privacy gate: extension code must make no outbound requests and
# keep no storage. With --staged, checks the content being committed (used
# by the pre-commit hook); otherwise checks the working tree.
#
# This is a heuristic tripwire, not a proof: the hard guarantees remain the
# empty permissions list in manifest.json and code review of extension/.

# Blanket ban. Sanctioned exceptions, each narrow and audited:
#   - extension/common/                    : fetch() only, same-origin only
#     (hosts fetchViaGateway, the shared F5-gateway request helper used by
#     agenda-map and ultimo-movimento-export; see
#     docs/superpowers/specs/2026-08-06-guia-do-dia-agencia-entrevistador-zona-nome-design.md)
#   - extension/features/agenda-map/       : fetch() only, same-origin only
#     (queries SIGC's own server; see
#     docs/superpowers/specs/2026-07-16-agenda-map-design.md)
#   - extension/features/ultimo-movimento-export/ : fetch() only, same-origin
#     only (same rationale, see
#     docs/superpowers/specs/2026-07-24-ultimo-movimento-multi-agencia-export-design.md)
#   - extension/features/lista-agenda/     : fetch() only, same-origin
#     (agenda slots + último movimento for the Lista de Endereços;
#     click+confirm, see
#     docs/superpowers/specs/2026-07-31-lista-agenda-design.md)
#   - extension/features/settings/         : chrome.storage only, no fetch
#     (persists the advanced-flags toggle; same spec as above)
#   - extension/vendor/                    : vendored third-party libraries,
#     unmodified from upstream — not swept by this heuristic (which targets
#     sigc-pro's own code), audited once at vendor time instead of per-commit.
#     First vendored library: Leaflet (see
#     docs/superpowers/specs/2026-08-08-ultimo-movimento-mapa-design.md).
# Every other API stays banned everywhere, including inside these
# directories except for the one API each is sanctioned for. Fetch-sanctioned
# directories may not contain absolute URLs, so their requests physically
# cannot leave location.origin. XMLHttpRequest is matched only as `new
# XMLHttpRequest` (actual API usage), not as a bare identifier — the
# standard AJAX header value "X-Requested-With: XMLHttpRequest" is a string
# literal, not a call, and the fetch-sanctioned directories legitimately
# send that header.
FETCH_DIRS='extension/common extension/features/agenda-map extension/features/ultimo-movimento-export extension/features/lista-agenda'
STORAGE_DIRS='extension/features/settings'
VENDOR_DIRS='extension/vendor'

PATTERN='fetch\(|["'\''"]fetch["'\''"]|import\(|new[[:space:]]+XMLHttpRequest|sendBeacon|WebSocket|EventSource|RTCPeerConnection|importScripts|new Image|\.src[[:space:]]*=|chrome\.storage|localStorage|sessionStorage|indexedDB|document\.cookie|eval\(|new Function'
PATTERN_NOFETCH='import\(|new[[:space:]]+XMLHttpRequest|sendBeacon|WebSocket|EventSource|RTCPeerConnection|importScripts|new Image|\.src[[:space:]]*=|chrome\.storage|localStorage|sessionStorage|indexedDB|document\.cookie|eval\(|new Function'
PATTERN_NOSTORAGE='fetch\(|["'\''"]fetch["'\''"]|import\(|new[[:space:]]+XMLHttpRequest|sendBeacon|WebSocket|EventSource|RTCPeerConnection|importScripts|new Image|\.src[[:space:]]*=|localStorage|sessionStorage|indexedDB|document\.cookie|eval\(|new Function'
URL_PATTERN='https?://'

if [ "$1" = "--staged" ]; then
  EXCLUDES=""
  for d in $FETCH_DIRS $STORAGE_DIRS $VENDOR_DIRS; do EXCLUDES="$EXCLUDES ':!$d'"; done
  MATCHES=$(eval git grep --cached -nE "\"$PATTERN\"" -- extension/ $EXCLUDES 2>/dev/null)
  FETCH_MATCHES=""
  FETCH_URLS=""
  for d in $FETCH_DIRS; do
    FETCH_MATCHES="$FETCH_MATCHES
$(git grep --cached -nE "$PATTERN_NOFETCH" -- "$d" 2>/dev/null)"
    # extension/common can contain URLs (gmapsDestinoUrl), which aren't
    # fetch calls — sigc-common is a shared utility file, not a feature.
    if [ "$d" != "extension/common" ]; then
      FETCH_URLS="$FETCH_URLS
$(git grep --cached -nE "$URL_PATTERN" -- "$d" 2>/dev/null)"
    fi
  done
  STORAGE_MATCHES=""
  for d in $STORAGE_DIRS; do
    STORAGE_MATCHES="$STORAGE_MATCHES
$(git grep --cached -nE "$PATTERN_NOSTORAGE" -- "$d" 2>/dev/null)"
  done
else
  EXCLUDE_GREP=""
  for d in $FETCH_DIRS $STORAGE_DIRS $VENDOR_DIRS; do EXCLUDE_GREP="$EXCLUDE_GREP -e ^$d/"; done
  MATCHES=$(grep -rnE "$PATTERN" extension/ 2>/dev/null | grep -vE "$(echo $EXCLUDE_GREP | sed 's/-e //g' | tr ' ' '|')")
  FETCH_MATCHES=""
  FETCH_URLS=""
  for d in $FETCH_DIRS; do
    FETCH_MATCHES="$FETCH_MATCHES
$(grep -rnE "$PATTERN_NOFETCH" "$d/" 2>/dev/null)"
    # extension/common can contain URLs (gmapsDestinoUrl), which aren't
    # fetch calls — sigc-common is a shared utility file, not a feature.
    if [ "$d" != "extension/common" ]; then
      FETCH_URLS="$FETCH_URLS
$(grep -rnE "$URL_PATTERN" "$d/" 2>/dev/null)"
    fi
  done
  STORAGE_MATCHES=""
  for d in $STORAGE_DIRS; do
    STORAGE_MATCHES="$STORAGE_MATCHES
$(grep -rnE "$PATTERN_NOSTORAGE" "$d/" 2>/dev/null)"
  done
fi

if [ -n "$MATCHES" ]; then
  echo "PRIVACY GATE FAILED — request/storage APIs found outside sanctioned directories:" >&2
  echo "$MATCHES" >&2
  exit 1
fi
if [ -n "$(echo "$FETCH_MATCHES" | tr -d '[:space:]')" ]; then
  echo "PRIVACY GATE FAILED — non-fetch request/storage APIs in a fetch-sanctioned directory:" >&2
  echo "$FETCH_MATCHES" >&2
  exit 1
fi
if [ -n "$(echo "$FETCH_URLS" | tr -d '[:space:]')" ]; then
  echo "PRIVACY GATE FAILED — absolute URL in a fetch-sanctioned directory (must use location.origin only):" >&2
  echo "$FETCH_URLS" >&2
  exit 1
fi
if [ -n "$(echo "$STORAGE_MATCHES" | tr -d '[:space:]')" ]; then
  echo "PRIVACY GATE FAILED — fetch/other request API in a storage-sanctioned directory (only chrome.storage is allowed there):" >&2
  echo "$STORAGE_MATCHES" >&2
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
  STORE_MATCHES=$(grep -rnE "$STORE_PATTERN" . 2>/dev/null)
fi

if [ -n "$STORE_MATCHES" ]; then
  echo "PRIVACY GATE FAILED — unlisted Chrome Web Store URL found in repo:" >&2
  echo "$STORE_MATCHES" >&2
  exit 1
fi
echo "privacy gate: CLEAN"
