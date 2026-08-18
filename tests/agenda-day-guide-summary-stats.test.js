import { describe, test, expect } from 'bun:test';

await import('../extension/common/sigc-common.js');
await import('../extension/common/municipios.js');
await import('../extension/features/agenda-day-guide/route-map.js');
await import('../extension/features/agenda-day-guide/agenda-day-guide.js');

const { buildSummaryPanel, buildTeamPanel, dayNumberMap } = window.__sigcPro.dayGuide;

function row({
  reservado = true, horaInicio = '09:00', controle = '2927408000123',
  domicilio = 'D1', nome = 'Fulano', equipe = 'Equipe A',
} = {}) {
  return {
    reservado, horaInicio, horaFim: '09:30', nome, controle, domicilio,
    equipe, dtNascimento: '', telefone: '', endereco: '', sexo: '',
    idade: '', observacao: '',
  };
}

const enderecosFor = (zonaByDom) => new Map(Object.entries(zonaByDom).map(
  ([dom, idZona]) => [`2927408000123|${dom}`, { lat: -12.9, lon: -38.5, zona: null, idZona }]));

const panel = (rows, enderecos, lab = false) =>
  buildSummaryPanel(rows, lab, enderecos ?? null, dayNumberMap(rows));

describe('Resumo stats table', () => {
  test('shows exactly the four stats, in order', () => {
    const rows = [
      row({ horaInicio: '08:00', domicilio: 'D1', equipe: 'Equipe B' }),
      row({ horaInicio: '16:00', domicilio: 'D2', equipe: 'Equipe A' }),
    ];
    const html = panel(rows, enderecosFor({ D1: 'Z1', D2: 'Z2' }));
    const labels = [...html.matchAll(/<tr><th>([^<]+)<\/th>/g)].map((m) => m[1]);
    expect(labels).toEqual([
      'Primeiro agendamento',
      'Último agendamento',
      'Zonas distintas',
      'Média de agendamentos por zona',
    ]);
    expect(html).toContain('08:00 — Equipe B');
    expect(html).toContain('16:00 — Equipe A');
  });

  test('the retired stats and the slot grid are gone', () => {
    const rows = [row()];
    const html = panel(rows, enderecosFor({ D1: 'Z1' }));
    ['Equipes ativas', 'Equipes com reserva', 'Agendamentos (reservados)',
      'Slots livres', 'Total de slots', 'Taxa de ocupação',
      'Controles distintos', 'por equipe ativa', 'por controle',
      'Slots do dia'].forEach((s) => expect(html).not.toContain(s));
  });

  test('zonas distintas counts distinct real zonas; média formats pt-BR', () => {
    // 3 agendamentos across 2 zonas -> "2" and média "1,5".
    const rows = [
      row({ horaInicio: '08:00', domicilio: 'D1' }),
      row({ horaInicio: '09:00', domicilio: 'D2' }),
      row({ horaInicio: '10:00', domicilio: 'D3' }),
    ];
    const html = panel(rows, enderecosFor({ D1: 'Z1', D2: 'Z1', D3: 'Z2' }));
    expect(html).toContain('<tr><th>Zonas distintas</th><td>2</td></tr>');
    expect(html).toContain('<tr><th>Média de agendamentos por zona</th><td>1,5</td></tr>');
  });

  test('without the endereços lookup the zona stats read "—", never "0"', () => {
    // generate(null) is a live path (declined/failed consulta): the zona
    // is UNKNOWN there, and "0 zonas" would be a claim.
    const html = panel([row()], null);
    expect(html).toContain('<tr><th>Zonas distintas</th><td>—</td></tr>');
    expect(html).toContain('<tr><th>Média de agendamentos por zona</th><td>—</td></tr>');
    expect(html).not.toContain('<td>0</td>');
  });

  test('a day with no reserved rows degrades every stat to "—"', () => {
    const html = panel([row({ reservado: false })], enderecosFor({}));
    expect(html).toContain('<tr><th>Primeiro agendamento</th><td>—</td></tr>');
    expect(html).toContain('<tr><th>Último agendamento</th><td>—</td></tr>');
    expect(html).toContain('<tr><th>Média de agendamentos por zona</th><td>—</td></tr>');
  });

  test('the Lab variant carries the same four stats', () => {
    const html = panel([row()], enderecosFor({ D1: 'Z1' }), true);
    // <th><td> pairs only: the lab list's own header row is all-<th>.
    const labels = [...html.matchAll(/<tr><th>([^<]+)<\/th><td>/g)].map((m) => m[1]);
    expect(labels).toEqual([
      'Primeiro agendamento',
      'Último agendamento',
      'Zonas distintas',
      'Média de agendamentos por zona',
    ]);
  });
});

describe('team stats line', () => {
  test('matches the Resumo stat set: primeiro, último, zonas, média', () => {
    const rows = [
      row({ horaInicio: '08:00', domicilio: 'D1' }),
      row({ horaInicio: '16:00', domicilio: 'D2' }),
    ];
    const html = buildTeamPanel({ equipe: 'Equipe A', rows },
      enderecosFor({ D1: 'Z1', D2: 'Z2' }), 0, dayNumberMap(rows));
    expect(html).toContain('primeiro 08:00');
    expect(html).toContain('último 16:00');
    expect(html).toContain('2 zona(s) distinta(s)');
    expect(html).toContain('1,0 agendamento(s) por zona');
    ['reservado(s)', 'livre(s)', 'ocupação', 'controle(s) distinto(s)']
      .forEach((s) => expect(html).not.toContain(s));
  });

  test('zona bits are omitted (not "—") when the lookup never ran', () => {
    const rows = [row({ horaInicio: '08:00' })];
    const html = buildTeamPanel({ equipe: 'Equipe A', rows }, null, 0, dayNumberMap(rows));
    expect(html).toContain('primeiro 08:00');
    expect(html).not.toContain('zona(s) distinta(s)');
    expect(html).not.toContain('por zona');
  });
});
