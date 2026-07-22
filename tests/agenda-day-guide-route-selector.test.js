import { describe, test, expect } from 'bun:test';

await import('../extension/common/sigc-common.js');
await import('../extension/features/agenda-day-guide/agenda-day-guide.js');
const { buildRouteSelector } = window.__sigcPro.dayGuide;

function row({ reservado = true, horaInicio = '09:00', nome = 'Fulano', controle = 'C1', domicilio = 'D1' } = {}) {
  return { reservado, horaInicio, horaFim: '09:30', nome, controle, domicilio, equipe: 'A' };
}

function enderecosMap(entries) {
  // entries: [[controle, domicilio, lat, lon], ...]
  const m = new Map();
  entries.forEach(([controle, domicilio, lat, lon]) => {
    m.set(`${controle}|${domicilio}`, { lat, lon, zona: null, idZona: null });
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
    expect(html).not.toContain('class="rota"'); // old block gone
    // Selector block sits where the old rota div was: before the cards,
    // i.e. before the first slot card's endereco div.
    expect(html.indexOf('route-selector')).toBeLessThan(html.indexOf('class="card"'));
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
});
