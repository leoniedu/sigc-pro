import { describe, test, expect } from 'bun:test';

await import('../extension/common/sigc-common.js');
await import('../extension/common/municipios.js');
await import('../extension/features/agenda-day-guide/route-map.js');
await import('../extension/features/agenda-day-guide/agenda-day-guide.js');

const { dayNumberMap, buildGuideHtml, buildSlotCard } = window.__sigcPro.dayGuide;

// Controle carries a real IBGE código so the Lab list's Município fills.
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

describe('dayNumberMap', () => {
  test('numbers reserved rows 1..N in the order given, skipping open slots', () => {
    const rows = [
      row({ reservado: false, horaInicio: '07:00', domicilio: 'D0' }),
      row({ horaInicio: '08:00', domicilio: 'D1' }),
      row({ horaInicio: '09:00', domicilio: 'D2' }),
      row({ reservado: false, horaInicio: '09:30', domicilio: 'D9' }),
      row({ horaInicio: '10:00', domicilio: 'D3' }),
    ];
    const map = dayNumberMap(rows);
    expect(map.get('2927408000123|D1')).toBe(1);
    expect(map.get('2927408000123|D2')).toBe(2);
    expect(map.get('2927408000123|D3')).toBe(3);
    expect(map.has('2927408000123|D0')).toBe(false);
    expect(map.size).toBe(3);
  });

  test('coordinate-less households are numbered too — the number is not a dot number', () => {
    // dayNumberMap never consults enderecos at all: every reserved row
    // gets a number whether or not it can be plotted.
    const rows = [row({ domicilio: 'D1' }), row({ horaInicio: '10:00', domicilio: 'D2' })];
    const map = dayNumberMap(rows);
    expect(map.size).toBe(2);
  });

  test('never restarts and dedupes defensively on controle|domicilio', () => {
    // A household cannot hold two agendamentos in one day, but a
    // duplicated row must not fork the numbering: first occurrence wins.
    const rows = [
      row({ horaInicio: '08:00', domicilio: 'D1' }),
      row({ horaInicio: '09:00', domicilio: 'D1' }),
      row({ horaInicio: '10:00', domicilio: 'D2' }),
    ];
    const map = dayNumberMap(rows);
    expect(map.get('2927408000123|D1')).toBe(1);
    expect(map.get('2927408000123|D2')).toBe(2);
    expect(map.size).toBe(2);
  });
});

describe('one number per household across every surface', () => {
  test('the same household shows the same number on Resumo card, team card, map dot and Lab row', () => {
    // Two teams, day order interleaved: the 2nd household of the day
    // belongs to team B, so its team-panel card must say 2, not 1.
    const allRows = [
      row({ horaInicio: '08:00', domicilio: 'D1', equipe: 'Equipe A' }),
      row({ horaInicio: '09:00', domicilio: 'D2', equipe: 'Equipe B', nome: 'Beltrano' }),
    ];
    const groups = [
      { equipe: 'Equipe A', rows: [allRows[0]] },
      { equipe: 'Equipe B', rows: [allRows[1]] },
    ];
    const enderecos = new Map([
      ['2927408000123|D1', { lat: -12.9, lon: -38.5, zona: null, idZona: '11' }],
      ['2927408000123|D2', { lat: -12.8, lon: -38.4, zona: null, idZona: '12' }],
    ]);
    const meta = { uf: 'BA', dataBr: '22/07/2026', diaSemana: 'quarta-feira', geradoEm: '22/07/2026 10:00' };
    const html = buildGuideHtml(meta, groups, allRows, enderecos);

    // The day's 2nd household is number 2 everywhere it appears:
    // Resumo card + team card (badge)…
    const badges = (html.match(/<span class="badge badge-seq">2<\/span>/g) || []).length;
    expect(badges).toBe(2);
    // …its Lab row…
    expect(html).toContain('<td class="lab-num">2</td>');
    // …and its map dots (Resumo map + team B map).
    const dotTwos = (html.match(/>2<\/text>/g) || []).length;
    expect(dotTwos).toBe(2);
    // Team B's own panel never renumbers its household to 1.
    const teamBSection = html.slice(html.indexOf('<h2>Equipe B</h2>'));
    expect(teamBSection).not.toContain('badge-seq">1<');
  });

  test('a coordinate-less household still gets its number badge on the card', () => {
    const rows = [
      row({ horaInicio: '08:00', domicilio: 'D1' }),
      row({ horaInicio: '09:00', domicilio: 'D2' }),
    ];
    // Only D1 has coordinates; D2 must still carry badge 2.
    const enderecos = new Map([
      ['2927408000123|D1', { lat: -12.9, lon: -38.5, zona: null, idZona: null }],
    ]);
    const card = buildSlotCard(rows[1], enderecos, dayNumberMap(rows), 'resumo', false);
    expect(card).toContain('<span class="badge badge-seq">2</span>');
  });

  test('the equipe is stamped on every reserved card', () => {
    const rows = [row({ equipe: 'Equipe Azul' })];
    const card = buildSlotCard(rows[0], null, dayNumberMap(rows), 'resumo', false);
    expect(card).toContain('<span class="badge badge-equipe">Equipe Azul</span>');
  });
});
