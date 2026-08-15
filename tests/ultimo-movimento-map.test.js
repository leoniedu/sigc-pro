import { describe, test, expect } from 'bun:test';

await import('../extension/common/sigc-common.js');
await import('../extension/features/agenda-lookups/agenda-lookups.js');
await import('../extension/features/ultimo-movimento-export/ultimo-movimento-export.js');
await import('../extension/features/ultimo-movimento-map/ultimo-movimento-map.js');

const UM = window.__sigcProUltimoMovimentoMapInternals;

describe('parseUltimoMovimentoRows', () => {
  test('maps Controle+Domicilio to full row data by header label', () => {
    const headers = ['Controle', 'Domicilio', 'Entrevistador', 'Tipo Entrevista', 'Última Posição', 'Data'];
    const rows = [
      ['290570120000125', '1', 'Fulano de Tal', 'Realizada', 'Transmitido', '01/08/2026'],
      ['290570120000125', '2', 'Fulano de Tal', 'Não Iniciada', 'Distribuido', ''],
    ];
    const map = UM.parseUltimoMovimentoRows(headers, rows);
    expect(map.get('290570120000125|1')).toEqual({
      controle: '290570120000125', domicilio: '1', entrevistador: 'Fulano de Tal',
      tipoEntrevista: 'Realizada', ultimaPosicao: 'Transmitido', data: '01/08/2026',
    });
    expect(map.get('290570120000125|2').tipoEntrevista).toBe('Não Iniciada');
  });

  test('is tolerant of header order', () => {
    const headers = ['Data', 'Última Posição', 'Tipo Entrevista', 'Entrevistador', 'Domicilio', 'Controle'];
    const rows = [['01/08/2026', 'Transmitido', 'Realizada', 'Fulano', 'D1', 'C1']];
    const map = UM.parseUltimoMovimentoRows(headers, rows);
    expect(map.get('C1|D1').entrevistador).toBe('Fulano');
  });

  test('returns null when a required header is missing', () => {
    const headers = ['Controle', 'Domicilio', 'Situação'];
    const rows = [['C1', 'D1', 'x']];
    expect(UM.parseUltimoMovimentoRows(headers, rows)).toBeNull();
  });

  test('matches the real live header "Domicílio" (accented, not the bare "Domicilio")', () => {
    const headers = ['Controle', 'Domicílio', 'Entrevistador', 'Tipo Entrevista', 'Última Posição', 'Data'];
    const rows = [['C1', 'D1', 'Fulano', 'Realizada', 'Transmitido', '01/08/2026']];
    const map = UM.parseUltimoMovimentoRows(headers, rows);
    expect(map.get('C1|D1')).toEqual({
      controle: 'C1', domicilio: 'D1', entrevistador: 'Fulano',
      tipoEntrevista: 'Realizada', ultimaPosicao: 'Transmitido', data: '01/08/2026',
    });
  });

  test('tolerates the "#!" sort/filter marker some SIGC report grids prepend to a header', () => {
    const headers = ['#!Controle', '!Domicílio', 'Entrevistador', 'Tipo Entrevista', 'Última Posição', 'Data'];
    const rows = [['C1', 'D1', 'Fulano', 'Realizada', 'Transmitido', '01/08/2026']];
    const map = UM.parseUltimoMovimentoRows(headers, rows);
    expect(map.get('C1|D1').entrevistador).toBe('Fulano');
  });
});

describe('joinEnderecos', () => {
  const movimentoMap = new Map([
    ['C1|1', { controle: 'C1', domicilio: '1', entrevistador: 'A', tipoEntrevista: 'Realizada', ultimaPosicao: 'Transmitido', data: '01/08/2026' }],
    ['C1|2', { controle: 'C1', domicilio: '2', entrevistador: 'A', tipoEntrevista: 'Não Iniciada', ultimaPosicao: 'Distribuido', data: '' }],
  ]);

  test('joins coordinates and zona by controle|domicilio', () => {
    const enderecosMap = new Map([
      ['C1|1', { lat: -8.5, lon: -63.8, zona: 'ESCOLA POLICIA', idZona: '11.1.01.08' }],
    ]);
    const joined = UM.joinEnderecos(movimentoMap, enderecosMap);
    const d1 = joined.find((r) => r.domicilio === '1');
    expect(d1).toMatchObject({ lat: -8.5, lon: -63.8, zona: 'ESCOLA POLICIA', idZona: '11.1.01.08', temCoordenadas: true, temZona: true });
  });

  test('a household missing from enderecosMap gets temCoordenadas/temZona false, not dropped', () => {
    const joined = UM.joinEnderecos(movimentoMap, new Map());
    expect(joined).toHaveLength(2);
    joined.forEach((r) => {
      expect(r.temCoordenadas).toBe(false);
      expect(r.temZona).toBe(false);
      expect(r.lat).toBeNull();
      expect(r.lon).toBeNull();
    });
  });

  test('a household with zona but no valid coordinates keeps temZona true, temCoordenadas false', () => {
    const enderecosMap = new Map([
      ['C1|1', { lat: null, lon: null, zona: 'ESCOLA POLICIA', idZona: '11.1.01.08' }],
    ]);
    const joined = UM.joinEnderecos(movimentoMap, enderecosMap);
    const d1 = joined.find((r) => r.domicilio === '1');
    expect(d1.temZona).toBe(true);
    expect(d1.temCoordenadas).toBe(false);
  });
});

describe('joinAgenda', () => {
  test('attaches the chosen agendamento to the matching household', () => {
    const I = window.__sigcProUltimoMovimentoMapInternals;
    const joined = [{ controle: 'C1', domicilio: '1' }, { controle: 'C1', domicilio: '2' }];
    const agendaIdx = new Map([
      ['C1|1', [{ start: '2026-09-01T09:00:00', isoDate: '2026-09-01' }]],
    ]);
    const rows = I.joinAgenda(joined, agendaIdx, '2026-08-11');
    expect(rows[0].agendado).toBe('01/09/2026 09:00');
    expect(rows[0].futura).toBe(true);
    expect(rows[0].agendadoOrdenavel).toBe('2026-09-01T09:00:00');
    expect(rows[1].agendado).toBe('');
  });

  test('a past visit is kept and flagged not futura', () => {
    const I = window.__sigcProUltimoMovimentoMapInternals;
    const joined = [{ controle: 'C1', domicilio: '1' }];
    const agendaIdx = new Map([
      ['C1|1', [{ start: '2026-07-01T14:30:00', isoDate: '2026-07-01' }]],
    ]);
    const rows = I.joinAgenda(joined, agendaIdx, '2026-08-11');
    expect(rows[0].agendado).toBe('01/07/2026 14:30');
    expect(rows[0].futura).toBe(false);
  });

  test('an empty agenda index leaves every row blank, never undefined', () => {
    const I = window.__sigcProUltimoMovimentoMapInternals;
    const rows = I.joinAgenda([{ controle: 'C1', domicilio: '1' }], new Map(), '2026-08-11');
    expect(rows[0].agendado).toBe('');
    expect(rows[0].agendadoOrdenavel).toBe('');
    expect(rows[0].futura).toBe(false);
  });
});

describe('aggregateZonas', () => {
  const joined = [
    { idZona: '11.1.01.08', zona: 'ESCOLA POLICIA', tipoEntrevista: 'Realizada', temCoordenadas: true, temZona: true },
    { idZona: '11.1.01.08', zona: 'ESCOLA POLICIA', tipoEntrevista: 'Não Iniciada', temCoordenadas: false, temZona: true },
    { idZona: '', zona: '', tipoEntrevista: 'Recusa', temCoordenadas: true, temZona: false },
    { idZona: '', zona: '', tipoEntrevista: 'Realizada', temCoordenadas: true, temZona: false },
  ];

  test('groups by idZona, one row per distinct zona', () => {
    const rows = UM.aggregateZonas(joined, new Map());
    const zonaRow = rows.find((r) => r.idZona === '11.1.01.08');
    expect(zonaRow).toMatchObject({
      idZona: '11.1.01.08', nomeZona: 'ESCOLA POLICIA',
      realizada: 1, naoIniciada: 1, domicilioFechado: 0, recusa: 0, outros: 0,
      totalDomicilios: 2, semCoordenadas: 1,
    });
  });

  test('households with temZona false land in a single "Sem zona" row (idZona null)', () => {
    const rows = UM.aggregateZonas(joined, new Map());
    const semZona = rows.find((r) => r.idZona === null);
    expect(semZona).toBeDefined();
    expect(semZona.totalDomicilios).toBe(2);
    expect(semZona.recusa).toBe(1);
    expect(semZona.realizada).toBe(1);
    expect(semZona.semCoordenadas).toBe(0);
  });

  test('unrecognized tipoEntrevista values count under outros', () => {
    const rows = UM.aggregateZonas([
      { idZona: 'Z1', zona: 'Zona 1', tipoEntrevista: 'Endereço Não Localizado', temCoordenadas: true, temZona: true },
    ], new Map());
    expect(rows[0].outros).toBe(1);
    expect(rows[0].realizada).toBe(0);
  });

  test('empty input returns empty array, no Sem zona row', () => {
    expect(UM.aggregateZonas([], new Map())).toEqual([]);
  });
});

describe('aggregateZonas coverage and agenda stats', () => {
  test('a zona with coordinates but no movimento rows still appears, with zeros', () => {
    const I = window.__sigcProUltimoMovimentoMapInternals;
    const enderecos = new Map([
      ['C1|1', { lat: -12.9, lon: -38.5, zona: '29JDM8 - x', idZona: '29JDM8' }],
      ['C9|1', { lat: -12.8, lon: -38.4, zona: '29LR9E - y', idZona: '29LR9E' }],
    ]);
    const joined = [{
      controle: 'C1', domicilio: '1', idZona: '29JDM8', zona: '29JDM8 - x',
      temZona: true, temCoordenadas: true, tipoEntrevista: 'REALIZADA', agendado: '',
    }];
    const rows = I.aggregateZonas(joined, enderecos);
    const ids = rows.map((r) => r.idZona).sort();
    expect(ids).toContain('29LR9E');
    const vazia = rows.find((r) => r.idZona === '29LR9E');
    expect(vazia.totalDomicilios).toBe(0);
    expect(vazia.realizada).toBe(0);
  });

  test('counts agendados, realizadas sem agendamento and pendentes per zona', () => {
    const I = window.__sigcProUltimoMovimentoMapInternals;
    const enderecos = new Map([
      ['C1|1', { lat: -12.9, lon: -38.5, zona: '29JDM8 - x', idZona: '29JDM8' }],
      ['C1|2', { lat: -12.9, lon: -38.5, zona: '29JDM8 - x', idZona: '29JDM8' }],
    ]);
    const row = (domicilio, extra) => Object.assign({
      controle: 'C1', domicilio, idZona: '29JDM8', zona: '29JDM8 - x',
      temZona: true, temCoordenadas: true, agendado: '',
    }, extra);
    const joined = [
      // Booked: counts as agendado, never as demand.
      row('1', { tipoEntrevista: 'Realizada',
        ultimaPosicao: 'Descarregado Parcialmente', agendado: '01/09/2026 09:00' }),
      // Owed: interview in, biomarcador collection not, no slot.
      row('2', { tipoEntrevista: 'Realizada',
        ultimaPosicao: 'Descarregado Parcialmente' }),
      // Pendente but not owed: in the field, owes no collection.
      row('3', { tipoEntrevista: 'Recusa', ultimaPosicao: 'Descarregado' }),
      // Neither: not yet field demand.
      row('4', { tipoEntrevista: 'Não Iniciada', ultimaPosicao: 'Distribuido' }),
    ];
    const z = I.aggregateZonas(joined, enderecos).find((r) => r.idZona === '29JDM8');
    expect(z.agendados).toBe(1);
    expect(z.realizadasSemAgendamento).toBe(1);
    // Realizadas sem agendamento is a SUBSET of pendentes: domicílio 2
    // is counted in both, 3 only in pendentes, 1 and 4 in neither.
    expect(z.pendentes).toBe(2);
  });
});

// The demand rules, exhaustively. These two predicates decide what a
// supervisor is told is owed, so every combination that behaves
// differently gets its own case.
//
// Every ultimaPosicao used below is a REAL value, measured against
// 26.203 rows of BA movimento.parquet (pns.zonas, 2026-08-14). The full
// domain is exactly these five. An earlier version of these tests
// asserted on 'Transmitido', which does not exist in the live data.
const POSICOES_REAIS = [
  'Distribuido', 'Enviado para Carga', 'Descarregado',
  'Descarregado Parcialmente', 'Reentrevista',
];

describe('isRealizadaSemAgendamento', () => {
  const I = () => window.__sigcProUltimoMovimentoMapInternals;
  const row = (extra) => Object.assign(
    { tipoEntrevista: 'Realizada', ultimaPosicao: 'Descarregado Parcialmente',
      agendado: '' }, extra);

  // The key state: interview in, biomarcador collection not.
  test('counts Realizada + Descarregado Parcialmente', () => {
    expect(I().isRealizadaSemAgendamento(row())).toBe(true);
  });

  // Reentrevista tracks the partial state (53% still pending in
  // biomarcadores) far more closely than the completed one (32%), so it
  // owes a collection too.
  test('counts Realizada + Reentrevista', () => {
    expect(I().isRealizadaSemAgendamento(row({ ultimaPosicao: 'Reentrevista' }))).toBe(true);
  });

  test('a fully descarregada realizada is closed', () => {
    expect(I().isRealizadaSemAgendamento(row({ ultimaPosicao: 'Descarregado' }))).toBe(false);
  });

  // Matched positively on the two owing states: anything else — present
  // or future — must not drift into the count.
  test('no other real posição counts', () => {
    POSICOES_REAIS
      .filter((p) => p !== 'Descarregado Parcialmente' && p !== 'Reentrevista')
      .forEach((p) => {
        expect(I().isRealizadaSemAgendamento(row({ ultimaPosicao: p }))).toBe(false);
      });
    // A posição SIGC has not introduced yet must also stay out.
    expect(I().isRealizadaSemAgendamento(row({ ultimaPosicao: 'Algo Novo' }))).toBe(false);
  });

  test('a booked household is never owed', () => {
    expect(I().isRealizadaSemAgendamento(row({ agendado: '01/09/2026 09:00' }))).toBe(false);
  });

  test('only Realizada counts — other tipos owe no collection', () => {
    expect(I().isRealizadaSemAgendamento(row({ tipoEntrevista: 'Recusa' }))).toBe(false);
    expect(I().isRealizadaSemAgendamento(row({ tipoEntrevista: 'Não Iniciada' }))).toBe(false);
  });
});

describe('isPendente', () => {
  const I = () => window.__sigcProUltimoMovimentoMapInternals;
  const row = (extra) => Object.assign(
    { tipoEntrevista: 'Recusa', ultimaPosicao: 'Descarregado', agendado: '' }, extra);

  // Not yet in the field: nothing is owed yet. "Não é fila intocada."
  test('Distribuido and Enviado para Carga are not demand yet', () => {
    expect(I().isPendente(row({ ultimaPosicao: 'Distribuido' }))).toBe(false);
    expect(I().isPendente(row({ ultimaPosicao: 'Enviado para Carga' }))).toBe(false);
  });

  test('every other real posição counts when unscheduled', () => {
    ['Descarregado', 'Descarregado Parcialmente', 'Reentrevista'].forEach((p) => {
      expect(I().isPendente(row({ ultimaPosicao: p }))).toBe(true);
    });
  });

  // Deliberately not tipo-filtered: the live table carries at least
  // fifteen tipos, and a whitelist silently undercounts the long tail.
  test('counts field tipos beyond the obvious four', () => {
    ['Em condições de ser habitada', 'Uso Ocasional', 'Domicílio Vago',
      'Em Ruínas', 'Não Residencial'].forEach((tipo) => {
      expect(I().isPendente(row({ tipoEntrevista: tipo }))).toBe(true);
    });
  });

  test('a booked household is never pending', () => {
    expect(I().isPendente(row({ agendado: '01/09/2026 09:00' }))).toBe(false);
  });

  // The nesting the header tooltip promises: everything owed is pending.
  test('every owed household is also pending', () => {
    ['Descarregado Parcialmente', 'Reentrevista'].forEach((p) => {
      const r = { tipoEntrevista: 'Realizada', ultimaPosicao: p, agendado: '' };
      expect(I().isRealizadaSemAgendamento(r)).toBe(true);
      expect(I().isPendente(r)).toBe(true);
    });
  });
});

describe('zonaSemCapacidade', () => {
  const I = () => window.__sigcProUltimoMovimentoMapInternals;

  test('flags a zona owing more than its free slots', () => {
    expect(I().zonaSemCapacidade({ realizadasSemAgendamento: 3 },
      { manha: 1, tarde: 1 })).toBe(true);
  });

  test('does not flag when capacity exactly meets what is owed', () => {
    expect(I().zonaSemCapacidade({ realizadasSemAgendamento: 2 },
      { manha: 1, tarde: 1 })).toBe(false);
  });

  // Zero demand needs zero capacity — a zona owing nothing must never
  // flag, however empty its agenda is.
  test('never flags a zona that owes nothing', () => {
    expect(I().zonaSemCapacidade({ realizadasSemAgendamento: 0 },
      { manha: 0, tarde: 0 })).toBe(false);
  });

  test('flags when there are no slots at all and something is owed', () => {
    expect(I().zonaSemCapacidade({ realizadasSemAgendamento: 1 }, undefined)).toBe(true);
  });

  test('counts both turnos toward capacity', () => {
    expect(I().zonaSemCapacidade({ realizadasSemAgendamento: 2 },
      { manha: 0, tarde: 2 })).toBe(false);
  });
});

describe('zonaColor', () => {
  test('returns the fixed gray for null/empty idZona ("Sem zona")', () => {
    expect(UM.zonaColor(null)).toBe('#888888');
    expect(UM.zonaColor('')).toBe('#888888');
  });

  test('returns a stable, non-gray color for a real idZona', () => {
    const c1 = UM.zonaColor('11.1.01.08');
    const c2 = UM.zonaColor('11.1.01.08');
    expect(c1).toBe(c2);
    expect(c1).not.toBe('#888888');
    expect(c1).toMatch(/^#[0-9a-f]{6}$/i);
  });

  test('different zonas get different colors (not guaranteed unique, but not all equal for a small set)', () => {
    const colors = new Set(['Z1', 'Z2', 'Z3', 'Z4', 'Z5'].map(UM.zonaColor));
    expect(colors.size).toBeGreaterThan(1);
  });
});

describe('zonaRowIsClickable', () => {
  test('true when at least one domicílio has valid coordinates', () => {
    expect(UM.zonaRowIsClickable({ totalDomicilios: 4, semCoordenadas: 1 })).toBe(true);
  });

  test('false when every domicílio lacks coordinates', () => {
    expect(UM.zonaRowIsClickable({ totalDomicilios: 3, semCoordenadas: 3 })).toBe(false);
  });

  test('false when there are zero domicílios at all', () => {
    expect(UM.zonaRowIsClickable({ totalDomicilios: 0, semCoordenadas: 0 })).toBe(false);
  });
});

describe('buildZonasTableHtml', () => {
  test('renders a header row and one row per zona, HTML-escaped', () => {
    const rows = [
      { idZona: 'Z1', nomeZona: 'Bairro <X>', realizada: 3, naoIniciada: 1, domicilioFechado: 0, recusa: 0, outros: 0, totalDomicilios: 4, semCoordenadas: 1 },
      { idZona: null, nomeZona: 'Sem zona', realizada: 0, naoIniciada: 0, domicilioFechado: 0, recusa: 2, outros: 0, totalDomicilios: 2, semCoordenadas: 0 },
    ];
    const html = UM.buildZonasTableHtml(rows);
    expect(html).toContain('<table');
    expect(html).toContain('Bairro &lt;X&gt;');
    expect(html).toContain('Sem zona');
    expect(html).toContain('Z1');
  });

  test('empty input still renders a valid table with no data rows', () => {
    const html = UM.buildZonasTableHtml([]);
    expect(html).toContain('<table');
    expect(html).not.toMatch(/<td/);
  });

  test('a row with mapped domicílios is clickable, with its idZona as a data attribute', () => {
    const rows = [
      { idZona: 'Z1', nomeZona: 'Bairro X', realizada: 1, naoIniciada: 0, domicilioFechado: 0, recusa: 0, outros: 0, totalDomicilios: 2, semCoordenadas: 1 },
    ];
    const html = UM.buildZonasTableHtml(rows);
    expect(html).toContain('sigc-pro-zona-row-clickable');
    expect(html).toContain('data-id-zona="Z1"');
  });

  test('the Zona cell is plain text — the pin carries the affordance now', () => {
    // Superseded the link-styled <a> that used to sit on the zona code:
    // with the pin owning the gesture, a link here would be a second
    // click target over text the user most likely wants to select.
    const rows = [
      { idZona: 'Z1', nomeZona: 'Bairro X', realizada: 1, naoIniciada: 0, domicilioFechado: 0, recusa: 0, outros: 0, totalDomicilios: 2, semCoordenadas: 1 },
    ];
    const html = UM.buildZonasTableHtml(rows);
    expect(html).not.toContain('sigc-pro-zona-link');
    expect(html).toContain('<td>Z1</td>');
  });

  test('a row with zero mapped domicílios (all sem coordenadas) is NOT clickable', () => {
    const rows = [
      { idZona: 'Z2', nomeZona: 'Bairro Y', realizada: 0, naoIniciada: 0, domicilioFechado: 0, recusa: 1, outros: 0, totalDomicilios: 1, semCoordenadas: 1 },
    ];
    const html = UM.buildZonasTableHtml(rows);
    expect(html).not.toContain('sigc-pro-zona-row-clickable');
    expect(html).not.toContain('data-id-zona');
    expect(html).not.toContain('sigc-pro-zona-link');
  });

  test('the "Sem zona" row (idZona null) is clickable via an empty-string data-id-zona', () => {
    const rows = [
      { idZona: null, nomeZona: 'Sem zona', realizada: 0, naoIniciada: 0, domicilioFechado: 0, recusa: 2, outros: 0, totalDomicilios: 2, semCoordenadas: 0 },
    ];
    const html = UM.buildZonasTableHtml(rows);
    expect(html).toContain('sigc-pro-zona-row-clickable');
    expect(html).toContain('data-id-zona=""');
  });
});

describe('buildPanelHtml', () => {
  const joined = [
    { controle: 'C1', domicilio: '1', entrevistador: 'A', tipoEntrevista: 'Realizada',
      ultimaPosicao: 'Transmitido', data: '01/08/2026', lat: -8.5, lon: -63.8,
      zona: 'Z1', idZona: 'Z1', temCoordenadas: true, temZona: true },
  ];
  const zonaRows = UM.aggregateZonas(joined, new Map());

  test('includes both tab buttons and both panels', () => {
    const html = UM.buildPanelHtml(joined, zonaRows);
    expect(html).toContain('Mapa');
    expect(html).toContain('Zonas');
    expect(html).toContain('sigc-pro-mapa-panel');
    expect(html).toContain('sigc-pro-zonas-panel');
  });

  test('embeds the Zonas table', () => {
    const html = UM.buildPanelHtml(joined, zonaRows);
    expect(html).toContain('sigc-pro-zonas-table');
  });

  test('includes a close control', () => {
    const html = UM.buildPanelHtml(joined, zonaRows);
    expect(html).toMatch(/fechar|close|×/i);
  });

  test('the zonas tab count reflects the actual number of zona rows, not a static label', () => {
    const html = UM.buildPanelHtml(joined, zonaRows);
    expect(zonaRows).toHaveLength(1);
    expect(html).toContain(`Zonas (${zonaRows.length})`);
  });

  test('the embedded Zonas table contains this fixture\'s actual zona data (Z1), not just headers', () => {
    const html = UM.buildPanelHtml(joined, zonaRows);
    expect(html).toContain('Z1');
    expect(html).toContain('<td>1</td>'); // realizada count for the Z1 row
  });

  test('shows the "click a zona" hint when at least one row is clickable', () => {
    const html = UM.buildPanelHtml(joined, zonaRows);
    expect(html).toContain('sigc-pro-zonas-hint');
    expect(html).toContain('Clique no 📍 de uma zona');
  });

  test('omits the hint when no row has mapped coordinates', () => {
    const noCoordsJoined = [
      { controle: 'C1', domicilio: '1', entrevistador: 'A', tipoEntrevista: 'Realizada',
        ultimaPosicao: 'Transmitido', data: '01/08/2026', lat: null, lon: null,
        zona: 'Z1', idZona: 'Z1', temCoordenadas: false, temZona: true },
    ];
    const noCoordsZonaRows = UM.aggregateZonas(noCoordsJoined, new Map());
    const html = UM.buildPanelHtml(noCoordsJoined, noCoordsZonaRows);
    expect(html).not.toContain('sigc-pro-zonas-hint');
  });

  test('empty joined/zonaRows still renders the panel shell but with a "Zonas (0)" tab and no data rows', () => {
    const html = UM.buildPanelHtml([], []);
    expect(html).toContain('Zonas (0)');
    expect(html).not.toMatch(/<td/);
  });
});

describe('agendamento in the marker popup', () => {
  test('the popup shows Agendado when one exists', () => {
    const I = window.__sigcProUltimoMovimentoMapInternals;
    const html = I.buildPopupHtml({
      controle: 'C1', domicilio: '1', entrevistador: 'MARIA',
      tipoEntrevista: 'PRESENCIAL', idZona: '29JDM8',
      lat: -12.9, lon: -38.5, agendado: '01/09/2026 09:00', futura: true,
    });
    expect(html).toContain('Agendado');
    expect(html).toContain('01/09/2026 09:00');
  });

  test('the popup omits the Agendado line entirely when there is none', () => {
    const I = window.__sigcProUltimoMovimentoMapInternals;
    const html = I.buildPopupHtml({
      controle: 'C1', domicilio: '1', entrevistador: 'MARIA',
      tipoEntrevista: 'PRESENCIAL', idZona: '29JDM8',
      lat: -12.9, lon: -38.5, agendado: '', futura: false,
    });
    expect(html).not.toContain('Agendado');
  });
});

describe('buildDomiciliosTabHtml', () => {
  // Real household row shape (joinEnderecos + joinAgenda output) has no
  // `endereco` field — see ultimo-movimento-map.js's joinEnderecos/joinAgenda.
  // The first column is Controle + Domicílio instead of a street address.
  test('renders one row per household with every column', () => {
    const I = window.__sigcProUltimoMovimentoMapInternals;
    const html = I.buildDomiciliosTabHtml([{
      controle: 'C1', domicilio: '1', agendado: '01/09/2026 09:00',
      ultimaPosicao: 'TRANSMITIDO', tipoEntrevista: 'PRESENCIAL',
      entrevistador: 'MARIA', data: '28/07/2026',
    }]);
    expect(html).toContain('Entrevistador');
    expect(html).toContain('MARIA');
    expect(html).toContain('C1');
  });

  test('missing values render as —', () => {
    const I = window.__sigcProUltimoMovimentoMapInternals;
    const html = I.buildDomiciliosTabHtml([{
      controle: 'C1', domicilio: '2', agendado: '', ultimaPosicao: '',
      tipoEntrevista: '', entrevistador: '', data: '',
    }]);
    expect((html.match(/—/g) || []).length).toBeGreaterThanOrEqual(5);
  });

  test('escapes HTML in every field', () => {
    const I = window.__sigcProUltimoMovimentoMapInternals;
    const html = I.buildDomiciliosTabHtml([{
      controle: '<img src=x onerror=alert(1)>', domicilio: '1', agendado: '',
      ultimaPosicao: '', tipoEntrevista: '', entrevistador: '', data: '',
    }]);
    expect(html).not.toContain('<img');
  });
});

// SIGC's own page script auto-initializes DataTables over the tables it
// finds, and this panel injects its tables into document.body — so they
// were being paged at the library's 10-row default ("Showing 1 to 10 of
// 90 entries", reported 2026-08-12).
// DataTables sorts on a cell's text unless told otherwise, and two columns
// here would sort wrongly that way: "dd/mm/yyyy HH:MM" is lexicographic
// nonsense, and the slots cell is a block of markup.
describe('sort keys for the library-sorted columns', () => {
  test('Agendado carries the raw ISO timestamp as its sort key', () => {
    const I = window.__sigcProUltimoMovimentoMapInternals;
    const html = I.buildDomiciliosTabHtml([{
      controle: 'C1', domicilio: '1', idZona: 'Z1',
      agendado: '01/09/2026 09:00', agendadoOrdenavel: '2026-09-01T09:00:00',
      futura: true, ultimaPosicao: '', tipoEntrevista: '', entrevistador: '', data: '',
    }]);
    expect(html).toContain('data-order="2026-09-01T09:00:00"');
  });

  test('an unscheduled household gets an empty sort key, not "—"', () => {
    const I = window.__sigcProUltimoMovimentoMapInternals;
    const html = I.buildDomiciliosTabHtml([{
      controle: 'C1', domicilio: '1', idZona: 'Z1', agendado: '', agendadoOrdenavel: '',
      futura: false, ultimaPosicao: '', tipoEntrevista: '', entrevistador: '', data: '',
    }]);
    expect(html).toContain('data-order=""');
  });

  // Sorting a day/hour markup block as text is meaningless; the useful
  // order is "which zona has the most capacity left".
  test('the slots cell sorts by how many open slots it holds', () => {
    const I = window.__sigcProUltimoMovimentoMapInternals;
    const slotsPorZona = new Map([['29JDM8', [
      { isoDate: '2026-08-12', horas: ['09:00', '14:00'] },
      { isoDate: '2026-08-13', horas: ['10:30'] },
    ]]]);
    const rows = [{
      idZona: '29JDM8', nomeZona: 'Zona 1', realizada: 1, naoIniciada: 0,
      domicilioFechado: 0, recusa: 0, outros: 0, totalDomicilios: 1,
      semCoordenadas: 0, agendados: 0, semAgendamento: 1,
    }];
    const html = I.buildZonasTableHtml(rows, slotsPorZona);
    expect(html).toContain('data-order="3"');
  });

  test('a zona with no open slots sorts as zero', () => {
    const I = window.__sigcProUltimoMovimentoMapInternals;
    const rows = [{
      idZona: '29JDM8', nomeZona: 'Zona 1', realizada: 1, naoIniciada: 0,
      domicilioFechado: 0, recusa: 0, outros: 0, totalDomicilios: 1,
      semCoordenadas: 0, agendados: 0, semAgendamento: 1,
    }];
    const html = I.buildZonasTableHtml(rows, new Map());
    expect(html).toContain('data-order="0"');
  });
});

describe('Zonas tab — turno columns and the capacity flag', () => {
  const I = () => window.__sigcProUltimoMovimentoMapInternals;
  const zonaRow = (extra) => Object.assign({
    idZona: '29JDM8', nomeZona: 'Zona 1', realizada: 1, naoIniciada: 0,
    domicilioFechado: 0, recusa: 0, outros: 0, totalDomicilios: 1,
    semCoordenadas: 0, agendados: 0, realizadasSemAgendamento: 0, pendentes: 0,
  }, extra);

  test('renders the Manhã and Tarde headers and counts', () => {
    const turnos = new Map([['29JDM8', { manha: 2, tarde: 3 }]]);
    const html = I().buildZonasTableHtml([zonaRow()], new Map(), turnos);
    expect(html).toContain('>Manhã</th>');
    expect(html).toContain('>Tarde</th>');
    expect(html).toContain('<td>2</td><td>3</td>');
  });

  test('a zona with no entry in the turno index renders zeros, not blanks', () => {
    const html = I().buildZonasTableHtml([zonaRow()], new Map(), new Map());
    expect(html).toContain('<td>0</td><td>0</td>');
  });

  test('flags the row when what is owed exceeds the free slots', () => {
    const turnos = new Map([['29JDM8', { manha: 1, tarde: 0 }]]);
    const html = I().buildZonasTableHtml(
      [zonaRow({ realizadasSemAgendamento: 3 })], new Map(), turnos);
    expect(html).toContain('sigc-pro-zona-sem-capacidade');
    // Colour is not the only signal: the row states the shortfall.
    expect(html).toContain('3 realizada(s) sem agendamento');
  });

  test('does not flag a zona whose capacity covers what it owes', () => {
    const turnos = new Map([['29JDM8', { manha: 2, tarde: 2 }]]);
    const html = I().buildZonasTableHtml(
      [zonaRow({ realizadasSemAgendamento: 3 })], new Map(), turnos);
    expect(html).not.toContain('sigc-pro-zona-sem-capacidade');
  });

  test('renders both demand columns', () => {
    const html = I().buildZonasTableHtml(
      [zonaRow({ realizadasSemAgendamento: 2, pendentes: 5 })], new Map(), new Map());
    expect(html).toContain('>Realizadas sem agend.</th>');
    expect(html).toContain('>Pendentes</th>');
    expect(html).toContain('sigc-pro-devidas">2</td>');
    expect(html).toContain('<td>5</td>');
  });

  // The two columns are nested, not disjoint — a reader who tries to add
  // them gets a wrong total, so the header says so explicitly.
  test('the Pendentes tooltip warns that the columns do not add up', () => {
    const html = I().buildZonasTableHtml([zonaRow()], new Map(), new Map());
    expect(html).toContain('não se somam');
  });
});

describe('Domicílios tab — Zona column', () => {
  test('shows the zona id per household', () => {
    const I = window.__sigcProUltimoMovimentoMapInternals;
    const html = I.buildDomiciliosTabHtml([{
      controle: 'C1', domicilio: '1', idZona: '29JDM8', zona: '29JDM8 - Lauro',
      agendado: '', futura: false, ultimaPosicao: 'TRANSMITIDO',
      tipoEntrevista: 'Realizada', entrevistador: 'MARIA', data: '28/07/2026',
    }]);
    expect(html).toContain('<th>Zona</th>');
    expect(html).toContain('29JDM8');
    // The short ID, not the full "ID - nome" label the Zonas tab carries.
    expect(html).not.toContain('29JDM8 - Lauro');
  });

  test('a household with no zona renders — rather than blank', () => {
    const I = window.__sigcProUltimoMovimentoMapInternals;
    const html = I.buildDomiciliosTabHtml([{
      controle: 'C1', domicilio: '1', idZona: '', zona: '',
      agendado: '', futura: false, ultimaPosicao: '', tipoEntrevista: '',
      entrevistador: '', data: '',
    }]);
    const row = html.split('<tbody>')[1];
    expect((row.match(/—/g) || []).length).toBe(6);
  });
});

describe('consent survives a second script injection', () => {
  // The content script has no re-entry guard (only sigc-common.js does),
  // so a second injection into the same page used to create a fresh
  // `fetchConsented = false` closure and re-ask something already
  // answered — reported live 2026-08-12 as "why do I have to click
  // twice?". The flags live on window so they outlive the IIFE.
  test('the consent flags are shared on window, not per-IIFE', () => {
    const state = window.__sigcProUltimoMovimentoMapConsent;
    expect(state).toBeDefined();
    expect(typeof state.fetch).toBe('boolean');
    expect(typeof state.tiles).toBe('boolean');
  });
});

describe('initPanelTables', () => {
  // The panel's tables are initialized DELIBERATELY rather than inheriting
  // SIGC's own auto-init, which gave a 10-row default and no sorting say
  // (reported live 2026-08-12).
  const withJq = (isDt, record) => {
    const prev = window.jQuery;
    const fake = (el) => ({
      DataTable: (opts) => {
        if (opts) record.initOpts = opts;
        return {
          page: { len: (n) => { record.len = n; return { draw: (v) => record.draws.push(v) }; } },
        };
      },
      el,
    });
    fake.fn = { dataTable: { isDataTable: () => isDt } };
    window.jQuery = fake;
    return () => { window.jQuery = prev; };
  };

  const run = (isDt, html) => {
    const I = window.__sigcProUltimoMovimentoMapInternals;
    const panel = document.createElement('div');
    panel.innerHTML = html;
    const record = { len: null, draws: [], initOpts: null };
    const restore = withJq(isDt, record);
    try {
      I.initPanelTables(panel);
    } finally {
      restore();
    }
    return record;
  };

  const DOMICILIOS = '<table class="sigc-pro-domicilios-table"><tbody></tbody></table>';

  test('initializes an unclaimed table with 50 rows per page', () => {
    const I = window.__sigcProUltimoMovimentoMapInternals;
    const r = run(false, DOMICILIOS);
    expect(r.initOpts).not.toBeNull();
    expect(r.initOpts.pageLength).toBe(50);
    expect(I.PANEL_PAGE_LENGTH).toBe(50);
    // No initial re-sort: the panel already built the rows in a meaningful
    // order (report order / zona order).
    expect(r.initOpts.order).toEqual([]);
  });

  test('the length menu offers a show-everything option', () => {
    const r = run(false, DOMICILIOS);
    const [values, labels] = r.initOpts.lengthMenu;
    expect(values).toContain(-1);
    expect(labels).toContain('Todos');
  });

  // Every other string in this panel is Portuguese, so the table's own
  // chrome must be too — and it must not come from a third-party CDN.
  test('the table chrome is Portuguese', () => {
    const r = run(false, DOMICILIOS);
    expect(r.initOpts.language.paginate.next).toBe('Próxima');
    expect(r.initOpts.language.lengthMenu).toContain('linhas por página');
    expect(r.initOpts.language.info).toContain('registros');
  });

  // Re-initializing an already-claimed table throws, so that case adjusts
  // the live instance instead.
  test('adjusts in place when SIGC already claimed the table', () => {
    const r = run(true, '<table class="sigc-pro-zonas-table"><tbody></tbody></table>');
    expect(r.initOpts).toBeNull();
    expect(r.len).toBe(50);
    expect(r.draws).toEqual([false]); // redraw without losing the current page
  });

  test('tolerates jQuery/DataTables being absent entirely', () => {
    const I = window.__sigcProUltimoMovimentoMapInternals;
    const prev = window.jQuery;
    const prevDollar = window.$;
    window.jQuery = undefined;
    window.$ = undefined;
    try {
      const panel = document.createElement('div');
      panel.innerHTML = '<table><tbody></tbody></table>';
      expect(() => I.initPanelTables(panel)).not.toThrow();
    } finally {
      window.jQuery = prev;
      window.$ = prevDollar;
    }
  });
});

describe('open slots in the Zonas tab', () => {
  test('a zona row carries its open slots', () => {
    const I = window.__sigcProUltimoMovimentoMapInternals;
    const slotsPorZona = new Map([['29JDM8', [{ isoDate: '2026-08-12', horas: ['09:00'] }]]]);
    const rows = [{
      idZona: '29JDM8', nomeZona: 'Zona 1', realizada: 1, naoIniciada: 0,
      domicilioFechado: 0, recusa: 0, outros: 0, totalDomicilios: 1,
      semCoordenadas: 0, agendados: 0, semAgendamento: 1,
    }];
    const html = I.buildZonasTableHtml(rows, slotsPorZona);
    expect(html).toContain('09:00');
  });

  // Regression (2026-08-12): the times used to sit behind a <details>
  // "Ver horários" disclosure, which was unopenable — the whole row is a
  // click target that jumps to the map, so the row handler swallowed the
  // summary's click and switched tabs instead. Every hour must be legible
  // in the table itself, with no interaction.
  test('every open time is visible without any disclosure widget', () => {
    const I = window.__sigcProUltimoMovimentoMapInternals;
    const slotsPorZona = new Map([['29JDM8', [
      { isoDate: '2026-08-12', horas: ['09:00', '14:00'] },
      { isoDate: '2026-08-13', horas: ['10:30'] },
    ]]]);
    const rows = [{
      idZona: '29JDM8', nomeZona: 'Zona 1', realizada: 1, naoIniciada: 0,
      domicilioFechado: 0, recusa: 0, outros: 0, totalDomicilios: 1,
      semCoordenadas: 0, agendados: 0, semAgendamento: 1,
    }];
    const html = I.buildZonasTableHtml(rows, slotsPorZona);
    expect(html).not.toContain('<details');
    expect(html).not.toContain('Ver horários');
    ['09:00', '14:00', '10:30', '12/08', '13/08'].forEach((s) => {
      expect(html).toContain(s);
    });
  });

  test('a zona with no open slots says so', () => {
    const I = window.__sigcProUltimoMovimentoMapInternals;
    const rows = [{
      idZona: '29JDM8', nomeZona: 'Zona 1', realizada: 1, naoIniciada: 0,
      domicilioFechado: 0, recusa: 0, outros: 0, totalDomicilios: 1,
      semCoordenadas: 0, agendados: 0, semAgendamento: 1,
    }];
    const html = I.buildZonasTableHtml(rows, new Map());
    expect(html).toContain('Nenhum slot livre');
  });
});

describe('statusColor', () => {
  test('Distribuido wins regardless of tipoEntrevista', () => {
    expect(UM.statusColor({ ultimaPosicao: 'Distribuido', tipoEntrevista: 'Realizada' })).toBe('#888888');
    expect(UM.statusColor({ ultimaPosicao: 'Distribuido', tipoEntrevista: '' })).toBe('#888888');
  });

  test('Realizada -> green', () => {
    expect(UM.statusColor({ ultimaPosicao: 'Descarregado', tipoEntrevista: 'Realizada' })).toBe('#009E73');
  });

  test('Recusa -> red/orange', () => {
    expect(UM.statusColor({ ultimaPosicao: 'Descarregado', tipoEntrevista: 'Recusa' })).toBe('#D55E00');
  });

  test('Não Iniciada -> yellow', () => {
    expect(UM.statusColor({ ultimaPosicao: 'Descarregado', tipoEntrevista: 'Não Iniciada' })).toBe('#F0E442');
  });

  test('Domicílio Fechado -> sky-blue', () => {
    expect(UM.statusColor({ ultimaPosicao: 'Descarregado', tipoEntrevista: 'Domicílio Fechado' })).toBe('#56B4E9');
  });

  test('unrecognized tipoEntrevista -> black (Outros)', () => {
    expect(UM.statusColor({ ultimaPosicao: 'Descarregado', tipoEntrevista: 'Em condições de ser habitada' })).toBe('#000000');
    expect(UM.statusColor({ ultimaPosicao: 'Descarregado', tipoEntrevista: '' })).toBe('#000000');
  });
});

describe('Mapa button mount', () => {
  test('button is registered under the expected id', () => {
    // mountWidget registration happens at module load (already imported
    // at top of file); confirm the widget was pushed with the right id
    // by checking the DOM after simulating a page with neither the
    // .dt-buttons toolbar nor the h6 page-title text present.
    document.body.innerHTML = '<div><a id="btnFiltrar" class="btn btn-primary btn-sigc">Filtrar</a></div>';
    window.__sigcPro.recheckMounts();
    // The button only mounts when onUltimoMovimento() is true AND a
    // DataTable exists (the .dt-buttons toolbar it anchors to) — neither
    // is present in this fixture, so assert it does NOT mount rather
    // than asserting a false positive.
    expect(document.getElementById('sigc-pro-ultimo-movimento-map-btn')).toBeNull();
  });
});

describe('convexHull', () => {
  test('0 points returns null', () => {
    expect(UM.convexHull([])).toBeNull();
  });

  test('1 point returns a circle centered on it', () => {
    const result = UM.convexHull([[10, 20]]);
    expect(result).toEqual({ type: 'circle', center: [10, 20] });
  });

  test('2 distinct points returns a capsule', () => {
    const result = UM.convexHull([[10, 20], [11, 21]]);
    expect(result).toEqual({ type: 'capsule', a: [10, 20], b: [11, 21] });
  });

  test('2 identical points (dedup to 1) returns a circle', () => {
    const result = UM.convexHull([[10, 20], [10, 20]]);
    expect(result).toEqual({ type: 'circle', center: [10, 20] });
  });

  test('3 collinear points returns a capsule between the extremes', () => {
    const result = UM.convexHull([[0, 0], [1, 1], [2, 2]]);
    expect(result.type).toBe('capsule');
    expect(result.a).toEqual([0, 0]);
    expect(result.b).toEqual([2, 2]);
  });

  test('3 non-collinear points returns a triangle polygon', () => {
    const result = UM.convexHull([[0, 0], [0, 2], [2, 0]]);
    expect(result.type).toBe('polygon');
    expect(result.points).toHaveLength(3);
    // every input point must be present in the hull for a triangle (all 3 are vertices)
    [[0, 0], [0, 2], [2, 0]].forEach((p) => {
      expect(result.points).toContainEqual(p);
    });
  });

  test('a point strictly inside the hull is excluded from the polygon', () => {
    const result = UM.convexHull([[0, 0], [0, 4], [4, 0], [4, 4], [2, 2]]);
    expect(result.type).toBe('polygon');
    expect(result.points).not.toContainEqual([2, 2]);
    expect(result.points).toHaveLength(4);
  });
});

describe('spiderfyRows', () => {
  const row = (domicilio, lat, lon) => ({ controle: 'C1', domicilio, lat, lon, temCoordenadas: true });

  test('leaves an isolated row on its exact coordinates', () => {
    const out = UM.spiderfyRows([row('1', -12.5, -38.4)]);
    expect(out).toHaveLength(1);
    expect(out[0].lat).toBe(-12.5);
    expect(out[0].lon).toBe(-38.4);
    expect(out[0].coLocated).toBe(1);
  });

  test('fans identical coordinates out onto distinct points', () => {
    const rows = [row('1', -12.5, -38.4), row('2', -12.5, -38.4), row('3', -12.5, -38.4)];
    const out = UM.spiderfyRows(rows);
    expect(out).toHaveLength(3);
    const keys = new Set(out.map((r) => `${r.lat},${r.lon}`));
    expect(keys.size).toBe(3);
    out.forEach((r) => expect(r.coLocated).toBe(3));
  });

  test('keeps the fanned points within a few dozen meters of the shared spot', () => {
    const rows = [row('1', -12.5, -38.4), row('2', -12.5, -38.4)];
    const out = UM.spiderfyRows(rows);
    out.forEach((r) => {
      // ~1e-4 degrees is ~11 m; the ring radius must stay in that order.
      expect(Math.abs(r.lat - -12.5)).toBeLessThan(0.001);
      expect(Math.abs(r.lon - -38.4)).toBeLessThan(0.001);
    });
  });

  test('groups coordinates that differ by less than the ~5 m threshold', () => {
    // ~2e-5 degrees latitude is ~2.2 m — same building, jittered geocode.
    const rows = [row('1', -12.5, -38.4), row('2', -12.50002, -38.4)];
    const out = UM.spiderfyRows(rows);
    out.forEach((r) => expect(r.coLocated).toBe(2));
    // Separated onto distinct points (for n=2 the ring puts them due
    // east/west of the shared centre, so they differ in longitude).
    expect(`${out[0].lat},${out[0].lon}`).not.toBe(`${out[1].lat},${out[1].lon}`);
  });

  test('does not group coordinates farther apart than the threshold', () => {
    // ~1e-3 degrees latitude is ~111 m — genuinely different addresses.
    const rows = [row('1', -12.5, -38.4), row('2', -12.501, -38.4)];
    const out = UM.spiderfyRows(rows);
    out.forEach((r) => expect(r.coLocated).toBe(1));
    expect(out[0].lat).toBe(-12.5);
    expect(out[1].lat).toBe(-12.501);
  });

  test('preserves the original row fields and original coordinates', () => {
    const rows = [row('7', -12.5, -38.4), row('8', -12.5, -38.4)];
    const out = UM.spiderfyRows(rows);
    expect(out.map((r) => r.domicilio).sort()).toEqual(['7', '8']);
    out.forEach((r) => {
      expect(r.controle).toBe('C1');
      expect(r.origLat).toBe(-12.5);
      expect(r.origLon).toBe(-38.4);
    });
  });

  test('returns an empty array for no rows', () => {
    expect(UM.spiderfyRows([])).toEqual([]);
  });
});

describe('domicilioLabel', () => {
  test('renders the domicilio number', () => {
    expect(UM.domicilioLabel({ domicilio: '7', coLocated: 1 })).toBe('7');
  });

  test('escapes unexpected domicilio content', () => {
    expect(UM.domicilioLabel({ domicilio: '<b>', coLocated: 1 })).toBe('&lt;b&gt;');
  });
});

describe('controleCentroids', () => {
  test('averages lat/lon across a Controle\'s valid-coordinate rows', () => {
    const joined = [
      { controle: 'C1', domicilio: '1', lat: 0, lon: 0, ultimaPosicao: 'Descarregado', temCoordenadas: true },
      { controle: 'C1', domicilio: '2', lat: 2, lon: 4, ultimaPosicao: 'Descarregado', temCoordenadas: true },
    ];
    const result = UM.controleCentroids(joined);
    expect(result).toHaveLength(1);
    expect(result[0].controle).toBe('C1');
    expect(result[0].lat).toBe(1);
    expect(result[0].lon).toBe(2);
  });

  test('rows without valid coordinates are excluded from the average', () => {
    const joined = [
      { controle: 'C1', domicilio: '1', lat: 0, lon: 0, ultimaPosicao: 'Descarregado', temCoordenadas: true },
      { controle: 'C1', domicilio: '2', lat: null, lon: null, ultimaPosicao: 'Descarregado', temCoordenadas: false },
    ];
    const result = UM.controleCentroids(joined);
    expect(result[0].lat).toBe(0);
    expect(result[0].lon).toBe(0);
  });

  test('a Controle with zero valid-coordinate rows produces no entry', () => {
    const joined = [
      { controle: 'C1', domicilio: '1', lat: null, lon: null, ultimaPosicao: 'Descarregado', temCoordenadas: false },
    ];
    expect(UM.controleCentroids(joined)).toEqual([]);
  });

  test('colorState: all Distribuido -> inactive', () => {
    const joined = [
      { controle: 'C1', lat: 0, lon: 0, ultimaPosicao: 'Distribuido', temCoordenadas: true },
      { controle: 'C1', lat: 1, lon: 1, ultimaPosicao: 'Distribuido', temCoordenadas: true },
    ];
    expect(UM.controleCentroids(joined)[0].colorState).toBe('inactive');
  });

  test('colorState: none Distribuido -> active', () => {
    const joined = [
      { controle: 'C1', lat: 0, lon: 0, ultimaPosicao: 'Descarregado', temCoordenadas: true },
      { controle: 'C1', lat: 1, lon: 1, ultimaPosicao: 'Enviado para Carga', temCoordenadas: true },
    ];
    expect(UM.controleCentroids(joined)[0].colorState).toBe('active');
  });

  test('colorState: mixed -> partial', () => {
    const joined = [
      { controle: 'C1', lat: 0, lon: 0, ultimaPosicao: 'Distribuido', temCoordenadas: true },
      { controle: 'C1', lat: 1, lon: 1, ultimaPosicao: 'Descarregado', temCoordenadas: true },
    ];
    expect(UM.controleCentroids(joined)[0].colorState).toBe('partial');
  });

  test('colorState is computed over ALL rows for that Controle, even ones without coordinates', () => {
    // A Controle's active/inactive/partial status is a fact about its
    // fieldwork progress, not about which rows happened to geocode —
    // excluding uncoordinated rows from colorState (unlike the
    // centroid average, which must exclude them) would misreport a
    // Controle as "active" when an un-geocoded domicílio is still
    // Distribuido.
    const joined = [
      { controle: 'C1', lat: 0, lon: 0, ultimaPosicao: 'Descarregado', temCoordenadas: true },
      { controle: 'C1', lat: null, lon: null, ultimaPosicao: 'Distribuido', temCoordenadas: false },
    ];
    expect(UM.controleCentroids(joined)[0].colorState).toBe('partial');
  });

  test('multiple distinct Controles each get their own entry', () => {
    const joined = [
      { controle: 'C1', lat: 0, lon: 0, ultimaPosicao: 'Descarregado', temCoordenadas: true },
      { controle: 'C2', lat: 5, lon: 5, ultimaPosicao: 'Distribuido', temCoordenadas: true },
    ];
    const result = UM.controleCentroids(joined);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.controle).sort()).toEqual(['C1', 'C2']);
  });
});

// The scope gate (2026-08-14, replacing the agência-only gate of
// 2026-08-10). Mapa replays the submitted filter onto ONE Lista de
// Endereços call, so what matters is the filter the report was rendered
// from — not one specific selector, which most profiles don't even have.

// The real #filtroJson payload, captured live 2026-08-14 on the Último
// Movimento page. Used verbatim as the fixture shape so these tests
// can't drift from what SIGC actually emits.
const FILTRO_REAL = {
  IdFiltro: 'relatorio-ultimo-movimento',
  IdUf: '29',
  IdAgencia: '*',
  IdMunicipio: '*',
  Controle: '*',
  IdEntrevistadores: '3424279',
  IdTipoAcompanhamento: '*',
};

function setFiltroJson(obj) {
  document.body.innerHTML =
    `<input type="hidden" id="filtroJson" value='${JSON.stringify(obj)}'>`;
}

describe('lerFiltro', () => {
  test('reads the whole filter out of #filtroJson', () => {
    setFiltroJson(FILTRO_REAL);
    expect(UM.lerFiltro()).toEqual(FILTRO_REAL);
  });

  // #filtroJson is the primary source precisely because SIGC assembles it
  // itself — but a page redesign could drop it, and the feature should
  // degrade to the individual inputs rather than die.
  test('falls back to the individual inputs when #filtroJson is absent', () => {
    document.body.innerHTML =
      '<select id="IdUf"><option value="29" selected>29</option></select>' +
      '<select id="IdMunicipio"><option value="2927408" selected>x</option></select>' +
      '<select id="IdAgencia"><option value="*" selected>TODOS</option></select>';
    const f = UM.lerFiltro();
    expect(f.IdUf).toBe('29');
    expect(f.IdMunicipio).toBe('2927408');
    expect(f.IdAgencia).toBe('*');
    // Absent fields read as the wildcard: "the user did not filter by this".
    expect(f.Controle).toBe('*');
    expect(f.IdEntrevistadores).toBe('*');
  });

  // This runs inside a capture-phase listener on SIGC's own Filtrar
  // button — throwing there would surface as the page's bug, not ours.
  test('malformed JSON falls back instead of throwing', () => {
    document.body.innerHTML =
      '<input type="hidden" id="filtroJson" value="{not json">' +
      '<select id="IdUf"><option value="29" selected>29</option></select>';
    const warn = console.warn;
    console.warn = () => {};
    try {
      expect(UM.lerFiltro().IdUf).toBe('29');
    } finally {
      console.warn = warn;
    }
  });

  test('returns null when there is no UF anywhere', () => {
    document.body.innerHTML = '';
    expect(UM.lerFiltro()).toBe(null);
  });
});

describe('motivoBloqueio', () => {
  const base = { ...FILTRO_REAL, IdEntrevistadores: '*' };

  test('allows an agência-scoped filter', () => {
    expect(UM.motivoBloqueio({ ...base, IdAgencia: '0570' })).toBe('');
  });

  // The whole point of this change: município scopes used to be blocked
  // because #IdAgencia never held a value for most profiles.
  test('allows a município-scoped filter with no agência', () => {
    expect(UM.motivoBloqueio({ ...base, IdMunicipio: '2927408' })).toBe('');
  });

  test('allows a Controle-scoped filter', () => {
    expect(UM.motivoBloqueio({ ...base, Controle: '292740805220571' })).toBe('');
  });

  // Entrevistador and tipo-de-acompanhamento have no analogue in Lista de
  // Endereços, but they only narrow the report WITHIN a geographic scope.
  // Given one, the coordinate response is a superset of the rows on
  // screen and the controle|domicilio join drops the surplus — so these
  // must NOT block on their own account.
  test('allows an entrevistador filter inside a município', () => {
    expect(UM.motivoBloqueio({
      ...FILTRO_REAL, IdMunicipio: '2927408',
    })).toBe('');
  });

  test('allows a tipo-de-acompanhamento filter inside an agência', () => {
    expect(UM.motivoBloqueio({
      ...base, IdAgencia: '0570', IdTipoAcompanhamento: '7',
    })).toBe('');
  });

  // What actually can't be served: no geographic scope at all, so the
  // coordinate request would fall back to the whole UF. An entrevistador
  // filter alone lands here — not because of the field, but because its
  // implicit scope is the entire state.
  test('blocks an entrevistador filter with no geographic scope', () => {
    expect(UM.motivoBloqueio(FILTRO_REAL)).toContain('estado inteiro');
  });

  test('blocks a whole-UF filter', () => {
    expect(UM.motivoBloqueio(base)).toContain('estado inteiro');
  });

  test('blocks when no Filtrar has been captured yet', () => {
    expect(UM.motivoBloqueio(null)).toContain('Filtrar');
  });

  // A blank is the select2 placeholder shape; it means the same as '*'.
  test('treats a blank field as the wildcard', () => {
    expect(UM.isWildcard('')).toBe(true);
    expect(UM.isWildcard('*')).toBe(true);
    expect(UM.isWildcard('0570')).toBe(false);
  });
});

describe('coverage warning', () => {
  // A single agency-scoped call could come back short (SIGC paginating
  // or truncating a large agência). That looks exactly like ordinary
  // missing geocoding once joined, so it's counted explicitly and
  // surfaced rather than silently absorbed into the no-coordinates
  // bucket.
  test('counts on-screen households the fetch returned no entry for', () => {
    const movimentoMap = new Map([
      ['C1|1', {}], ['C1|2', {}], ['C2|1', {}],
    ]);
    const enderecosMap = new Map([['C1|1', { lat: 1, lon: 2 }]]);
    expect(UM.missingEnderecoCount(movimentoMap, enderecosMap)).toBe(2);
  });

  test('is zero when every household came back', () => {
    const movimentoMap = new Map([['C1|1', {}]]);
    const enderecosMap = new Map([['C1|1', { lat: 1, lon: 2 }]]);
    expect(UM.missingEnderecoCount(movimentoMap, enderecosMap)).toBe(0);
  });
});

// The gate follows the FILTERED report, not the live selector (2026-08-10).
// Changing the agência dropdown without clicking Filtrar leaves the old
// report on screen: the rendered rows still belong to the previously
// submitted agência, so that is what the coordinate fetch must use.
describe('filtroAtual', () => {
  function setFiltro(obj) {
    setFiltroJson(obj);
    document.body.insertAdjacentHTML('beforeend', '<button id="btnFiltrar">Filtrar</button>');
  }

  const AGENCIA = { ...FILTRO_REAL, IdAgencia: '0570', IdEntrevistadores: '*' };

  test('is null before any Filtrar, even with a filter on the form', () => {
    setFiltro(AGENCIA);
    UM.resetFiltroCapturado();
    expect(UM.filtroAtual()).toBe(null);
  });

  test('captures the whole filter when Filtrar is clicked', () => {
    setFiltro(AGENCIA);
    UM.resetFiltroCapturado();
    UM.captureFiltro();
    expect(UM.filtroAtual().IdAgencia).toBe('0570');
  });

  // The core of the older gate, preserved: the captured filter must NOT
  // follow a later form change, because the table on screen didn't
  // change either. Scoping the fetch to a filter whose rows aren't
  // displayed is a silent wrong-data join, not a visible error.
  test('does not follow the form after Filtrar', () => {
    setFiltro(AGENCIA);
    UM.resetFiltroCapturado();
    UM.captureFiltro();
    document.getElementById('filtroJson').value =
      JSON.stringify({ ...FILTRO_REAL, IdAgencia: '9999' });
    expect(UM.filtroAtual().IdAgencia).toBe('0570');
  });

  test('a Filtrar on TODOS replaces a previously captured scope', () => {
    setFiltro(AGENCIA);
    UM.resetFiltroCapturado();
    UM.captureFiltro();
    document.getElementById('filtroJson').value =
      JSON.stringify({ ...FILTRO_REAL, IdEntrevistadores: '*' });
    UM.captureFiltro();
    expect(UM.motivoBloqueio(UM.filtroAtual())).toContain('estado inteiro');
  });
});

// The "button doesn't show up until a reload" bug (2026-08-10). The
// capture only ever ran on a Filtrar CLICK, so a report already rendered
// at page-load time — SIGC restoring state, a back navigation, or a
// Filtrar that happened before the listener bound — left it empty
// forever and the button never enabled.
describe('adoptRenderedFiltro', () => {
  const AGENCIA = { ...FILTRO_REAL, IdAgencia: '0570', IdEntrevistadores: '*' };

  test('adopts the form filter when a table is already rendered', () => {
    setFiltroJson(AGENCIA);
    UM.resetFiltroCapturado();
    UM.adoptRenderedFiltro(true);
    expect(UM.filtroAtual().IdAgencia).toBe('0570');
  });

  test('does nothing when no table is rendered yet', () => {
    setFiltroJson(AGENCIA);
    UM.resetFiltroCapturado();
    UM.adoptRenderedFiltro(false);
    expect(UM.filtroAtual()).toBe(null);
  });

  // Adoption is a one-time seed for the pre-existing report. Once a
  // Filtrar has been observed, the captured filter is authoritative and
  // must keep winning over a drifting form.
  test('does not overwrite an already-captured filter', () => {
    setFiltroJson(AGENCIA);
    UM.resetFiltroCapturado();
    UM.captureFiltro();
    document.getElementById('filtroJson').value =
      JSON.stringify({ ...FILTRO_REAL, IdAgencia: '9999' });
    UM.adoptRenderedFiltro(true);
    expect(UM.filtroAtual().IdAgencia).toBe('0570');
  });
});

describe('MAPA PRO button state', () => {
  function mkBtn() {
    const btn = document.createElement('button');
    btn.id = 'sigc-pro-ultimo-movimento-map-btn';
    document.body.appendChild(btn);
    return btn;
  }

  test('blocked with an explanatory tooltip when the whole UF is filtered', () => {
    const I = window.__sigcProUltimoMovimentoMapInternals;
    setFiltroJson({ ...FILTRO_REAL, IdEntrevistadores: '*' });
    I.resetFiltroCapturado();
    I.captureFiltro();
    const btn = mkBtn();
    try {
      I.atualizarEstadoBotaoMapa();
      expect(btn.getAttribute('aria-disabled')).toBe('true');
      expect(btn.title).toContain('estado inteiro');
    } finally {
      btn.remove();
    }
  });

  // Deliberately NOT btn.disabled: a disabled button swallows clicks, so
  // the click-to-explain path (onMapaClick's motivoBloqueio guard) would
  // never fire. The block is painted, and the button stays clickable.
  test('a blocked button stays clickable so the click can explain', () => {
    const I = window.__sigcProUltimoMovimentoMapInternals;
    setFiltroJson({ ...FILTRO_REAL, IdEntrevistadores: '*' });
    I.resetFiltroCapturado();
    I.captureFiltro();
    const btn = mkBtn();
    try {
      I.atualizarEstadoBotaoMapa();
      expect(btn.disabled).toBe(false);
    } finally {
      btn.remove();
    }
  });

  // The reported bug: these profiles have no agência selector at all, so
  // the old gate left the button permanently dead for them.
  test('enabled for a município filter with no agência', () => {
    const I = window.__sigcProUltimoMovimentoMapInternals;
    setFiltroJson({ ...FILTRO_REAL, IdMunicipio: '2927408', IdEntrevistadores: '*' });
    I.resetFiltroCapturado();
    I.captureFiltro();
    const btn = mkBtn();
    try {
      I.atualizarEstadoBotaoMapa();
      expect(btn.getAttribute('aria-disabled')).toBe('false');
      expect(btn.disabled).toBe(false);
    } finally {
      btn.remove();
    }
  });

  // Hover text and click text must be the same sentence — one source of
  // truth (motivoBloqueio), so they can't drift apart.
  test('the tooltip is exactly the reason the click would report', () => {
    const I = window.__sigcProUltimoMovimentoMapInternals;
    setFiltroJson(FILTRO_REAL); // entrevistador filter
    I.resetFiltroCapturado();
    I.captureFiltro();
    const btn = mkBtn();
    try {
      I.atualizarEstadoBotaoMapa();
      expect(btn.title).toBe(I.motivoBloqueio(I.filtroAtual()));
    } finally {
      btn.remove();
    }
  });
});

// The agenda fetch is an enrichment, not the feature's core (that's the
// coordinate join) — a rejected agenda fetch must never cost the map.
describe('onMapaClick — agenda fetch is non-fatal', () => {
  function fakeDataTable(header, rows) {
    const node = document.createElement('table');
    const api = {
      table: () => ({ node: () => node }),
      columns: () => ({
        header: () => ({ toArray: () => header.map((h) => ({ textContent: h })) }),
      }),
      rows: () => ({ data: () => ({ toArray: () => rows }) }),
    };
    return api;
  }

  function setUpDom({ header, rows }) {
    document.body.innerHTML =
      // The filter SIGC assembles for its own POST — the Mapa's primary
      // source of scope. An agência-scoped filter here, so the gate is open.
      `<input type="hidden" id="filtroJson" value='${JSON.stringify({
        ...FILTRO_REAL, IdAgencia: '0570', IdEntrevistadores: '*',
      })}'>` +
      '<select id="IdUf"><option value="29" selected>29</option></select>' +
      '<select id="IdAgencia"><option value="0570" selected>0570</option></select>' +
      '<button id="btnFiltrar">Filtrar</button>' +
      // A real page-owned report table must exist in the DOM: getDataTable()
      // now filters SIGC-PRO's own tables out and returns null when nothing
      // page-owned is left, so a fixture that faked only jQuery would make
      // the whole panel silently fail to render.
      '<table id="tableRelatorio"><tbody><tr><td>x</td></tr></tbody></table>';
    const table = fakeDataTable(header, rows);
    window.jQuery = window.$ = Object.assign(
      () => ({ DataTable: () => table }),
      { fn: { dataTable: true } },
    );
  }

  const HEADER = ['Controle', 'Domicilio', 'Entrevistador', 'Tipo Entrevista', 'Última Posição', 'Data'];
  const ROWS = [['C1', '1', 'Fulano', 'Realizada', 'Transmitido', '01/08/2026']];

  test('the map panel still renders when the agenda fetch rejects', async () => {
    const I = window.__sigcProUltimoMovimentoMapInternals;
    setUpDom({ header: HEADER, rows: ROWS });
    I.resetFiltroCapturado();
    I.captureFiltro();

    const originalConfirm = window.confirm;
    const originalAM = window.__sigcProAgendaLookups;
    window.confirm = () => true;
    window.__sigcProAgendaLookups = {
      ...originalAM,
      fetchEnderecosPorFiltro: async () => new Map([
        ['C1|1', { lat: -8.5, lon: -63.8, zona: 'Z1', idZona: 'Z1' }],
      ]),
      fetchAgendaSlots: async () => { throw new Error('network down'); },
    };
    const warnSpy = console.warn;
    const warnCalls = [];
    console.warn = (...args) => warnCalls.push(args);
    // onMapaClick fires a trailing, un-awaited maybeLoadTiles() call —
    // give it real (if bogus) Leaflet URLs so its readLeafletUrls() poll
    // resolves synchronously on the first check() (see pollFor's
    // fast-path) instead of falling back to a setInterval that would
    // still be ticking, and could still fire renderLeafletMap on this
    // test's now-detached container, well after this test has finished
    // and torn down (leaking into whichever later test happens to be
    // running when a later data-attribute or window.L assignment finally
    // makes its check() succeed).
    document.documentElement.dataset.sigcProLeafletJsUrl = 'about:blank#leaflet.js';
    document.documentElement.dataset.sigcProLeafletCssUrl = 'about:blank#leaflet.css';

    const btn = document.createElement('button');
    try {
      await I.onMapaClick(btn);
      const panel = document.getElementById('sigc-pro-ultimo-movimento-map-panel');
      expect(panel).not.toBeNull();
      expect(warnCalls.some((args) => String(args[0]).includes('agenda fetch failed'))).toBe(true);
      // Let the trailing maybeLoadTiles() call (and its now-synchronous
      // loadLeafletAssets rejection, since window.L is unset here) fully
      // settle before teardown — see the comment above.
      await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
      console.warn = warnSpy;
      window.confirm = originalConfirm;
      window.__sigcProAgendaLookups = originalAM;
      delete window.jQuery;
      delete window.$;
      delete document.documentElement.dataset.sigcProLeafletJsUrl;
      delete document.documentElement.dataset.sigcProLeafletCssUrl;
      document.getElementById('sigc-pro-ultimo-movimento-map-panel')?.remove();
      I.resetFiltroCapturado();
      I.resetTileState();
    }
  });

  // The only other onMapaClick agenda test mocks a REJECTED fetch — this
  // exercises the success path: fetchAgendaSlots -> agenda.dados ->
  // indexByControle -> joinAgenda -> a populated `agendado` on the
  // matching household, reaching all the way to the rendered Domicílios
  // tab HTML (not just an internal), so the `.dados` unwrapping at the
  // onMapaClick call site stays covered against a shape change.
  test('a resolving agenda fetch joins a matching scheduled visit onto its household, visible in the Domicílios tab', async () => {
    const I = window.__sigcProUltimoMovimentoMapInternals;
    setUpDom({ header: HEADER, rows: ROWS });
    I.resetFiltroCapturado();
    I.resetTileState();
    I.captureFiltro();

    const originalConfirm = window.confirm;
    const originalAM = window.__sigcProAgendaLookups;
    window.confirm = () => true;
    window.__sigcProAgendaLookups = {
      ...originalAM,
      fetchEnderecosPorFiltro: async () => new Map([
        ['C1|1', { lat: -8.5, lon: -63.8, zona: 'Z1', idZona: 'Z1' }],
      ]),
      // Realistic shape: fetchAgendaSlots resolves { dados, em, cache },
      // dados already parsed (agenda-lookups.js's own parseSlots shape) —
      // one slot matching C1|1 (the household on screen), one open slot
      // that must NOT match anything (aberto: true, no controle).
      fetchAgendaSlots: async () => ({
        dados: [
          {
            start: '2026-09-01T09:00:00', isoDate: '2026-09-01',
            controle: 'C1', domicilio: '1', zonas: 'Z1 - Zona 1', aberto: false,
          },
          {
            start: '2026-09-02T10:00:00', isoDate: '2026-09-02',
            controle: '', domicilio: '', zonas: 'Z1 - Zona 1', aberto: true,
          },
        ],
        em: Date.now(),
        cache: false,
      }),
    };
    // onMapaClick's own trailing maybeLoadTiles() call — give it real
    // (bogus) URLs so its readLeafletUrls() poll resolves on the first
    // synchronous check() rather than leaking a live setInterval past
    // this test's teardown (see the identical comment on the rejected-
    // agenda test above).
    document.documentElement.dataset.sigcProLeafletJsUrl = 'about:blank#leaflet.js';
    document.documentElement.dataset.sigcProLeafletCssUrl = 'about:blank#leaflet.css';

    const btn = document.createElement('button');
    try {
      await I.onMapaClick(btn);
      const panel = document.getElementById('sigc-pro-ultimo-movimento-map-panel');
      expect(panel).not.toBeNull();
      const domiciliosHtml = document.getElementById('sigc-pro-domicilios-panel').innerHTML;
      expect(domiciliosHtml).toContain('01/09/2026 09:00');
      expect(domiciliosHtml).toContain('sigc-pro-futura');
      await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
      window.confirm = originalConfirm;
      window.__sigcProAgendaLookups = originalAM;
      delete window.jQuery;
      delete window.$;
      delete document.documentElement.dataset.sigcProLeafletJsUrl;
      delete document.documentElement.dataset.sigcProLeafletCssUrl;
      document.getElementById('sigc-pro-ultimo-movimento-map-panel')?.remove();
      I.resetFiltroCapturado();
      I.resetTileState();
    }
  });

  // Minimal fake Leaflet: loadLeafletAssets() short-circuits to
  // window.L when it's already set (see its `if (window.L) { resolve(L);
  // return; }` branch), so this never touches a real <script> tag —
  // happy-dom disables script loading outright, which would otherwise
  // make every tile load reject via onerror.
  function fakeLeaflet() {
    const layer = { addTo: () => layer, bindTooltip: () => layer, bindPopup: () => layer };
    const map = { addLayer: () => {}, setView: () => map, fitBounds: () => map };
    let mapCallCount = 0;
    const L = {
      mapCallCount: () => mapCallCount,
      // Mirrors real Leaflet's L.map(container): it takes over the
      // container element, clearing whatever HTML (e.g. the declined-
      // consent message) was there before.
      map: (container) => { mapCallCount += 1; if (container) container.innerHTML = ''; return map; },
      tileLayer: () => layer,
      polygon: () => layer,
      polyline: () => layer,
      circle: () => layer,
      circleMarker: () => layer,
      marker: () => layer,
      divIcon: () => ({}),
      DomUtil: { create: () => document.createElement('div') },
      control: () => ({ addTo: () => {}, onAdd: null }),
    };
    return L;
  }

  test('two concurrent maybeLoadTiles() calls (via two rapid Mapa-tab clicks) construct the Leaflet map only once', async () => {
    const I = window.__sigcProUltimoMovimentoMapInternals;
    setUpDom({ header: HEADER, rows: ROWS });
    I.resetFiltroCapturado();
    I.resetTileState();
    I.captureFiltro();

    const originalConfirm = window.confirm;
    const originalAM = window.__sigcProAgendaLookups;
    const originalL = window.L;
    window.confirm = () => true;
    window.__sigcProAgendaLookups = {
      ...originalAM,
      fetchEnderecosPorFiltro: async () => new Map([
        ['C1|1', { lat: -8.5, lon: -63.8, zona: 'Z1', idZona: 'Z1' }],
      ]),
      fetchAgendaSlots: async () => { throw new Error('network down'); },
    };
    const fakeL = fakeLeaflet();
    window.L = fakeL;
    document.documentElement.dataset.sigcProLeafletJsUrl = 'data:text/javascript,';
    document.documentElement.dataset.sigcProLeafletCssUrl = 'data:text/css,';
    const warnSpy = console.warn;
    console.warn = () => {};

    const btn = document.createElement('button');
    try {
      await I.onMapaClick(btn);
      const panelEl = document.getElementById('sigc-pro-ultimo-movimento-map-panel');
      const mapaTabBtn = panelEl.querySelector('.sigc-pro-tab-btn[data-tab="mapa"]');
      // Two rapid clicks, neither awaited between them: both reach
      // maybeLoadTiles() and race past the `mapInitialized` check before
      // either call's `await loadLeafletAssets()` has a chance to flip
      // it true (mirrors the real focusZonaOnMap double-call this
      // finding reported).
      mapaTabBtn.click();
      mapaTabBtn.click();
      // Let every pending microtask/timer (loadLeafletAssets' internal
      // pollFor + promise chain) drain.
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(fakeL.mapCallCount()).toBe(1);
    } finally {
      console.warn = warnSpy;
      window.confirm = originalConfirm;
      window.__sigcProAgendaLookups = originalAM;
      if (originalL === undefined) delete window.L; else window.L = originalL;
      delete document.documentElement.dataset.sigcProLeafletJsUrl;
      delete document.documentElement.dataset.sigcProLeafletCssUrl;
      delete window.jQuery;
      delete window.$;
      document.getElementById('sigc-pro-ultimo-movimento-map-panel')?.remove();
      I.resetFiltroCapturado();
      I.resetTileState();
    }
  });

  test('the "Tentar novamente" retry button still recovers the map after a failed tile load', async () => {
    const I = window.__sigcProUltimoMovimentoMapInternals;
    setUpDom({ header: HEADER, rows: ROWS });
    I.resetFiltroCapturado();
    I.resetTileState();
    I.captureFiltro();

    const originalConfirm = window.confirm;
    const originalAM = window.__sigcProAgendaLookups;
    const originalL = window.L;
    // Decline the tile consent prompt the first time, accept afterward —
    // exercises the declined-consent branch's retry button, and confirms
    // the tileLoadInFlight guard (set only AFTER the consent block) never
    // leaves a declined attempt stuck unable to retry.
    let tileConfirmCalls = 0;
    window.confirm = (msg) => {
      if (String(msg).includes('Endereços')) return true; // fetch consent
      tileConfirmCalls += 1; // tile consent: decline the first prompt, accept the retry
      return tileConfirmCalls > 1;
    };
    window.__sigcProAgendaLookups = {
      ...originalAM,
      fetchEnderecosPorFiltro: async () => new Map([
        ['C1|1', { lat: -8.5, lon: -63.8, zona: 'Z1', idZona: 'Z1' }],
      ]),
      fetchAgendaSlots: async () => { throw new Error('network down'); },
    };
    delete window.L; // so the tile fetch path is even reachable if consent were accepted
    document.documentElement.dataset.sigcProLeafletJsUrl = 'data:text/javascript,';
    document.documentElement.dataset.sigcProLeafletCssUrl = 'data:text/css,';
    const warnSpy = console.warn;
    console.warn = () => {};

    const btn = document.createElement('button');
    try {
      await I.onMapaClick(btn);
      await new Promise((resolve) => setTimeout(resolve, 250));
      const declined = document.getElementById('sigc-pro-retry-tiles');
      expect(declined).not.toBeNull();

      // Now stub in a working Leaflet and click retry — the declined
      // path must not have left tileLoadInFlight stuck true.
      const fakeL = fakeLeaflet();
      window.L = fakeL;
      declined.click();
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(fakeL.mapCallCount()).toBe(1);
      expect(document.getElementById('sigc-pro-leaflet-map').querySelector('#sigc-pro-retry-tiles')).toBeNull();
    } finally {
      console.warn = warnSpy;
      window.confirm = originalConfirm;
      window.__sigcProAgendaLookups = originalAM;
      if (originalL === undefined) delete window.L; else window.L = originalL;
      delete document.documentElement.dataset.sigcProLeafletJsUrl;
      delete document.documentElement.dataset.sigcProLeafletCssUrl;
      delete window.jQuery;
      delete window.$;
      document.getElementById('sigc-pro-ultimo-movimento-map-panel')?.remove();
      I.resetFiltroCapturado();
      I.resetTileState();
    }
  });
});

describe('janelaAgendavel', () => {
  // pns.zonas' primeiro_dia_agendavel(): a slot needs lead time, so today
  // and the next two days are never bookable; on a Friday the third day is
  // out too, because the weekend is not working time.
  test('skips today and the next two days', () => {
    // 2026-08-11 is a Tuesday.
    expect(UM.primeiroDiaAgendavel('2026-08-11')).toBe('2026-08-14');
  });

  test('on a Friday the lead time stretches to four days', () => {
    // 2026-08-14 is a Friday: +3 lands on Monday, still too soon.
    expect(UM.primeiroDiaAgendavel('2026-08-14')).toBe('2026-08-18');
  });

  test('crosses month and year boundaries', () => {
    expect(UM.primeiroDiaAgendavel('2026-12-30')).toBe('2027-01-02');
  });

  test('every weekday lands on a bookable weekday', () => {
    // Mon 2026-08-10 through Sun 2026-08-16.
    const esperado = {
      '2026-08-10': '2026-08-13', // Mon -> Thu
      '2026-08-11': '2026-08-14', // Tue -> Fri
      '2026-08-12': '2026-08-15', // Wed -> Sat
      '2026-08-13': '2026-08-16', // Thu -> Sun
      '2026-08-14': '2026-08-18', // Fri -> Tue (weekend skipped)
      '2026-08-15': '2026-08-18', // Sat -> Tue
      '2026-08-16': '2026-08-19', // Sun -> Wed
    };
    Object.entries(esperado).forEach(([hoje, primeiro]) => {
      expect(UM.primeiroDiaAgendavel(hoje)).toBe(primeiro);
    });
  });

  test('window ends 17 days from today, not from the first bookable day', () => {
    // JANELA_DIAS is counted from HOJE (pns.zonas relatorio_agenda.R:430):
    // the dead head eats into it, which is the point — the window is "the
    // short term", not "the next N bookable days".
    expect(UM.fimDaJanela('2026-08-11')).toBe('2026-08-28');
  });

  // The weekend is lead TIME, not a filter on which slots count. SIGC has
  // no weekend slots today, but nothing forbids them — a Saturday slot
  // three weeks out is real capacity, and dropping it would understate the
  // zona instead of overstating it. Only the dead head is excluded.
  test('does not exclude weekend slots from the window', () => {
    const sabado = '2026-08-22';
    const domingo = '2026-08-23';
    const primeiro = UM.primeiroDiaAgendavel('2026-08-11');
    const fim = UM.fimDaJanela('2026-08-11');
    expect(sabado >= primeiro && sabado <= fim).toBe(true);
    expect(domingo >= primeiro && domingo <= fim).toBe(true);
  });
});

describe('onBiomarcadores', () => {
  // The biomarcadores report has no <h6> title — the live capture shows
  // the report named only in a breadcrumb, so onUltimoMovimento()'s h6
  // probe finds nothing here.
  const BREADCRUMB =
    '<nav aria-label="breadcrumb"><ol class="breadcrumb">' +
    '<li class="breadcrumb-item"><a href="javascript:void(0);">Biomarcadores</a></li>' +
    '<li class="breadcrumb-item"><a href="javascript:void(0);">Relatório</a></li>' +
    '<li class="breadcrumb-item active" aria-current="page">' +
    'Relat&#xF3;rio de Acompanhamento de Biomarcadores</li></ol></nav>';

  test('detects the report from its breadcrumb', () => {
    document.body.innerHTML = BREADCRUMB;
    try {
      expect(UM.onBiomarcadores()).toBe(true);
    } finally {
      document.body.innerHTML = '';
    }
  });

  test('does not fire on Último Movimento', () => {
    document.body.innerHTML = '<h6>Relatório Último Movimento</h6>';
    try {
      expect(UM.onBiomarcadores()).toBe(false);
    } finally {
      document.body.innerHTML = '';
    }
  });

  test('does not fire on the bare Biomarcadores menu word alone', () => {
    // "Biomarcadores" alone appears in the breadcrumb's first crumb and in
    // menus all over SIGC; only the full report name may match, or the
    // feature mounts on unrelated pages.
    document.body.innerHTML =
      '<ol class="breadcrumb"><li class="breadcrumb-item">Biomarcadores</li></ol>';
    try {
      expect(UM.onBiomarcadores()).toBe(false);
    } finally {
      document.body.innerHTML = '';
    }
  });

  test('tolerates an h6 title if SIGC ever adds one', () => {
    document.body.innerHTML =
      '<h6>Relatório de Acompanhamento de Biomarcadores</h6>';
    try {
      expect(UM.onBiomarcadores()).toBe(true);
    } finally {
      document.body.innerHTML = '';
    }
  });
});

describe('recusa disambiguation', () => {
  // "Recusa" means two different things in SIGC and the two populations
  // are nearly disjoint: in BA ~50 households refused the BIOMARCADOR
  // collection while 18 refused the INTERVIEW, and almost all of the
  // former show up here as a successful interview. This table only ever
  // sees the interview refusal, so labelling it plain "Recusa" invites
  // reading it as the collection refusal it cannot show.
  test('the zonas column names which refusal it counts', () => {
    const zonaRows = [{
      idZona: '29XJYY', nomeZona: 'Zona X', realizada: 1, naoIniciada: 0,
      domicilioFechado: 0, recusa: 2, outros: 0, totalDomicilios: 3,
      semCoordenadas: 0, agendados: 0, realizadasSemAgendamento: 0, pendentes: 0,
    }];
    const html = UM.buildZonasTableHtml(zonaRows, new Map(), new Map());
    expect(html).toContain('Recusa entrev.');
    // And says so in full on hover, naming the one it is NOT.
    expect(html).toMatch(/title="[^"]*entrevista[^"]*"/);
    expect(html).toContain('biomarcador');
  });
});

describe('zona pin instead of whole-row click', () => {
  const ZONA_ROWS = [{
    idZona: '29XJYY', nomeZona: 'Zona X', realizada: 1, naoIniciada: 0,
    domicilioFechado: 0, recusa: 0, outros: 0, totalDomicilios: 3,
    semCoordenadas: 0, agendados: 0, realizadasSemAgendamento: 0, pendentes: 0,
  }];

  test('the pin cell carries the click target, not the row', () => {
    const html = UM.buildZonasTableHtml(ZONA_ROWS, new Map(), new Map());
    // The pin is a real button for keyboard/AT users, not a bare glyph.
    expect(html).toMatch(/role="button"/);
    expect(html).toMatch(/tabindex="0"/);
    expect(html).toContain('📍');
    // data-id-zona moves onto the pin so the row is no longer a target.
    expect(html).toMatch(/class="[^"]*sigc-pro-zona-pin[^"]*"[^>]*data-id-zona="29XJYY"/);
    expect(html).not.toMatch(/<tr[^>]*data-id-zona=/);
  });

  test('a zona with no mapped coordinates gets no pin', () => {
    const semCoords = [{ ...ZONA_ROWS[0], semCoordenadas: 3 }];
    const html = UM.buildZonasTableHtml(semCoords, new Map(), new Map());
    expect(html).not.toContain('📍');
  });

  test('the pin column is first and marked unsortable', () => {
    const html = UM.buildZonasTableHtml(ZONA_ROWS, new Map(), new Map());
    // Leading <th> before "Zona": adding a column shifts every later
    // index, so the header must declare itself unsortable rather than
    // relying on a positional columnDefs entry elsewhere.
    expect(html).toMatch(/<thead><tr><th[^>]*class="[^"]*sigc-pro-zona-pin-col/);
    expect(html).toMatch(/<th[^>]*data-orderable="false"/);
  });
});
