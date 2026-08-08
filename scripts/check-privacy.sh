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
#   - extension/features/ultimo-movimento-map/ : .src=/.href= only, and only
#     when the value is chrome.runtime.getURL('vendor/...') — loads the
#     vendored Leaflet bundle from the extension's own package, no network
#     request leaves the browser (chrome-extension:// resolves locally, not
#     a URL_PATTERN https?:// match). Not a fetch sanction: this directory
#     may not call fetch() at all. ultimo-movimento-map.js runs in MAIN
#     world (no chrome.*), so it never calls chrome.runtime.getURL
#     directly — ultimo-movimento-map-relay.js (ISOLATED world) resolves
#     the URLs and hands them over via a CustomEvent
#     ("sigc-pro-leaflet-urls", detail {jsUrl, cssUrl}); the recognized
#     safe pattern below additionally covers .src=/.href= assigned from a
#     `.jsUrl`/`.cssUrl` property read off a variable populated by that
#     event's `.detail` — same "provenance must be visible in this file's
#     own text" principle as the direct-call carve-out, just one hop
#     removed. See
#     docs/superpowers/specs/2026-08-08-ultimo-movimento-mapa-design.md.
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
LOCAL_RESOURCE_DIRS='extension/features/ultimo-movimento-map'

PATTERN='fetch\(|["'\''"]fetch["'\''"]|import\(|new[[:space:]]+XMLHttpRequest|sendBeacon|WebSocket|EventSource|RTCPeerConnection|importScripts|new Image|\.src[[:space:]]*=|chrome\.storage|localStorage|sessionStorage|indexedDB|document\.cookie|eval\(|new Function'
PATTERN_NOFETCH='import\(|new[[:space:]]+XMLHttpRequest|sendBeacon|WebSocket|EventSource|RTCPeerConnection|importScripts|new Image|\.src[[:space:]]*=|chrome\.storage|localStorage|sessionStorage|indexedDB|document\.cookie|eval\(|new Function'
PATTERN_NOSTORAGE='fetch\(|["'\''"]fetch["'\''"]|import\(|new[[:space:]]+XMLHttpRequest|sendBeacon|WebSocket|EventSource|RTCPeerConnection|importScripts|new Image|\.src[[:space:]]*=|localStorage|sessionStorage|indexedDB|document\.cookie|eval\(|new Function'
# extension/features/ultimo-movimento-map/ may assign .src=/.href= ONLY
# from chrome.runtime.getURL('vendor/...') (loading the vendored Leaflet
# bundle — a local, bundled resource, not a network request). Every other
# banned API (fetch, XHR, new Image, chrome.storage, etc.) still applies
# there in full — this is the narrowest possible carve-out from PATTERN,
# not a second fetch/storage sanction.
PATTERN_NOLOCALRESOURCE='fetch\(|["'\''"]fetch["'\''"]|import\(|new[[:space:]]+XMLHttpRequest|sendBeacon|WebSocket|EventSource|RTCPeerConnection|importScripts|new Image|chrome\.storage|localStorage|sessionStorage|indexedDB|document\.cookie|eval\(|new Function'
# .src=/.href= is allowed when the RHS's provenance is visible in the
# SAME FILE as one of:
#   (a) inline: literally chrome.runtime.getURL('vendor/...')
#   (b) a bare variable that was itself assigned from that same call
#       earlier in the file — covers
#       `const cssHref = chrome.runtime.getURL(...); link.href = cssHref;`
#   (c) a `.jsUrl`/`.cssUrl` property read off a variable that was itself
#       assigned from a `sigc-pro-leaflet-urls` CustomEvent's `.detail`
#       (or a bare destructure of that `.detail`) — covers
#       ultimo-movimento-map.js's MAIN-world consumption of
#       ultimo-movimento-map-relay.js's (ISOLATED-world) broadcast; see
#       the directory comment above.
# None of this traces arbitrary control flow — it's a same-file text
# scan — but each variable name must appear in a qualifying assignment
# somewhere in the SAME file, and a later bare reassignment of that name
# (`name = <anything>;`) revokes it for the rest of the file, so an href
# pulled from an unrelated, attacker-controlled, or since-reassigned
# variable is still caught. Variable whitelists are scoped per file, not
# per directory — a name legitimately safe in one file must not leak
# safety to a same-named variable in a different file.
LOCAL_RESOURCE_SRC_INLINE_OK='\.(src|href)[[:space:]]*=[[:space:]]*chrome\.runtime\.getURL\(['\''"]vendor/'
LOCAL_RESOURCE_VAR_DEF='(const|let|var)[[:space:]]+([A-Za-z_$][A-Za-z0-9_$]*)[[:space:]]*=[[:space:]]*chrome\.runtime\.getURL\(['\''"]vendor/'
# Matches ANY assignment (declaration or plain reassignment) whose RHS
# mentions `.detail` — covers both `const x = e.detail;` and
# `leafletUrls = (e.detail && e.detail.jsUrl && e.detail.cssUrl) ? e.detail : null;`
# (ultimo-movimento-map.js's actual shape: a module-level `let`,
# reassigned inside the event listener, not declared with its final
# value). Deliberately loose on the exact RHS shape — the safety property
# this enforces is narrower and lives in local_resource_bad_src_file's
# consumer check below (only `.jsUrl`/`.cssUrl` property reads off a name
# assigned here are treated as safe, and only for .src=/.href=).
LOCAL_RESOURCE_EVENT_VAR_DEF='([A-Za-z_$][A-Za-z0-9_$]*)[[:space:]]*=[^;]*\.detail'
URL_PATTERN='https?://'

# Prints the .src=/.href= lines in $1 (a directory) that are NOT covered
# by the recognized safe patterns above, evaluated per file. $2 selects
# git-grep --cached (pass "staged") vs plain grep over the working tree
# (pass "tree").
local_resource_bad_src() {
  d="$1"; mode="$2"
  if [ "$mode" = staged ]; then
    files=$(git grep --cached -lE '\.(src|href)[[:space:]]*=' -- "$d" 2>/dev/null)
  else
    files=$(grep -rlE '\.(src|href)[[:space:]]*=' "$d/" 2>/dev/null)
  fi
  [ -z "$files" ] && return 0
  echo "$files" | while IFS= read -r f; do
    [ -z "$f" ] && continue
    local_resource_bad_src_file "$f" "$mode"
  done
}

# Per-file worker for local_resource_bad_src: builds this ONE file's
# variable whitelist (direct getURL('vendor/...') assignments, plus
# sigc-pro-leaflet-urls event-detail assignments for .jsUrl/.cssUrl
# access), revokes any name that's later bare-reassigned to something
# else, then reports .src=/.href= lines not covered by an inline literal
# or a still-whitelisted variable/property read.
local_resource_bad_src_file() {
  f="$1"; mode="$2"
  if [ "$mode" = staged ]; then
    content=$(git show ":$f" 2>/dev/null)
  else
    content=$(cat "$f" 2>/dev/null)
  fi
  [ -z "$content" ] && return 0
  src_lines=$(echo "$content" | grep -nE '\.(src|href)[[:space:]]*=')
  [ -z "$src_lines" ] && return 0

  direct_defs=$(echo "$content" | grep -oE "$LOCAL_RESOURCE_VAR_DEF" | sed -E 's/.*(const|let|var)[[:space:]]+([A-Za-z_$][A-Za-z0-9_$]*)[[:space:]]*=.*/\2/')
  event_defs=$(echo "$content" | grep -oE "$LOCAL_RESOURCE_EVENT_VAR_DEF" | sed -E 's/^[[:space:]]*([A-Za-z_$][A-Za-z0-9_$]*)[[:space:]]*=.*/\1/')

  # A name counts as whitelisted only up to its last bare reassignment
  # (`name = <not-a-qualifying-RHS>;`) in file order. Since this is a
  # line-order text scan (not real control flow), a reassignment ANYWHERE
  # after the qualifying definition revokes the name for simplicity and
  # safety (a false rejection here just means writing a fresh variable
  # name, not a security gap).
  revoked=""
  for name in $direct_defs $event_defs; do
    reassign=$(echo "$content" | grep -nE "^[[:space:]]*${name}[[:space:]]*=[[:space:]]*[^;]*;" | grep -vE "getURL\(['\''\"]vendor/|\.detail")
    if [ -n "$reassign" ]; then
      revoked="$revoked $name"
    fi
  done

  live_direct=""
  for name in $direct_defs; do
    case " $revoked " in
      *" $name "*) ;;
      *) live_direct="$live_direct $name" ;;
    esac
  done
  live_event=""
  for name in $event_defs; do
    case " $revoked " in
      *" $name "*) ;;
      *) live_event="$live_event $name" ;;
    esac
  done

  direct_names=$(echo "$live_direct" | tr ' ' '\n' | sed '/^$/d' | sort -u | tr '\n' '|' | sed 's/|$//')
  event_names=$(echo "$live_event" | tr ' ' '\n' | sed '/^$/d' | sort -u | tr '\n' '|' | sed 's/|$//')

  result="$src_lines"
  result=$(echo "$result" | grep -vE "$LOCAL_RESOURCE_SRC_INLINE_OK")
  if [ -n "$direct_names" ]; then
    result=$(echo "$result" | grep -vE "\.(src|href)[[:space:]]*=[[:space:]]*($direct_names)[[:space:]]*;")
  fi
  if [ -n "$event_names" ]; then
    result=$(echo "$result" | grep -vE "\.(src|href)[[:space:]]*=[[:space:]]*($event_names)\.(jsUrl|cssUrl)[[:space:]]*;")
  fi
  if [ -n "$result" ]; then
    echo "$result" | sed "s|^|$f:|"
  fi
}

if [ "$1" = "--staged" ]; then
  EXCLUDES=""
  for d in $FETCH_DIRS $STORAGE_DIRS $VENDOR_DIRS $LOCAL_RESOURCE_DIRS; do EXCLUDES="$EXCLUDES ':!$d'"; done
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
  LOCAL_RESOURCE_MATCHES=""
  LOCAL_RESOURCE_BAD_SRC=""
  for d in $LOCAL_RESOURCE_DIRS; do
    LOCAL_RESOURCE_MATCHES="$LOCAL_RESOURCE_MATCHES
$(git grep --cached -nE "$PATTERN_NOLOCALRESOURCE" -- "$d" 2>/dev/null)"
    LOCAL_RESOURCE_BAD_SRC="$LOCAL_RESOURCE_BAD_SRC
$(local_resource_bad_src "$d" staged)"
  done
else
  EXCLUDE_GREP=""
  for d in $FETCH_DIRS $STORAGE_DIRS $VENDOR_DIRS $LOCAL_RESOURCE_DIRS; do EXCLUDE_GREP="$EXCLUDE_GREP -e ^$d/"; done
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
  LOCAL_RESOURCE_MATCHES=""
  LOCAL_RESOURCE_BAD_SRC=""
  for d in $LOCAL_RESOURCE_DIRS; do
    LOCAL_RESOURCE_MATCHES="$LOCAL_RESOURCE_MATCHES
$(grep -rnE "$PATTERN_NOLOCALRESOURCE" "$d/" 2>/dev/null)"
    LOCAL_RESOURCE_BAD_SRC="$LOCAL_RESOURCE_BAD_SRC
$(local_resource_bad_src "$d" tree)"
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
if [ -n "$(echo "$LOCAL_RESOURCE_MATCHES" | tr -d '[:space:]')" ]; then
  echo "PRIVACY GATE FAILED — banned API in a local-resource-sanctioned directory (only .src=/.href= from chrome.runtime.getURL('vendor/...') is allowed there):" >&2
  echo "$LOCAL_RESOURCE_MATCHES" >&2
  exit 1
fi
if [ -n "$(echo "$LOCAL_RESOURCE_BAD_SRC" | tr -d '[:space:]')" ]; then
  echo "PRIVACY GATE FAILED — .src=/.href= in a local-resource-sanctioned directory not assigned from chrome.runtime.getURL('vendor/...'):" >&2
  echo "$LOCAL_RESOURCE_BAD_SRC" >&2
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
