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
PLANT_OTHER_FETCH="extension/features/agenda-date-picker/__privacy_tripwire_fetch__.js"
PLANT_UME_XHR="extension/features/ultimo-movimento-export/__privacy_tripwire_xhr__.js"
PLANT_UME_URL="extension/features/ultimo-movimento-export/__privacy_tripwire_url__.js"
PLANT_UME_STORAGE="extension/features/ultimo-movimento-export/__privacy_tripwire_storage__.js"
PLANT_VENDOR_OK="extension/vendor/__privacy_tripwire_ok__.js"
PLANT_VENDOR_LOOKALIKE="extension/vendor-evil/__privacy_tripwire_lookalike__.js"
PLANT_UMM_XHR="extension/features/ultimo-movimento-map/__privacy_tripwire_xhr__.js"
PLANT_UMM_SRC_BAD="extension/features/ultimo-movimento-map/__privacy_tripwire_src_bad__.js"
PLANT_UMM_SRC_VAR_BAD="extension/features/ultimo-movimento-map/__privacy_tripwire_src_var_bad__.js"
PLANT_UMM_EVENT_OK="extension/features/ultimo-movimento-map/__privacy_tripwire_event_ok__.js"
PLANT_UMM_EVENT_REASSIGN_OK="extension/features/ultimo-movimento-map/__privacy_tripwire_event_reassign_ok__.js"
PLANT_UMM_TILE_URL_OK="extension/features/ultimo-movimento-map/__privacy_tripwire_tile_url_ok__.js"
PLANT_UMM_URL_BAD="extension/features/ultimo-movimento-map/__privacy_tripwire_url_bad__.js"
PLANT_UL_URL="extension/features/usuario-lookup/__privacy_tripwire_url__.js"
PLANT_UL_SRC="extension/features/usuario-lookup/__privacy_tripwire_src__.js"
PLANT_CN_FETCH="extension/features/carta-notificacao/__privacy_tripwire_fetch__.js"
PLANT_CN_SRC_OK="extension/features/carta-notificacao/__privacy_tripwire_src_ok__.js"
PLANT_CN_SRC_BAD="extension/features/carta-notificacao/__privacy_tripwire_src_bad__.js"
PLANT_CN_URL_BAD="extension/features/carta-notificacao/__privacy_tripwire_url_bad__.js"
PLANT_CN_TILE_BAD="extension/features/carta-notificacao/__privacy_tripwire_tile_bad__.js"
PLANT_GH_IDB_OK="extension/features/gerenciamento-historico/__privacy_tripwire_idb_ok__.js"
PLANT_GH_FETCH="extension/features/gerenciamento-historico/__privacy_tripwire_fetch__.js"
PLANT_GH_CHROME="extension/features/gerenciamento-historico/__privacy_tripwire_chrome__.js"
PLANT_GH_LOCAL="extension/features/gerenciamento-historico/__privacy_tripwire_local__.js"
PLANT_GR_IDB="extension/features/gerenciamento-coleta/__privacy_tripwire_idb__.js"
PLANT_COMMON_URL_OK="extension/common/__privacy_tripwire_url_ok__.js"
PLANT_COMMON_URL_BAD="extension/common/__privacy_tripwire_url_bad__.js"
PLANT_HEX_URL="extension/features/csv-export/__privacy_tripwire_hex__.js"
PLANT_B64_URL="extension/features/csv-export/__privacy_tripwire_b64__.js"
cleanup() { rm -f "$PLANT_COMMON_URL_OK" "$PLANT_COMMON_URL_BAD" "$PLANT_HEX_URL" "$PLANT_B64_URL"; rm -f "$PLANT_GH_IDB_OK" "$PLANT_GH_FETCH" "$PLANT_GH_CHROME" "$PLANT_GH_LOCAL" "$PLANT_GR_IDB"; rm -f "$PLANT_CN_TILE_BAD" "$PLANT_UL_URL" "$PLANT_UL_SRC" "$PLANT_CN_FETCH" "$PLANT_CN_SRC_OK" "$PLANT_CN_SRC_BAD" "$PLANT_CN_URL_BAD"; rm -f "$PLANT_OUT" "$PLANT_MAP_XHR" "$PLANT_MAP_URL" "$PLANT_OTHER_FETCH" "$PLANT_UME_XHR" "$PLANT_UME_URL" "$PLANT_UME_STORAGE" "$PLANT_VENDOR_OK" "$PLANT_VENDOR_LOOKALIKE" "$PLANT_UMM_XHR" "$PLANT_UMM_SRC_BAD" "$PLANT_UMM_SRC_VAR_BAD" "$PLANT_UMM_EVENT_OK" "$PLANT_UMM_EVENT_REASSIGN_OK" "$PLANT_UMM_TILE_URL_OK" "$PLANT_UMM_URL_BAD"; rmdir extension/vendor extension/vendor-evil extension/features/ultimo-movimento-map 2>/dev/null || true; }
trap cleanup EXIT INT TERM
mkdir -p extension/features/agenda-date-picker extension/features/ultimo-movimento-export extension/vendor extension/vendor-evil extension/features/ultimo-movimento-map extension/features/usuario-lookup extension/features/carta-notificacao extension/features/gerenciamento-historico extension/features/gerenciamento-coleta

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

# 5. fetch( in a feature directory with no sanction must fail.
echo 'fetch("/x");' > "$PLANT_OTHER_FETCH"
if scripts/check-privacy.sh >/dev/null 2>&1; then
  fail "gate missed fetch( inside agenda-date-picker/"
fi
rm -f "$PLANT_OTHER_FETCH"

# 6. chrome.storage must FAIL EVERYWHERE — the manifest requests no
#    permissions at all.
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

# 14. .src= assigned from a plain variable must fail — only a
#     .jsUrl/.cssUrl property read is allowed.
printf '%s\n' \
  "const evilUrl = 'https://evil.example/x';" \
  "link.href = evilUrl;" \
  > "$PLANT_UMM_SRC_VAR_BAD"
if scripts/check-privacy.sh >/dev/null 2>&1; then
  fail "gate missed .src=/.href= from a plain variable"
fi
rm -f "$PLANT_UMM_SRC_VAR_BAD"

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

# 22. usuario-lookup/ (Carta de notificação's agent lookup) is a FETCH
#     directory: an absolute https:// URL there must FAIL — its requests
#     are built from location.origin plus a hex prefix constant kept in
#     extension/common, never from a URL literal.
echo 'fetch("https://w3servicosigc.ibge.gov.br/usuario/Grid");' > "$PLANT_UL_URL"
if scripts/check-privacy.sh >/dev/null 2>&1; then
  fail "gate missed an absolute URL inside usuario-lookup/"
fi
rm -f "$PLANT_UL_URL"

# 23. ...and .src= there must FAIL (fetch dirs load no scripts; that is
#     why the PDF feature lives in a separate directory).
echo 'script.src = urls.jsUrl;' > "$PLANT_UL_SRC"
if scripts/check-privacy.sh >/dev/null 2>&1; then
  fail "gate missed .src= inside usuario-lookup/"
fi
rm -f "$PLANT_UL_SRC"

# 24. carta-notificacao/ is a LOCAL-RESOURCE directory: fetch( there must
#     FAIL (the lookup is usuario-lookup's job).
echo 'fetch("/usuario/Grid");' > "$PLANT_CN_FETCH"
if scripts/check-privacy.sh >/dev/null 2>&1; then
  fail "gate missed fetch( inside carta-notificacao/"
fi
rm -f "$PLANT_CN_FETCH"

# 25. The vendored-library load shape it uses (`el.src = <expr>.jsUrl;`,
#     the relay-provided pdf-lib / carta-assets URLs) must PASS there.
printf '%s\n' \
  "const urls = { pdfLib: { jsUrl: document.documentElement.dataset.sigcProPdfLibJsUrl } };" \
  "script.src = urls.pdfLib.jsUrl;" \
  > "$PLANT_CN_SRC_OK"
if ! scripts/check-privacy.sh >/dev/null 2>&1; then
  fail "gate rejected the sanctioned .jsUrl load inside carta-notificacao/"
fi
rm -f "$PLANT_CN_SRC_OK"

# 26. Any other .src= RHS there must FAIL.
echo 'script.src = "/vendor/pdf-lib/pdf-lib.min.js";' > "$PLANT_CN_SRC_BAD"
if scripts/check-privacy.sh >/dev/null 2>&1; then
  fail "gate missed a non-.jsUrl .src= inside carta-notificacao/"
fi
rm -f "$PLANT_CN_SRC_BAD"

# 27. An absolute URL there must FAIL — the tile-host allowlist is for
#     the map directory's one tile template, not a blanket pass.
echo 'const u = "https://unpkg.com/pdf-lib";' > "$PLANT_CN_URL_BAD"
if scripts/check-privacy.sh >/dev/null 2>&1; then
  fail "gate missed an absolute URL inside carta-notificacao/"
fi
rm -f "$PLANT_CN_URL_BAD"

# 28. The OpenStreetMap tile template is allowlisted for the MAP
#     directory only: planted in carta-notificacao/ it must FAIL.
echo "L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {});" > "$PLANT_CN_TILE_BAD"
if scripts/check-privacy.sh >/dev/null 2>&1; then
  fail "gate let the tile-host URL through inside carta-notificacao/"
fi
rm -f "$PLANT_CN_TILE_BAD"

# 27. gerenciamento-historico/ is the ONE storage-sanctioned directory:
#     IndexedDB there must PASS...
echo 'const req = indexedDB.open("x", 1);' > "$PLANT_GH_IDB_OK"
if ! scripts/check-privacy.sh >/dev/null 2>&1; then
  fail "gate rejected indexedDB inside gerenciamento-historico/"
fi
rm -f "$PLANT_GH_IDB_OK"

# 28. ...but the same call anywhere else must FAIL (the ban stays global).
echo 'const req = indexedDB.open("x", 1);' > "$PLANT_GR_IDB"
if scripts/check-privacy.sh >/dev/null 2>&1; then
  fail "gate missed indexedDB outside gerenciamento-historico/"
fi
rm -f "$PLANT_GR_IDB"

# 29. ...and it may not touch the network.
echo 'fetch("/x");' > "$PLANT_GH_FETCH"
if scripts/check-privacy.sh >/dev/null 2>&1; then
  fail "gate missed fetch( inside gerenciamento-historico/"
fi
rm -f "$PLANT_GH_FETCH"

# 30. ...nor use any other storage API: only IndexedDB is sanctioned.
echo 'chrome.storage.local.set({x: 1});' > "$PLANT_GH_CHROME"
if scripts/check-privacy.sh >/dev/null 2>&1; then
  fail "gate missed chrome.storage inside gerenciamento-historico/"
fi
rm -f "$PLANT_GH_CHROME"
echo 'localStorage.setItem("x", "1");' > "$PLANT_GH_LOCAL"
if scripts/check-privacy.sh >/dev/null 2>&1; then
  fail "gate missed localStorage inside gerenciamento-historico/"
fi
rm -f "$PLANT_GH_LOCAL"

# 31. extension/common may name its allowlisted URLs...
echo "const o = 'https://w3servicosigc.ibge.gov.br';" > "$PLANT_COMMON_URL_OK"
scripts/check-privacy.sh >/dev/null 2>&1 \
  || fail "gate rejected an allowlisted URL inside extension/common"
rm -f "$PLANT_COMMON_URL_OK"

# 32. ...but no other absolute URL.
echo "const o = 'https://example.com';" > "$PLANT_COMMON_URL_BAD"
if scripts/check-privacy.sh >/dev/null 2>&1; then
  fail "gate missed a non-allowlisted URL inside extension/common"
fi
rm -f "$PLANT_COMMON_URL_BAD"

# 33. A URL hidden as hex or base64 must fail anywhere outside vendor/.
echo "const o = '68747470733a2f2f6578616d706c652e636f6d';" > "$PLANT_HEX_URL"
if scripts/check-privacy.sh >/dev/null 2>&1; then
  fail "gate missed a hex-encoded URL"
fi
rm -f "$PLANT_HEX_URL"
echo "const o = atob('aHR0cHM6Ly9leGFtcGxlLmNvbQ==');" > "$PLANT_B64_URL"
if scripts/check-privacy.sh >/dev/null 2>&1; then
  fail "gate missed a base64-encoded URL"
fi
rm -f "$PLANT_B64_URL"

echo "privacy gate self-test: PASS"
