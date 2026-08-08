#!/bin/sh
# Self-test for scripts/check-privacy.sh — the tripwire's tripwire: proves
# the gate still FAILS when a banned API is planted, so a future gate
# refactor can't silently weaken it. Plants temp files in the working tree
# (never staged), removes them on exit. The pre-commit hook runs this
# whenever the gate or this self-test changes.
set -e
cd "$(git rev-parse --show-toplevel)"

PLANT_OUT="extension/features/__privacy_tripwire__.js"
PLANT_MAP_XHR="extension/features/agenda-map/__privacy_tripwire_xhr__.js"
PLANT_MAP_URL="extension/features/agenda-map/__privacy_tripwire_url__.js"
PLANT_SETTINGS_FETCH="extension/features/settings/__privacy_tripwire_fetch__.js"
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
cleanup() { rm -f "$PLANT_OUT" "$PLANT_MAP_XHR" "$PLANT_MAP_URL" "$PLANT_SETTINGS_FETCH" "$PLANT_UME_XHR" "$PLANT_UME_URL" "$PLANT_UME_STORAGE" "$PLANT_VENDOR_OK" "$PLANT_VENDOR_LOOKALIKE" "$PLANT_UMM_XHR" "$PLANT_UMM_SRC_BAD" "$PLANT_UMM_SRC_VAR_BAD" "$PLANT_UMM_SRC_OK" "$PLANT_UMM_SRC_VAR_OK"; rmdir extension/vendor extension/vendor-evil extension/features/ultimo-movimento-map 2>/dev/null || true; }
trap cleanup EXIT INT TERM
mkdir -p extension/features/settings extension/features/ultimo-movimento-export extension/vendor extension/vendor-evil extension/features/ultimo-movimento-map

fail() { echo "privacy gate SELF-TEST FAILED: $1" >&2; exit 1; }

# 1. Clean tree must pass (working-tree mode exercises the same patterns
#    as --staged).
scripts/check-privacy.sh >/dev/null 2>&1 || fail "gate rejects a clean tree"

# 2. fetch( outside agenda-map must fail.
echo 'fetch("/x");' > "$PLANT_OUT"
if scripts/check-privacy.sh >/dev/null 2>&1; then
  fail "gate missed fetch( outside agenda-map"
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
  fail "gate --staged missed 'new   XMLHttpRequest' (multi-space) outside agenda-map"
fi
git reset -- "$PLANT_OUT" >/dev/null 2>&1
rm -f "$PLANT_OUT"

# 3. Non-fetch request API inside agenda-map must fail (only fetch is
#    sanctioned there).
echo 'var x = new XMLHttpRequest();' > "$PLANT_MAP_XHR"
if scripts/check-privacy.sh >/dev/null 2>&1; then
  fail "gate missed new XMLHttpRequest inside agenda-map"
fi
rm -f "$PLANT_MAP_XHR"

# 4. Absolute URL inside agenda-map must fail (requests must be built
#    from location.origin only).
echo '// see https://example.com' > "$PLANT_MAP_URL"
if scripts/check-privacy.sh >/dev/null 2>&1; then
  fail "gate missed absolute URL inside agenda-map"
fi
rm -f "$PLANT_MAP_URL"

# 5. fetch( inside settings/ must fail (only chrome.storage is sanctioned
#    there, not fetch).
echo 'fetch("/x");' > "$PLANT_SETTINGS_FETCH"
if scripts/check-privacy.sh >/dev/null 2>&1; then
  fail "gate missed fetch( inside settings/"
fi
rm -f "$PLANT_SETTINGS_FETCH"

# 6. chrome.storage inside settings/ must PASS (it's the sanctioned API
#    there) — proves the exception isn't accidentally too narrow.
echo 'chrome.storage.local.get(["x"], () => {});' > "extension/features/settings/__privacy_tripwire_storage_ok__.js"
if ! scripts/check-privacy.sh >/dev/null 2>&1; then
  fail "gate rejected sanctioned chrome.storage inside settings/"
fi
rm -f "extension/features/settings/__privacy_tripwire_storage_ok__.js"

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

echo "privacy gate self-test: PASS"
