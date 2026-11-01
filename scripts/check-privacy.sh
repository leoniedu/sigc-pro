#!/bin/sh
# SIGC-PRO privacy gate: extension code must make no outbound requests and
# keep no storage. With --staged, checks the content being committed (used
# by the pre-commit hook); otherwise checks the working tree.
#
# This is a heuristic tripwire, not a proof: the hard guarantees remain the
# empty permissions list in manifest.json and code review of extension/.

# Blanket ban. Sanctioned exceptions, each narrow and audited:
#   - extension/common/                    : fetch() only, same-origin only;
#     absolute URLs only from COMMON_URL_ALLOWLIST (below)
#     (hosts fetchViaGateway, the shared F5-gateway request helper used by
#     agenda-lookups and ultimo-movimento-export; see
#     docs/archive/specs/2026-08-06-guia-do-dia-agencia-entrevistador-zona-nome-design.md)
#   - extension/features/agenda-lookups/       : fetch() only, same-origin only
#     (queries SIGC's own server; see
#     docs/archive/specs/2026-07-16-agenda-map-design.md)
#   - extension/features/ultimo-movimento-export/ : fetch() only, same-origin
#     only (same rationale, see
#     docs/archive/specs/2026-07-24-ultimo-movimento-multi-agencia-export-design.md)
#   - extension/features/gerenciamento-historico/ : IndexedDB only (the GEREN-PRO
#     history by agência: per-UF, per-day counts, never a household), and NO
#     network at all — fetch() is banned there like everywhere but FETCH_DIRS.
#     Only historico-worker.js (extension origin) opens the database; the
#     bridge and the client relay through DOM attributes. See
#     docs/superpowers/specs/2026-10-15-gerenciamento-historico-design.md.
#   - extension/vendor/                    : vendored third-party libraries,
#     unmodified from upstream — not swept by this heuristic (which targets
#     sigc-pro's own code), audited once at vendor time instead of per-commit.
#     First vendored library: Leaflet (see
#     docs/archive/specs/2026-08-08-ultimo-movimento-mapa-design.md).
#   - extension/features/ultimo-movimento-map/ : .src=/.href= only, and only
#     from a `.jsUrl`/`.cssUrl` property — the vendored Leaflet bundle's
#     chrome-extension:// URLs, which ultimo-movimento-map-relay.js
#     (ISOLATED world) writes as document.documentElement.dataset
#     attributes for the MAIN-world script. Not a fetch sanction: this
#     directory may not call fetch() at all. This directory ALSO gets an
#     absolute-URL allowlist check
#     (LOCAL_RESOURCE_URL_ALLOWLIST, below): unlike FETCH_DIRS (which must
#     contain zero absolute URLs), it legitimately needs exactly one — the
#     OpenStreetMap tile-host template Leaflet's L.tileLayer() uses — so
#     any OTHER absolute URL found there still fails the gate. See
#     docs/archive/specs/2026-08-08-ultimo-movimento-mapa-design.md.
# Every other API stays banned everywhere, including inside these
# directories except for the one API each is sanctioned for. Fetch-sanctioned
# directories may not contain absolute URLs, so their requests physically
# cannot leave location.origin. XMLHttpRequest is matched only as `new
# XMLHttpRequest` (actual API usage), not as a bare identifier — the
# standard AJAX header value "X-Requested-With: XMLHttpRequest" is a string
# literal, not a call, and the fetch-sanctioned directories legitimately
# send that header.
# extension/features/usuario-lookup: the Carta de notificação's agent
# lookup — two same-origin requests through the page's F5 gateway to the
# SIGC usuário module: POST /usuario/Grid (siape -> id) and GET
# /usuario/EditarUsuario (id -> cadastro). The module's backend host is
# the one allowlisted URL in extension/common (COMMON_URL_ALLOWLIST).
FETCH_DIRS='extension/common extension/features/agenda-lookups extension/features/ultimo-movimento-export extension/features/usuario-lookup'
# Storage APIs are banned EVERYWHERE in extension/ except this directory:
# the GEREN-PRO history (2026-10-15, the first thing this extension stores).
# chrome.storage stays banned even here — the history is IndexedDB in the
# service worker, and the manifest still requests no permissions at all.
# (An earlier list, the advanced-flags Options page, was retired 2026-08-13.)
STORAGE_DIRS='extension/features/gerenciamento-historico'
VENDOR_DIRS='extension/vendor'
# extension/features/carta-notificacao loads the vendored pdf-lib bundle
# and the letterhead-assets script the same way (relay + .jsUrl); it may
# not request anything — its agent lookup lives in usuario-lookup/.
LOCAL_RESOURCE_DIRS='extension/features/ultimo-movimento-map extension/features/carta-notificacao'

PATTERN='fetch\(|["'\''"]fetch["'\''"]|import\(|new[[:space:]]+XMLHttpRequest|sendBeacon|WebSocket|EventSource|RTCPeerConnection|importScripts|new Image|\.src[[:space:]]*=|chrome\.storage|localStorage|sessionStorage|indexedDB|document\.cookie|eval\(|new Function'
PATTERN_NOFETCH='import\(|new[[:space:]]+XMLHttpRequest|sendBeacon|WebSocket|EventSource|RTCPeerConnection|importScripts|new Image|\.src[[:space:]]*=|chrome\.storage|localStorage|sessionStorage|indexedDB|document\.cookie|eval\(|new Function'
# The storage-sanctioned directory: IndexedDB is allowed (that is the point),
# everything that moves bytes off-origin is not, and neither are the other
# storage APIs (chrome.storage, localStorage, sessionStorage, cookies).
PATTERN_NOSTORAGE='fetch\(|["'\''"]fetch["'\''"]|import\(|new[[:space:]]+XMLHttpRequest|sendBeacon|WebSocket|EventSource|RTCPeerConnection|importScripts|new Image|\.src[[:space:]]*=|chrome\.storage|localStorage|sessionStorage|document\.cookie|eval\(|new Function'
# Local-resource directories may assign .src=/.href= ONLY from a
# .jsUrl/.cssUrl property (loading a vendored bundle — a local resource,
# not a network request). Every other
# banned API (fetch, XHR, new Image, chrome.storage, etc.) still applies
# there in full — this is the narrowest possible carve-out from PATTERN,
# not a second fetch/storage sanction.
PATTERN_NOLOCALRESOURCE='fetch\(|["'\''"]fetch["'\''"]|import\(|new[[:space:]]+XMLHttpRequest|sendBeacon|WebSocket|EventSource|RTCPeerConnection|importScripts|new Image|chrome\.storage|localStorage|sessionStorage|indexedDB|document\.cookie|eval\(|new Function'
# .src=/.href= is allowed only from a `.jsUrl`/`.cssUrl` property read
# off any expression (`script.src = urls.jsUrl;`). A property-NAME
# allowlist, deliberately not provenance-traced: two tracing versions
# broke the moment the real call shape changed (2026-08-09). An attacker
# would need a property literally named jsUrl/cssUrl to reach .src=/.href=
# in a directory whose only purpose is loading vendored bundles.
LOCAL_RESOURCE_PROP_OK='\.(src|href)[[:space:]]*=[[:space:]]*[A-Za-z_$][A-Za-z0-9_$.]*\.(jsUrl|cssUrl)[[:space:]]*;'
URL_PATTERN='https?://'
# extension/features/ultimo-movimento-map/ is not URL-free like FETCH_DIRS
# (which must contain zero absolute URLs): it legitimately loads OSM map
# tiles via Leaflet's L.tileLayer(), which needs one hardcoded tile-host
# URL template (see ultimo-movimento-map.js's renderLeafletMap and
# docs/archive/specs/2026-08-08-ultimo-movimento-mapa-design.md). So
# this is an ALLOWLIST, not a ban: any https?:// URL in this directory
# must match the exact tile-host template below, or the gate fails —
# catching a future unauthorized second external URL while still
# permitting the one sanctioned tile host.
# Substring match (not anchored to the whole line — the real call site
# is `L.tileLayer('https://...png', { ... })`, so the URL is only part
# of its line): a line is only exempted when it contains this exact
# tile-host template somewhere in it.
LOCAL_RESOURCE_URL_ALLOWLIST='https://\{s\}\.tile\.openstreetmap\.org/\{z\}/\{x\}/\{y\}\.png'

# extension/common is fetch-sanctioned like the feature directories, but
# may name exactly these absolute URLs: the usuário module's backend host
# (hex-encoded at runtime into the F5 gateway prefix; the request goes to
# location.origin) and the two Google Maps link builders (links the user
# clicks, never fetched). Every other fetch-sanctioned directory must be
# URL-free. Filters stdin.
COMMON_URL_ALLOWLIST="'https://w3servicosigc\.ibge\.gov\.br'|'https://www\.google\.com/maps/(dir|search)/\?api=1"
fetch_url_filter() {
  if [ "$1" = "extension/common" ]; then
    grep -vE "$COMMON_URL_ALLOWLIST"
  else
    cat
  fi
}

# URLs hidden from URL_PATTERN by encoding: hex or base64 of "http".
# Checked across extension/ except vendored code (whose embedded PNGs
# are base64 and may contain any substring).
ENCODED_URL_PATTERN='68747470|aHR0c'

# The tile-host allowlist belongs to the map directory alone: any other
# local-resource directory (carta-notificacao) has no business with
# tiles, so every absolute URL there fails. Filters stdin.
LOCAL_RESOURCE_TILE_DIR='extension/features/ultimo-movimento-map'
local_resource_url_filter() {
  if [ "$1" = "$LOCAL_RESOURCE_TILE_DIR" ]; then
    grep -vE "$LOCAL_RESOURCE_URL_ALLOWLIST"
  else
    cat
  fi
}

# Prints the .src=/.href= lines in $1 (a directory) not assigned from a
# .jsUrl/.cssUrl property. $2: "staged" (git grep --cached) or "tree".
local_resource_bad_src() {
  if [ "$2" = staged ]; then
    git grep --cached -nE '\.(src|href)[[:space:]]*=' -- "$1" 2>/dev/null
  else
    grep -rnE '\.(src|href)[[:space:]]*=' "$1/" 2>/dev/null
  fi | grep -vE "$LOCAL_RESOURCE_PROP_OK"
}

if [ "$1" = "--staged" ]; then
  ENCODED_URLS=$(eval git grep --cached -nE "\"$ENCODED_URL_PATTERN\"" -- extension/ $(for d in $VENDOR_DIRS; do printf "':!%s' " "$d"; done) 2>/dev/null)
  EXCLUDES=""
  for d in $FETCH_DIRS $STORAGE_DIRS $VENDOR_DIRS $LOCAL_RESOURCE_DIRS; do EXCLUDES="$EXCLUDES ':!$d'"; done
  MATCHES=$(eval git grep --cached -nE "\"$PATTERN\"" -- extension/ $EXCLUDES 2>/dev/null)
  FETCH_MATCHES=""
  FETCH_URLS=""
  for d in $FETCH_DIRS; do
    FETCH_MATCHES="$FETCH_MATCHES
$(git grep --cached -nE "$PATTERN_NOFETCH" -- "$d" 2>/dev/null)"
    FETCH_URLS="$FETCH_URLS
$(git grep --cached -nE "$URL_PATTERN" -- "$d" 2>/dev/null | fetch_url_filter "$d")"
  done
  STORAGE_MATCHES=""
  for d in $STORAGE_DIRS; do
    STORAGE_MATCHES="$STORAGE_MATCHES
$(git grep --cached -nE "$PATTERN_NOSTORAGE" -- "$d" 2>/dev/null)"
  done
  LOCAL_RESOURCE_MATCHES=""
  LOCAL_RESOURCE_BAD_SRC=""
  LOCAL_RESOURCE_BAD_URLS=""
  for d in $LOCAL_RESOURCE_DIRS; do
    LOCAL_RESOURCE_MATCHES="$LOCAL_RESOURCE_MATCHES
$(git grep --cached -nE "$PATTERN_NOLOCALRESOURCE" -- "$d" 2>/dev/null)"
    LOCAL_RESOURCE_BAD_SRC="$LOCAL_RESOURCE_BAD_SRC
$(local_resource_bad_src "$d" staged)"
    LOCAL_RESOURCE_BAD_URLS="$LOCAL_RESOURCE_BAD_URLS
$(git grep --cached -nE "$URL_PATTERN" -- "$d" 2>/dev/null | local_resource_url_filter "$d")"
  done
else
  ENCODED_URLS=$(grep -rnE "$ENCODED_URL_PATTERN" extension/ 2>/dev/null | grep -vE "^($(echo $VENDOR_DIRS | tr ' ' '|'))/")
  EXCLUDE_GREP=""
  for d in $FETCH_DIRS $STORAGE_DIRS $VENDOR_DIRS $LOCAL_RESOURCE_DIRS; do EXCLUDE_GREP="$EXCLUDE_GREP -e ^$d/"; done
  MATCHES=$(grep -rnE "$PATTERN" extension/ 2>/dev/null | grep -vE "$(echo $EXCLUDE_GREP | sed 's/-e //g' | tr ' ' '|')")
  FETCH_MATCHES=""
  FETCH_URLS=""
  for d in $FETCH_DIRS; do
    FETCH_MATCHES="$FETCH_MATCHES
$(grep -rnE "$PATTERN_NOFETCH" "$d/" 2>/dev/null)"
    FETCH_URLS="$FETCH_URLS
$(grep -rnE "$URL_PATTERN" "$d/" 2>/dev/null | fetch_url_filter "$d")"
  done
  STORAGE_MATCHES=""
  for d in $STORAGE_DIRS; do
    STORAGE_MATCHES="$STORAGE_MATCHES
$(grep -rnE "$PATTERN_NOSTORAGE" "$d/" 2>/dev/null)"
  done
  LOCAL_RESOURCE_MATCHES=""
  LOCAL_RESOURCE_BAD_SRC=""
  LOCAL_RESOURCE_BAD_URLS=""
  for d in $LOCAL_RESOURCE_DIRS; do
    LOCAL_RESOURCE_MATCHES="$LOCAL_RESOURCE_MATCHES
$(grep -rnE "$PATTERN_NOLOCALRESOURCE" "$d/" 2>/dev/null)"
    LOCAL_RESOURCE_BAD_SRC="$LOCAL_RESOURCE_BAD_SRC
$(local_resource_bad_src "$d" tree)"
    LOCAL_RESOURCE_BAD_URLS="$LOCAL_RESOURCE_BAD_URLS
$(grep -rnE "$URL_PATTERN" "$d/" 2>/dev/null | local_resource_url_filter "$d")"
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
if [ -n "$ENCODED_URLS" ]; then
  echo "PRIVACY GATE FAILED — hex/base64-encoded URL found (write URLs in plain text so the gate can see them):" >&2
  echo "$ENCODED_URLS" >&2
  exit 1
fi
if [ -n "$(echo "$FETCH_URLS" | tr -d '[:space:]')" ]; then
  echo "PRIVACY GATE FAILED — absolute URL in a fetch-sanctioned directory (must use location.origin only; extension/common may name only COMMON_URL_ALLOWLIST):" >&2
  echo "$FETCH_URLS" >&2
  exit 1
fi
if [ -n "$(echo "$STORAGE_MATCHES" | tr -d '[:space:]')" ]; then
  echo "PRIVACY GATE FAILED — fetch/other request API in a storage-sanctioned directory (only chrome.storage is allowed there):" >&2
  echo "$STORAGE_MATCHES" >&2
  exit 1
fi
if [ -n "$(echo "$LOCAL_RESOURCE_MATCHES" | tr -d '[:space:]')" ]; then
  echo "PRIVACY GATE FAILED — banned API in a local-resource-sanctioned directory (only .src=/.href= from a .jsUrl/.cssUrl property is allowed there):" >&2
  echo "$LOCAL_RESOURCE_MATCHES" >&2
  exit 1
fi
if [ -n "$(echo "$LOCAL_RESOURCE_BAD_SRC" | tr -d '[:space:]')" ]; then
  echo "PRIVACY GATE FAILED — .src=/.href= in a local-resource-sanctioned directory not assigned from a .jsUrl/.cssUrl property:" >&2
  echo "$LOCAL_RESOURCE_BAD_SRC" >&2
  exit 1
fi
if [ -n "$(echo "$LOCAL_RESOURCE_BAD_URLS" | tr -d '[:space:]')" ]; then
  echo "PRIVACY GATE FAILED — absolute URL in a local-resource-sanctioned directory not matching the allowlisted tile host ($LOCAL_RESOURCE_URL_ALLOWLIST):" >&2
  echo "$LOCAL_RESOURCE_BAD_URLS" >&2
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
