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

  test('ultimo-movimento-map.js loads after sigc-common.js and after ultimo-movimento-export.js', () => {
    const common = idx('common/sigc-common.js');
    const exportJs = idx('features/ultimo-movimento-export/ultimo-movimento-export.js');
    const mapJs = idx('features/ultimo-movimento-map/ultimo-movimento-map.js');
    expect(mapJs).toBeGreaterThan(common);
    expect(mapJs).toBeGreaterThan(exportJs);
  });

  // sigc-panel.js attaches window.__sigcPro.panel, which the map panel
  // destructures at its own top level.
  test('sigc-panel.js loads after sigc-common.js and before every feature module', () => {
    const panel = idx('common/sigc-panel.js');
    expect(panel).toBeGreaterThan(idx('common/sigc-common.js'));
    js.forEach((path, i) => {
      if (path.startsWith('features/')) expect(i).toBeGreaterThan(panel);
    });
  });

  // route-map.js assigns window.__sigcPro.routeMap; agenda-day-guide.js
  // destructures it at its own top level (dayNumberMap, buildRouteMapSvg,
  // STOP_COLOR, …), so loading the guide first throws immediately on a
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

  // carta-notificacao.js reads window.__sigcProUsuarioLookup on click and
  // the map wires its button to window.__sigcProCarta; municipios.js's
  // municipioFromControle fills the letter's município. All three must
  // be in place first.
  test('carta-notificacao.js loads after usuario-lookup.js, municipios.js and the map', () => {
    const carta = idx('features/carta-notificacao/carta-notificacao.js');
    const lookup = idx('features/usuario-lookup/usuario-lookup.js');
    const mapJs = idx('features/ultimo-movimento-map/ultimo-movimento-map.js');
    const municipios = idx('common/municipios.js');
    expect(carta).toBeGreaterThan(lookup);
    expect(carta).toBeGreaterThan(mapJs);
    expect(carta).toBeGreaterThan(municipios);
    expect(lookup).toBeGreaterThan(idx('common/sigc-common.js'));
  });

  test('the vendored pdf-lib bundle and the carta assets are web-accessible and on disk', async () => {
    const resources = manifest.web_accessible_resources.flatMap((w) => w.resources);
    for (const path of ['vendor/pdf-lib/pdf-lib.min.js', 'vendor/carta-assets/carta-assets.js']) {
      expect(resources).toContain(path);
      expect(await Bun.file(new URL(`../extension/${path}`, import.meta.url)).exists()).toBe(true);
    }
  });

  test('the map relay runs in the ISOLATED world', async () => {
    const isolated = manifest.content_scripts.find((s) => (s.js || []).includes('features/ultimo-movimento-map/ultimo-movimento-map-relay.js'));
    expect(isolated.world).not.toBe('MAIN');
    const relay = await Bun.file(new URL('../extension/features/ultimo-movimento-map/ultimo-movimento-map-relay.js', import.meta.url)).text();
    expect(relay).toContain("getURL('vendor/pdf-lib/pdf-lib.min.js')");
    expect(relay).toContain("getURL('vendor/carta-assets/carta-assets.js')");
  });

  // The history: the database belongs to the service worker (extension
  // origin); the ISOLATED bridge relays to it and must be listening from
  // document_start, before the MAIN-world client can call; the client, the
  // aggregation and the tab load before the report that uses them.
  test('the history service worker is declared as a module', () => {
    expect(manifest.background).toEqual({
      service_worker: 'features/gerenciamento-historico/historico-worker.js',
      type: 'module',
    });
  });

  test('the history bridge is ISOLATED, at document_start, and alone in its block', () => {
    const bloco = manifest.content_scripts.find((s) => (s.js || []).includes('features/gerenciamento-historico/historico-bridge.js'));
    expect(bloco.world).toBe('ISOLATED');
    expect(bloco.run_at).toBe('document_start');
    expect(bloco.js).toEqual(['features/gerenciamento-historico/historico-bridge.js']);
    expect(js).not.toContain('features/gerenciamento-historico/historico-bridge.js');
    expect(js).not.toContain('features/gerenciamento-historico/historico-worker.js');
    expect(js).not.toContain('features/gerenciamento-historico/historico-db.js');
  });

  test('the history client, aggregation and tab load after sigc-panel and before the report', () => {
    const relatorio = idx('features/gerenciamento-coleta/gerenciamento-report.js');
    for (const f of ['historico-client.js', 'historico-agregar.js', 'historico-view.js']) {
      const i = idx(`features/gerenciamento-historico/${f}`);
      expect(i).toBeGreaterThan(idx('common/sigc-panel.js'));
      expect(i).toBeLessThan(relatorio);
    }
    expect(idx('features/gerenciamento-historico/historico-agregar.js'))
      .toBeGreaterThan(idx('features/gerenciamento-coleta/gerenciamento-aggregate.js'));
  });

  test('the manifest still requests no permissions', () => {
    expect(manifest.permissions).toBeUndefined();
    expect(manifest.host_permissions).toBeUndefined();
  });
});
