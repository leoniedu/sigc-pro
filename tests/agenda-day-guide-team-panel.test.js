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
