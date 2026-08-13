#!/bin/sh
# Self-test for scripts/check-privacy.sh — the tripwire's tripwire: proves
# the gate still FAILS when a banned API is planted, so a future gate
# refactor can't silently weaken it. Plants temp files in the working tree
# (never staged), removes them on exit. The pre-commit hook runs this
# whenever the gate or this self-test changes.
set -e
cd "$(git rev-parse --show-toplevel)"

PLANT_OUT="extension/features/__privacy_tripwire__.js"
PLANT_MAP_XHR="extension/features/agenda-lookups/__privacy_tripwire_xhr__.js"
PLANT_MAP_URL="extension/features/agenda-lookups/__privacy_tripwire_url__.js"
PLANT_SETTINGS_FETCH="extension/features/agenda-date-picker/__privacy_tripwire_fetch__.js"
PLANT_UME_XHR="extension/features/ultimo-movimento-export/__privacy_tripwire_xhr__.js"
PLANT_UME_URL="extension/features/ultimo-movimento-export/__privacy_tripwire_url__.js"
PLANT_UME_STORAGE="extension/features/ultimo-movimento-export/__privacy_tripwire_storage__.js"
PLANT_VENDOR_OK="extension/vendor/__privacy_tripwire_ok__.js"
PLANT_VENDOR_LOOKALIKE="extension/vendor-evil/__privacy_tripwire_lookalike__.js"
PLANT_UMM_XHR="extension/features/ultimo-movimento-map/__privacy_tripwire_xhr__.js"
PLANT_UMM_SRC_BAD="extension/features/ultimo-movimento-map/__privacy_tripwire_src_bad__.js"
PLANT_UMM_SRC_VAR_BAD="extension/features/ultimo-movimento-map/__privacy_tripwire_src_var_bad__.js"
PLANT_UMM_SRC_OK="extension/features/ultimo-movimento-map/__privacy_tripwire_src_ok__.js"
PLANT_UMM_SRC_VAR_OK="extension/features/ultimo-movimento-map/__privacy_tripwire_src_var_ok__.js"
PLANT_UMM_SCOPE_DEF="extension/features/ultimo-movimento-map/__privacy_tripwire_scope_def__.js"
PLANT_UMM_SCOPE_LEAK="extension/features/ultimo-movimento-map/__privacy_tripwire_scope_leak__.js"
PLANT_UMM_REASSIGN="extension/features/ultimo-movimento-map/__privacy_tripwire_reassign__.js"
PLANT_UMM_EVENT_OK="extension/features/ultimo-movimento-map/__privacy_tripwire_event_ok__.js"
PLANT_UMM_EVENT_REASSIGN_OK="extension/features/ultimo-movimento-map/__privacy_tripwire_event_reassign_ok__.js"
PLANT_UMM_TILE_URL_OK="extension/features/ultimo-movimento-map/__privacy_tripwire_tile_url_ok__.js"
PLANT_UMM_URL_BAD="extension/features/ultimo-movimento-map/__privacy_tripwire_url_bad__.js"
cleanup() { rm -f "$PLANT_OUT" "$PLANT_MAP_XHR" "$PLANT_MAP_URL" "$PLANT_SETTINGS_FETCH" "$PLANT_UME_XHR" "$PLANT_UME_URL" "$PLANT_UME_STORAGE" "$PLANT_VENDOR_OK" "$PLANT_VENDOR_LOOKALIKE" "$PLANT_UMM_XHR" "$PLANT_UMM_SRC_BAD" "$PLANT_UMM_SRC_VAR_BAD" "$PLANT_UMM_SRC_OK" "$PLANT_UMM_SRC_VAR_OK" "$PLANT_UMM_SCOPE_DEF" "$PLANT_UMM_SCOPE_LEAK" "$PLANT_UMM_REASSIGN" "$PLANT_UMM_EVENT_OK" "$PLANT_UMM_EVENT_REASSIGN_OK" "$PLANT_UMM_TILE_URL_OK" "$PLANT_UMM_URL_BAD"; rmdir extension/vendor extension/vendor-evil extension/features/ultimo-movimento-map 2>/dev/null || true; }
trap cleanup EXIT INT TERM
mkdir -p extension/features/agenda-date-picker extension/features/ultimo-movimento-export extension/vendor extension/vendor-evil extension/features/ultimo-movimento-map

fail() { echo "privacy gate SELF-TEST FAILED: $1" >&2; exit 1; }

# 1. Clean tree must pass (working-tree mode exercises the same patterns
#    as --staged).
scripts/check-privacy.sh >/dev/null 2>&1 || fail "gate rejects a clean tree"

# 2. fetch( outside agenda-lookups must fail.
echo 'fetch("/x");' > "$PLANT_OUT"
if scripts/check-privacy.sh >/dev/null 2>&1; then
  fail "gate missed fetch( outside agenda-lookups"
fi
rm -f "$PLANT_OUT"

# 2b. The same, in --staged mode (what the pre-commit hook actually
#     runs) — git grep and plain grep use different regex engines under
#     -E (git grep's doesn't support \s; POSIX [[:space:]] works in
#     both), so a pattern that passes working-tree mode can still
#     silently under-match --staged. Plant WITH internal whitespace,
#     since that's exactly the shape that exposed the gap before.
echo 'var x = new   XMLHttpRequest();' > "$PLANT_OUT"
git add "$PLANT_OUT"
if scripts/check-privacy.sh --staged >/dev/null 2>&1; then
  git reset -- "$PLANT_OUT" >/dev/null 2>&1
  fail "gate --staged missed 'new   XMLHttpRequest' (multi-space) outside agenda-lookups"
fi
git reset -- "$PLANT_OUT" >/dev/null 2>&1
rm -f "$PLANT_OUT"

# 3. Non-fetch request API inside agenda-lookups must fail (only fetch is
#    sanctioned there).
echo 'var x = new XMLHttpRequest();' > "$PLANT_MAP_XHR"
if scripts/check-privacy.sh >/dev/null 2>&1; then
  fail "gate missed new XMLHttpRequest inside agenda-lookups"
fi
rm -f "$PLANT_MAP_XHR"

# 4. Absolute URL inside agenda-lookups must fail (requests must be built
#    from location.origin only).
echo '// see https://example.com' > "$PLANT_MAP_URL"
if scripts/check-privacy.sh >/dev/null 2>&1; then
  fail "gate missed absolute URL inside agenda-lookups"
fi
rm -f "$PLANT_MAP_URL"

# 5. fetch( inside settings/ must fail (only chrome.storage is sanctioned
#    there, not fetch).
echo 'fetch("/x");' > "$PLANT_SETTINGS_FETCH"
if scripts/check-privacy.sh >/dev/null 2>&1; then
  fail "gate missed fetch( inside settings/"
fi
rm -f "$PLANT_SETTINGS_FETCH"

# 6. chrome.storage must now FAIL EVERYWHERE. The settings/ exception was
#    retired with the advanced-flags Options page (2026-08-13) and the
#    manifest requests no permissions at all — so any storage API
#    reappearing anywhere is a regression, not a sanctioned use.
echo 'chrome.storage.local.get(["x"], () => {});' > "extension/features/ultimo-movimento-export/__privacy_tripwire_storage__.js"
if scripts/check-privacy.sh >/dev/null 2>&1; then
  fail "gate accepted chrome.storage — the storage ban must now be global"
fi
rm -f "extension/features/ultimo-movimento-export/__privacy_tripwire_storage__.js"

# 7. Non-fetch request API inside ultimo-movimento-export/ must fail.
echo 'var x = new XMLHttpRequest();' > "$PLANT_UME_XHR"
if scripts/check-privacy.sh >/dev/null 2>&1; then
  fail "gate missed new XMLHttpRequest inside ultimo-movimento-export/"
fi
rm -f "$PLANT_UME_XHR"

# 8. Absolute URL inside ultimo-movimento-export/ must fail.
echo 'const u = "https://evil.example/x";' > "$PLANT_UME_URL"
if scripts/check-privacy.sh >/dev/null 2>&1; then
  fail "gate missed absolute URL inside ultimo-movimento-export/"
fi
rm -f "$PLANT_UME_URL"

# 9. chrome.storage inside ultimo-movimento-export/ must fail (only fetch
#    is sanctioned there, not storage).
echo 'chrome.storage.local.set({x: 1});' > "$PLANT_UME_STORAGE"
if scripts/check-privacy.sh >/dev/null 2>&1; then
  fail "gate missed chrome.storage inside ultimo-movimento-export/"
fi
rm -f "$PLANT_UME_STORAGE"

# 10. Any banned API inside extension/vendor/ must PASS — vendored
#     third-party code is excluded from the blanket-ban scan (audited
#     once at vendor time, not per-commit).
echo 'fetch("/x"); new XMLHttpRequest(); document.cookie;' > "$PLANT_VENDOR_OK"
if ! scripts/check-privacy.sh >/dev/null 2>&1; then
  fail "gate rejected vendored code inside extension/vendor/"
fi
rm -f "$PLANT_VENDOR_OK"

# 11. A similarly-named but non-vendor directory (extension/vendor-evil/)
#     must still be caught — proves the exclusion is a real directory
#     boundary, not a naive string-prefix match that could be gamed by
#     naming a first-party file to look like it's under extension/vendor/.
echo 'fetch("/x");' > "$PLANT_VENDOR_LOOKALIKE"
if scripts/check-privacy.sh >/dev/null 2>&1; then
  fail "gate missed fetch( inside extension/vendor-evil/ (lookalike directory)"
fi
rm -f "$PLANT_VENDOR_LOOKALIKE"

# 12. Non-.src/.href banned API inside ultimo-movimento-map/ must fail —
#     that directory is sanctioned for .src=/.href= only, nothing else
#     (not even fetch, unlike the FETCH_DIRS).
echo 'var x = new XMLHttpRequest();' > "$PLANT_UMM_XHR"
if scripts/check-privacy.sh >/dev/null 2>&1; then
  fail "gate missed new XMLHttpRequest inside ultimo-movimento-map/"
fi
rm -f "$PLANT_UMM_XHR"

# 13. .src= assigned directly from a non-vendor URL inside
#     ultimo-movimento-map/ must fail.
echo "img.src = 'https://evil.example/beacon.gif';" > "$PLANT_UMM_SRC_BAD"
if scripts/check-privacy.sh >/dev/null 2>&1; then
  fail "gate missed .src= from a non-vendor URL inside ultimo-movimento-map/"
fi
rm -f "$PLANT_UMM_SRC_BAD"

# 14. .src= assigned from a variable that was NOT itself sourced from
#     chrome.runtime.getURL('vendor/...') must fail — proves the
#     variable carve-out can't be used to smuggle an arbitrary URL
#     through an intermediate variable.
printf '%s\n' \
  "const evilUrl = 'https://evil.example/x';" \
  "link.href = evilUrl;" \
  > "$PLANT_UMM_SRC_VAR_BAD"
if scripts/check-privacy.sh >/dev/null 2>&1; then
  fail "gate missed .src=/.href= from a variable not sourced from chrome.runtime.getURL('vendor/...')"
fi
rm -f "$PLANT_UMM_SRC_VAR_BAD"

# 15. .src= assigned inline from chrome.runtime.getURL('vendor/...'), and
#     the same via a two-step variable, must both PASS — the real shape
#     ultimo-movimento-map.js uses to load the vendored Leaflet bundle
#     (loadLeafletAssets: cssHref is assigned, then used two lines later).
echo "script.src = chrome.runtime.getURL('vendor/leaflet/leaflet.js');" > "$PLANT_UMM_SRC_OK"
if ! scripts/check-privacy.sh >/dev/null 2>&1; then
  fail "gate rejected inline .src= from chrome.runtime.getURL('vendor/...')"
fi
rm -f "$PLANT_UMM_SRC_OK"

printf '%s\n' \
  "const jsHref = chrome.runtime.getURL('vendor/leaflet/leaflet.js');" \
  "script.src = jsHref;" \
  > "$PLANT_UMM_SRC_VAR_OK"
if ! scripts/check-privacy.sh >/dev/null 2>&1; then
  fail "gate rejected .src= from a variable sourced from chrome.runtime.getURL('vendor/...')"
fi
rm -f "$PLANT_UMM_SRC_VAR_OK"

# 16. Variable whitelist must be scoped PER FILE, not per directory: a
#     name legitimately safe in one file (jsHref, defined here from
#     getURL('vendor/...')) must not make the SAME name safe in a
#     different file of the same directory that assigns it from an
#     attacker URL instead. Both files are planted together so the
#     directory-wide scan sees both; only the second (leak) file should
#     be reported as bad.
printf '%s\n' \
  "const jsHref = chrome.runtime.getURL('vendor/leaflet/leaflet.js');" \
  "script.src = jsHref;" \
  > "$PLANT_UMM_SCOPE_DEF"
printf '%s\n' \
  "const jsHref = 'https://evil.example/x';" \
  "script.src = jsHref;" \
  > "$PLANT_UMM_SCOPE_LEAK"
if scripts/check-privacy.sh >/dev/null 2>&1; then
  fail "gate let a variable name whitelisted in one file leak safety to a same-named variable in a different file"
fi
rm -f "$PLANT_UMM_SCOPE_DEF" "$PLANT_UMM_SCOPE_LEAK"

# 17. A variable whitelisted from chrome.runtime.getURL('vendor/...') but
#     later reassigned to something else must still fail — proves
#     reassignment isn't ignored (only the first assignment used to be
#     checked).
printf '%s\n' \
  "let cssHref = chrome.runtime.getURL('vendor/leaflet/leaflet.css');" \
  "cssHref = 'https://evil.example/x';" \
  "link.href = cssHref;" \
  > "$PLANT_UMM_REASSIGN"
if scripts/check-privacy.sh >/dev/null 2>&1; then
  fail "gate missed a whitelisted variable reassigned to a non-vendor value before use"
fi
rm -f "$PLANT_UMM_REASSIGN"

# 18. .src=/.href= assigned from a `.jsUrl`/`.cssUrl` property read off
#     ANY expression must PASS — a property-NAME allowlist, not a
#     provenance trace (see check-privacy.sh's LOCAL_RESOURCE_PROP_OK
#     comment for why: two earlier, more "precise" versions of this rule
#     — a CustomEvent .detail trace, then a document.documentElement
#     .dataset trace — each broke the moment the real code's call shape
#     changed, once live, 2026-08-09). Covers the real MAIN/ISOLATED
#     relay shape ultimo-movimento-map.js uses today (Leaflet URLs read
#     from document.documentElement.dataset, set by
#     ultimo-movimento-map-relay.js in ISOLATED world) without the gate
#     needing to know that shape's exact details.
printf '%s\n' \
  "const urls = readLeafletUrls();" \
  "script.src = urls.jsUrl;" \
  "link.href = urls.cssUrl;" \
  > "$PLANT_UMM_EVENT_OK"
if ! scripts/check-privacy.sh >/dev/null 2>&1; then
  fail "gate rejected .src=/.href= from a .jsUrl/.cssUrl property read"
fi
rm -f "$PLANT_UMM_EVENT_OK"

# 19. The property-name allowlist is deliberately NOT provenance-traced —
#     document that .jsUrl/.cssUrl off an attacker-controlled object
#     still PASSES the .src=/.href= check specifically (the accepted
#     trade-off from #18's comment, not a regression): confirms the gate
#     behaves as designed rather than silently reverting to the stricter,
#     more brittle tracing. The object's own URL literals are built from
#     a function call rather than a string literal so this test isolates
#     the .src=/.href= property-name rule from the SEPARATE
#     LOCAL_RESOURCE_URL_ALLOWLIST check (which independently, correctly
#     flags a hardcoded https:// literal anywhere in this directory —
#     confirmed while writing this test, that check catching a literal
#     attacker URL here is a feature, not something to route around).
printf '%s\n' \
  "const attacker = { jsUrl: attackerControlled(), cssUrl: attackerControlled() };" \
  "script.src = attacker.jsUrl;" \
  > "$PLANT_UMM_EVENT_REASSIGN_OK"
if ! scripts/check-privacy.sh >/dev/null 2>&1; then
  fail "gate's property-name allowlist unexpectedly rejected .jsUrl off an arbitrary object (design changed? update this test's comment)"
fi
rm -f "$PLANT_UMM_EVENT_REASSIGN_OK"

# 20. The allowlisted OpenStreetMap tile-host URL (the exact template
#     ultimo-movimento-map.js's renderLeafletMap passes to
#     L.tileLayer()) must PASS inside ultimo-movimento-map/ — proves the
#     one legitimate absolute URL this directory needs isn't caught by
#     its own allowlist check.
echo "L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {});" > "$PLANT_UMM_TILE_URL_OK"
if ! scripts/check-privacy.sh >/dev/null 2>&1; then
  fail "gate rejected the allowlisted OpenStreetMap tile-host URL inside ultimo-movimento-map/"
fi
rm -f "$PLANT_UMM_TILE_URL_OK"

# 21. Any OTHER absolute URL inside ultimo-movimento-map/ must FAIL —
#     proves the tile-host allowlist doesn't degrade into a blanket
#     pass for absolute URLs in this directory (the gap this check
#     closes: a future unauthorized second external URL there).
echo 'const u = "https://evil.example/x";' > "$PLANT_UMM_URL_BAD"
if scripts/check-privacy.sh >/dev/null 2>&1; then
  fail "gate missed a non-allowlisted absolute URL inside ultimo-movimento-map/"
fi
rm -f "$PLANT_UMM_URL_BAD"

echo "privacy gate self-test: PASS"
