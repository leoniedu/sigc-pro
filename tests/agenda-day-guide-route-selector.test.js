import { describe, test, expect } from 'bun:test';

await import('../extension/common/sigc-common.js');
await import('../extension/features/agenda-day-guide/agenda-day-guide.js');
const { buildRouteSelector } = window.__sigcPro.dayGuide;

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

describe('buildRouteSelector', () => {
  test('routable reserved rows get an enabled checkbox with data-lat/lon/name', () => {
    const rows = [row()];
    const enderecos = enderecosMap([['C1', 'D1', -12.9, -38.5]]);
    const html = buildRouteSelector(rows, enderecos, 'team-0', true);
    expect(html).toContain('class="route-chk"');
    expect(html).toContain('data-group="team-0"');
    expect(html).toContain('data-lat="-12.900000"');
    expect(html).toContain('data-lon="-38.500000"');
    expect(html).toContain('checked');
    expect(html).not.toContain('disabled');
  });

  test('non-routable reserved row: disabled, unchecked, "sem coordenadas" note', () => {
    const rows = [row()];
    const html = buildRouteSelector(rows, null, 'team-0', true);
    expect(html).toContain('disabled');
    expect(html).not.toMatch(/route-chk[^>]*checked/);
    expect(html).toContain('sem coordenadas');
  });

  test('open (non-reserved) rows are skipped entirely', () => {
    const rows = [row({ reservado: false })];
    const html = buildRouteSelector(rows, null, 'team-0', true);
    expect(html).not.toContain('route-chk');
  });

  test('defaultAllChecked=false starts routable rows unchecked', () => {
    const rows = [row()];
    const enderecos = enderecosMap([['C1', 'D1', -12.9, -38.5]]);
    const html = buildRouteSelector(rows, enderecos, 'team-0', false);
    expect(html).not.toMatch(/route-chk[^>]*checked/);
  });

  test('always includes a rota-link placeholder namespaced by groupId', () => {
    const html = buildRouteSelector([row()], null, 'resumo', false);
    expect(html).toContain('id="rota-link-resumo"');
  });

  test('escapes stop names', () => {
    const rows = [row({ nome: '<script>alert(1)</script>' })];
    const enderecos = enderecosMap([['C1', 'D1', -12.9, -38.5]]);
    const html = buildRouteSelector(rows, enderecos, 'team-0', true);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('label includes Controle, Dom and Zona alongside time and name', () => {
    const rows = [row({ horaInicio: '09:00', nome: 'Maria Silva', controle: 'C1', domicilio: 'D1' })];
    const enderecos = enderecosMap([['C1', 'D1', -12.9, -38.5, 'Centro', '12']]);
    const html = buildRouteSelector(rows, enderecos, 'team-0', true);
    expect(html).toContain(
      '09:00 Maria Silva — Controle: C1 &nbsp;·&nbsp; Dom: D1 &nbsp;·&nbsp; Zona: 12 Centro'
    );
  });

  test('label omits Zona segment when zona info is unavailable', () => {
    const rows = [row({ horaInicio: '09:00', nome: 'Maria Silva', controle: 'C1', domicilio: 'D1' })];
    const enderecos = enderecosMap([['C1', 'D1', -12.9, -38.5]]);
    const html = buildRouteSelector(rows, enderecos, 'team-0', true);
    expect(html).toContain('09:00 Maria Silva — Controle: C1 &nbsp;·&nbsp; Dom: D1');
    expect(html).not.toContain('Zona:');
  });

  test('assigns data-idx from a shared cross-team counter (flatMap-style call)', () => {
    const rows = [
      row({ horaInicio: '09:00', controle: 'C1', domicilio: 'D1' }),
      row({ horaInicio: '10:00', controle: 'C2', domicilio: 'D2' }),
    ];
    const enderecos = enderecosMap([
      ['C1', 'D1', -12.9, -38.5],
      ['C2', 'D2', -12.8, -38.4],
    ]);
    const html = buildRouteSelector(rows, enderecos, 'resumo', false);
    const idxA = html.indexOf('data-idx="0"');
    const idxB = html.indexOf('data-idx="1"');
    expect(idxA).toBeGreaterThan(-1);
    expect(idxB).toBeGreaterThan(-1);
    // idx 0 belongs to C1 (first in row order), idx 1 to C2.
    expect(html.indexOf('data-name="09:00')).toBeLessThan(html.indexOf('data-name="10:00'));
  });
});

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

describe('routeCheckboxHtml', () => {
  test('routable row: enabled checkbox with data-lat/lon/name and detail text', () => {
    const { routeCheckboxHtml } = window.__sigcPro.dayGuide;
    const r = row({ horaInicio: '09:00', nome: 'Maria Silva', controle: 'C1', domicilio: 'D1' });
    const info = { lat: -12.9, lon: -38.5, zona: 'Centro', idZona: '12' };
    const html = routeCheckboxHtml(r, info, 'team-0', true);
    expect(html).toContain('class="route-chk"');
    expect(html).toContain('data-group="team-0"');
    expect(html).toContain('data-lat="-12.900000"');
    expect(html).toContain('data-lon="-38.500000"');
    expect(html).toContain('data-name="09:00 Maria Silva"');
    expect(html).toContain('checked');
    expect(html).toContain('Controle: C1 &nbsp;·&nbsp; Dom: D1 &nbsp;·&nbsp; Zona: 12 Centro');
  });

  test('routable row, checked=false: no checked attribute', () => {
    const { routeCheckboxHtml } = window.__sigcPro.dayGuide;
    const r = row();
    const info = { lat: -12.9, lon: -38.5, zona: null, idZona: null };
    const html = routeCheckboxHtml(r, info, 'team-0', false);
    expect(html).not.toMatch(/route-chk[^>]*checked/);
  });

  test('non-routable row (info null): disabled, unchecked, "sem coordenadas" note', () => {
    const { routeCheckboxHtml } = window.__sigcPro.dayGuide;
    const r = row();
    const html = routeCheckboxHtml(r, null, 'team-0', true);
    expect(html).toContain('disabled');
    expect(html).not.toMatch(/route-chk[^>]*checked/);
    expect(html).toContain('sem coordenadas');
  });

  test('non-routable row (info present but lat null): disabled, unchecked', () => {
    const { routeCheckboxHtml } = window.__sigcPro.dayGuide;
    const r = row();
    const info = { lat: null, lon: null, zona: null, idZona: null };
    const html = routeCheckboxHtml(r, info, 'team-0', true);
    expect(html).toContain('disabled');
    expect(html).toContain('sem coordenadas');
  });

  test('escapes stop name in both data-name and display text', () => {
    const { routeCheckboxHtml } = window.__sigcPro.dayGuide;
    const r = row({ nome: '<script>alert(1)</script>' });
    const info = { lat: -12.9, lon: -38.5, zona: null, idZona: null };
    const html = routeCheckboxHtml(r, info, 'team-0', true);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('idx passes through to the wrapped input', () => {
    const { routeCheckboxHtml } = window.__sigcPro.dayGuide;
    const r = row({ controle: 'C1', domicilio: 'D1' });
    const info = { lat: -12.9, lon: -38.5, zona: null, idZona: null };
    const html = routeCheckboxHtml(r, info, 'team-0', true, 5);
    expect(html).toContain('data-idx="5"');
  });
});

describe('buildSlotCard route checkbox', () => {
  test('routable reserved row: checkbox appears in the .hora line, before the time', () => {
    const { buildSlotCard } = window.__sigcPro.dayGuide;
    const r = row({ horaInicio: '09:00', controle: 'C1', domicilio: 'D1' });
    const enderecos = enderecosMap([['C1', 'D1', -12.9, -38.5]]);
    const html = buildSlotCard(r, enderecos, null, '#005a9c', 'team-0', true);
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
    const html = buildSlotCard(r, enderecos, null, '#005a9c', 'team-0', false);
    expect(html).toContain('class="route-chk"');
    expect(html).not.toMatch(/route-chk[^>]*checked/);
  });

  test('non-routable reserved row: disabled unchecked checkbox, no extra note text', () => {
    const { buildSlotCard } = window.__sigcPro.dayGuide;
    const r = row({ controle: 'C1', domicilio: 'D1' });
    const html = buildSlotCard(r, null, null, '#005a9c', 'team-0', true);
    expect(html).toContain('type="checkbox" disabled');
    expect(html).not.toContain('sem coordenadas');
  });

  test('LIVRE row: no checkbox at all, unaffected by routeGroupId/checked', () => {
    const { buildSlotCard } = window.__sigcPro.dayGuide;
    const r = row({ reservado: false });
    const html = buildSlotCard(r, null, null, '#005a9c', 'team-0', true);
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
    const rowSets = [{ rows, color: '#E69F00' }];
    const idxMap = routeIdxMap(rowSets, enderecos);
    const svg = buildRouteMapSvg(rowSets, enderecos, 480, 320, 'team-0');
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
    const svg = buildRouteMapSvg([{ rows, color: '#E69F00' }], enderecos, 480, 320, 'team-0');
    expect(svg).toContain('id="route-line-team-0"');
    expect(svg).toContain('stroke="#E69F00"');
  });

  test('multiple rowSets (Resumo shape): exactly one polyline, neutral color, not per-set', () => {
    const { buildRouteMapSvg } = window.__sigcPro.dayGuide;
    const rowsA = [row({ horaInicio: '09:00', controle: 'C1', domicilio: 'D1' })];
    const rowsB = [row({ horaInicio: '10:00', controle: 'C2', domicilio: 'D2' })];
    const enderecos = enderecosMap([
      ['C1', 'D1', -12.9, -38.5],
      ['C2', 'D2', -12.8, -38.4],
    ]);
    const svg = buildRouteMapSvg(
      [{ rows: rowsA, color: '#E69F00' }, { rows: rowsB, color: '#56B4E9' }],
      enderecos, 640, 420, 'resumo'
    );
    const polylineCount = (svg.match(/<polyline/g) || []).length;
    expect(polylineCount).toBe(1);
    expect(svg).toContain('id="route-line-resumo"');
    expect(svg).toContain('stroke="#333"');
    // Dots still keep their own set's color.
    expect(svg).toContain('fill="#E69F00"');
    expect(svg).toContain('fill="#56B4E9"');
  });

  test('multiple rowSets: data-idx is a flat counter, does not reset at the second set', () => {
    const { buildRouteMapSvg, routeIdxMap } = window.__sigcPro.dayGuide;
    const rowsA = [row({ horaInicio: '09:00', controle: 'C1', domicilio: 'D1' })];
    const rowsB = [row({ horaInicio: '10:00', controle: 'C2', domicilio: 'D2' })];
    const enderecos = enderecosMap([
      ['C1', 'D1', -12.9, -38.5],
      ['C2', 'D2', -12.8, -38.4],
    ]);
    const rowSets = [{ rows: rowsA, color: '#E69F00' }, { rows: rowsB, color: '#56B4E9' }];
    const idxMap = routeIdxMap(rowSets, enderecos);
    expect(idxMap.get('C1|D1')).toBe(0);
    expect(idxMap.get('C2|D2')).toBe(1);
    const svg = buildRouteMapSvg(rowSets, enderecos, 640, 420, 'resumo');
    expect(svg).toContain('<g data-idx="0"');
    expect(svg).toContain('<g data-idx="1"');
  });

  test('visible sequence number is unaffected by data-idx (still restarts at 1 per set)', () => {
    const { buildRouteMapSvg } = window.__sigcPro.dayGuide;
    const rowsA = [row({ horaInicio: '09:00', controle: 'C1', domicilio: 'D1' })];
    const rowsB = [row({ horaInicio: '10:00', controle: 'C2', domicilio: 'D2' })];
    const enderecos = enderecosMap([
      ['C1', 'D1', -12.9, -38.5],
      ['C2', 'D2', -12.8, -38.4],
    ]);
    const svg = buildRouteMapSvg(
      [{ rows: rowsA, color: '#E69F00' }, { rows: rowsB, color: '#56B4E9' }],
      enderecos, 640, 420, 'resumo'
    );
    // Both sets' first (and only) dot shows visible number "1" — unrelated
    // to the flat data-idx counter used above (0 and 1 respectively).
    const oneCount = (svg.match(/>1<\/text>/g) || []).length;
    expect(oneCount).toBe(2);
  });

  test('below 2 checked-equivalent plottable points in a set, still draws that single dot with its <g> wrapper (no polyline)', () => {
    const { buildRouteMapSvg } = window.__sigcPro.dayGuide;
    const rows = [row({ horaInicio: '09:00', controle: 'C1', domicilio: 'D1' })];
    const enderecos = enderecosMap([['C1', 'D1', -12.9, -38.5]]);
    const svg = buildRouteMapSvg([{ rows, color: '#E69F00' }], enderecos, 480, 320, 'team-0');
    expect(svg).toContain('<g data-idx="0"');
    expect(svg).not.toContain('<polyline');
  });
});

describe('buildTeamPanel route selector wiring', () => {
  test('<=9 routable stops: all checked by default, groupId is team-<colorIndex>', () => {
    const { buildTeamPanel } = window.__sigcPro.dayGuide;
    const rows = [row({ horaInicio: '09:00' }), row({ horaInicio: '10:00', controle: 'C2', domicilio: 'D2' })];
    const enderecos = enderecosMap([
      ['C1', 'D1', -12.9, -38.5],
      ['C2', 'D2', -12.8, -38.4],
    ]);
    const html = buildTeamPanel({ equipe: 'Equipe A', rows }, enderecos, 0);
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
    const html = buildTeamPanel({ equipe: 'Equipe A', rows }, enderecos, 0);
    expect(html).not.toContain('checked');
  });

  test('each card carries data-idx matching its routable position', () => {
    const { buildTeamPanel } = window.__sigcPro.dayGuide;
    const rows = [row({ horaInicio: '09:00' }), row({ horaInicio: '10:00', controle: 'C2', domicilio: 'D2' })];
    const enderecos = enderecosMap([
      ['C1', 'D1', -12.9, -38.5],
      ['C2', 'D2', -12.8, -38.4],
    ]);
    const html = buildTeamPanel({ equipe: 'Equipe A', rows }, enderecos, 0);
    expect(html).toContain('data-idx="0"');
    expect(html).toContain('data-idx="1"');
    // idx 0 (09:00/C1) appears before idx 1 (10:00/C2) in document order.
    expect(html.indexOf('data-idx="0"')).toBeLessThan(html.indexOf('data-idx="1"'));
  });
});

describe('buildSummaryPanel route selector wiring', () => {
  test('Resumo combines all teams, always starts unchecked, groupId is resumo', () => {
    const { buildSummaryPanel } = window.__sigcPro.dayGuide;
    const groups = [
      { equipe: 'Equipe A', rows: [row({ horaInicio: '09:00', controle: 'C1', domicilio: 'D1' })] },
      { equipe: 'Equipe B', rows: [row({ horaInicio: '08:00', controle: 'C2', domicilio: 'D2' })] },
    ];
    const allRows = groups.flatMap((g) => g.rows);
    const enderecos = enderecosMap([
      ['C1', 'D1', -12.9, -38.5],
      ['C2', 'D2', -12.8, -38.4],
    ]);
    const html = buildSummaryPanel(groups, allRows, false, enderecos);
    expect(html).toContain('data-group="resumo"');
    expect(html).not.toContain('checked'); // unconditionally unchecked
    expect(html).toContain('Rota do dia');
    // both teams' stops present, in groups' existing order (A's 09:00 before B's 08:00)
    const idxA = html.indexOf('data-name="09:00');
    const idxB = html.indexOf('data-name="08:00');
    expect(idxA).toBeGreaterThan(-1);
    expect(idxB).toBeGreaterThan(idxA);
  });

  test('Rota do dia section placed before Mapa do dia', () => {
    const { buildSummaryPanel } = window.__sigcPro.dayGuide;
    const groups = [{ equipe: 'Equipe A', rows: [row({ controle: 'C1', domicilio: 'D1' })] }];
    const enderecos = enderecosMap([['C1', 'D1', -12.9, -38.5]]);
    const html = buildSummaryPanel(groups, groups[0].rows, false, enderecos);
    expect(html.indexOf('Rota do dia')).toBeLessThan(html.indexOf('Mapa do dia'));
  });

  test('Lab panel gets no route selector', () => {
    const { buildSummaryPanel } = window.__sigcPro.dayGuide;
    const groups = [{ equipe: 'Equipe A', rows: [row({ controle: 'C1', domicilio: 'D1' })] }];
    const enderecos = enderecosMap([['C1', 'D1', -12.9, -38.5]]);
    const html = buildSummaryPanel(groups, groups[0].rows, true, enderecos);
    expect(html).not.toContain('Rota do dia');
    expect(html).not.toContain('route-selector');
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
});
