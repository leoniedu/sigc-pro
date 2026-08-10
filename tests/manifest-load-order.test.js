import { describe, test, expect } from 'bun:test';

// manifest.json's content_scripts order is a LOAD-ORDER CONTRACT, not a
// stylistic list — but nothing about the file's appearance says so, and
// every other test imports modules explicitly in the right order, so a
// reordered manifest cannot fail them. It fails in the browser instead,
// where the whole Guia do Dia download dies on a TypeError.
//
// The trap is that alphabetizing the array is a natural tidy-up:
// "common/municipios.js" sorts BEFORE "common/sigc-common.js", which is
// exactly backwards. These tests make that a red suite instead.
const manifest = await Bun.file(
  new URL('../extension/manifest.json', import.meta.url)
).json();

// The MAIN-world content script — the one carrying the feature modules.
const mainScript = manifest.content_scripts.find((s) => s.world === 'MAIN');
const js = mainScript.js;
const idx = (path) => js.indexOf(path);

describe('manifest content_scripts load order', () => {
  test('the MAIN-world script block exists and lists its modules', () => {
    expect(mainScript).toBeDefined();
    expect(Array.isArray(js)).toBe(true);
    expect(js.length).toBeGreaterThan(0);
  });

  // sigc-common.js assigns window.__sigcPro WHOLESALE; municipios.js
  // augments that object. Loading municipios.js first means its
  // municipioFromControle is discarded by the later wholesale assign,
  // and the Lab tab throws at agenda-day-guide.js's call site.
  test('municipios.js loads AFTER sigc-common.js', () => {
    const common = idx('common/sigc-common.js');
    const municipios = idx('common/municipios.js');
    expect(common).toBeGreaterThanOrEqual(0);
    expect(municipios).toBeGreaterThanOrEqual(0);
    expect(municipios).toBeGreaterThan(common);
  });

  // Every feature module reads window.__sigcPro at its own import-time
  // top level (mountWidget registration), so the common runtime must be
  // in place before any of them.
  test('sigc-common.js loads before every feature module', () => {
    const common = idx('common/sigc-common.js');
    js.forEach((path, i) => {
      if (path.startsWith('features/')) expect(i).toBeGreaterThan(common);
    });
  });

  test('every listed script actually exists on disk', async () => {
    for (const path of js) {
      const url = new URL(`../extension/${path}`, import.meta.url);
      expect(await Bun.file(url).exists()).toBe(true);
    }
  });

  test('lista-agenda.js is registered', () => {
    expect(idx('features/lista-agenda/lista-agenda.js')).toBeGreaterThan(
      idx('common/sigc-common.js'));
  });

  test('ultimo-movimento-map.js loads after sigc-common.js and after ultimo-movimento-export.js', () => {
    const common = idx('common/sigc-common.js');
    const exportJs = idx('features/ultimo-movimento-export/ultimo-movimento-export.js');
    const mapJs = idx('features/ultimo-movimento-map/ultimo-movimento-map.js');
    expect(mapJs).toBeGreaterThan(common);
    expect(mapJs).toBeGreaterThan(exportJs);
  });

  // route-map.js assigns window.__sigcPro.routeMap; agenda-day-guide.js
  // destructures it at its own top level (teamColor, buildRouteMapSvg,
  // slotInfo, …), so loading the guide first throws immediately on a
  // TypeError and the whole Guia do Dia download dies.
  test('route-map.js loads after sigc-common.js and before agenda-day-guide.js', () => {
    const common = idx('common/sigc-common.js');
    const routeMap = idx('features/agenda-day-guide/route-map.js');
    const dayGuide = idx('features/agenda-day-guide/agenda-day-guide.js');
    expect(routeMap).toBeGreaterThan(common);
    expect(dayGuide).toBeGreaterThan(routeMap);
  });

  test('web_accessible_resources exposes vendored Leaflet to SIGC origins only', () => {
    expect(Array.isArray(manifest.web_accessible_resources)).toBe(true);
    const leafletEntry = manifest.web_accessible_resources.find(
      (e) => e.resources.some((r) => r.includes('leaflet')));
    expect(leafletEntry).toBeDefined();
    expect(leafletEntry.matches).toEqual([
      'https://portalweb.ibge.gov.br/*',
      'https://portalweb2.ibge.gov.br/*',
      'https://w3sigcpns2025.ibge.gov.br/*',
    ]);
  });
});
