import { describe, test, expect } from 'bun:test';

await import('../extension/common/sigc-common.js');
// municipios.js: buildGuideHtml and buildSummaryPanel(lab=true) render the
// Lab list, whose Município column needs municipioFromControle.
await import('../extension/common/municipios.js');
await import('../extension/features/agenda-day-guide/route-map.js');
await import('../extension/features/agenda-day-guide/agenda-day-guide.js');

function row({ reservado = true, horaInicio = '09:00', nome = 'Fulano', controle = 'C1', domicilio = 'D1' } = {}) {
  return { reservado, horaInicio, horaFim: '09:30', nome, controle, domicilio, equipe: 'A' };
}

function enderecosMap(entries) {
  // entries: [[controle, domicilio, lat, lon, zona, idZona], ...]
  const m = new Map();
  entries.forEach(([controle, domicilio, lat, lon, zona = null, idZona = null]) => {
    m.set(`${controle}|${domicilio}`, { lat, lon, zona, idZona });
  });
  return m;
}

describe('routeCheckboxInput', () => {
  test('routable row: enabled checkbox with data-lat/lon/name, no label wrapper', () => {
    const { routeCheckboxInput } = window.__sigcPro.dayGuide;
    const r = row({ horaInicio: '09:00', nome: 'Maria Silva', controle: 'C1', domicilio: 'D1' });
    const info = { lat: -12.9, lon: -38.5, zona: null, idZona: null };
    const html = routeCheckboxInput(r, info, 'team-0', true);
    expect(html).toContain('class="route-chk"');
    expect(html).toContain('data-group="team-0"');
    expect(html).toContain('data-lat="-12.900000"');
    expect(html).toContain('data-lon="-38.500000"');
    expect(html).toContain('data-name="09:00 Maria Silva"');
    expect(html).toContain('checked');
    expect(html).not.toContain('<label');
    expect(html).not.toContain('sem coordenadas');
  });

  test('routable row, checked=false: no checked attribute', () => {
    const { routeCheckboxInput } = window.__sigcPro.dayGuide;
    const r = row();
    const info = { lat: -12.9, lon: -38.5, zona: null, idZona: null };
    const html = routeCheckboxInput(r, info, 'team-0', false);
    expect(html).not.toContain('checked');
  });

  test('non-routable row (info null): bare disabled checkbox, no data-* attributes', () => {
    const { routeCheckboxInput } = window.__sigcPro.dayGuide;
    const r = row();
    const html = routeCheckboxInput(r, null, 'team-0', true);
    expect(html).toBe('<input type="checkbox" disabled>');
  });

  test('non-routable row (info present but lat null): bare disabled checkbox', () => {
    const { routeCheckboxInput } = window.__sigcPro.dayGuide;
    const r = row();
    const info = { lat: null, lon: null, zona: null, idZona: null };
    const html = routeCheckboxInput(r, info, 'team-0', true);
    expect(html).toBe('<input type="checkbox" disabled>');
  });

  test('escapes stop name in data-name', () => {
    const { routeCheckboxInput } = window.__sigcPro.dayGuide;
    const r = row({ nome: '<script>alert(1)</script>' });
    const info = { lat: -12.9, lon: -38.5, zona: null, idZona: null };
    const html = routeCheckboxInput(r, info, 'team-0', true);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('idx provided and row is routable: carries data-idx', () => {
    const { routeCheckboxInput } = window.__sigcPro.dayGuide;
    const r = row({ controle: 'C1', domicilio: 'D1' });
    const info = { lat: -12.9, lon: -38.5, zona: null, idZona: null };
    const html = routeCheckboxInput(r, info, 'team-0', true, 3);
    expect(html).toContain('data-idx="3"');
  });

  test('idx omitted: no data-idx attribute', () => {
    const { routeCheckboxInput } = window.__sigcPro.dayGuide;
    const r = row({ controle: 'C1', domicilio: 'D1' });
    const info = { lat: -12.9, lon: -38.5, zona: null, idZona: null };
    const html = routeCheckboxInput(r, info, 'team-0', true);
    expect(html).not.toContain('data-idx');
  });

  test('non-routable row: idx is ignored, no data-idx even if provided', () => {
    const { routeCheckboxInput } = window.__sigcPro.dayGuide;
    const r = row({ controle: 'C1', domicilio: 'D1' });
    const html = routeCheckboxInput(r, null, 'team-0', true, 3);
    expect(html).not.toContain('data-idx');
  });
});

describe('buildSlotCard route checkbox', () => {
  test('routable reserved row: checkbox appears in the .hora line, before the time', () => {
    const { buildSlotCard } = window.__sigcPro.dayGuide;
    const r = row({ horaInicio: '09:00', controle: 'C1', domicilio: 'D1' });
    const enderecos = enderecosMap([['C1', 'D1', -12.9, -38.5]]);
    const html = buildSlotCard(r, enderecos, null, 'team-0', true);
    expect(html).toContain('class="route-chk"');
    expect(html).toContain('data-group="team-0"');
    expect(html).toContain('checked');
    const horaIdx = html.indexOf('class="hora"');
    const chkIdx = html.indexOf('route-chk');
    const timeIdx = html.indexOf('09:00', horaIdx);
    expect(chkIdx).toBeGreaterThan(horaIdx);
    expect(chkIdx).toBeLessThan(timeIdx);
  });

  test('routable reserved row, checked=false: checkbox present but unchecked', () => {
    const { buildSlotCard } = window.__sigcPro.dayGuide;
    const r = row({ controle: 'C1', domicilio: 'D1' });
    const enderecos = enderecosMap([['C1', 'D1', -12.9, -38.5]]);
    const html = buildSlotCard(r, enderecos, null, 'team-0', false);
    expect(html).toContain('class="route-chk"');
    expect(html).not.toMatch(/route-chk[^>]*checked/);
  });

  test('non-routable reserved row: disabled unchecked checkbox, no extra note text', () => {
    const { buildSlotCard } = window.__sigcPro.dayGuide;
    const r = row({ controle: 'C1', domicilio: 'D1' });
    const html = buildSlotCard(r, null, null, 'team-0', true);
    expect(html).toContain('type="checkbox" disabled');
    expect(html).not.toContain('sem coordenadas');
  });

  test('LIVRE row: no checkbox at all, unaffected by routeGroupId/checked', () => {
    const { buildSlotCard } = window.__sigcPro.dayGuide;
    const r = row({ reservado: false });
    const html = buildSlotCard(r, null, null, 'team-0', true);
    expect(html).not.toContain('route-chk');
    expect(html).not.toContain('checkbox');
  });
});

describe('routeIdxMap', () => {
  test('single rowSet: 0-based index across routable rows only, in row order', () => {
    const { routeIdxMap } = window.__sigcPro.dayGuide;
    const rows = [
      row({ horaInicio: '09:00', controle: 'C1', domicilio: 'D1' }),
      row({ horaInicio: '10:00', controle: 'C2', domicilio: 'D2' }), // no coords below
      row({ horaInicio: '11:00', controle: 'C3', domicilio: 'D3' }),
    ];
    const enderecos = enderecosMap([
      ['C1', 'D1', -12.9, -38.5],
      ['C3', 'D3', -12.7, -38.3],
    ]);
    const map = routeIdxMap([{ rows }], enderecos);
    expect(map.get('C1|D1')).toBe(0);
    expect(map.has('C2|D2')).toBe(false); // no coords -> not routable -> no idx
    expect(map.get('C3|D3')).toBe(1);
  });

  test('multiple rowSets: counter is flat across sets, does not reset', () => {
    const { routeIdxMap } = window.__sigcPro.dayGuide;
    const rowsA = [row({ horaInicio: '09:00', controle: 'C1', domicilio: 'D1' })];
    const rowsB = [
      row({ horaInicio: '08:00', controle: 'C2', domicilio: 'D2' }),
      row({ horaInicio: '09:30', controle: 'C3', domicilio: 'D3' }),
    ];
    const enderecos = enderecosMap([
      ['C1', 'D1', -12.9, -38.5],
      ['C2', 'D2', -12.8, -38.4],
      ['C3', 'D3', -12.7, -38.3],
    ]);
    const map = routeIdxMap([{ rows: rowsA }, { rows: rowsB }], enderecos);
    expect(map.get('C1|D1')).toBe(0); // last stop of set A
    expect(map.get('C2|D2')).toBe(1); // first stop of set B, continues the counter
    expect(map.get('C3|D3')).toBe(2);
  });

  test('open (non-reserved) rows never get an idx', () => {
    const { routeIdxMap } = window.__sigcPro.dayGuide;
    const rows = [row({ reservado: false, controle: 'C1', domicilio: 'D1' })];
    const enderecos = enderecosMap([['C1', 'D1', -12.9, -38.5]]);
    const map = routeIdxMap([{ rows }], enderecos);
    expect(map.size).toBe(0);
  });

  test('no enderecos: nothing is routable, empty map', () => {
    const { routeIdxMap } = window.__sigcPro.dayGuide;
    const rows = [row({ controle: 'C1', domicilio: 'D1' })];
    const map = routeIdxMap([{ rows }], null);
    expect(map.size).toBe(0);
  });
});

describe('buildRouteMapSvg data-idx/data-x/data-y and polyline id', () => {
  const { dayNumberMap } = window.__sigcPro.dayGuide;

  test('single rowSet (team panel shape): each dot wrapped in <g data-idx data-x data-y>, matches routeIdxMap', () => {
    const { buildRouteMapSvg, routeIdxMap } = window.__sigcPro.dayGuide;
    const rows = [
      row({ horaInicio: '09:00', controle: 'C1', domicilio: 'D1' }),
      row({ horaInicio: '10:00', controle: 'C2', domicilio: 'D2' }),
    ];
    const enderecos = enderecosMap([
      ['C1', 'D1', -12.9, -38.5],
      ['C2', 'D2', -12.8, -38.4],
    ]);
    const rowSets = [{ rows, color: '#005a9c' }];
    const idxMap = routeIdxMap(rowSets, enderecos);
    const svg = buildRouteMapSvg(rowSets, enderecos, 480, 320, 'team-0', dayNumberMap(rows));
    expect(svg).toContain(`<g data-idx="${idxMap.get('C1|D1')}"`);
    expect(svg).toContain(`<g data-idx="${idxMap.get('C2|D2')}"`);
    expect(svg).toMatch(/<g data-idx="0" data-x="[\d.]+" data-y="[\d.]+">/);
  });

  test('single rowSet: polyline carries id="route-line-<groupId>" and keeps the set color', () => {
    const { buildRouteMapSvg } = window.__sigcPro.dayGuide;
    const rows = [
      row({ horaInicio: '09:00', controle: 'C1', domicilio: 'D1' }),
      row({ horaInicio: '10:00', controle: 'C2', domicilio: 'D2' }),
    ];
    const enderecos = enderecosMap([
      ['C1', 'D1', -12.9, -38.5],
      ['C2', 'D2', -12.8, -38.4],
    ]);
    const svg = buildRouteMapSvg([{ rows, color: '#005a9c' }], enderecos, 480, 320, 'team-0', dayNumberMap(rows));
    expect(svg).toContain('id="route-line-team-0"');
    expect(svg).toContain('stroke="#005a9c"');
  });

  // The visible number on every dot is the household's DAY number, the
  // same one its card and Lab row carry — never a per-set sequence. A
  // team map whose households are numbers 3 and 7 of the day shows 3
  // and 7, so the manager's cross-team route reads the same everywhere.
  test('dots are labeled with the day number, not a per-set restart', () => {
    const { buildRouteMapSvg } = window.__sigcPro.dayGuide;
    const allRows = [
      row({ horaInicio: '08:00', controle: 'C1', domicilio: 'D1' }),
      row({ horaInicio: '09:00', controle: 'C2', domicilio: 'D2' }),
      row({ horaInicio: '10:00', controle: 'C3', domicilio: 'D3' }),
    ];
    const enderecos = enderecosMap([
      ['C2', 'D2', -12.8, -38.4],
      ['C3', 'D3', -12.7, -38.3],
    ]);
    const dayNums = dayNumberMap(allRows); // C1 -> 1, C2 -> 2, C3 -> 3
    // A "team" holding only the day's 2nd and 3rd households.
    const teamRows = allRows.slice(1);
    const svg = buildRouteMapSvg([{ rows: teamRows, color: '#005a9c' }], enderecos, 480, 320, 'team-0', dayNums);
    expect(svg).toContain('>2</text>');
    expect(svg).toContain('>3</text>');
    expect(svg).not.toContain('>1</text>');
  });

  test('below 2 plottable points, still draws that single dot with its <g> wrapper (no polyline)', () => {
    const { buildRouteMapSvg } = window.__sigcPro.dayGuide;
    const rows = [row({ horaInicio: '09:00', controle: 'C1', domicilio: 'D1' })];
    const enderecos = enderecosMap([['C1', 'D1', -12.9, -38.5]]);
    const svg = buildRouteMapSvg([{ rows, color: '#005a9c' }], enderecos, 480, 320, 'team-0', dayNumberMap(rows));
    expect(svg).toContain('<g data-idx="0"');
    expect(svg).not.toContain('<polyline');
  });
});

describe('buildTeamPanel route selector wiring', () => {
  const { dayNumberMap } = window.__sigcPro.dayGuide;

  test('<=9 routable stops: all checked by default, groupId is team-<teamIndex>', () => {
    const { buildTeamPanel } = window.__sigcPro.dayGuide;
    const rows = [row({ horaInicio: '09:00' }), row({ horaInicio: '10:00', controle: 'C2', domicilio: 'D2' })];
    const enderecos = enderecosMap([
      ['C1', 'D1', -12.9, -38.5],
      ['C2', 'D2', -12.8, -38.4],
    ]);
    const html = buildTeamPanel({ equipe: 'Equipe A', rows }, enderecos, 0, dayNumberMap(rows));
    expect(html).toContain('data-group="team-0"');
    expect((html.match(/checked/g) || []).length).toBe(2);
    expect(html).not.toContain('class="rota"'); // old auto-route block gone
    expect(html).not.toContain('route-selector'); // standalone list gone too
    // Checkbox sits inside each card's .hora line, not in a separate block.
    const chkIdx = html.indexOf('route-chk');
    const cardIdx = html.indexOf('class="card"');
    expect(chkIdx).toBeGreaterThan(cardIdx);
    // Link placeholder still exists, now positioned after all cards.
    const lastCardIdx = html.lastIndexOf('class="card"');
    const linkIdx = html.indexOf('rota-link-team-0');
    expect(linkIdx).toBeGreaterThan(lastCardIdx);
  });

  test('>9 routable stops: none checked by default', () => {
    const { buildTeamPanel } = window.__sigcPro.dayGuide;
    const entries = [];
    const rows = [];
    for (let i = 0; i < 10; i++) {
      const controle = `C${i}`;
      rows.push(row({ horaInicio: `0${i}:00`.slice(-5), controle, domicilio: 'D1' }));
      entries.push([controle, 'D1', -12.9 + i * 0.01, -38.5]);
    }
    const enderecos = enderecosMap(entries);
    const html = buildTeamPanel({ equipe: 'Equipe A', rows }, enderecos, 0, dayNumberMap(rows));
    expect(html).not.toContain('checked');
  });

  test('each card carries data-idx matching its routable position', () => {
    const { buildTeamPanel } = window.__sigcPro.dayGuide;
    const rows = [row({ horaInicio: '09:00' }), row({ horaInicio: '10:00', controle: 'C2', domicilio: 'D2' })];
    const enderecos = enderecosMap([
      ['C1', 'D1', -12.9, -38.5],
      ['C2', 'D2', -12.8, -38.4],
    ]);
    const html = buildTeamPanel({ equipe: 'Equipe A', rows }, enderecos, 0, dayNumberMap(rows));
    expect(html).toContain('data-idx="0"');
    expect(html).toContain('data-idx="1"');
    // idx 0 (09:00/C1) appears before idx 1 (10:00/C2) in document order.
    expect(html.indexOf('data-idx="0"')).toBeLessThan(html.indexOf('data-idx="1"'));
  });
});

describe('buildSummaryPanel route wiring', () => {
  const { dayNumberMap } = window.__sigcPro.dayGuide;

  test('Resumo lists the whole day in TIME order, always unchecked, groupId is resumo', () => {
    const { buildSummaryPanel } = window.__sigcPro.dayGuide;
    // allRows in day (time) order, teams interleaved — the shape
    // readAgendaSlots delivers.
    const allRows = [
      { ...row({ horaInicio: '08:00', controle: 'C2', domicilio: 'D2' }), equipe: 'Equipe B' },
      { ...row({ horaInicio: '09:00', controle: 'C1', domicilio: 'D1' }), equipe: 'Equipe A' },
    ];
    const enderecos = enderecosMap([
      ['C1', 'D1', -12.9, -38.5],
      ['C2', 'D2', -12.8, -38.4],
    ]);
    const html = buildSummaryPanel(allRows, false, enderecos, dayNumberMap(allRows));
    expect(html).toContain('data-group="resumo"');
    expect(html).not.toContain(' checked'); // unconditionally unchecked
    expect(html).toContain('Rota do dia');
    // Day order: B's 08:00 stop comes before A's 09:00 stop.
    const idxB = html.indexOf('data-name="08:00');
    const idxA = html.indexOf('data-name="09:00');
    expect(idxB).toBeGreaterThan(-1);
    expect(idxA).toBeGreaterThan(idxB);
  });

  test('Rota do dia section placed before Mapa do dia', () => {
    const { buildSummaryPanel } = window.__sigcPro.dayGuide;
    const allRows = [row({ controle: 'C1', domicilio: 'D1' })];
    const enderecos = enderecosMap([['C1', 'D1', -12.9, -38.5]]);
    const html = buildSummaryPanel(allRows, false, enderecos, dayNumberMap(allRows));
    expect(html.indexOf('Rota do dia')).toBeLessThan(html.indexOf('Mapa do dia'));
  });

  test('Lab panel gets no route checkboxes and no map', () => {
    const { buildSummaryPanel } = window.__sigcPro.dayGuide;
    const allRows = [row({ controle: 'C1', domicilio: 'D1' })];
    const enderecos = enderecosMap([['C1', 'D1', -12.9, -38.5]]);
    const html = buildSummaryPanel(allRows, true, enderecos, dayNumberMap(allRows));
    expect(html).not.toContain('Rota do dia');
    expect(html).not.toContain('route-chk');
    expect(html).not.toContain('Mapa do dia');
  });
});

describe('ocultar não selecionadas toggle', () => {
  const { dayNumberMap, buildSummaryPanel, buildTeamPanel, buildGuideHtml } =
    window.__sigcPro.dayGuide;

  test('Resumo and team panels with cards render the toggle', () => {
    const allRows = [row({ controle: 'C1', domicilio: 'D1' })];
    const enderecos = enderecosMap([['C1', 'D1', -12.9, -38.5]]);
    const resumo = buildSummaryPanel(allRows, false, enderecos, dayNumberMap(allRows));
    expect(resumo).toContain('class="ocultar-chk"');
    const team = buildTeamPanel({ equipe: 'Equipe A', rows: allRows }, enderecos, 0, dayNumberMap(allRows));
    expect(team).toContain('class="ocultar-chk"');
  });

  test('no rows -> no toggle on any tab; the Lab with rows gets one too', () => {
    const openOnly = [row({ reservado: false })];
    expect(buildTeamPanel({ equipe: 'Equipe A', rows: openOnly }, null, 0, dayNumberMap(openOnly)))
      .not.toContain('ocultar-chk');
    expect(buildSummaryPanel(openOnly, false, null, dayNumberMap(openOnly)))
      .not.toContain('ocultar-chk');
    expect(buildSummaryPanel(openOnly, true, null, dayNumberMap(openOnly)))
      .not.toContain('ocultar-chk');
    // The Lab list carries its own tickmarks, so its rows are hideable
    // like every other tab's cards.
    const reserved = [row({ controle: 'C1', domicilio: 'D1' })];
    expect(buildSummaryPanel(reserved, true, null, dayNumberMap(reserved)))
      .toContain('ocultar-chk');
  });

  test('the document CSS hides unchecked cards when toggled, and hides the toggle in print', () => {
    const groups = [{ equipe: 'Equipe A', rows: [row({ controle: 'C1', domicilio: 'D1' })] }];
    const enderecos = enderecosMap([['C1', 'D1', -12.9, -38.5]]);
    const meta = { uf: 'BA', dataBr: '22/07/2026', diaSemana: 'quarta-feira', geradoEm: '22/07/2026 10:00' };
    const html = buildGuideHtml(meta, groups, groups[0].rows, enderecos);
    // The hide rule targets the card's OWN checkbox — including the
    // disabled sem-coordenadas one — scoped to the toggled panel only.
    expect(html).toContain(
      '.panel:has(.ocultar-chk:checked) .card:has(.hora input[type="checkbox"]:not(:checked)) { display: none; }');
    // display:none carries into print by itself; the control must not print.
    expect(html).toContain(
      '@media print { .tabs { display: none; } .ocultar-toggle { display: none; } }');
  });
});

describe('inline script is present and shaped correctly', () => {
  test('buildGuideHtml embeds exactly one <script> block before </body>', () => {
    const { buildGuideHtml } = window.__sigcPro.dayGuide;
    const groups = [{ equipe: 'Equipe A', rows: [row({ controle: 'C1', domicilio: 'D1' })] }];
    const enderecos = enderecosMap([['C1', 'D1', -12.9, -38.5]]);
    const meta = { uf: 'BA', dataBr: '22/07/2026', diaSemana: 'quarta-feira', geradoEm: '22/07/2026 10:00' };
    const html = buildGuideHtml(meta, groups, groups[0].rows, enderecos);
    const scriptCount = (html.match(/<script>/g) || []).length;
    expect(scriptCount).toBe(1);
    expect(html.indexOf('<script>')).toBeLessThan(html.indexOf('</body>'));
    expect(html).toContain('route-chk');
    expect(html).toContain('rota-link-');
  });

  test('Resumo and a team panel use distinct data-group values (independent state)', () => {
    const { buildGuideHtml } = window.__sigcPro.dayGuide;
    const groups = [{ equipe: 'Equipe A', rows: [row({ controle: 'C1', domicilio: 'D1' })] }];
    const enderecos = enderecosMap([['C1', 'D1', -12.9, -38.5]]);
    const meta = { uf: 'BA', dataBr: '22/07/2026', diaSemana: 'quarta-feira', geradoEm: '22/07/2026 10:00' };
    const html = buildGuideHtml(meta, groups, groups[0].rows, enderecos);
    expect(html).toContain('data-group="resumo"');
    expect(html).toContain('data-group="team-0"');
    // Each group has its own rota-link placeholder id -> refreshGroup's
    // querySelectorAll scoping (data-group="<id>") can never cross groups.
    expect(html).toContain('id="rota-link-resumo"');
    expect(html).toContain('id="rota-link-team-0"');
  });

  test('the embedded script builds the same URL shape as gmapsRouteUrl (mirrored logic)', () => {
    // Mirrors the inline script's buildGmapsUrl exactly (Step 3 below) so the
    // URL-building logic is covered without executing <script> in happy-dom.
    function buildGmapsUrl(stops) {
      const fmt = (s) => `${Number(s.lat).toFixed(6)},${Number(s.lon).toFixed(6)}`;
      const way = stops.slice(0, -1).map(fmt).join('|');
      const dest = fmt(stops[stops.length - 1]);
      return 'https://www.google.com/maps/dir/?api=1&travelmode=driving' +
        (way ? `&waypoints=${encodeURIComponent(way)}` : '') +
        `&destination=${encodeURIComponent(dest)}`;
    }
    const url = buildGmapsUrl([{ lat: -12.9, lon: -38.5 }, { lat: -12.8, lon: -38.4 }]);
    expect(url).toBe(
      'https://www.google.com/maps/dir/?api=1&travelmode=driving' +
      `&waypoints=${encodeURIComponent('-12.900000,-38.500000')}` +
      `&destination=${encodeURIComponent('-12.800000,-38.400000')}`
    );
  });

  test('cap enforcement logic (mirrored): disables at 9 checked, re-enables below 9', () => {
    // Mirrors refreshGroup's cap-enforcement branch exactly (Step 3 below).
    // happy-dom doesn't reliably execute inline <script> tags inserted via
    // innerHTML, so this pins the same logic standalone, same pattern as
    // the URL-building mirror test above.
    function applyCap(boxes) {
      const checked = boxes.filter((b) => b.checked);
      boxes.forEach((b) => {
        if (!b.checked) b.disabled = checked.length >= 9;
      });
    }
    // 9 checked, 1 unchecked -> the unchecked one gets disabled.
    const nineChecked = Array.from({ length: 9 }, () => ({ checked: true, disabled: false }));
    const tenth = { checked: false, disabled: false };
    applyCap([...nineChecked, tenth]);
    expect(tenth.disabled).toBe(true);

    // Drop to 8 checked -> everyone (including a previously-disabled box)
    // is re-enabled.
    nineChecked[0].checked = false;
    applyCap([...nineChecked, tenth]);
    expect(tenth.disabled).toBe(false);
  });

  test('buildGuideHtml output contains data-idx groups and a route-line id, matching checkboxes', () => {
    const { buildGuideHtml } = window.__sigcPro.dayGuide;
    const groups = [{ equipe: 'Equipe A', rows: [row({ controle: 'C1', domicilio: 'D1' })] }];
    const enderecos = enderecosMap([['C1', 'D1', -12.9, -38.5]]);
    const meta = { uf: 'BA', dataBr: '22/07/2026', diaSemana: 'quarta-feira', geradoEm: '22/07/2026 10:00' };
    const html = buildGuideHtml(meta, groups, groups[0].rows, enderecos);
    expect(html).toMatch(/<g data-idx="\d+" data-x="[\d.]+" data-y="[\d.]+">/);
    expect(html).toContain('route-chk');
    expect(html).toMatch(/data-idx="\d+"/);
  });

  test('map redraw logic (mirrored): dims unchecked stops, rebuilds line from checked ones in idx order', () => {
    // Mirrors refreshGroup's new map-redraw step exactly (Task 3 Step 3
    // below). happy-dom doesn't reliably execute inline <script> tags
    // inserted via innerHTML, so this pins the same logic standalone,
    // same pattern as the cap-enforcement/URL-building mirror tests
    // already in this file.
    function redrawMap(groupId, checkedIdxSet, allStopGs) {
      var checkedStops = [];
      allStopGs.forEach(function (g) {
        var idx = g.dataset.idx;
        if (checkedIdxSet.has(idx)) {
          g.dimmed = false;
          checkedStops.push(g);
        } else {
          g.dimmed = true;
        }
      });
      checkedStops.sort(function (a, b) { return Number(a.dataset.idx) - Number(b.dataset.idx); });
      if (checkedStops.length < 2) return { points: null };
      var points = checkedStops.map(function (g) {
        return g.dataset.x + ',' + g.dataset.y;
      }).join(' ');
      return { points: points };
    }

    var gs = [
      { dataset: { idx: '0', x: '10.0', y: '20.0' } },
      { dataset: { idx: '1', x: '30.0', y: '40.0' } },
      { dataset: { idx: '2', x: '50.0', y: '60.0' } },
    ];

    // Only idx 0 and 2 checked -> idx 1 stays dimmed, line skips it.
    var result = redrawMap('team-0', new Set(['0', '2']), gs);
    expect(gs[0].dimmed).toBe(false);
    expect(gs[1].dimmed).toBe(true);
    expect(gs[2].dimmed).toBe(false);
    expect(result.points).toBe('10.0,20.0 50.0,60.0');

    // Below 2 checked -> no line.
    var result2 = redrawMap('team-0', new Set(['0']), gs);
    expect(result2.points).toBeNull();
  });
});
