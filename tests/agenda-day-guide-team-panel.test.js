import { describe, test, expect } from 'bun:test';

await import('../extension/common/sigc-common.js');
await import('../extension/features/agenda-day-guide/route-map.js');
await import('../extension/features/agenda-day-guide/agenda-day-guide.js');

const { buildTeamPanel } = window.__sigcPro.dayGuide;

function row({
  reservado = true, horaInicio = '09:00', horaFim = '09:30',
  nome = 'Fulano de Tal', controle = 'C1', domicilio = 'D1', zonas = '',
} = {}) {
  return { reservado, horaInicio, horaFim, nome, controle, domicilio, zonas, equipe: 'A' };
}

describe('buildTeamPanel — LIVRE cards removed', () => {
  test('a team with only open slots produces no cards at all', () => {
    const group = { equipe: 'Equipe A', rows: [row({ reservado: false, zonas: '29_A' })] };
    const html = buildTeamPanel(group, null, 0);
    expect(html).not.toContain('LIVRE');
    expect(html).not.toContain('livre-edge');
    expect(html).not.toContain('class="card livre"');
  });

  test('a team mixing reserved and open slots shows only the reserved card', () => {
    const group = {
      equipe: 'Equipe A',
      rows: [
        row({ reservado: false, horaInicio: '08:00', horaFim: '08:30', zonas: '29_A' }),
        row({ reservado: true, horaInicio: '09:00', controle: 'C1', domicilio: 'D1' }),
        row({ reservado: false, horaInicio: '10:00', horaFim: '10:30', zonas: '29_A' }),
      ],
    };
    const html = buildTeamPanel(group, null, 0);
    expect(html).not.toContain('LIVRE');
    expect(html).not.toContain('livre-edge');
    expect(html).toContain('class="card"'); // the reserved card renders (no RESERVADO badge — all cards are reserved)
    expect(html).toContain('C1');
  });

  test('the Zonas: summary line never appears, even with distinct zonas across rows', () => {
    const group = {
      equipe: 'Equipe A',
      rows: [
        row({ reservado: true, controle: 'C1', domicilio: 'D1' }),
        row({ reservado: false, horaInicio: '08:00', horaFim: '08:30', zonas: '29_A 29_B' }),
      ],
    };
    const html = buildTeamPanel(group, null, 0);
    expect(html).not.toContain('Zonas:');
    expect(html).not.toContain('class="zonas"');
  });

  test('a fully-reserved team still renders its card(s) normally', () => {
    const group = { equipe: 'Equipe A', rows: [row({ reservado: true, controle: 'C1', domicilio: 'D1' })] };
    const html = buildTeamPanel(group, null, 0);
    expect(html).toContain('class="card"'); // the reserved card renders (no RESERVADO badge — all cards are reserved)
    expect(html).toContain('C1');
  });
});

// Google snaps a routing coordinate to the nearest road IT knows, and
// labels the stop with that road's bairro. Confirmed live (2026-08-26,
// Salvador/BA): a household at -12.944915,-38.361918 — Rua Nova, Itapuã
// per OpenStreetMap — came back as "1a Travess 29 De Outubro, 3 —
// Pernambués", a different street in a bairro ~8 km away. The other two
// stops in the same route resolved correctly, so this is Google's data,
// not the coordinate.
//
// The /maps/search/ endpoint does NOT snap and does NOT reverse-geocode:
// Google's own docs say a bare lat,lng gives "a pin in the map, but no
// additional place information". So the per-household link uses it, and
// cannot contradict the IBGE address printed on the same card.
describe('the per-household map link shows the true point, unsnapped', () => {
  const enderecos = new Map([['C1|D1', { lat: -12.944915, lon: -38.361918 }]]);
  const group = { equipe: 'Equipe A', rows: [row({ controle: 'C1', domicilio: 'D1' })] };

  test('the card links to the search endpoint, not to directions', () => {
    const html = buildTeamPanel(group, enderecos, 0);
    expect(html).toContain('/maps/search/?api=1');
    // The routing endpoint is what snapped the stop to another bairro.
    expect(html).not.toContain('/maps/dir/?api=1&travelmode=driving&destination');
  });

  test('the exact surveyed coordinate is what gets pinned', () => {
    const html = buildTeamPanel(group, enderecos, 0);
    expect(html).toContain(encodeURIComponent('-12.944915,-38.361918'));
  });

  test('a household without coordinates still gets no link', () => {
    const html = buildTeamPanel(group, new Map(), 0);
    expect(html).not.toContain('/maps/');
  });

  test('the multi-stop route link is untouched — it must still be directions', () => {
    // Routing is the whole point there, and snapping is inherent to it:
    // a car cannot be navigated to a point with no road. The route link
    // is injected into .rota-link at runtime, so the card's own markup
    // carries the checkbox data the runtime builds it from.
    const html = buildTeamPanel(group, enderecos, 0);
    expect(html).toContain('class="rota-link"');
    expect(html).toContain('data-lat="-12.944915"');
    expect(html).toContain('data-lon="-38.361918"');
  });
});
