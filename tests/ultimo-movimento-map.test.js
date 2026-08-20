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

  test('incluirSoEnderecos: a selecionado absent from the report joins as Não Distribuido', () => {
    // The movement report covers everything that left the base, so a
    // household in the Lista de Endereços but not in the report has not
    // been distributed. It joins with coordinates (so its controle gets
    // a real row, a marker and a working pin) and the derived posição.
    const enderecosMap = new Map([
      ['C1|1', { lat: -8.5, lon: -63.8, zona: 'A', idZona: 'Z1' }],
      ['C9|7', { lat: -8.4, lon: -63.7, zona: 'B', idZona: 'Z2' }],
    ]);
    const joined = UM.joinEnderecos(movimentoMap, enderecosMap, true);
    expect(joined).toHaveLength(3);
    const novo = joined.find((r) => r.controle === 'C9');
    expect(novo).toMatchObject({
      domicilio: '7', ultimaPosicao: 'Não Distribuido', tipoEntrevista: '',
      temCoordenadas: true, idZona: 'Z2',
    });
    // It lands in the Não distribuída column and makes its controle real.
    const agg = UM.aggregateZonas(joined, null, UM.MODO_MOVIMENTO, undefined);
    const c9 = agg.find((b) => b.idZona === 'C9');
    expect(c9.naoDistribuida).toBe(1);
    expect(UM.zonaRowIsClickable(c9)).toBe(true);
  });

  test('without the flag (biomarcadores path), enderecos-only households stay out', () => {
    const enderecosMap = new Map([['C9|7', { lat: -8.4, lon: -63.7, zona: 'B', idZona: 'Z2' }]]);
    expect(UM.joinEnderecos(movimentoMap, enderecosMap)).toHaveLength(2);
    expect(UM.joinEnderecos(movimentoMap, enderecosMap, false)).toHaveLength(2);
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
  // Two units, one aggregation. Biomarcadores groups by zona because the
  // AGENDA is built per zona — slots, capacity and déficit only mean
  // anything there. Último Movimento asks no agenda question, so it
  // groups by the survey's own sampling unit, the Controle.
  const joined = [
    { controle: 'C1', idZona: '11.1.01.08', zona: 'ESCOLA POLICIA', tipoEntrevista: 'Realizada', temCoordenadas: true, temZona: true },
    { controle: 'C1', idZona: '11.1.01.08', zona: 'ESCOLA POLICIA', tipoEntrevista: 'Não Iniciada', temCoordenadas: false, temZona: true },
    { controle: 'C2', idZona: '', zona: '', tipoEntrevista: 'Recusa', temCoordenadas: true, temZona: false },
    { controle: 'C2', idZona: '', zona: '', tipoEntrevista: 'Realizada', temCoordenadas: true, temZona: false },
  ];

  test('biomarcadores groups by idZona, one row per distinct zona', () => {
    const rows = UM.aggregateZonas(joined, new Map(), UM.MODO_BIOMARCADORES);
    const zonaRow = rows.find((r) => r.idZona === '11.1.01.08');
    expect(zonaRow).toMatchObject({
      idZona: '11.1.01.08', nomeZona: 'ESCOLA POLICIA',
      totalDomicilios: 2, semCoordenadas: 1,
    });
  });

  test('biomarcadores keeps a single "Sem zona" row (idZona null)', () => {
    const rows = UM.aggregateZonas(joined, new Map(), UM.MODO_BIOMARCADORES);
    const semZona = rows.find((r) => r.idZona === null);
    expect(semZona).toBeDefined();
    expect(semZona.totalDomicilios).toBe(2);
    expect(semZona.semCoordenadas).toBe(0);
  });

  test('movimento groups by controle, ignoring zona entirely', () => {
    const rows = UM.aggregateZonas(joined, new Map(), UM.MODO_MOVIMENTO);
    expect(rows.map((r) => r.idZona).sort()).toEqual(['C1', 'C2']);
    const c1 = rows.find((r) => r.idZona === 'C1');
    expect(c1).toMatchObject({
      idZona: 'C1', nomeZona: 'C1',
      realizada: 1, naoIniciada: 1, domicilioFechado: 0, recusa: 0, outros: 0,
      totalDomicilios: 2, semCoordenadas: 1,
    });
    // The two zona-less households are a Controle of their own, NOT a
    // "Sem zona" bucket: every row of the report carries a controle, so
    // the ungrouped row that zona needs cannot arise here.
    const c2 = rows.find((r) => r.idZona === 'C2');
    expect(c2.totalDomicilios).toBe(2);
    expect(c2.recusa).toBe(1);
    expect(c2.realizada).toBe(1);
    expect(rows.some((r) => r.idZona === null)).toBe(false);
  });

  test('unrecognized tipoEntrevista values count under outros', () => {
    const rows = UM.aggregateZonas([
      { controle: 'C9', idZona: 'Z1', zona: 'Zona 1', tipoEntrevista: 'Endereço Não Localizado', temCoordenadas: true, temZona: true },
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
    const rows = I.aggregateZonas(joined, enderecos, UM.MODO_BIOMARCADORES);
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
    // MODO_MOVIMENTO: these three counters use the ultimaPosicao
    // predicates, which only that variant applies. It now groups by
    // controle, so the row to look at is C1's.
    const z = I.aggregateZonas(joined, enderecos, UM.MODO_MOVIMENTO)
      .find((r) => r.idZona === 'C1');
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
    // Id plus nome in ONE cell, same markup as the Domicílios tab —
    // there is no separate Nome column.
    expect(html).toContain('<td>Z1 <span class="sigc-pro-zona-nome">Bairro X</span></td>');
    expect(html).not.toContain('<th>Nome</th>');
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

  describe('the Entenda tab', () => {
    // The panel states inferences in the same visual register as facts:
    // "Inelegível" looks exactly like "Coletado", though one is a status
    // the report gives us and the other is a guess measured in a single
    // UF. The tooltips carry the caveats, but a tooltip does not survive
    // a CSV export, a screenshot, or a reader who never hovers.
    test('is present in both variants', () => {
      [UM.MODO_MOVIMENTO, UM.MODO_BIOMARCADORES].forEach((modo) => {
        const html = UM.buildPanelHtml(
          joined, zonaRows, new Map(), new Map(), modo, '2026-08-15');
        expect(html).toContain('data-tab="entenda"');
        expect(html).toContain('sigc-pro-entenda-panel');
      });
    });

    test('names the source report and what it can answer', () => {
      const bio = UM.buildEntendaHtml(UM.MODO_BIOMARCADORES);
      expect(bio).toContain('Biomarcadores');
      const mov = UM.buildEntendaHtml(UM.MODO_MOVIMENTO);
      expect(mov).toContain('Último Movimento');
    });

    // The whole point of the tab: a reader must be able to tell, per
    // column, whether the number is reported or inferred.
    test('marks Inelegível as an inference and says where it was measured', () => {
      const html = UM.buildEntendaHtml(UM.MODO_BIOMARCADORES);
      expect(html).toContain('Inelegível');
      expect(html).toMatch(/INFERÊNCIA/);
      // The provenance that prompt-pns-zonas.md says is still unconfirmed.
      expect(html).toContain('35');
      expect(html).toMatch(/Bahia|BA\b/);
    });

    test('explains only the columns the variant actually renders', () => {
      const mov = UM.buildEntendaHtml(UM.MODO_MOVIMENTO);
      // Demand columns do not exist on Último Movimento, so explaining
      // them would describe a table the reader cannot see.
      expect(mov).not.toContain('Déficit');
      expect(mov).not.toContain('Agendamento pendente');
      const bio = UM.buildEntendaHtml(UM.MODO_BIOMARCADORES);
      expect(bio).toContain('Déficit');
      expect(bio).toContain('Agendamento pendente');
    });

    // The trap Fable found: a collection refusal renders green on this
    // variant, indistinguishable from a collected household.
    test('warns that Último Movimento cannot see collection refusals', () => {
      const mov = UM.buildEntendaHtml(UM.MODO_MOVIMENTO);
      expect(mov).toMatch(/recusa/i);
      expect(mov).toMatch(/biomarcador/i);
    });

    test('documents every colour the map can actually paint', () => {
      [UM.MODO_MOVIMENTO, UM.MODO_BIOMARCADORES].forEach((modo) => {
        const html = UM.buildEntendaHtml(modo);
        UM.legendEntries(modo).forEach(([label]) => {
          expect(html).toContain(label);
        });
      });
    });

    test('escapes its content', () => {
      const html = UM.buildEntendaHtml(UM.MODO_BIOMARCADORES);
      expect(html).not.toContain('<script');
    });
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
    // Scoped to the DATA tables' bodies: the Entenda tab is static
    // documentation and legitimately has <td>s of its own, so a
    // panel-wide "<td" search stopped meaning "no data rows".
    expect(html).toMatch(/<table class="sigc-pro-zonas-table">.*<tbody><\/tbody>/s);
    expect(html).toMatch(/<table class="sigc-pro-domicilios-table">.*<tbody><\/tbody>/s);
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
      // Entrevistador/Data are Último Movimento columns; the
      // biomarcadores variant shows the collection's people instead.
    }], I.MODO_MOVIMENTO);
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

  test('renders the turno headers and counts', () => {
    const turnos = new Map([['29JDM8', { manha: 2, tarde: 3 }]]);
    const html = I().buildZonasTableHtml([zonaRow()], new Map(), turnos);
    // "Slots" in the header: these are counts of FREE agenda slots, which
    // a bare "Manhã" does not say.
    expect(html).toContain('>Slots manhã</th>');
    expect(html).toContain('>Slots tarde</th>');
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
    expect(html).toContain('Deve 3 biomarcador(es)');
  });

  test('does not flag a zona whose capacity covers what it owes', () => {
    const turnos = new Map([['29JDM8', { manha: 2, tarde: 2 }]]);
    const html = I().buildZonasTableHtml(
      [zonaRow({ realizadasSemAgendamento: 3 })], new Map(), turnos);
    expect(html).not.toContain('sigc-pro-zona-sem-capacidade');
  });

  test('renders both demand columns', () => {
    const html = I().buildZonasTableHtml(
      [zonaRow({ agendamentoPendente: 2, agendadoBio: 5 })], new Map(), new Map());
    expect(html).toContain('>Agendamento pendente</th>');
    expect(html).toContain('>Agendado</th>');
    expect(html).toContain('sigc-pro-devidas">2</td>');
    expect(html).toContain('<td>5</td>');
  });

  // Superseded the nested pair: the columns are now disjoint, so they
  // ADD UP and the "do not sum these" warning is gone — that warning was
  // the part a reader skipped.
  test('the demand columns no longer warn against summing', () => {
    const html = I().buildZonasTableHtml([zonaRow()], new Map(), new Map());
    expect(html).not.toContain('não se somam');
  });
});

describe('Domicílios tab — Zona column', () => {
  test('Último Movimento shows no Zona column at all', () => {
    // That variant groups by Controle everywhere — aggregate tab, hulls,
    // pin — so a lone Zona column here would be the one place a grouping
    // survived that nothing else in the variant can act on. The Controle
    // is already its own column.
    const I = window.__sigcProUltimoMovimentoMapInternals;
    const html = I.buildDomiciliosTabHtml([{
      controle: 'C1', domicilio: '1', idZona: '29JDM8', zona: '29JDM8 - Lauro',
      agendado: '', futura: false, ultimaPosicao: 'TRANSMITIDO',
      tipoEntrevista: 'Realizada', entrevistador: 'MARIA', data: '28/07/2026',
    }], I.MODO_MOVIMENTO);
    expect(html).not.toContain('<th>Zona</th>');
    expect(html).not.toContain('29JDM8');
    expect(html).toContain('<th>Controle</th>');
    expect(html).toContain('C1');
  });

  test('biomarcadores keeps the zona id and name', () => {
    const I = window.__sigcProUltimoMovimentoMapInternals;
    const html = I.buildDomiciliosTabHtml([{
      controle: 'C1', domicilio: '1', idZona: '29JDM8', zona: '29JDM8 - Lauro',
      agendado: '', futura: false, ultimaPosicao: 'TRANSMITIDO',
      tipoEntrevista: 'Realizada', entrevistador: 'MARIA', data: '28/07/2026',
    }], I.MODO_BIOMARCADORES);
    expect(html).toContain('<th>Zona</th>');
    expect(html).toContain('29JDM8');
  });

  test('a household with no zona renders — rather than blank', () => {
    const I = window.__sigcProUltimoMovimentoMapInternals;
    const html = I.buildDomiciliosTabHtml([{
      controle: 'C1', domicilio: '1', idZona: '', zona: '',
      agendado: '', futura: false, ultimaPosicao: '', tipoEntrevista: '',
      entrevistador: '', data: '',
    }], I.MODO_MOVIMENTO);
    const row = html.split('<tbody>')[1];
    // Four now, not five: the Zona column that used to contribute one of
    // the em-dashes is gone from this variant.
    expect((row.match(/—/g) || []).length).toBe(4);
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

  test('leaves the Entenda glossary alone', () => {
    // It is prose laid out as a table. Sorting it would scramble a reading
    // order that follows the collection pipeline, and a search box over a
    // dozen static rows invites reading documentation as data.
    const record = run(false,
      '<table class="sigc-pro-entenda-table"><thead><tr><th>Coluna</th></tr></thead>' +
      '<tbody><tr><td>x</td></tr></tbody></table>');
    expect(record.initOpts).toBeNull();
    expect(record.len).toBeNull();
  });

  // A real panel table always has a header: initPanelTables refuses to
  // initialize a table whose body disagrees with its header (see
  // colunasBatem), and "no header at all" is that same disagreement.
  const DOMICILIOS = '<table class="sigc-pro-domicilios-table">' +
    '<thead><tr><th>A</th></tr></thead><tbody></tbody></table>';

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
  test('the tipo wins — only the literal Não Distribuído is grey', () => {
    expect(UM.statusColor({ ultimaPosicao: 'Distribuido', tipoEntrevista: 'Realizada' })).toBe('#009E73');
    expect(UM.statusColor({ ultimaPosicao: 'Não Distribuído', tipoEntrevista: 'Não Iniciada' })).toBe('#888888');
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

  // biomarcadores: renders the breadcrumb that puts the panel in
  // MODO_BIOMARCADORES, the only variant that fetches the agenda. Without
  // it the page reads as Último Movimento, which makes no agenda request
  // at all — so every agenda-joining test has to opt in.
  function setUpDom({ header, rows, biomarcadores }) {
    document.body.innerHTML =
      (biomarcadores
        ? '<ol class="breadcrumb"><li class="breadcrumb-item active" ' +
          'aria-current="page">Relatório de Acompanhamento de Biomarcadores</li></ol>'
        : '') +
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

  // The agenda is only fetched in MODO_BIOMARCADORES, whose on-screen
  // table is the biomarcadores report — so those tests need its columns,
  // not Último Movimento's. Same household key (C1|1) either way.
  const HEADER_BIO = [
    'UF', 'Agência', 'Município', 'ID Zona', 'Nome Zona', '#!Controle',
    '!N.º Domicílio', 'Tipo Entrevista', 'Nome Equipe', 'Status',
    'Siape Agendamento', 'Data Resposta 25A.01', 'Data Agendada',
    'Data Visita Biomarcadores', 'Siape Coleta Biomarcadores',
    'Data Final para Coleta', 'Dias Prazo Final', 'Data/hora coleta sangue',
    'Status sangue', 'Motivo sangue', 'Data/hora coleta urina',
    'Status urina', 'Motivo urina', 'Dias entre 1° agendamento e coleta',
  ];
  const ROWS_BIO = [[
    '29', '0570', '2927408', 'Z1', 'Zona 1', 'C1', '1', 'Realizada', 'EQ1',
    'A agendar', '', '20/07/2026', '', '', '', '14/08/2026', '0',
    '', '', '', '', '', '', '',
  ]];

  test('the map panel still renders when the agenda fetch rejects', async () => {
    const I = window.__sigcProUltimoMovimentoMapInternals;
    setUpDom({ header: HEADER_BIO, rows: ROWS_BIO, biomarcadores: true });
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
  test('on the biomarcadores page the report wins over the agenda for a booking', async () => {
    const I = window.__sigcProUltimoMovimentoMapInternals;
    setUpDom({ header: HEADER_BIO, rows: ROWS_BIO, biomarcadores: true });
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
      // The fixture's Data Agendada is empty — the report says this
      // household is NOT booked — while the agenda offers a slot for it.
      // The report is authoritative here, so the agenda's date must not
      // appear; the agenda is fetched on this page only for free slots.
      expect(domiciliosHtml).not.toContain('01/09/2026 09:00');
      // The panel still rendered, i.e. the agenda fetch is not wasted:
      // its slots feed the zona capacity columns.
      const zonasHtml = document.getElementById('sigc-pro-zonas-panel').innerHTML;
      expect(zonasHtml).toContain('Slots');
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
    const layer = {
      addTo: () => layer, bindTooltip: () => layer, bindPopup: () => layer,
      // circleMarker's zoom-driven resize (see raioPorZoom).
      setRadius: () => layer,
    };
    // getZoom/on are real Leaflet surface the render path uses; without
    // them here the fake diverges from the browser and these tests pass
    // against code that would throw on the live page.
    const map = {
      addLayer: () => {}, setView: () => map, fitBounds: () => map,
      getZoom: () => 13, on: () => map,
    };
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
      layerGroup: () => layer,
      DomUtil: { create: () => document.createElement('div') },
      control: Object.assign(() => ({ addTo: () => {}, onAdd: null }), {
        // L.control.layers is a property ON the control function in real
        // Leaflet, not a separate export.
        layers: () => ({ addTo: () => {} }),
      }),
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
    // MODO_MOVIMENTO keeps the interview-outcome columns, where the
    // qualifier is what disambiguates the two refusals.
    const html = UM.buildZonasTableHtml(zonaRows, new Map(), new Map(), UM.MODO_MOVIMENTO);
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

  // The pin writes the grouping key and focusZonaOnMap reads it back. If
  // the two ever disagree the filter matches nothing and the panel
  // switches to the Mapa tab and then sits there — no error, no zoom, no
  // clue why. So the round trip is asserted per variant.
  describe('the pin round-trips its grouping key', () => {
    const comMapa = (fn) => {
      document.body.innerHTML =
        '<div id="p">' +
        '<div id="sigc-pro-mapa-panel" class="sigc-pro-tab-panel"></div>' +
        '<div id="sigc-pro-zonas-panel" class="sigc-pro-tab-panel sigc-pro-tab-panel-active"></div>' +
        '<button class="sigc-pro-tab-btn" data-tab="mapa"></button>' +
        '<button class="sigc-pro-tab-btn sigc-pro-tab-active" data-tab="zonas"></button>' +
        '</div>';
      const bounds = [];
      UM.setCurrentMapForTest({ setView: () => {}, fitBounds: (b) => bounds.push(b) });
      try {
        fn(document.getElementById('p'), bounds);
      } finally {
        UM.setCurrentMapForTest(null);
        document.body.innerHTML = '';
      }
    };

    const linhas = [
      { controle: 'C1', domicilio: '1', idZona: 'Z1', temZona: true, temCoordenadas: true, lat: -12, lon: -38 },
      { controle: 'C2', domicilio: '1', idZona: 'Z2', temZona: true, temCoordenadas: true, lat: -13, lon: -39 },
    ];

    test('Último Movimento focuses the controle the pin names', () => {
      const html = UM.buildZonasTableHtml(
        [{ idZona: 'C2', nomeZona: 'C2', totalDomicilios: 1, semCoordenadas: 0 }],
        new Map(), new Map(), UM.MODO_MOVIMENTO);
      const m = html.match(/data-id-zona="([^"]+)"/);
      expect(m[1]).toBe('C2');
      comMapa((panelEl, bounds) => {
        UM.focusZonaOnMap(panelEl, linhas, m[1], UM.MODO_MOVIMENTO);
        expect(bounds).toEqual([[[-13, -39]]]);
      });
    });

    test('biomarcadores focuses the zona the pin names', () => {
      const html = UM.buildZonasTableHtml(
        [{ idZona: 'Z2', nomeZona: 'Zona 2', totalDomicilios: 1, semCoordenadas: 0 }],
        new Map(), new Map(), UM.MODO_BIOMARCADORES);
      const m = html.match(/data-id-zona="([^"]+)"/);
      expect(m[1]).toBe('Z2');
      comMapa((panelEl, bounds) => {
        UM.focusZonaOnMap(panelEl, linhas, m[1], UM.MODO_BIOMARCADORES);
        expect(bounds).toEqual([[[-13, -39]]]);
      });
    });
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

describe('modo (map variants)', () => {
  const ZONA = {
    idZona: 'Z1', nomeZona: 'Bairro X', realizada: 1, naoIniciada: 0,
    domicilioFechado: 0, recusa: 0, outros: 0, totalDomicilios: 2,
    semCoordenadas: 0, agendados: 1, realizadasSemAgendamento: 1, pendentes: 1,
  };

  test('MODO_MOVIMENTO drops every agenda-derived column', () => {
    // Último Movimento makes no agenda request, so Agendados, the two
    // demand columns and the slot columns have no data behind them.
    // Rendering them as zeros would assert "nothing scheduled" when the
    // truth is "not asked".
    const html = UM.buildZonasTableHtml([ZONA], new Map(), new Map(), UM.MODO_MOVIMENTO);
    expect(html).not.toContain('Agendados');
    expect(html).not.toContain('Realizadas sem agend.');
    expect(html).not.toContain('Slots livres');
    expect(html).not.toContain('Manhã');
    // But the tipo counts stay. Sem coordenadas is no column in either
    // variant — that count lives in the popup now.
    expect(html).toContain('Recusa entrev.');
    expect(html).not.toContain('Sem coordenadas');
  });

  test('MODO_BIOMARCADORES keeps the slot columns', () => {
    const html = UM.buildZonasTableHtml([ZONA], new Map(), new Map(), UM.MODO_BIOMARCADORES);
    expect(html).toContain('Slots livres');
    expect(html).toContain('Slots manhã');
    expect(html).toContain('>Agendado</th>');
  });

  test('every row has the same cell count as the header', () => {
    // A column dropped from the header but not the body (or vice versa)
    // silently shifts every later cell into the wrong column.
    [UM.MODO_MOVIMENTO, UM.MODO_BIOMARCADORES].forEach((modo) => {
      const html = UM.buildZonasTableHtml([ZONA], new Map(), new Map(), modo);
      // <thead> also matches /<th/, so count the real cells only.
      const ths = (html.match(/<th[ >]/g) || []).length;
      const tds = (html.match(/<td[ >]/g) || []).length;
      expect(tds).toBe(ths);
    });
  });

  test('defaults to the biomarcadores shape when no modo is passed', () => {
    // Existing callers/tests pass no modo; they must keep the full table.
    const html = UM.buildZonasTableHtml([ZONA], new Map(), new Map());
    expect(html).toContain('Slots livres');
  });
});

describe('biomarcadores demand from status', () => {
  const linha = (over) => ({
    controle: 'C1', domicilio: '1', status: 'Não iniciado',
    dataAgendada: '', dataFinalColeta: '', ...over,
  });

  test('open statuses owe a collection', () => {
    ['A agendar', 'Não iniciado', 'Indefinido'].forEach((status) => {
      expect(UM.coletaEmAberto(linha({ status }))).toBe(true);
    });
  });

  test('collected and closed-without-collection statuses do not', () => {
    ['Coletado Sangue e Urina', 'Coletado apenas Sangue', 'Coletado apenas Urina',
      'Recusa', 'Outro Motivo', 'Não elegível'].forEach((status) => {
      expect(UM.coletaEmAberto(linha({ status }))).toBe(false);
    });
  });

  test('Agendado is conditional on the date not having passed', () => {
    const hoje = '2026-08-14';
    // Future booking: closed, it is on its way.
    expect(UM.coletaEmAberto(linha({ status: 'Agendado', dataAgendada: '20/08/2026' }), hoje))
      .toBe(false);
    // Today still counts as booked.
    expect(UM.coletaEmAberto(linha({ status: 'Agendado', dataAgendada: '14/08/2026' }), hoje))
      .toBe(false);
    // Lapsed without a collection: back to being demand.
    expect(UM.coletaEmAberto(linha({ status: 'Agendado', dataAgendada: '01/08/2026' }), hoje))
      .toBe(true);
  });

  test('an unknown status is left out of the counts, not absorbed', () => {
    // Matched positively: a status SIGC adds tomorrow must not silently
    // land in "owed" (or in "closed") through a negation.
    expect(UM.coletaEmAberto(linha({ status: 'Status Novo Do SIGC' }))).toBe(false);
    expect(UM.statusDesconhecido(linha({ status: 'Status Novo Do SIGC' }))).toBe(true);
    expect(UM.statusDesconhecido(linha({ status: 'A agendar' }))).toBe(false);
  });
});

describe('capacity flag is agenda-derived', () => {
  test('MODO_MOVIMENTO never flags a zona as sem capacidade', () => {
    // The flag compares demand against free slots. With no agenda fetch
    // there is neither, so flagging would paint a shortfall the data
    // cannot support — and the tooltip would read "0 slot(s) livre(s)"
    // when the truth is that nothing was asked.
    const zona = {
      idZona: 'Z1', nomeZona: 'B', realizada: 1, naoIniciada: 0,
      domicilioFechado: 0, recusa: 0, outros: 0, totalDomicilios: 2,
      semCoordenadas: 0, agendados: 1, realizadasSemAgendamento: 5, pendentes: 5,
    };
    const html = UM.buildZonasTableHtml([zona], new Map(), new Map(), UM.MODO_MOVIMENTO);
    expect(html).not.toContain('sigc-pro-zona-sem-capacidade');
    expect(html).not.toContain('slot(s) livre(s)');
    // The pin's own tooltip survives, naming this variant's own unit.
    expect(html).toContain('Ver este controle no mapa');
  });
});

describe('reading the on-screen table per modo', () => {
  const BIO_HEADERS = [
    'UF', 'Agência', 'Município', 'ID Zona', 'Nome Zona', '#!Controle',
    '!N.º Domicílio', 'Tipo Entrevista', 'Nome Equipe', 'Status',
    'Siape Agendamento', 'Data Resposta 25A.01', 'Data Agendada',
    'Data Visita Biomarcadores', 'Siape Coleta Biomarcadores',
    'Data Final para Coleta', 'Dias Prazo Final', 'Data/hora coleta sangue',
    'Status sangue', 'Motivo sangue', 'Data/hora coleta urina',
    'Status urina', 'Motivo urina', 'Dias entre 1° agendamento e coleta',
  ];
  const BIO_ROW = [
    '29', '292740800', '2927408', '29XJYY', '29.3.01.02 Pituba',
    '292740805220571', '1', 'Realizada', 'EQ1', 'A agendar',
    '', '20/07/2026', '', '', '', '14/08/2026', '0', '', '', '', '', '', '', '',
  ];

  test('biomarcadores rows carry status and become map rows', () => {
    // The biomarcadores report is the household source on its own page,
    // so its rows must reach the same {controle, domicilio, idZona} shape
    // the coordinate join and the zona aggregation expect.
    const map = UM.biomarcadoresParaLinhas(BIO_HEADERS, [BIO_ROW]);
    expect(map).not.toBeNull();
    const row = map.get('292740805220571|1');
    expect(row.status).toBe('A agendar');
    expect(row.idZona).toBe('29XJYY');
    // Data Agendada is empty here, so nothing is booked.
    expect(row.agendado).toBe('');
    // And the household owes a collection.
    expect(UM.coletaEmAberto(row)).toBe(true);
  });

  test('Data Agendada becomes agendado without any agenda request', () => {
    const cells = [...BIO_ROW];
    cells[9] = 'Agendado';
    cells[12] = '20/08/2026';
    const row = UM.biomarcadoresParaLinhas(BIO_HEADERS, [cells]).get('292740805220571|1');
    expect(row.agendado).toBe('20/08/2026');
    expect(row.agendadoOrdenavel).toBe('2026-08-20');
  });
});

describe('demand comes from status on the biomarcadores page', () => {
  const linha = (over) => ({
    controle: 'C1', domicilio: '1', idZona: 'Z1', zona: 'Zona 1',
    temZona: true, temCoordenadas: true, tipoEntrevista: 'Realizada',
    ultimaPosicao: '', status: 'A agendar', agendado: '', dataAgendada: '',
    ...over,
  });

  test('an owed collection counts, whatever its ultimaPosicao', () => {
    // ultimaPosicao is empty on this report, so the proxy rule would
    // count zero here — the whole point of reading status instead.
    const zonas = UM.aggregateZonas([linha()], new Map(), UM.MODO_BIOMARCADORES);
    expect(zonas[0].realizadasSemAgendamento).toBe(1);
  });

  test('a collected household owes nothing', () => {
    const zonas = UM.aggregateZonas(
      [linha({ status: 'Coletado Sangue e Urina' })], new Map(), UM.MODO_BIOMARCADORES);
    expect(zonas[0].realizadasSemAgendamento).toBe(0);
  });

  test('a refused collection owes nothing, even though the interview succeeded', () => {
    // The BA case: ~50 households refused the collection and almost all
    // appear as a successful interview. The proxy counted them as owed.
    const zonas = UM.aggregateZonas(
      [linha({ status: 'Recusa' })], new Map(), UM.MODO_BIOMARCADORES);
    expect(zonas[0].realizadasSemAgendamento).toBe(0);
  });

  test('a booked household is not owed until the date lapses', () => {
    const futuro = UM.aggregateZonas(
      [linha({ status: 'Agendado', dataAgendada: '31/12/2099', agendado: '31/12/2099' })],
      new Map(), UM.MODO_BIOMARCADORES);
    expect(futuro[0].realizadasSemAgendamento).toBe(0);
    const vencido = UM.aggregateZonas(
      [linha({ status: 'Agendado', dataAgendada: '01/01/2020', agendado: '01/01/2020' })],
      new Map(), UM.MODO_BIOMARCADORES);
    expect(vencido[0].realizadasSemAgendamento).toBe(1);
  });

  test('Último Movimento keeps the ultimaPosicao rule', () => {
    const zonas = UM.aggregateZonas(
      [linha({ status: '', ultimaPosicao: 'Descarregado Parcialmente' })],
      new Map(), UM.MODO_MOVIMENTO);
    expect(zonas[0].realizadasSemAgendamento).toBe(1);
  });
});

describe('the two demand columns stay nested', () => {
  // The header tooltip tells the reader the columns cannot be added up
  // because one contains the other. That has to be true of the data, not
  // just of the prose.
  test('every owed household is also pendente', () => {
    const statuses = ['A agendar', 'Não iniciado', 'Indefinido', 'Agendado',
      'Coletado Sangue e Urina', 'Recusa', 'Outro Motivo', 'Não elegível',
      'Status Novo'];
    const tipos = ['Realizada', 'Não Iniciada', 'Recusa', ''];
    const datas = ['', '01/01/2020', '31/12/2099'];
    const hoje = '2026-08-14';
    statuses.forEach((status) => tipos.forEach((tipoEntrevista) => datas.forEach((dataAgendada) => {
      const r = { status, tipoEntrevista, dataAgendada };
      if (UM.deveColeta(r, hoje)) {
        expect(UM.coletaEmAberto(r, hoje)).toBe(true);
      }
    })));
  });
});

describe('statusColor per modo', () => {
  const hoje = '2026-08-14';
  const bio = (over) => ({ status: 'Não iniciado', tipoEntrevista: '', ultimaPosicao: '', ...over });

  test('MODO_MOVIMENTO keeps colouring by interview outcome', () => {
    expect(UM.statusColor(bio({ tipoEntrevista: 'Realizada' }), UM.MODO_MOVIMENTO, hoje))
      .toBe('#009E73');
    expect(UM.statusColor(bio({ tipoEntrevista: 'Recusa' }), UM.MODO_MOVIMENTO, hoje))
      .toBe('#D55E00');
    expect(UM.statusColor(bio({ ultimaPosicao: 'Não Distribuído' }), UM.MODO_MOVIMENTO, hoje))
      .toBe('#888888');
  });

  test('a collected household is green, however it was collected', () => {
    ['Coletado Sangue e Urina', 'Coletado apenas Sangue', 'Coletado apenas Urina']
      .forEach((status) => {
        expect(UM.statusColor(bio({ status }), UM.MODO_BIOMARCADORES, hoje)).toBe('#009E73');
      });
  });

  test('a refused COLLECTION is no longer green', () => {
    // The bug this fixes: ~50 BA households refused the collection and
    // almost all of them show a successful interview, so they rendered
    // identical to an already-collected household.
    const cor = UM.statusColor(
      bio({ status: 'Recusa', tipoEntrevista: 'Realizada' }), UM.MODO_BIOMARCADORES, hoje);
    expect(cor).not.toBe('#009E73');
    expect(cor).toBe('#D55E00');
  });

  test('the two refusals are different colours', () => {
    const recusaColeta = UM.statusColor(
      bio({ status: 'Recusa', tipoEntrevista: 'Realizada' }), UM.MODO_BIOMARCADORES, hoje);
    const recusaEntrevista = UM.statusColor(
      bio({ status: 'Não iniciado', tipoEntrevista: 'Recusa' }), UM.MODO_BIOMARCADORES, hoje);
    expect(recusaColeta).not.toBe(recusaEntrevista);
    expect(recusaEntrevista).toBe('#A63603');
  });

  test('a booking is blue while it holds and amber once it lapses', () => {
    expect(UM.statusColor(
      bio({ status: 'Agendado', dataAgendada: '20/08/2026' }), UM.MODO_BIOMARCADORES, hoje))
      .toBe('#0072B2');
    // Lapsed without a collection: back to needing action, same colour as
    // "A agendar" — it IS demand again.
    expect(UM.statusColor(
      bio({ status: 'Agendado', dataAgendada: '01/08/2026' }), UM.MODO_BIOMARCADORES, hoje))
      .toBe('#F0E442');
  });

  test('needs-action statuses share the amber', () => {
    ['A agendar', 'Indefinido'].forEach((status) => {
      expect(UM.statusColor(bio({ status }), UM.MODO_BIOMARCADORES, hoje)).toBe('#F0E442');
    });
  });

  test('Outro Motivo and Não elegível stay distinct', () => {
    expect(UM.statusColor(bio({ status: 'Outro Motivo' }), UM.MODO_BIOMARCADORES, hoje))
      .toBe('#882255');
    expect(UM.statusColor(bio({ status: 'Não elegível' }), UM.MODO_BIOMARCADORES, hoje))
      .toBe('#000000');
  });

  test('"Não iniciado" splits by why it has not started', () => {
    // Waiting its turn — grey.
    expect(UM.statusColor(
      bio({ status: 'Não iniciado', tipoEntrevista: 'Realizada' }),
      UM.MODO_BIOMARCADORES, hoje)).toBe('#999999');
    // Blocked behind a reversible interview outcome — amber-orange. The
    // collection is not queued, it is stuck, and a revisit can unstick it.
    ['Domicílio Fechado', 'Não Foi Encontrado'].forEach((tipoEntrevista) => {
      expect(UM.statusColor(
        bio({ status: 'Não iniciado', tipoEntrevista }),
        UM.MODO_BIOMARCADORES, hoje)).toBe('#E69F00');
    });
    // No resident to interview: nothing to reverse, so it stays grey.
    ['Uso Ocasional', 'Domicílio Vago', 'Em obras ou ruínas'].forEach((tipoEntrevista) => {
      expect(UM.statusColor(
        bio({ status: 'Não iniciado', tipoEntrevista }),
        UM.MODO_BIOMARCADORES, hoje)).toBe('#999999');
    });
  });

  test('an unknown status gets its own colour, not a silent default', () => {
    // Matched positively like everything else: a status SIGC adds must be
    // visible as unrecognized, never absorbed into a real category.
    expect(UM.statusColor(bio({ status: 'Status Novo Do SIGC' }), UM.MODO_BIOMARCADORES, hoje))
      .toBe('#CC79A7');
  });
});

describe('legend follows the scale actually drawn', () => {
  test('MODO_BIOMARCADORES legend names collection outcomes', () => {
    const entradas = UM.legendEntries(UM.MODO_BIOMARCADORES);
    const labels = entradas.map(([l]) => l);
    expect(labels).toContain('Coletado');
    expect(labels).toContain('Recusa do biomarcador');
    expect(labels).toContain('Recusa da entrevista');
    // A legend must not promise a colour the scale never emits.
    expect(labels).not.toContain('Não distribuída');
    // Every colour on the legend is one statusColor can actually return.
    const cores = new Set(entradas.map(([, c]) => c));
    expect(cores.has('#009E73')).toBe(true);
    expect(cores.has('#A63603')).toBe(true);
  });

  test('MODO_MOVIMENTO legend is the interview scale', () => {
    const labels = UM.legendEntries(UM.MODO_MOVIMENTO).map(([l]) => l);
    expect(labels).toContain('Não distribuída');
    expect(labels).toContain('Recusa da entrevista');
    expect(labels).not.toContain('Coletado');
  });
});

describe('popup shows the collection status', () => {
  const row = {
    controle: 'C1', domicilio: '1', entrevistador: 'F', idZona: 'Z1',
    tipoEntrevista: 'Realizada', status: 'Recusa', lat: -12, lon: -38,
    agendado: '', coLocated: 1,
  };

  test('biomarcadores popup names the collection outcome', () => {
    const html = UM.buildPopupHtml(row, UM.MODO_BIOMARCADORES);
    // Without this the popup says "Tipo: Realizada" and nothing else —
    // exactly the reading that hides a refused collection.
    expect(html).toContain('Biomarcadores: Recusa');
  });

  test('movimento popup does not invent a status line', () => {
    const html = UM.buildPopupHtml({ ...row, status: '' }, UM.MODO_MOVIMENTO);
    expect(html).not.toContain('Biomarcadores:');
  });
});

describe('palette integrity', () => {
  test('no two legend entries in one scale share a colour', () => {
    // Two meanings on one colour is unreadable and silent — nothing
    // errors, the map just stops distinguishing them.
    [UM.MODO_MOVIMENTO, UM.MODO_BIOMARCADORES].forEach((modo) => {
      const cores = UM.legendEntries(modo).map(([, c]) => c);
      expect(new Set(cores).size).toBe(cores.length);
    });
  });

  test('every colour statusColor emits is on the legend', () => {
    const hoje = '2026-08-14';
    const statuses = ['Coletado Sangue e Urina', 'Coletado apenas Sangue',
      'Coletado apenas Urina', 'Agendado', 'A agendar', 'Não iniciado',
      'Indefinido', 'Recusa', 'Outro Motivo', 'Não elegível', 'Novo'];
    const tipos = ['Realizada', 'Recusa', 'Domicílio Fechado',
      'Não Foi Encontrado', 'Uso Ocasional', 'Domicílio Vago', ''];
    const datas = ['', '01/01/2020', '31/12/2099'];
    const naLegenda = new Set(UM.legendEntries(UM.MODO_BIOMARCADORES).map(([, c]) => c));
    statuses.forEach((status) => tipos.forEach((tipoEntrevista) => datas.forEach((dataAgendada) => {
      const cor = UM.statusColor({ status, tipoEntrevista, dataAgendada }, UM.MODO_BIOMARCADORES, hoje);
      expect(naLegenda.has(cor)).toBe(true);
    })));
  });
});

describe('alerta de prazo', () => {
  const hoje = '2026-08-14';
  const dom = (over) => ({
    controle: 'C1', domicilio: '1', idZona: 'Z1', nomeZona: 'Zona 1',
    status: 'A agendar', tipoEntrevista: 'Realizada', dataAgendada: '',
    dataFinalColeta: '20/08/2026', diasPrazoFinal: '6', nomeEquipe: 'EQ1',
    ...over,
  });

  test('dias para o prazo is recomputed, going negative when overdue', () => {
    // The SIGC field is truncated at zero, so a household three weeks
    // overdue reports 0, the same as one due today. Sorting by it puts
    // the most urgent work nowhere near the top.
    expect(UM.diasParaPrazo(dom({ dataFinalColeta: '20/08/2026' }), hoje)).toBe(6);
    expect(UM.diasParaPrazo(dom({ dataFinalColeta: '14/08/2026' }), hoje)).toBe(0);
    expect(UM.diasParaPrazo(dom({ dataFinalColeta: '24/07/2026' }), hoje)).toBe(-21);
    // No deadline at all is not "zero days left".
    expect(UM.diasParaPrazo(dom({ dataFinalColeta: '' }), hoje)).toBeNull();
  });

  test('a collected household never alerts, however close its prazo', () => {
    // The R's first version alerted on "prazo < 10 dias" alone, and 75 of
    // 138 highlighted households were already collected, 24 refused.
    // Highlighting finished work is worse than highlighting nothing.
    ['Coletado Sangue e Urina', 'Coletado apenas Sangue', 'Coletado apenas Urina']
      .forEach((status) => {
        expect(UM.emAlertaDePrazo(dom({ status, dataFinalColeta: '15/08/2026' }), hoje))
          .toBe(false);
      });
  });

  test('a household with no prazo never alerts', () => {
    expect(UM.emAlertaDePrazo(dom({ dataFinalColeta: '' }), hoje)).toBe(false);
    // "Não iniciado" cannot have one: the deadline is born from the 25A.01
    // answer, which only exists once collection has begun.
    expect(UM.emAlertaDePrazo(dom({ status: 'Não iniciado', dataFinalColeta: '' }), hoje))
      .toBe(false);
  });

  test('alerts inside the 10-day window and once overdue', () => {
    expect(UM.emAlertaDePrazo(dom({ dataFinalColeta: '20/08/2026' }), hoje)).toBe(true);
    expect(UM.emAlertaDePrazo(dom({ dataFinalColeta: '01/08/2026' }), hoje)).toBe(true);
    // Outside the window, there is still time — not an alert.
    expect(UM.emAlertaDePrazo(dom({ dataFinalColeta: '30/08/2026' }), hoje)).toBe(false);
  });

  test('Recusa alerts even though it is a closed status', () => {
    // Closed without collection, but still actionable while the clock
    // runs: reverting it is exactly the work the deadline threatens.
    expect(UM.emAlertaDePrazo(dom({ status: 'Recusa', dataFinalColeta: '20/08/2026' }), hoje))
      .toBe(true);
    // The other two closed-without-collection statuses do NOT: there is
    // nothing to revert.
    ['Outro Motivo', 'Não elegível'].forEach((status) => {
      expect(UM.emAlertaDePrazo(dom({ status, dataFinalColeta: '20/08/2026' }), hoje))
        .toBe(false);
    });
  });

  test('a lapsed booking alerts, a live one does not', () => {
    expect(UM.emAlertaDePrazo(
      dom({ status: 'Agendado', dataAgendada: '01/08/2026', dataFinalColeta: '20/08/2026' }),
      hoje)).toBe(true);
    expect(UM.emAlertaDePrazo(
      dom({ status: 'Agendado', dataAgendada: '18/08/2026', dataFinalColeta: '20/08/2026' }),
      hoje)).toBe(false);
  });

  test('acao separates agenda work from persuasion work', () => {
    // Without this split, 24 of BA's 39 rows were refusals and the
    // genuinely bookable households were a minority in their own list.
    expect(UM.acaoDePrazo(dom({ status: 'Recusa' }), hoje)).toBe('reverter recusa');
    expect(UM.acaoDePrazo(dom({ status: 'A agendar' }), hoje)).toBe('agendar');
    expect(UM.acaoDePrazo(dom({ status: 'Indefinido' }), hoje)).toBe('definir situação');
    expect(UM.acaoDePrazo(
      dom({ status: 'Agendado', dataAgendada: '01/08/2026' }), hoje)).toBe('reagendar');
  });

  test('only agenda work is agendável', () => {
    expect(UM.agendavelDePrazo(dom({ status: 'Recusa' }))).toBe(false);
    expect(UM.agendavelDePrazo(dom({ status: 'A agendar' }))).toBe(true);
  });
});

describe('date columns sort chronologically, not lexicographically', () => {
  const linha = (over) => ({
    controle: 'C1', domicilio: '1', idZona: 'Z1', entrevistador: 'F',
    tipoEntrevista: 'Realizada', ultimaPosicao: 'Descarregado',
    status: 'A agendar', agendado: '', dataAgendada: '',
    dataFinalColeta: '', data: '', dataVisita: '', ...over,
  });
  const hoje = '2026-08-14';

  // "dd/mm/yyyy HH:MM" as text puts every 01/… together regardless of
  // month or year, so each date cell carries an ISO data-order key —
  // the same mechanism the Agendado column already uses.
  test('movimento Data cell carries an ISO sort key with the time', () => {
    const html = UM.buildDomiciliosTabHtml(
      [linha({ data: '05/01/2026 08:30:15' })], UM.MODO_MOVIMENTO, hoje);
    expect(html).toContain('data-order="2026-01-05 08:30:15"');
  });

  test('biomarcadores Coleta cell carries an ISO sort key', () => {
    const html = UM.buildDomiciliosTabHtml(
      [linha({ dataVisita: '14/08/2026 10:30' })], UM.MODO_BIOMARCADORES, hoje);
    expect(html).toContain('data-order="2026-08-14 10:30"');
  });

  test('a blank or unparseable date gets an empty key, not a fake moment', () => {
    const html = UM.buildDomiciliosTabHtml(
      [linha({ data: '—invalid—' })], UM.MODO_MOVIMENTO, hoje);
    expect(html).not.toMatch(/data-order="[^"]*invalid/);
    expect(html).toContain('data-order=""');
  });

  test('time-less dates still sort by day', () => {
    const html = UM.buildDomiciliosTabHtml(
      [linha({ data: '05/01/2026' })], UM.MODO_MOVIMENTO, hoje);
    expect(html).toContain('data-order="2026-01-05"');
  });
});

describe('prazo in the Domicílios tab', () => {
  const linha = (over) => ({
    controle: 'C1', domicilio: '1', idZona: 'Z1', entrevistador: 'F',
    tipoEntrevista: 'Realizada', ultimaPosicao: '', status: 'A agendar',
    agendado: '', dataAgendada: '', dataFinalColeta: '20/08/2026',
    data: '01/08/2026', ...over,
  });
  const hoje = '2026-08-14';

  test('biomarcadores tab shows prazo and the action to take', () => {
    const html = UM.buildDomiciliosTabHtml([linha()], UM.MODO_BIOMARCADORES, hoje);
    expect(html).toContain('Prazo');
    expect(html).toContain('Ação');
    expect(html).toContain('agendar');
    // Sortable by urgency: the sort key is the recomputed day count, so
    // overdue rows lead under an ascending sort.
    expect(html).toMatch(/data-order="6"/);
  });

  test('an overdue household sorts ahead of one due today', () => {
    const html = UM.buildDomiciliosTabHtml(
      [linha({ dataFinalColeta: '24/07/2026' })], UM.MODO_BIOMARCADORES, hoje);
    expect(html).toMatch(/data-order="-21"/);
  });

  test('every Prazo cell carries a numeric sort key — one text cell broke the whole column', () => {
    // A dash cell without data-order made DataTables type the column as
    // text, so "-21" sorted after "5" lexicographically. The dash now
    // carries 9999 — not 0: a household with no deadline is not "due
    // today", and ascending (overdue first) must put it last.
    const html = UM.buildDomiciliosTabHtml(
      [linha({ dataFinalColeta: '' }), linha({ domicilio: '2' })],
      UM.MODO_BIOMARCADORES, hoje);
    expect(html).toContain('data-order="9999">—</td>');
    const prazoKeys = [...html.matchAll(/<td[^>]*data-order="(-?\d+)">(?:—|<span class="sigc-pro-prazo-num)/g)]
      .map((m) => m[1]);
    expect(prazoKeys.length).toBe(2);
    prazoKeys.forEach((k) => expect(Number.isNaN(Number(k))).toBe(false));
  });

  test('no prazo renders as an em-dash, not as zero', () => {
    const html = UM.buildDomiciliosTabHtml(
      [linha({ status: 'Não iniciado', dataFinalColeta: '' })],
      UM.MODO_BIOMARCADORES, hoje);
    expect(html).not.toMatch(/data-order="0"/);
  });

  test('alerted rows are marked so they can be spotted', () => {
    const alerta = UM.buildDomiciliosTabHtml([linha()], UM.MODO_BIOMARCADORES, hoje);
    expect(alerta).toContain('sigc-pro-prazo-alerta');
    const calmo = UM.buildDomiciliosTabHtml(
      [linha({ dataFinalColeta: '30/09/2026' })], UM.MODO_BIOMARCADORES, hoje);
    expect(calmo).not.toContain('sigc-pro-prazo-alerta');
  });

  test('MODO_MOVIMENTO has no prazo columns at all', () => {
    const html = UM.buildDomiciliosTabHtml([linha()], UM.MODO_MOVIMENTO, hoje);
    expect(html).not.toContain('Prazo');
    expect(html).not.toContain('Ação');
    // Header and body still agree.
    const ths = (html.match(/<th[ >]/g) || []).length;
    const tds = (html.match(/<td[ >]/g) || []).length;
    expect(tds).toBe(ths);
  });

  test('header and body agree in the biomarcadores tab too', () => {
    const html = UM.buildDomiciliosTabHtml([linha()], UM.MODO_BIOMARCADORES, hoje);
    const ths = (html.match(/<th[ >]/g) || []).length;
    const tds = (html.match(/<td[ >]/g) || []).length;
    expect(tds).toBe(ths);
  });

  test('biomarcadores tab carries the Agência column; movimento does not', () => {
    const bio = UM.buildDomiciliosTabHtml(
      [linha({ agencia: 'Salvador' })], UM.MODO_BIOMARCADORES, hoje);
    expect(bio).toContain('<th>Agência</th>');
    expect(bio).toContain('Salvador');
    const mov = UM.buildDomiciliosTabHtml([linha()], UM.MODO_MOVIMENTO, hoje);
    expect(mov).not.toContain('<th>Agência</th>');
  });
});

describe('prazo alert is discoverable', () => {
  const linha = (over) => ({
    controle: 'C1', domicilio: '1', idZona: 'Z1', entrevistador: 'F',
    tipoEntrevista: 'Realizada', status: 'A agendar', agendado: '',
    dataAgendada: '', dataFinalColeta: '20/08/2026', temZona: true,
    temCoordenadas: true, data: '', ...over,
  });
  const zonaRows = [{
    idZona: 'Z1', nomeZona: 'Z1', realizada: 1, naoIniciada: 0,
    domicilioFechado: 0, recusa: 0, outros: 0, totalDomicilios: 1,
    semCoordenadas: 0, agendados: 0, realizadasSemAgendamento: 1, pendentes: 1,
  }];

  test('the Domicílios tab label counts the alerts', () => {
    // Buried in a table of hundreds, an alert nobody scrolls to is not an
    // alert. The count on the tab is what makes it findable.
    const html = UM.buildPanelHtml(
      [linha(), linha({ domicilio: '2', dataFinalColeta: '30/09/2026' })],
      zonaRows, new Map(), new Map(), UM.MODO_BIOMARCADORES, '2026-08-14');
    expect(html).toMatch(/Domicílios \(2\)/);
    expect(html).toContain('1 com prazo');
  });

  test('no alerts, no warning', () => {
    const html = UM.buildPanelHtml(
      [linha({ dataFinalColeta: '30/09/2026' })],
      zonaRows, new Map(), new Map(), UM.MODO_BIOMARCADORES, '2026-08-14');
    expect(html).not.toContain('com prazo');
  });

  test('MODO_MOVIMENTO never claims a prazo count', () => {
    const html = UM.buildPanelHtml(
      [linha()], zonaRows, new Map(), new Map(), UM.MODO_MOVIMENTO, '2026-08-14');
    expect(html).not.toContain('com prazo');
  });
});

describe('zonas with no fieldwork yet', () => {
  test('a zona present only in endereços still gets a row', () => {
    // The zona where work has not started is precisely where it needs to
    // start, and the R's map dropped exactly those (25 zonas, ~705
    // households in BA). Here enderecosMap seeds the buckets BEFORE the
    // movimento rows fold in, so a zona with addresses and zero movimento
    // rows survives as an all-zeros row.
    const enderecos = new Map([
      ['C1|1', { lat: -12, lon: -38, zona: 'Zona Nova', idZona: 'ZNOVA' }],
    ]);
    const zonas = UM.aggregateZonas([], enderecos, UM.MODO_BIOMARCADORES);
    const nova = zonas.find((z) => z.idZona === 'ZNOVA');
    expect(nova).toBeDefined();
    expect(nova.nomeZona).toBe('Zona Nova');
    expect(nova.totalDomicilios).toBe(0);
  });

  test('the same holds for a controle on Último Movimento', () => {
    // Same invariant, that variant's unit: a controle with addresses and
    // no movement is the one nobody has started. The controle comes from
    // the endereços KEY ("controle|domicilio"), since the value object
    // carries only lat/lon/zona/idZona.
    const enderecos = new Map([
      ['C1|1', { lat: -12, lon: -38, zona: 'Zona Nova', idZona: 'ZNOVA' }],
    ]);
    const rows = UM.aggregateZonas([], enderecos, UM.MODO_MOVIMENTO);
    const novo = rows.find((z) => z.idZona === 'C1');
    expect(novo).toBeDefined();
    expect(novo.totalDomicilios).toBe(0);
    // No zona leaked into this variant's rows.
    expect(rows.some((z) => z.idZona === 'ZNOVA')).toBe(false);
  });

  test('it survives alongside zonas that do have movimento', () => {
    const enderecos = new Map([
      ['C1|1', { lat: -12, lon: -38, zona: 'Zona Nova', idZona: 'ZNOVA' }],
      ['C1|2', { lat: -12, lon: -38, zona: 'Zona Velha', idZona: 'ZVELHA' }],
    ]);
    const joined = [{
      controle: 'C1', domicilio: '2', idZona: 'ZVELHA', zona: 'Zona Velha',
      temZona: true, temCoordenadas: true, tipoEntrevista: 'Realizada',
      ultimaPosicao: 'Descarregado', agendado: '',
    }];
    const zonas = UM.aggregateZonas(joined, enderecos, UM.MODO_BIOMARCADORES);
    expect(zonas.map((z) => z.idZona).sort()).toEqual(['ZNOVA', 'ZVELHA']);
    expect(zonas.find((z) => z.idZona === 'ZNOVA').totalDomicilios).toBe(0);
    expect(zonas.find((z) => z.idZona === 'ZVELHA').totalDomicilios).toBe(1);
  });
});

describe('Outro Motivo is disambiguated too', () => {
  test('the legend names which Outro Motivo it means', () => {
    // Same trap as Recusa: 'Outro Motivo' exists in BOTH tipoEntrevista
    // and status, meaning different things. In BA there are 12 of the
    // biomarcador kind against 2 of the interview kind, and zero overlap.
    const labels = UM.legendEntries(UM.MODO_BIOMARCADORES).map(([l]) => l);
    expect(labels).toContain('Outro motivo (biomarcador)');
  });

  test('the popup labels the status line as the biomarcador outcome', () => {
    // Already covered by the "Biomarcadores:" prefix — asserted here so
    // the disambiguation is pinned for this value specifically.
    const html = UM.buildPopupHtml({
      controle: 'C1', domicilio: '1', entrevistador: 'F', idZona: 'Z1',
      tipoEntrevista: 'Outro Motivo', status: 'Outro Motivo',
      lat: -12, lon: -38, agendado: '', coLocated: 1,
    }, UM.MODO_BIOMARCADORES);
    expect(html).toContain('Biomarcadores: Outro Motivo');
    expect(html).toContain('Tipo: Outro Motivo');
  });
});

describe('the panel names its own source', () => {
  const zonaRows = [{
    idZona: 'Z1', nomeZona: 'Z1', realizada: 1, naoIniciada: 0,
    domicilioFechado: 0, recusa: 0, outros: 0, totalDomicilios: 1,
    semCoordenadas: 0, agendados: 0, realizadasSemAgendamento: 0, pendentes: 0,
  }];
  const joined = [{
    controle: 'C1', domicilio: '1', idZona: 'Z1', temZona: true,
    temCoordenadas: true, tipoEntrevista: 'Realizada', status: 'A agendar',
    ultimaPosicao: '', agendado: '', dataAgendada: '', dataFinalColeta: '',
  }];

  test('biomarcadores panel says so', () => {
    // Two variants that differ in which columns exist are otherwise told
    // apart only by what is MISSING — a reader who never saw the other
    // one has nothing to compare against.
    const html = UM.buildPanelHtml(
      joined, zonaRows, new Map(), new Map(), UM.MODO_BIOMARCADORES, '2026-08-14');
    expect(html).toContain('sigc-pro-panel-fonte');
    expect(html).toContain('Biomarcadores');
  });

  test('movimento panel names its source and its limitation', () => {
    const html = UM.buildPanelHtml(
      joined, zonaRows, new Map(), new Map(), UM.MODO_MOVIMENTO, '2026-08-14');
    expect(html).toContain('Último Movimento');
    // The title is just the report's name; the "cannot tell who owes a
    // biomarcador" caveat lives in the tooltip and the Entenda tab.
    expect(html).not.toContain('demanda estimada');
  });
});

describe('CSV export per tab', () => {
  test('extracts a table to header + rows, matching what is on screen', () => {
    // Read from the rendered DOM, not re-derived from the row objects:
    // the two variants show different columns, and a CSV built from a
    // separate code path would drift from the table beside it.
    document.body.innerHTML =
      '<table id="t"><thead><tr><th>A</th><th>B</th></tr></thead>' +
      '<tbody><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></tbody></table>';
    try {
      const { header, rows } = UM.tabelaParaCsv(document.getElementById('t'));
      expect(header).toEqual(['A', 'B']);
      expect(rows).toEqual([['1', '2'], ['3', '4']]);
    } finally {
      document.body.innerHTML = '';
    }
  });

  test('the pin column is dropped — it is a control, not data', () => {
    document.body.innerHTML =
      '<table id="t"><thead><tr>' +
      '<th class="sigc-pro-zona-pin-col"></th><th>Zona</th></tr></thead>' +
      '<tbody><tr><td class="sigc-pro-zona-pin-col">' +
      '<span class="sigc-pro-zona-pin">📍</span></td><td>Z1</td></tr></tbody></table>';
    try {
      const { header, rows } = UM.tabelaParaCsv(document.getElementById('t'));
      expect(header).toEqual(['Zona']);
      expect(rows).toEqual([['Z1']]);
    } finally {
      document.body.innerHTML = '';
    }
  });

  test('a slots cell collapses to one line instead of leaking markup', () => {
    // The Slots livres cell is a block of per-day markup; flattened
    // naively it drags newlines into the field and breaks the row.
    document.body.innerHTML =
      '<table id="t"><thead><tr><th>Slots</th></tr></thead><tbody><tr>' +
      '<td class="sigc-pro-slots-cell"><div>01/09\n09:00</div><div>02/09\n14:00</div>' +
      '</td></tr></tbody></table>';
    try {
      const { rows } = UM.tabelaParaCsv(document.getElementById('t'));
      expect(rows[0][0]).not.toContain('\n');
      expect(rows[0][0]).toContain('01/09');
      expect(rows[0][0]).toContain('02/09');
    } finally {
      document.body.innerHTML = '';
    }
  });

  test('DataTables paging does not truncate the export', () => {
    // The panel's tables are DataTables-backed; a naive tbody scrape
    // exports only the visible page, which is the exact bug
    // readDataTable() exists to avoid elsewhere in this file.
    document.body.innerHTML =
      '<table id="t"><thead><tr><th>A</th></tr></thead>' +
      '<tbody><tr><td>visivel</td></tr></tbody></table>';
    const tbl = document.getElementById('t');
    // Models real DataTables: rows().nodes() yields only the nodes it has
    // RENDERED — off-page rows have no DOM node at all — while
    // rows().data() carries the full dataset. An earlier version of this
    // fake returned every row from nodes(), which made the test pass
    // against code that still truncated at the page boundary.
    const jq = () => ({
      DataTable: () => ({
        rows: () => ({
          nodes: () => [
            Object.assign(document.createElement('tr'), { innerHTML: '<td>pagina1</td>' }),
          ],
          data: () => ({
            toArray: () => [['pagina1'], ['pagina2'], ['pagina3']],
          }),
        }),
      }),
    });
    jq.fn = { dataTable: { isDataTable: () => true } };
    const original = window.jQuery;
    window.jQuery = window.$ = jq;
    try {
      const { rows } = UM.tabelaParaCsv(tbl);
      expect(rows).toEqual([['pagina1'], ['pagina2'], ['pagina3']]);
    } finally {
      window.jQuery = window.$ = original;
      document.body.innerHTML = '';
    }
  });

  test('the filename names the tab and the variant', () => {
    expect(UM.nomeCsvAba('zonas', UM.MODO_BIOMARCADORES, '2026-08-15'))
      .toBe('sigc-pro-biomarcadores-zonas-2026-08-15.csv');
    expect(UM.nomeCsvAba('domicilios', UM.MODO_MOVIMENTO, '2026-08-15'))
      .toBe('sigc-pro-ultimo-movimento-domicilios-2026-08-15.csv');
    // The movimento "zonas" tab holds controles, and the file says so.
    expect(UM.nomeCsvAba('zonas', UM.MODO_MOVIMENTO, '2026-08-15'))
      .toBe('sigc-pro-ultimo-movimento-controles-2026-08-15.csv');
  });
});

describe('CSV buttons in the panel', () => {
  const zonaRows = [{
    idZona: 'Z1', nomeZona: 'Zona 1', realizada: 1, naoIniciada: 0,
    domicilioFechado: 0, recusa: 0, outros: 0, totalDomicilios: 1,
    semCoordenadas: 0, agendados: 0, realizadasSemAgendamento: 1, pendentes: 1,
  }];
  const joined = [{
    controle: 'C1', domicilio: '1', idZona: 'Z1', temZona: true,
    temCoordenadas: true, tipoEntrevista: 'Realizada', status: 'A agendar',
    ultimaPosicao: '', agendado: '', dataAgendada: '',
    dataFinalColeta: '20/08/2026', entrevistador: 'F', data: '',
  }];

  test('every data tab gets a CSV button, and the Mapa tab does not', () => {
    // Nothing tabular to export from a map — a CSV button there would
    // promise a file it cannot build.
    const html = UM.buildPanelHtml(
      joined, zonaRows, new Map(), new Map(), UM.MODO_BIOMARCADORES, '2026-08-15');
    expect(html).toContain('data-csv-aba="zonas"');
    expect(html).toContain('data-csv-aba="domicilios"');
    expect(html).not.toContain('data-csv-aba="mapa"');
  });

  test('the button downloads the tab it belongs to', async () => {
    document.body.innerHTML = UM.buildPanelHtml(
      joined, zonaRows, new Map(), new Map(), UM.MODO_BIOMARCADORES, '2026-08-15');
    const panelEl = document.getElementById('sigc-pro-ultimo-movimento-map-panel');
    const baixados = [];
    const originalDownload = window.__sigcPro.downloadFile;
    window.__sigcPro.downloadFile = (nome, texto) => baixados.push({ nome, texto });
    try {
      UM.wireTabs(panelEl, UM.MODO_BIOMARCADORES);
      panelEl.querySelector('[data-csv-aba="zonas"]').click();
      expect(baixados).toHaveLength(1);
      expect(baixados[0].nome).toMatch(/^sigc-pro-biomarcadores-zonas-/);
      // Semicolon-delimited, header first, one row of data.
      const linhas = baixados[0].texto.trim().split('\r\n');
      // Zona and nome share one column now, so the CSV cell carries both.
      expect(linhas[0]).toContain('Zona;A entrevistar');
      expect(linhas[1]).toContain('Z1 Zona 1;');
      // The pin column is gone from both.
      expect(baixados[0].texto).not.toContain('📍');
    } finally {
      window.__sigcPro.downloadFile = originalDownload;
      document.body.innerHTML = '';
    }
  });

  test('clicking the CSV button does not switch tabs', async () => {
    // The button lives on the tab bar next to the tab itself; if the
    // click bubbled, exporting would yank the user to another tab.
    document.body.innerHTML = UM.buildPanelHtml(
      joined, zonaRows, new Map(), new Map(), UM.MODO_BIOMARCADORES, '2026-08-15');
    const panelEl = document.getElementById('sigc-pro-ultimo-movimento-map-panel');
    const originalDownload = window.__sigcPro.downloadFile;
    window.__sigcPro.downloadFile = () => {};
    try {
      UM.wireTabs(panelEl, UM.MODO_BIOMARCADORES);
      const mapaAtivo = () =>
        panelEl.querySelector('#sigc-pro-mapa-panel').classList.contains('sigc-pro-tab-panel-active');
      expect(mapaAtivo()).toBe(true);
      panelEl.querySelector('[data-csv-aba="domicilios"]').click();
      expect(mapaAtivo()).toBe(true);
    } finally {
      window.__sigcPro.downloadFile = originalDownload;
      document.body.innerHTML = '';
    }
  });
});

describe('CSV keeps the prazo numeric', () => {
  test('an overdue prazo exports as a plain negative number', () => {
    // "-22 (vencido)" is not a plain number, so the CSV
    // formula-injection guard quotes it as text — and Excel then cannot
    // sort the very rows that matter most. The suffix is display sugar;
    // the number is the data, so the export carries the number and the
    // sort survives.
    document.body.innerHTML =
      '<table id="t"><thead><tr><th>Prazo</th></tr></thead><tbody><tr>' +
      '<td data-order="-22" class="sigc-pro-prazo-cell sigc-pro-prazo-alerta">' +
      '<span class="sigc-pro-prazo-num sigc-pro-prazo-num-oculto">-22</span>Vencido</td>' +
      '</tr></tbody></table>';
    try {
      const { rows } = UM.tabelaParaCsv(document.getElementById('t'));
      expect(rows[0][0]).toBe('-22');
    } finally {
      document.body.innerHTML = '';
    }
  });

  test('cells without a numeric sort key are untouched', () => {
    document.body.innerHTML =
      '<table id="t"><thead><tr><th>Agendado</th></tr></thead><tbody><tr>' +
      '<td data-order="2026-09-01T09:00:00">01/09/2026 09:00</td>' +
      '</tr></tbody></table>';
    try {
      const { rows } = UM.tabelaParaCsv(document.getElementById('t'));
      expect(rows[0][0]).toBe('01/09/2026 09:00');
    } finally {
      document.body.innerHTML = '';
    }
  });
});

describe('CSV keeps the slots list intact', () => {
  test('the Slots livres cell exports its days, not its count', () => {
    // This cell also carries a numeric data-order (the slot COUNT), so a
    // rule of "any numeric sort key wins" would replace a day-by-day
    // list with a bare "2" — losing the column's entire content. The
    // substitution is opt-in by class for exactly this reason.
    const zonaRows = [{
      idZona: 'Z1', nomeZona: 'Pituba', realizada: 1, naoIniciada: 0,
      domicilioFechado: 0, recusa: 0, outros: 0, totalDomicilios: 1,
      semCoordenadas: 0, agendados: 0, realizadasSemAgendamento: 1, pendentes: 1,
    }];
    const slots = new Map([['Z1', [{ isoDate: '2026-09-01', horas: ['09:00', '14:00'] }]]]);
    const turnos = new Map([['Z1', { manha: 1, tarde: 1 }]]);
    document.body.innerHTML = '<div>' +
      UM.buildZonasTableHtml(zonaRows, slots, turnos, UM.MODO_BIOMARCADORES) + '</div>';
    try {
      const { header, rows } = UM.tabelaParaCsv(document.querySelector('table'));
      const celula = rows[0][header.indexOf('Slots livres')];
      expect(celula).not.toBe('2');
      expect(celula).toContain('09:00');
      expect(celula).toContain('14:00');
    } finally {
      document.body.innerHTML = '';
    }
  });
});

describe('untouched households get their own column', () => {
  const linha = (over) => ({
    controle: 'C1', domicilio: '1', idZona: 'Z1', zona: 'Z1', temZona: true,
    temCoordenadas: true, tipoEntrevista: 'Não Iniciada',
    ultimaPosicao: 'Distribuido', agendado: '', ...over,
  });

  test('columns follow the tipo de entrevista, whatever the posição', () => {
    // A household whose posição literally reads 'Distribuido' must not
    // land in a column called "Não distribuída" — an earlier version
    // filed Distribuido/Enviado para Carga there, reinterpreting the
    // posição instead of carrying the report's own tipo.
    const zonas = UM.aggregateZonas([
      linha({ domicilio: '1', ultimaPosicao: 'Distribuido' }),
      linha({ domicilio: '2', ultimaPosicao: 'Enviado para Carga' }),
      linha({ domicilio: '3', ultimaPosicao: 'Descarregado Parcialmente' }),
    ], new Map(), UM.MODO_MOVIMENTO);
    expect(zonas[0].naoDistribuida).toBe(0);
    // All three carry tipo 'Não Iniciada', so all three count there.
    expect(zonas[0].naoIniciada).toBe(3);
  });

  test('only the literal Não Distribuido counts there, in any case/accent form', () => {
    // Never seen in the parquet history (its five values are the whole
    // recorded domain), but the SIGC UI can show it — so the spelling is
    // unverifiable and every plausible form must land in the same column.
    const formas = ['Não Distribuido', 'Não Distribuído',
      'Não distribuido', 'Não distribuído'];
    const zonas = UM.aggregateZonas(
      formas.map((p, i) => linha({ domicilio: String(i + 1), ultimaPosicao: p })),
      new Map(), UM.MODO_MOVIMENTO);
    expect(zonas[0].naoDistribuida).toBe(formas.length);
    expect(zonas[0].naoIniciada).toBe(0);
  });

  test('the total still accounts for every household exactly once', () => {
    const zonas = UM.aggregateZonas([
      linha({ domicilio: '1', ultimaPosicao: 'Distribuido' }),
      linha({ domicilio: '2', tipoEntrevista: 'Realizada', ultimaPosicao: 'Descarregado' }),
      linha({ domicilio: '3', tipoEntrevista: 'Uso Ocasional', ultimaPosicao: 'Descarregado' }),
    ], new Map(), UM.MODO_MOVIMENTO);
    const z = zonas[0];
    const soma = z.realizada + z.naoIniciada + z.domicilioFechado +
      z.recusa + z.outros + z.naoDistribuida;
    expect(soma).toBe(z.totalDomicilios);
    expect(z.totalDomicilios).toBe(3);
  });

  test('Outros keeps the worked-but-uninterviewable tipos', () => {
    // Outros was never the problem: in BA its 148 households are all
    // already descarregado (Domicílio Vago, Uso Ocasional, Demolida...).
    const zonas = UM.aggregateZonas([
      linha({ tipoEntrevista: 'Domicílio Vago', ultimaPosicao: 'Descarregado' }),
    ], new Map(), UM.MODO_MOVIMENTO);
    expect(zonas[0].outros).toBe(1);
    expect(zonas[0].naoDistribuida).toBe(0);
  });

  test('the column shows in both variants', () => {
    const zonaRow = {
      idZona: 'Z1', nomeZona: 'Z1', realizada: 0, naoIniciada: 0,
      domicilioFechado: 0, recusa: 0, outros: 0, naoDistribuida: 4,
      totalDomicilios: 4, semCoordenadas: 0, agendados: 0,
      realizadasSemAgendamento: 0, pendentes: 0,
    };
    [UM.MODO_MOVIMENTO, UM.MODO_BIOMARCADORES].forEach((modo) => {
      const html = UM.buildZonasTableHtml([zonaRow], new Map(), new Map(), modo);
      expect(html).toContain(modo.comDemanda ? 'A entrevistar' : 'Não distribuída');
      // Header and body still agree.
      const ths = (html.match(/<th[ >]/g) || []).length;
      const tds = (html.match(/<td[ >]/g) || []).length;
      expect(tds).toBe(ths);
    });
  });
});

describe('the map colours by tipo de entrevista', () => {
  const cor = (ultimaPosicao) => UM.statusColor(
    { ultimaPosicao, tipoEntrevista: 'Não Iniciada' }, UM.MODO_MOVIMENTO, '2026-08-15');

  test('only the literal Não Distribuído is inactive grey', () => {
    expect(cor('Não Distribuído')).toBe('#888888');
    expect(cor('Não Distribuido')).toBe('#888888');
  });

  test('Distribuido and Enviado para Carga take their tipo colour', () => {
    // Their tipo is 'Não Iniciada', so they render as not-started —
    // never as the "não distribuída" grey their posição contradicts.
    expect(cor('Distribuido')).not.toBe('#888888');
    expect(cor('Enviado para Carga')).toBe(cor('Distribuido'));
  });

  test('the legend keeps the Não distribuída entry', () => {
    const labels = UM.legendEntries(UM.MODO_MOVIMENTO).map(([l]) => l);
    expect(labels).toContain('Não distribuída');
    expect(labels).not.toContain('Inativo (Distribuído)');
  });
});

describe('a finished household has no deadline to miss', () => {
  const linha = (over) => ({
    controle: 'C1', domicilio: '1', idZona: 'Z1', entrevistador: 'F',
    tipoEntrevista: 'Realizada', status: 'A agendar', agendado: '',
    dataAgendada: '', dataFinalColeta: '24/07/2026', data: '', ...over,
  });
  const hoje = '2026-08-14';

  test('a collected household shows no prazo at all', () => {
    // It kept its deadline in the data, and printing "-22 (vencido)" for
    // work that is DONE reads as a missed deadline. The deadline stopped
    // meaning anything the moment the collection happened.
    const html = UM.buildDomiciliosTabHtml(
      [linha({ status: 'Coletado Sangue e Urina' })], UM.MODO_BIOMARCADORES, hoje);
    // Scoped to the body: the Prazo header tooltip legitimately explains
    // what "vencido" means, so the whole-HTML check would never pass.
    const corpo = html.split('<tbody>')[1];
    expect(corpo).not.toContain('Vencido');
    expect(corpo).not.toContain('-21');
  });

  test('the same is true of the closed-without-collection outcomes', () => {
    // Nothing left to do before the deadline, so the deadline is moot.
    ['Outro Motivo', 'Não elegível'].forEach((status) => {
      const html = UM.buildDomiciliosTabHtml([linha({ status })], UM.MODO_BIOMARCADORES, hoje);
      expect(html.split('<tbody>')[1]).not.toContain('Vencido');
    });
  });

  test('Recusa still shows it — reverting is still on the clock', () => {
    const html = UM.buildDomiciliosTabHtml(
      [linha({ status: 'Recusa' })], UM.MODO_BIOMARCADORES, hoje);
    expect(html.split('<tbody>')[1]).toContain('Vencido');
  });

  test('overdue reads "Vencido", never a negative number', () => {
    // A negative number is noise in a column of day counts: how long ago
    // it lapsed changes nothing about what to do. The word says the one
    // thing that matters, and data-order keeps the sort numeric so
    // overdue rows still lead.
    const corpo = UM.buildDomiciliosTabHtml(
      [linha()], UM.MODO_BIOMARCADORES, hoje).split('<tbody>')[1];
    expect(corpo).toContain('>Vencido<');
    expect(corpo).not.toContain('-21 (');
    expect(corpo).toContain('data-order="-21"');
  });

  test('a prazo still running shows the day count', () => {
    const corpo = UM.buildDomiciliosTabHtml(
      [linha({ dataFinalColeta: '20/08/2026' })], UM.MODO_BIOMARCADORES, hoje)
      .split('<tbody>')[1];
    expect(corpo).toContain('>6<');
    expect(corpo).not.toContain('Vencido');
  });
});

describe('off-page rows keep their column semantics', () => {
  // DataTables hands back the cell's INNER html, without attributes, so
  // an off-page Prazo cell has no data-order of its own. Its per-row
  // value cannot be recovered — and inheriting the visible row's key
  // would stamp every exported row with the same number, which is worse
  // than a text value.
  function fakeDt(tabela, dados) {
    const jq = () => ({
      DataTable: () => ({ rows: () => ({ data: () => ({ toArray: () => dados }) }) }),
    });
    jq.fn = { dataTable: { isDataTable: () => true } };
    return jq;
  }

  test('an off-page Prazo cell never inherits the visible row\'s sort key', () => {
    document.body.innerHTML =
      '<table id="t"><thead><tr><th>Prazo</th></tr></thead><tbody>' +
      '<tr><td class="sigc-pro-prazo-cell" data-order="6">6</td></tr></tbody></table>';
    const tbl = document.getElementById('t');
    const original = window.jQuery;
    window.jQuery = window.$ = fakeDt(tbl, [['6'], ['Vencido'], ['3']]);
    try {
      const { rows } = UM.tabelaParaCsv(tbl);
      // Three rows exported, and the overdue one is NOT stamped with 6.
      expect(rows).toHaveLength(3);
      expect(rows[1][0]).not.toBe('6');
      expect(rows[2][0]).toBe('3');
    } finally {
      window.jQuery = window.$ = original;
      document.body.innerHTML = '';
    }
  });

  test('classes still come across, so column behaviour is preserved', () => {
    document.body.innerHTML =
      '<table id="t"><thead><tr><th>Slots</th></tr></thead><tbody>' +
      '<tr><td class="sigc-pro-slots-cell" data-order="2">01/09 09:00</td></tr>' +
      '</tbody></table>';
    const tbl = document.getElementById('t');
    const original = window.jQuery;
    window.jQuery = window.$ = fakeDt(tbl, [['01/09 09:00'], ['<div>02/09\n14:00</div>']]);
    try {
      const { rows } = UM.tabelaParaCsv(tbl);
      // Markup flattened, newline gone — the same treatment the rendered
      // row gets.
      expect(rows[1][0]).toBe('02/09 14:00');
    } finally {
      window.jQuery = window.$ = original;
      document.body.innerHTML = '';
    }
  });
});

describe('the prazo travels with the cell, not just its attribute', () => {
  test('an off-page overdue row still exports a number', () => {
    // DataTables gives back inner HTML without attributes, so data-order
    // is unreachable for off-page rows. Carrying the number INSIDE the
    // cell (hidden) means every row exports numerically, whether it was
    // rendered or not.
    document.body.innerHTML =
      '<table id="t"><thead><tr><th>Prazo</th></tr></thead><tbody>' +
      '<tr><td class="sigc-pro-prazo-cell" data-order="6">' +
      '<span class="sigc-pro-prazo-num">6</span></td></tr></tbody></table>';
    const tbl = document.getElementById('t');
    const jq = () => ({
      DataTable: () => ({ rows: () => ({ data: () => ({ toArray: () => [
        ['<span class="sigc-pro-prazo-num">6</span>'],
        ['<span class="sigc-pro-prazo-num">-21</span>Vencido'],
      ] }) }) }),
    });
    jq.fn = { dataTable: { isDataTable: () => true } };
    const original = window.jQuery;
    window.jQuery = window.$ = jq;
    try {
      const { rows } = UM.tabelaParaCsv(tbl);
      expect(rows).toEqual([['6'], ['-21']]);
    } finally {
      window.jQuery = window.$ = original;
      document.body.innerHTML = '';
    }
  });

  test('the visible cell still reads Vencido', () => {
    const linha = {
      controle: 'C1', domicilio: '1', idZona: 'Z1', entrevistador: 'F',
      tipoEntrevista: 'Realizada', status: 'A agendar', agendado: '',
      dataAgendada: '', dataFinalColeta: '24/07/2026', data: '',
    };
    document.body.innerHTML = '<div>' +
      UM.buildDomiciliosTabHtml([linha], UM.MODO_BIOMARCADORES, '2026-08-14') + '</div>';
    try {
      const celula = document.querySelector('.sigc-pro-prazo-cell');
      // The number is present for the exporter but hidden from the eye.
      expect(celula.textContent).toContain('Vencido');
      expect(celula.querySelector('.sigc-pro-prazo-num').textContent).toBe('-21');
    } finally {
      document.body.innerHTML = '';
    }
  });
});

describe('initPanelTables refuses malformed tables', () => {
  test('a table whose body does not match its header is never initialized', () => {
    // DataTables reports a column-count mismatch through alert(), not a
    // thrown error, so the try/catch around the init cannot contain it.
    // The only defence is not handing it such a table.
    document.body.innerHTML =
      '<div id="p" data-sigc-pro>' +
      '<table><thead><tr><th>A</th><th>B</th></tr></thead>' +
      '<tbody><tr><td>so-uma</td></tr></tbody></table></div>';
    const prev = window.jQuery;
    let iniciou = 0;
    const fake = () => ({ DataTable: () => { iniciou += 1; return { page: () => ({ len: () => ({ draw: () => {} }) }) }; } });
    fake.fn = { dataTable: { isDataTable: () => false } };
    window.jQuery = window.$ = fake;
    const warnSpy = console.warn;
    console.warn = () => {};
    try {
      UM.initPanelTables(document.getElementById('p'));
      expect(iniciou).toBe(0);
    } finally {
      console.warn = warnSpy;
      window.jQuery = window.$ = prev;
      document.body.innerHTML = '';
    }
  });

  test('a well-formed table is still initialized', () => {
    document.body.innerHTML =
      '<div id="p" data-sigc-pro>' +
      '<table><thead><tr><th>A</th><th>B</th></tr></thead>' +
      '<tbody><tr><td>1</td><td>2</td></tr></tbody></table></div>';
    const prev = window.jQuery;
    let iniciou = 0;
    const fake = () => ({ DataTable: () => { iniciou += 1; return {}; } });
    fake.fn = { dataTable: { isDataTable: () => false } };
    window.jQuery = window.$ = fake;
    try {
      UM.initPanelTables(document.getElementById('p'));
      expect(iniciou).toBe(1);
    } finally {
      window.jQuery = window.$ = prev;
      document.body.innerHTML = '';
    }
  });

  test('an empty table is fine — no rows means no mismatch', () => {
    document.body.innerHTML =
      '<div id="p" data-sigc-pro>' +
      '<table><thead><tr><th>A</th></tr></thead><tbody></tbody></table></div>';
    const prev = window.jQuery;
    let iniciou = 0;
    const fake = () => ({ DataTable: () => { iniciou += 1; return {}; } });
    fake.fn = { dataTable: { isDataTable: () => false } };
    window.jQuery = window.$ = fake;
    try {
      UM.initPanelTables(document.getElementById('p'));
      expect(iniciou).toBe(1);
    } finally {
      window.jQuery = window.$ = prev;
      document.body.innerHTML = '';
    }
  });
});

describe('agência reaches the map rows', () => {
  const BIO_HEADERS = [
    'UF', 'Agência', 'Município', 'ID Zona', 'Nome Zona', '#!Controle',
    '!N.º Domicílio', 'Tipo Entrevista', 'Nome Equipe', 'Status',
    'Siape Agendamento', 'Data Resposta 25A.01', 'Data Agendada',
    'Data Visita Biomarcadores', 'Siape Coleta Biomarcadores',
    'Data Final para Coleta', 'Dias Prazo Final', 'Data/hora coleta sangue',
    'Status sangue', 'Motivo sangue', 'Data/hora coleta urina',
    'Status urina', 'Motivo urina', 'Dias entre 1° agendamento e coleta',
  ];
  const BIO_ROW = [
    '29', '292740800', '2927408', '29XJYY', 'Pituba', '292740805220571',
    '1', 'Realizada', 'EQ1', 'A agendar', '', '', '', '', '',
    '20/08/2026', '6', '', '', '', '', '', '', '',
  ];

  test('the agência column is parsed, so layers can group by it', () => {
    const row = UM.biomarcadoresParaLinhas(BIO_HEADERS, [BIO_ROW])
      .get('292740805220571|1');
    expect(row.agencia).toBe('292740800');
  });
});

describe('marker radius scales with zoom', () => {
  // Ported from pns.zonas' map_corredores.R:1262-1268. At ~3.400 markers a
  // fixed 9px is a solid smear zoomed out and larger than the building
  // zoomed in. Urgent markers run ~50% larger at every level so they keep
  // standing out without blowing up close in.
  test('grows from state view to street view', () => {
    expect(UM.raioPorZoom(9, false)).toBeLessThan(UM.raioPorZoom(13, false));
    expect(UM.raioPorZoom(13, false)).toBeLessThan(UM.raioPorZoom(18, false));
    expect(UM.raioPorZoom(9, false)).toBe(3);
    expect(UM.raioPorZoom(18, false)).toBe(13);
  });

  test('urgent markers are larger at every level', () => {
    [9, 13, 16, 18].forEach((z) => {
      expect(UM.raioPorZoom(z, true)).toBeGreaterThan(UM.raioPorZoom(z, false));
    });
    expect(UM.raioPorZoom(9, true)).toBe(4.5);
    expect(UM.raioPorZoom(18, true)).toBe(19);
  });

  test('interpolates between the anchor points', () => {
    // Halfway from zoom 9 (3px) to 13 (6px).
    expect(UM.raioPorZoom(11, false)).toBe(4.5);
  });

  test('clamps outside the anchor range instead of extrapolating', () => {
    // A world-level zoom must not produce a negative radius.
    expect(UM.raioPorZoom(0, false)).toBe(3);
    expect(UM.raioPorZoom(22, false)).toBe(13);
  });
});

describe('urgency is visible on the map', () => {
  const linha = (over) => ({
    controle: 'C1', domicilio: '1', idZona: 'Z1', status: 'A agendar',
    tipoEntrevista: 'Realizada', dataAgendada: '', dataFinalColeta: '20/08/2026',
    ...over,
  });

  test('an alerted household is marked urgent, a calm one is not', () => {
    // The alert already existed in the Domicílios table; the map is where
    // someone plans a route, so it has to carry it too.
    expect(UM.marcadorUrgente(linha(), UM.MODO_BIOMARCADORES, '2026-08-14')).toBe(true);
    expect(UM.marcadorUrgente(
      linha({ dataFinalColeta: '30/09/2026' }), UM.MODO_BIOMARCADORES, '2026-08-14')).toBe(false);
  });

  test('a collected household is never urgent', () => {
    expect(UM.marcadorUrgente(
      linha({ status: 'Coletado Sangue e Urina' }),
      UM.MODO_BIOMARCADORES, '2026-08-14')).toBe(false);
  });

  test('MODO_MOVIMENTO has no deadline data, so nothing is urgent', () => {
    expect(UM.marcadorUrgente(linha(), UM.MODO_MOVIMENTO, '2026-08-14')).toBe(false);
  });

  test('the urgent halo is dark, not white', () => {
    // White disappears against the yellow needs-action fill — the R hit
    // this and switched to a dark stroke.
    expect(UM.corDaBorda(true)).not.toBe('white');
    expect(UM.corDaBorda(false)).toBe('white');
  });
});

describe('agência layer toggles', () => {
  const linha = (over) => ({
    controle: 'C1', domicilio: '1', idZona: 'Z1', temZona: true,
    temCoordenadas: true, lat: -12, lon: -38, origLat: -12, origLon: -38,
    tipoEntrevista: 'Realizada', status: 'A agendar', ultimaPosicao: '',
    agendado: '', dataAgendada: '', dataFinalColeta: '', agencia: '292740800',
    entrevistador: '', coLocated: 1, ...over,
  });

  test('groups rows by agência, sorted, for the layer control', () => {
    const grupos = UM.agruparPorAgencia([
      linha({ domicilio: '1', agencia: '292740800' }),
      linha({ domicilio: '2', agencia: '290570100' }),
      linha({ domicilio: '3', agencia: '292740800' }),
    ]);
    expect([...grupos.keys()]).toEqual(['290570100', '292740800']);
    expect(grupos.get('292740800')).toHaveLength(2);
  });

  test('rows with no agência fall into one labelled bucket', () => {
    // Último Movimento carries no agência column at all, so this is the
    // normal case there — the bucket must be named, not blank.
    const grupos = UM.agruparPorAgencia([linha({ agencia: '' })]);
    expect([...grupos.keys()]).toEqual(['Sem agência']);
  });

  test('a single agência is not worth a layer control', () => {
    // The scope gate already requires agência/município/controle, so a
    // one-agência report is the common case. A control with one checkbox
    // is chrome that toggles nothing.
    expect(UM.valeControleDeCamadas(UM.agruparPorAgencia([linha()]))).toBe(false);
    expect(UM.valeControleDeCamadas(UM.agruparPorAgencia([
      linha({ domicilio: '1', agencia: 'A' }),
      linha({ domicilio: '2', agencia: 'B' }),
    ]))).toBe(true);
  });
});

describe('renderLeafletMap wires the three map features', () => {
  // Drives the real render path against a recording fake, so the wiring
  // is covered — not just the pure helpers. The pre-existing fake only
  // asserted the map got constructed, which is how a missing getZoom()
  // could have shipped.
  function recordingLeaflet() {
    const rec = {
      circles: [], grupos: 0, camadas: null, zoomHandlers: [], addedTo: [],
    };
    // addTo returns the layer itself, as real Leaflet does — returning
    // anything else breaks the chained .bindPopup() the render path uses.
    // Hull tooltips carry the grouping key, so recording them is how a
    // test can tell WHAT the outlines were drawn around.
    rec.hullTooltips = [];
    const mkLayer = (isHull) => {
      const layer = {
        addTo(dest) { rec.addedTo.push(dest === rec.map ? 'map' : 'grupo'); return layer; },
        bindTooltip(t) { if (isHull) rec.hullTooltips.push(t); return layer; },
        bindPopup() { return layer; },
        setRadius(r) { rec.circles.push({ raio: r, set: true }); return layer; },
      };
      return layer;
    };
    rec.map = {
      addLayer: () => {}, setView() { return this; }, fitBounds() { return this; },
      getZoom: () => 13,
      on: (ev, fn) => { if (ev === 'zoomend') rec.zoomHandlers.push(fn); return rec.map; },
    };
    const L = {
      map: (c) => { if (c) c.innerHTML = ''; return rec.map; },
      tileLayer: () => mkLayer(),
      polygon: () => mkLayer(true), polyline: () => mkLayer(true), circle: () => mkLayer(true),
      circleMarker: (_ll, opts) => {
        const m = mkLayer();
        rec.circles.push({ raio: opts.radius, cor: opts.color, peso: opts.weight });
        return m;
      },
      marker: () => mkLayer(),
      divIcon: () => ({}),
      layerGroup: () => { rec.grupos += 1; return mkLayer(); },
      DomUtil: { create: () => document.createElement('div') },
      control: Object.assign(() => ({ addTo: () => {}, onAdd: null }), {
        layers: (_base, overlays) => { rec.camadas = Object.keys(overlays); return { addTo: () => {} }; },
      }),
    };
    return { L, rec };
  }

  const linha = (over) => ({
    controle: 'C1', domicilio: '1', idZona: 'Z1', zona: 'Z1', temZona: true,
    temCoordenadas: true, lat: -12, lon: -38, tipoEntrevista: 'Realizada',
    status: 'A agendar', ultimaPosicao: '', agendado: '', dataAgendada: '',
    dataFinalColeta: '', entrevistador: '', agencia: '292740800', ...over,
  });

  const render = (rows, modo) => {
    const { L, rec } = recordingLeaflet();
    const container = document.createElement('div');
    document.body.appendChild(container);
    try {
      UM.renderLeafletMap(L, container, rows, modo);
    } finally {
      container.remove();
    }
    return rec;
  };

  test('registers a zoomend handler that resizes markers', () => {
    const rec = render([linha()], UM.MODO_BIOMARCADORES);
    expect(rec.zoomHandlers).toHaveLength(1);
    const antes = rec.circles.length;
    rec.zoomHandlers[0]();
    // Every marker got a new radius, none was rebuilt.
    expect(rec.circles.length).toBeGreaterThan(antes);
    expect(rec.circles.at(-1).set).toBe(true);
  });

  test('an urgent household is drawn larger with a dark edge', () => {
    const urgente = render(
      [linha({ dataFinalColeta: '20/08/2026' })], UM.MODO_BIOMARCADORES);
    const calmo = render([linha()], UM.MODO_BIOMARCADORES);
    expect(urgente.circles[0].raio).toBeGreaterThan(calmo.circles[0].raio);
    expect(urgente.circles[0].cor).not.toBe('white');
    expect(calmo.circles[0].cor).toBe('white');
  });

  test('one agência means no layer control and no groups', () => {
    const rec = render([linha()], UM.MODO_BIOMARCADORES);
    expect(rec.grupos).toBe(0);
    expect(rec.camadas).toBeNull();
  });

  test('two agências get one layer each, labelled with their counts', () => {
    const rec = render([
      linha({ domicilio: '1', agencia: '292740800' }),
      linha({ domicilio: '2', agencia: '290570100' }),
      linha({ domicilio: '3', agencia: '290570100' }),
    ], UM.MODO_BIOMARCADORES);
    expect(rec.grupos).toBe(2);
    expect(rec.camadas).toEqual([
      'Agência 290570100 (2)', 'Agência 292740800 (1)',
    ]);
  });

  // The hull is the map's picture of whatever the aggregate tab counts.
  // If the two ever group by different fields, an outline and a row
  // claim to be the same set of households while containing different
  // ones — and nothing errors.
  describe('hulls outline the same unit the aggregate tab counts', () => {
    const doisControles = [
      linha({ controle: 'C1', domicilio: '1', idZona: 'Z1', lat: -12, lon: -38 }),
      linha({ controle: 'C1', domicilio: '2', idZona: 'Z1', lat: -12.1, lon: -38.1 }),
      linha({ controle: 'C2', domicilio: '1', idZona: 'Z1', lat: -13, lon: -39 }),
    ];

    test('Último Movimento draws one hull per controle', () => {
      const rec = render(doisControles, UM.MODO_MOVIMENTO);
      expect(rec.hullTooltips.sort()).toEqual(['C1', 'C2']);
    });

    test('biomarcadores still draws one hull per zona', () => {
      // Same three households, one zona: the zona grouping must be
      // untouched by the movimento change.
      const rec = render(doisControles, UM.MODO_BIOMARCADORES);
      expect(rec.hullTooltips).toEqual(['Z1']);
    });

    test('a row with no zona still gets a controle hull on Último Movimento', () => {
      // Zona is absent from this variant entirely, so its absence on a
      // row cannot cost that row an outline.
      const rec = render([
        linha({ controle: 'C7', domicilio: '1', idZona: '', zona: '', temZona: false, lat: -12, lon: -38 }),
        linha({ controle: 'C7', domicilio: '2', idZona: '', zona: '', temZona: false, lat: -12.2, lon: -38.2 }),
      ], UM.MODO_MOVIMENTO);
      expect(rec.hullTooltips).toEqual(['C7']);
    });
  });
});

describe('demand columns are disjoint and add up', () => {
  const linha = (over) => ({
    controle: 'C1', domicilio: '1', idZona: 'Z1', temZona: true,
    temCoordenadas: true, tipoEntrevista: 'Realizada', ultimaPosicao: 'Descarregado',
    status: 'A agendar', agendado: '', dataAgendada: '', ...over,
  });
  const agg = (rows) => UM.aggregateZonas(rows, new Map(), UM.MODO_BIOMARCADORES, '2026-08-15')[0];

  test('a agendar and ja agendados never overlap', () => {
    const z = agg([
      linha({ domicilio: '1', status: 'A agendar' }),
      linha({ domicilio: '2', status: 'Agendado', dataAgendada: '31/12/2099' }),
    ]);
    expect(z.aAgendar).toBe(1);
    expect(z.jaAgendados).toBe(1);
  });

  test('a lapsed booking counts as a agendar, not as agendado', () => {
    // The date passed with no collection, so it is demand again — the
    // booking on file is stale.
    const z = agg([linha({ status: 'Agendado', dataAgendada: '01/01/2020' })]);
    expect(z.aAgendar).toBe(1);
    expect(z.jaAgendados).toBe(0);
  });

  test('closed households are in neither', () => {
    const z = agg([
      linha({ domicilio: '1', status: 'Coletado Sangue e Urina' }),
      linha({ domicilio: '2', status: 'Recusa' }),
      linha({ domicilio: '3', status: 'Não elegível' }),
    ]);
    expect(z.aAgendar).toBe(0);
    expect(z.jaAgendados).toBe(0);
  });

  test('the headers say what they count', () => {
    const zonaRow = { ...agg([linha()]) };
    const html = UM.buildZonasTableHtml([zonaRow], new Map(), new Map(), UM.MODO_BIOMARCADORES);
    expect(html).toContain('Agendamento pendente');
    expect(html).toContain('Em campo (indefinida)');
    // The slot columns say they are FREE slots.
    expect(html).toContain('Slots manhã');
    expect(html).toContain('Slots tarde');
    // Gone: the names nobody could decode.
    expect(html).not.toContain('Biomarc. devidos');
    expect(html).not.toContain('>Pendentes<');
  });
});

describe('the capacity flag matches the column on screen', () => {
  test('flags against A agendar, the number the table shows', () => {
    // Deriving the flag from a different count than the visible column is
    // how a table ends up contradicting itself: the row would be
    // highlighted while its own numbers say there is no shortfall.
    const zona = {
      idZona: 'Z1', nomeZona: 'Z1', realizada: 0, naoIniciada: 0,
      domicilioFechado: 0, recusa: 0, outros: 0, naoDistribuida: 0,
      totalDomicilios: 5, semCoordenadas: 0, agendados: 0,
      aAgendar: 5, jaAgendados: 0, realizadasSemAgendamento: 0, pendentes: 0,
    };
    const turnos = new Map([['Z1', { manha: 1, tarde: 1 }]]);
    const html = UM.buildZonasTableHtml([zona], new Map(), turnos, UM.MODO_BIOMARCADORES);
    // 5 to schedule against 2 free slots — a real shortfall.
    expect(html).toContain('sigc-pro-zona-sem-capacidade');
    expect(html).toContain('Deve 5 biomarcador(es)');
  });

  test('enough slots means no flag', () => {
    const zona = {
      idZona: 'Z1', nomeZona: 'Z1', realizada: 0, naoIniciada: 0,
      domicilioFechado: 0, recusa: 0, outros: 0, naoDistribuida: 0,
      totalDomicilios: 2, semCoordenadas: 0, agendados: 0,
      aAgendar: 1, jaAgendados: 0, realizadasSemAgendamento: 0, pendentes: 0,
    };
    const turnos = new Map([['Z1', { manha: 3, tarde: 3 }]]);
    const html = UM.buildZonasTableHtml([zona], new Map(), turnos, UM.MODO_BIOMARCADORES);
    expect(html).not.toContain('sigc-pro-zona-sem-capacidade');
  });
});

describe('A agendar means schedulable, not merely open', () => {
  const linha = (over) => ({
    controle: 'C1', domicilio: '1', idZona: 'Z1', temZona: true,
    temCoordenadas: true, tipoEntrevista: 'Realizada',
    ultimaPosicao: 'Descarregado', status: 'A agendar', agendado: '',
    dataAgendada: '', ...over,
  });
  const agg = (rows) => UM.aggregateZonas(rows, new Map(), UM.MODO_BIOMARCADORES, '2026-08-15')[0];

  test('a household nobody has visited is NOT schedulable', () => {
    // The collection follows the interview: you cannot book a biomarcador
    // visit for a household whose interview has not happened. Counting
    // these made BA read 1.629 "a agendar" when 170 were actionable.
    const z = agg([
      linha({ domicilio: '1', tipoEntrevista: '', ultimaPosicao: 'Distribuido', status: 'Não iniciado' }),
      linha({ domicilio: '2', tipoEntrevista: '', ultimaPosicao: 'Enviado para Carga', status: 'Não iniciado' }),
    ]);
    expect(z.aAgendar).toBe(0);
  });

  test('nor is one already in the field whose interview has not concluded', () => {
    const z = agg([linha({
      domicilio: '1', tipoEntrevista: '', ultimaPosicao: 'Descarregado Parcialmente',
      status: 'Não iniciado',
    })]);
    expect(z.aAgendar).toBe(0);
  });

  test('an interview that concluded WITHOUT a resident is not schedulable either', () => {
    // Domicílio Vago, Demolida and friends: the interview is done, but
    // there is nobody to draw blood from.
    ['Domicílio Vago', 'Demolida', 'Uso Ocasional'].forEach((tipoEntrevista) => {
      expect(agg([linha({ tipoEntrevista, status: 'Não iniciado' })]).aAgendar).toBe(0);
    });
  });

  test('a completed interview with the collection open IS schedulable', () => {
    expect(agg([linha({ status: 'A agendar' })]).aAgendar).toBe(1);
    expect(agg([linha({ status: 'Não iniciado' })]).aAgendar).toBe(1);
    expect(agg([linha({ status: 'Indefinido' })]).aAgendar).toBe(1);
  });

  test('a lapsed booking on a completed interview is schedulable again', () => {
    const z = agg([linha({ status: 'Agendado', dataAgendada: '01/01/2020' })]);
    expect(z.aAgendar).toBe(1);
    expect(z.jaAgendados).toBe(0);
  });

  test('the two columns still add to the open workload', () => {
    const z = agg([
      linha({ domicilio: '1', status: 'A agendar' }),
      linha({ domicilio: '2', status: 'Agendado', dataAgendada: '31/12/2099' }),
      linha({ domicilio: '3', tipoEntrevista: '', ultimaPosicao: 'Distribuido', status: 'Não iniciado' }),
    ]);
    // The undistributed one is in neither: it is not work anyone can book.
    expect(z.aAgendar + z.jaAgendados).toBe(2);
  });
});

describe('every household lands in a column that is actually rendered', () => {
  test('a Não Iniciada tipo does not vanish on the biomarcadores page', () => {
    // The Não Iniciada column is not rendered here (the report never emits
    // that tipo), so anything filed under it disappears from the status
    // columns while still counting toward Total. Measured live: the
    // posição join was filling blank tipo with movimento's "Não Iniciada",
    // which is exactly this case for 224 BA households.
    const linha = (over) => ({
      controle: 'C1', domicilio: '1', idZona: 'Z1', temZona: true,
      temCoordenadas: true, status: 'Não iniciado', agendado: '',
      dataAgendada: '', tipoEntrevista: 'Não Iniciada',
      ultimaPosicao: 'Descarregado Parcialmente', ...over,
    });
    const z = UM.aggregateZonas([
      linha({ domicilio: '1' }),
      linha({ domicilio: '2', ultimaPosicao: 'Distribuido' }),
    ], new Map(), UM.MODO_BIOMARCADORES, '2026-08-15');
    const soma = z[0].aEntrevistar + z[0].emAndamento + z[0].inelegivel +
      z[0].semAgendamento + z[0].agendamentoPendente + z[0].agendadoBio +
      z[0].coletado + z[0].recusaBiomarcador + z[0].recusaEntrevista +
      z[0].semEntrevista;
    expect(soma).toBe(z[0].totalDomicilios);
    // Nothing may land in the interview-outcome buckets on this page.
    expect(z[0].naoIniciada).toBe(0);
    expect(z[0].outros).toBe(0);
  });
});

describe('classificaDomicilio — the nine-column partition', () => {
  const hoje = '2026-08-15';
  const d = (over) => ({
    tipoEntrevista: 'Realizada', ultimaPosicao: 'Descarregado',
    status: 'Não iniciado', dataAgendada: '', dataFinalColeta: '', ...over,
  });
  const c = (over) => UM.classificaDomicilio(d(over), hoje);

  test('A entrevistar: nobody has been there yet', () => {
    expect(c({ tipoEntrevista: '', ultimaPosicao: 'Distribuido' })).toBe('aEntrevistar');
    expect(c({ tipoEntrevista: '', ultimaPosicao: 'Enviado para Carga' })).toBe('aEntrevistar');
  });

  test('Em campo (indefinida): left distribution, no tipo recorded', () => {
    expect(c({ tipoEntrevista: '', ultimaPosicao: 'Descarregado Parcialmente' }))
      .toBe('emAndamento');
    expect(c({ tipoEntrevista: '', ultimaPosicao: 'Reentrevista' })).toBe('emAndamento');
  });

  test('Sem agendamento iniciado: interview done, 25A.01 never answered', () => {
    // 25A.01 asks the INTERVIEWER "deseja iniciar o agendamento?" — these
    // stopped before it. Still transmitting (Parcialmente/Reentrevista),
    // so unlike the terminal case below they may yet get there.
    expect(c({ ultimaPosicao: 'Descarregado Parcialmente' })).toBe('semAgendamento');
    expect(c({ ultimaPosicao: 'Reentrevista' })).toBe('semAgendamento');
  });

  test('Inelegível: interview finished without ever opening the biomarcador', () => {
    // Realizada + Descarregado + Não iniciado + no prazo. Measured in BA,
    // 69 of these 74 have a selected resident under 35 — the eligibility
    // floor (minimum age ever collected: 35; maximum among these: 34), so
    // no collection will ever happen. Requiring Descarregado is what makes
    // the inference safe: among partially-transmitted households the age
    // mix is nearly even (23 under 35 against 33 over).
    expect(c({ ultimaPosicao: 'Descarregado', status: 'Não iniciado' })).toBe('inelegivel');
  });

  test('Agendamento pendente: deadline running, nothing booked', () => {
    expect(c({ status: 'A agendar', dataFinalColeta: '20/08/2026' })).toBe('agendamentoPendente');
    expect(c({ status: 'Indefinido', dataFinalColeta: '20/08/2026' })).toBe('agendamentoPendente');
    expect(c({ status: 'Agendado', dataAgendada: '01/08/2026', dataFinalColeta: '20/08/2026' }))
      .toBe('agendamentoPendente');
  });

  test('Agendado: future date wins, even over an open interview', () => {
    expect(c({ status: 'Agendado', dataAgendada: '31/12/2099' })).toBe('agendado');
    expect(c({ tipoEntrevista: '', ultimaPosicao: 'Reentrevista',
      status: 'Agendado', dataAgendada: '31/12/2099' })).toBe('agendado');
    // Order matters: a future booking WITH a deadline must not fall into
    // Agendamento pendente.
    expect(c({ status: 'Agendado', dataAgendada: '31/12/2099', dataFinalColeta: '20/08/2026' }))
      .toBe('agendado');
  });

  test('Coletado wins over everything', () => {
    ['Coletado Sangue e Urina', 'Coletado apenas Sangue', 'Coletado apenas Urina']
      .forEach((status) => expect(c({ status })).toBe('coletado'));
    expect(c({ status: 'Coletado Sangue e Urina', dataFinalColeta: '20/08/2026' }))
      .toBe('coletado');
  });

  test('the refusals are their own columns — they may still be reversed', () => {
    expect(c({ status: 'Recusa' })).toBe('recusaBiomarcador');
    expect(c({ tipoEntrevista: 'Recusa', status: 'Não iniciado' }))
      .toBe('recusaEntrevista');
    // Biomarcador refusal wins over an open interview.
    expect(c({ tipoEntrevista: '', ultimaPosicao: 'Reentrevista', status: 'Recusa' }))
      .toBe('recusaBiomarcador');
  });

  test('Encerrado sem entrevista: no usable interview happened', () => {
    // Kept apart from Inelegível on purpose: there the interview WAS
    // done (all 74 are tipo Realizada) and only the resident is out of
    // range, so "sem entrevista" would be false for the majority.
    ['Outro Motivo', 'Não elegível'].forEach((status) =>
      expect(c({ status })).toBe('semEntrevista'));
    ['Domicílio Vago', 'Uso Ocasional', 'Domicílio Fechado', 'Demolida',
      'Em obras ou ruínas', 'Não Residencial', 'Não Foi Encontrado'].forEach((tipoEntrevista) =>
      expect(c({ tipoEntrevista, status: 'Não iniciado' })).toBe('semEntrevista'));
  });

  test('never returns nothing', () => {
    // A household that matched no rule would vanish from the status
    // columns while still counting toward Total.
    expect(c({ tipoEntrevista: '', ultimaPosicao: 'Descarregado', status: 'Novo Status' }))
      .toBeTruthy();
    expect(c({ tipoEntrevista: 'Tipo Novo', ultimaPosicao: '', status: '' })).toBeTruthy();
  });
});

describe('the Zonas table renders the nine columns', () => {
  const hoje = '2026-08-15';
  const d = (over) => ({
    controle: 'C1', idZona: 'Z1', zona: 'Z1', temZona: true, temCoordenadas: true,
    tipoEntrevista: 'Realizada', ultimaPosicao: 'Descarregado',
    status: 'Não iniciado', dataAgendada: '', dataFinalColeta: '', agendado: '', ...over,
  });

  test('a realistic mix lands one household per column and sums to Total', () => {
    const z = UM.aggregateZonas([
      d({ domicilio: '1', tipoEntrevista: '', ultimaPosicao: 'Distribuido' }),
      d({ domicilio: '2', tipoEntrevista: '', ultimaPosicao: 'Descarregado Parcialmente' }),
      d({ domicilio: '3' }),
      d({ domicilio: '4', ultimaPosicao: 'Reentrevista' }),
      d({ domicilio: '5', status: 'A agendar', dataFinalColeta: '20/08/2026' }),
      d({ domicilio: '6', status: 'Agendado', dataAgendada: '31/12/2099' }),
      d({ domicilio: '7', status: 'Coletado Sangue e Urina' }),
      d({ domicilio: '8', status: 'Recusa' }),
      d({ domicilio: '9', tipoEntrevista: 'Domicílio Vago' }),
    ], new Map(), UM.MODO_BIOMARCADORES, hoje)[0];
    expect(z.aEntrevistar).toBe(1);
    expect(z.emAndamento).toBe(1);
    expect(z.inelegivel).toBe(1);
    expect(z.semAgendamento).toBe(1);
    expect(z.agendamentoPendente).toBe(1);
    expect(z.agendadoBio).toBe(1);
    expect(z.coletado).toBe(1);
    expect(z.recusaBiomarcador).toBe(1);
    expect(z.semEntrevista).toBe(1);
    const soma = z.aEntrevistar + z.emAndamento + z.inelegivel + z.semAgendamento +
      z.agendamentoPendente + z.agendadoBio + z.coletado + z.recusaBiomarcador +
      z.recusaEntrevista + z.semEntrevista;
    expect(soma).toBe(z.totalDomicilios);
    expect(z.totalDomicilios).toBe(9);
  });

  test('the headers are the agreed labels', () => {
    const z = UM.aggregateZonas([d({ domicilio: '1' })], new Map(),
      UM.MODO_BIOMARCADORES, hoje)[0];
    const html = UM.buildZonasTableHtml([z], new Map(), new Map(), UM.MODO_BIOMARCADORES);
    ['A entrevistar', 'Em campo (indefinida)', 'Inelegível',
      'Sem agendamento iniciado', 'Agendamento pendente', 'Agendado',
      'Coletado', 'Recusa biomarc.', 'Recusa entrev.',
      'Encerrado sem entrevista'].forEach((label) =>
      expect(html).toContain(`>${label}</th>`));
    // The names that confused the reader are gone.
    expect(html).not.toContain('Biomarc. devidos');
    expect(html).not.toContain('Não distribuída');
    expect(html).not.toContain('Sem desfecho');
    expect(html).not.toContain('>Outros</th>');
  });

  test('header and body still agree in both variants', () => {
    const z = UM.aggregateZonas([d({ domicilio: '1' })], new Map(),
      UM.MODO_BIOMARCADORES, hoje)[0];
    [UM.MODO_MOVIMENTO, UM.MODO_BIOMARCADORES].forEach((modo) => {
      const html = UM.buildZonasTableHtml([z], new Map(), new Map(), modo);
      const ths = (html.match(/<th[ >]/g) || []).length;
      const tds = (html.match(/<td[ >]/g) || []).length;
      expect(tds).toBe(ths);
    });
  });

  test('the capacity flag uses Agendamento pendente', () => {
    // The actionable queue, not everything still open — comparing the
    // old 170-style count raised false alarms on zones with nothing
    // bookable this week.
    const z = UM.aggregateZonas([
      d({ domicilio: '1', status: 'A agendar', dataFinalColeta: '20/08/2026' }),
      d({ domicilio: '2', status: 'A agendar', dataFinalColeta: '20/08/2026' }),
      d({ domicilio: '3', tipoEntrevista: '', ultimaPosicao: 'Distribuido' }),
    ], new Map(), UM.MODO_BIOMARCADORES, hoje)[0];
    const html = UM.buildZonasTableHtml([z], new Map(),
      new Map([['Z1', { manha: 1, tarde: 0 }]]), UM.MODO_BIOMARCADORES);
    // 2 pending against 1 free slot.
    expect(html).toContain('sigc-pro-zona-sem-capacidade');
    expect(html).toContain('Deve 2 biomarcador(es)');
  });
});

describe('Domicílios tab on the biomarcadores page', () => {
  const hoje = '2026-08-15';
  const d = (over) => ({
    controle: 'C1', domicilio: '1', idZona: 'Z1', tipoEntrevista: 'Realizada',
    ultimaPosicao: 'Descarregado', status: 'Não iniciado', agendado: '',
    dataAgendada: '', dataFinalColeta: '', dataVisita: '', nomeEquipe: '',
    siapeAgendamento: '', siapeColeta: '', statusSangue: '', statusUrina: '',
    entrevistador: '', data: '', ...over,
  });
  const html = (rows) => UM.buildDomiciliosTabHtml(rows, UM.MODO_BIOMARCADORES, hoje);

  test('Situação uses the same nine-way vocabulary as the Zonas tab', () => {
    // Four households that all read "Não iniciado" before: drilling from
    // a zona into its households used to lose the distinction the Zonas
    // row had just made.
    const h = html([
      d({ domicilio: '1', tipoEntrevista: '', ultimaPosicao: 'Distribuido' }),
      d({ domicilio: '2', tipoEntrevista: '', ultimaPosicao: 'Descarregado Parcialmente' }),
      d({ domicilio: '3' }),
      d({ domicilio: '4', ultimaPosicao: 'Descarregado Parcialmente' }),
    ]);
    expect(h).toContain('A entrevistar');
    expect(h).toContain('Em campo (indefinida)');
    expect(h).toContain('Inelegível');
    expect(h).toContain('Sem agendamento iniciado');
  });

  test('Ação is filled for every actionable household, not only urgent ones', () => {
    // It used to fill only inside the 10-day deadline window, so it was
    // blank for most rows — including work that genuinely needed doing.
    expect(html([d({ status: 'A agendar', dataFinalColeta: '20/08/2026' })]))
      .toContain('agendar');
    expect(html([d({ tipoEntrevista: '', ultimaPosicao: 'Distribuido' })]))
      .toContain('entrevistar');
    expect(html([d({ status: 'Recusa' })])).toContain('reverter recusa');
    // And empty where there is genuinely nothing to do. Checked against
    // the BODY: the Ação tooltip legitimately contains the word.
    const feito = html([d({ status: 'Coletado Sangue e Urina' })]);
    expect(feito.split('<tbody>')[1]).not.toContain('agendar');
  });

  test('shows the collection people and dates, not the interviewer', () => {
    const h = html([d({
      status: 'Coletado Sangue e Urina', dataVisita: '12/08/2026',
      siapeColeta: '222', nomeEquipe: 'EQ1', entrevistador: 'SIAPE-ENTREV',
    })]);
    expect(h).toContain('12/08/2026');
    expect(h).toContain('222');
    expect(h).toContain('EQ1');
    // Último Movimento's interviewer is not this page's subject. (A
    // distinctive fixture value: a numeric one collided with the
    // dash-cell data-order sentinel.)
    expect(h).not.toContain('SIAPE-ENTREV');
  });

  test('sample outcomes are shown when they exist', () => {
    const h = html([d({
      status: 'Coletado apenas Sangue', statusSangue: 'Coletado',
      statusUrina: 'Não coletado',
    })]);
    expect(h).toContain('Coletado');
    expect(h).toContain('Não coletado');
  });

  test('Último Movimento keeps its own columns', () => {
    const h = UM.buildDomiciliosTabHtml([d()], UM.MODO_MOVIMENTO, hoje);
    expect(h).toContain('>Entrevistador</th>');
    expect(h).toContain('>Situação</th>');
    expect(h).not.toContain('Equipe');
  });

  test('header and body agree in both variants', () => {
    [UM.MODO_MOVIMENTO, UM.MODO_BIOMARCADORES].forEach((modo) => {
      const h = UM.buildDomiciliosTabHtml([d()], modo, hoje);
      const ths = (h.match(/<th[ >]/g) || []).length;
      const tds = (h.match(/<td[ >]/g) || []).length;
      expect(tds).toBe(ths);
    });
  });
});

describe('turno tooltips describe their own turno', () => {
  test('the afternoon column does not explain the morning cut-off', () => {
    // Both columns shared one string ending "Manhã antes das 13h", so
    // hovering "Slots tarde" defined the morning and said nothing about
    // the afternoon.
    const zona = {
      idZona: 'Z1', nomeZona: 'Z1', aEntrevistar: 0, emAndamento: 0,
      semAgendamento: 0, agendamentoPendente: 0, agendadoBio: 0, coletado: 0,
      recusaBio: 0, inelegivel: 0, semEntrevista: 0, totalDomicilios: 0,
      semCoordenadas: 0,
    };
    document.body.innerHTML = '<div>' +
      UM.buildZonasTableHtml([zona], new Map(), new Map(), UM.MODO_BIOMARCADORES) + '</div>';
    try {
      const th = [...document.querySelectorAll('th[title]')];
      const manha = th.find((e) => e.textContent.includes('Slots manhã'));
      const tarde = th.find((e) => e.textContent.includes('Slots tarde'));
      expect(manha.title).toContain('antes das 13h');
      expect(tarde.title).toContain('a partir das 13h');
      expect(tarde.title).not.toContain('Manhã:');
    } finally {
      document.body.innerHTML = '';
    }
  });
});

describe('Zonas answers "which zone is in trouble" without hovering', () => {
  const hoje = '2026-08-15';
  const d = (over) => ({
    controle: 'C1', idZona: 'Z1', zona: 'Z1', temZona: true, temCoordenadas: true,
    tipoEntrevista: 'Realizada', ultimaPosicao: 'Descarregado',
    status: 'A agendar', dataAgendada: '', dataFinalColeta: '20/08/2026',
    agendado: '', ...over,
  });

  test('deficit is a column, not only a hover title', () => {
    // The manager's one question — pendente minus free slots — used to
    // exist only in the row's title attribute, so answering it across 60
    // rows meant hovering each one or exporting to a spreadsheet.
    const z = UM.aggregateZonas([d({ domicilio: '1' }), d({ domicilio: '2' })],
      new Map(), UM.MODO_BIOMARCADORES, hoje)[0];
    const html = UM.buildZonasTableHtml([z], new Map(),
      new Map([['Z1', { manha: 1, tarde: 0 }]]), UM.MODO_BIOMARCADORES);
    expect(html).toContain('>Déficit</th>');
    // 2 pending against 1 slot.
    expect(html).toMatch(/data-order="1"/);
  });

  test('a zone with spare capacity shows a non-positive deficit', () => {
    const z = UM.aggregateZonas([d({ domicilio: '1' })],
      new Map(), UM.MODO_BIOMARCADORES, hoje)[0];
    const html = UM.buildZonasTableHtml([z], new Map(),
      new Map([['Z1', { manha: 5, tarde: 5 }]]), UM.MODO_BIOMARCADORES);
    expect(html).not.toContain('sigc-pro-zona-sem-capacidade');
  });

  test('overdue households are visible inside the pending count', () => {
    // "Agendamento pendente" silently includes expired deadlines, so a
    // queue of 29 fresh and a queue of 29 already blown looked identical
    // — different staffing decisions entirely.
    const z = UM.aggregateZonas([
      d({ domicilio: '1', dataFinalColeta: '20/08/2026' }),
      d({ domicilio: '2', dataFinalColeta: '01/08/2026' }),
    ], new Map(), UM.MODO_BIOMARCADORES, hoje)[0];
    expect(z.agendamentoPendente).toBe(2);
    expect(z.vencidos).toBe(1);
    const html = UM.buildZonasTableHtml([z], new Map(), new Map(), UM.MODO_BIOMARCADORES);
    expect(html).toContain('>Vencidos</th>');
  });

  test('header and body still agree with the new columns', () => {
    const z = UM.aggregateZonas([d({ domicilio: '1' })],
      new Map(), UM.MODO_BIOMARCADORES, hoje)[0];
    [UM.MODO_MOVIMENTO, UM.MODO_BIOMARCADORES].forEach((modo) => {
      const html = UM.buildZonasTableHtml([z], new Map(), new Map(), modo);
      const ths = (html.match(/<th[ >]/g) || []).length;
      const tds = (html.match(/<td[ >]/g) || []).length;
      expect(tds).toBe(ths);
    });
  });
});

describe('the Zonas table opens on the zones that need attention', () => {
  test('rows are ordered by deficit, worst first', () => {
    // Default was the report's own order, so a zone in trouble sat
    // wherever SIGC put it and the amber highlight was invisible below
    // the fold. The tab is now sorted before DataTables ever sees it,
    // which also survives the CSV export.
    const z = (idZona, agendamentoPendente) => ({
      idZona, nomeZona: idZona, aEntrevistar: 0, emAndamento: 0,
      semAgendamento: 0, agendamentoPendente, agendadoBio: 0, coletado: 0,
      recusaBio: 0, inelegivel: 0, semEntrevista: 0, vencidos: 0,
      totalDomicilios: agendamentoPendente, semCoordenadas: 0,
    });
    const turnos = new Map([['A', { manha: 0, tarde: 0 }], ['B', { manha: 0, tarde: 0 }],
      ['C', { manha: 0, tarde: 0 }]]);
    const html = UM.buildZonasTableHtml(
      [z('A', 1), z('B', 9), z('C', 4)], new Map(), turnos, UM.MODO_BIOMARCADORES);
    // Read the pin's data-id-zona: the Zona and Nome cells both hold the
    // id in this fixture, so matching cell text would double-count.
    const ordem = [...html.matchAll(/data-id-zona="([ABC])"/g)].map((mm) => mm[1]);
    expect(ordem).toEqual(['B', 'C', 'A']);
  });
});

describe('Domicílios shows its zona\'s free slots', () => {
  const hoje = '2026-08-15';
  const d = (over) => ({
    controle: 'C1', domicilio: '1', idZona: 'Z1', tipoEntrevista: 'Realizada',
    ultimaPosicao: 'Descarregado', status: 'A agendar', agendado: '',
    dataAgendada: '', dataFinalColeta: '20/08/2026', dataVisita: '',
    nomeEquipe: '', siapeAgendamento: '', siapeColeta: '', statusSangue: '',
    statusUrina: '', entrevistador: '', data: '', ...over,
  });
  const slots = new Map([['Z1', [
    { isoDate: '2026-08-20', horas: ['08:30', '09:00'] },
    { isoDate: '2026-08-25', horas: ['14:00'] },
  ]]]);

  test('the same slot listing the Zonas tab shows, on the household row', () => {
    // Deciding whether a household can be fitted used to mean noting its
    // zona, flipping to the Zonas tab, finding the row, then flipping
    // back — once per phone call.
    const html = UM.buildDomiciliosTabHtml([d()], UM.MODO_BIOMARCADORES, hoje, slots);
    expect(html).toContain('>Slots livres</th>');
    expect(html).toContain('08:30');
    expect(html).toContain('14:00');
  });

  test('a household whose zona has none says so', () => {
    const html = UM.buildDomiciliosTabHtml([d({ idZona: 'Z9' })],
      UM.MODO_BIOMARCADORES, hoje, slots);
    expect(html).toContain('Nenhum slot livre');
  });

  test('households with nothing to book do not carry the listing', () => {
    // A collected household needs no slot; repeating the zona's whole
    // agenda on its row is noise in a table read row by row.
    const html = UM.buildDomiciliosTabHtml(
      [d({ status: 'Coletado Sangue e Urina' })], UM.MODO_BIOMARCADORES, hoje, slots);
    expect(html.split('<tbody>')[1]).not.toContain('08:30');
  });

  test('Último Movimento has no slot column', () => {
    const html = UM.buildDomiciliosTabHtml([d()], UM.MODO_MOVIMENTO, hoje, slots);
    expect(html).not.toContain('Slots livres');
  });

  test('header and body agree with the new column', () => {
    [UM.MODO_MOVIMENTO, UM.MODO_BIOMARCADORES].forEach((modo) => {
      const html = UM.buildDomiciliosTabHtml([d()], modo, hoje, slots);
      const ths = (html.match(/<th[ >]/g) || []).length;
      const tds = (html.match(/<td[ >]/g) || []).length;
      expect(tds).toBe(ths);
    });
  });
});

describe('the agenda is fetched only for free slots', () => {
  test('joinAgenda does not erase a booking the report already stated', () => {
    // The biomarcadores report carries Data Agendada per household, and
    // biomarcadoresParaLinhas sets `agendado` from it. joinAgenda then
    // overwrote that with the agenda's own lookup, which blanks it
    // whenever the agenda has no matching slot — showing "—" for a
    // household SIGC says is booked.
    const joined = [{
      controle: 'C1', domicilio: '1', agendado: '20/08/2026',
      agendadoOrdenavel: '2026-08-20', futura: true,
      status: 'Agendado', dataAgendada: '20/08/2026',
    }];
    const out = UM.joinAgenda(joined, new Map(), '2026-08-15');
    expect(out[0].agendado).toBe('20/08/2026');
    expect(out[0].agendadoOrdenavel).toBe('2026-08-20');
  });

  test('a household with no booking of its own still takes the agenda\'s', () => {
    // Último Movimento has no Data Agendada column at all, so there the
    // agenda remains the only source.
    const AM = window.__sigcProAgendaLookups;
    const idx = AM.indexByControle([{
      start: '2026-09-01T09:00:00', isoDate: '2026-09-01',
      controle: 'C1', domicilio: '1', zonas: 'Z1 - x', aberto: false,
    }]);
    const out = UM.joinAgenda([{ controle: 'C1', domicilio: '1' }], idx, '2026-08-15');
    expect(out[0].agendado).toContain('01/09/2026');
  });
});

describe('the agenda request asks only for the window it uses', () => {
  test('the bookable window is under a month, never a year', () => {
    // The slots outside this window are discarded client-side, so asking
    // SIGC for January-to-December fetched a year of the state's agenda
    // to keep about two weeks of it. SIGC takes start/end as query
    // parameters, so the narrowing is free.
    const hoje = '2026-08-15';
    const inicio = UM.primeiroDiaAgendavel(hoje);
    const fim = UM.fimDaJanela(hoje);
    const dias = (Date.parse(`${fim}T00:00:00Z`) -
      Date.parse(`${inicio}T00:00:00Z`)) / 86400000;
    expect(dias).toBeGreaterThan(0);
    expect(dias).toBeLessThan(31);
    // And it starts in the future, not on 1 January.
    expect(inicio > hoje).toBe(true);
  });
});

describe('panel toolbars', () => {
  const zonaRows = [{
    idZona: 'Z1', nomeZona: 'Z1', aEntrevistar: 0, emAndamento: 0,
    semAgendamento: 0, agendamentoPendente: 1, agendadoBio: 0, coletado: 0,
    recusaBio: 0, inelegivel: 0, semEntrevista: 0, vencidos: 0,
    totalDomicilios: 1, semCoordenadas: 0,
  }];
  const joined = [{
    controle: 'C1', domicilio: '1', idZona: 'Z1', temZona: true,
    temCoordenadas: true, tipoEntrevista: 'Realizada', ultimaPosicao: 'Descarregado',
    status: 'A agendar', agendado: '', dataAgendada: '', dataFinalColeta: '20/08/2026',
  }];
  const painel = (modo) => UM.buildPanelHtml(
    joined, zonaRows, new Map(), new Map(), modo, '2026-08-15');

  test('the CSV button sits with the table, not on the tab strip', () => {
    // On the tab strip it read as a third tab and its click had to be
    // stopped from switching tabs; beside the table it is plainly an
    // action ON that table.
    const html = painel(UM.MODO_BIOMARCADORES);
    const zonas = html.split('id="sigc-pro-zonas-panel"')[1].split('</div>')[0];
    expect(zonas).toContain('data-csv-aba="zonas"');
    const barra = html.split('sigc-pro-panel-bar')[1].split('</div>')[0];
    expect(barra).not.toContain('data-csv-aba');
  });

  test('the CSV button is labelled, not a bare glyph', () => {
    const html = painel(UM.MODO_BIOMARCADORES);
    expect(html).toContain('CSV');
  });

  test('a slots refresh button sits with the Zonas table', () => {
    // Slots go stale while the panel is open — someone else books one —
    // and rebuilding the whole panel to see that costs three requests.
    const zonas = painel(UM.MODO_BIOMARCADORES)
      .split('id="sigc-pro-zonas-panel"')[1].split('</div>')[0];
    expect(zonas).toContain('sigc-pro-slots-reload');
  });

  test('no slots refresh where there are no slots', () => {
    // Último Movimento makes no agenda request at all.
    const html = painel(UM.MODO_MOVIMENTO);
    expect(html).not.toContain('sigc-pro-slots-reload');
  });
});

describe('the slots reload re-asks only the agenda', () => {
  const zonaRows = [{
    idZona: 'Z1', nomeZona: 'Z1', aEntrevistar: 0, emAndamento: 0,
    semAgendamento: 0, agendamentoPendente: 2, agendadoBio: 0, coletado: 0,
    recusaBio: 0, inelegivel: 0, semEntrevista: 0, vencidos: 0,
    totalDomicilios: 2, semCoordenadas: 0,
  }];
  const joined = [{
    controle: 'C1', domicilio: '1', idZona: 'Z1', temZona: true,
    temCoordenadas: true, tipoEntrevista: 'Realizada', ultimaPosicao: 'Descarregado',
    status: 'A agendar', agendado: '', dataAgendada: '', dataFinalColeta: '20/08/2026',
  }];

  test('fetches the agenda alone and repaints the slot columns', async () => {
    document.body.innerHTML = UM.buildPanelHtml(
      joined, zonaRows, new Map(), new Map(), UM.MODO_BIOMARCADORES, '2026-08-15');
    const panelEl = document.getElementById('sigc-pro-ultimo-movimento-map-panel');
    const chamadas = [];
    const originalAM = window.__sigcProAgendaLookups;
    window.__sigcProAgendaLookups = {
      ...originalAM,
      resetAgendaCache: () => {},
      fetchEnderecosPorFiltro: async () => { chamadas.push('enderecos'); return new Map(); },
      fetchPosicoesPorFiltro: async () => { chamadas.push('posicoes'); return new Map(); },
      fetchBiomarcadoresPorFiltro: async () => { chamadas.push('bio'); return new Map(); },
      fetchAgendaSlots: async () => {
        chamadas.push('agenda');
        return { dados: [
          { aberto: true, isoDate: '2026-08-20', start: '2026-08-20T09:00:00', zonas: 'Z1 - x' },
        ], em: Date.now(), cache: false };
      },
    };
    try {
      await UM.recarregarSlots(panelEl, zonaRows, joined, UM.MODO_BIOMARCADORES,
        { IdUf: '29' }, '2026-08-15');
      // The agenda, and nothing else: the households have not changed.
      expect(chamadas).toEqual(['agenda']);
      const zonasHtml = document.getElementById('sigc-pro-zonas-panel').innerHTML;
      expect(zonasHtml).toContain('09:00');
    } finally {
      window.__sigcProAgendaLookups = originalAM;
      document.body.innerHTML = '';
    }
  });

  test('stamps when the slots were last read', async () => {
    document.body.innerHTML = UM.buildPanelHtml(
      joined, zonaRows, new Map(), new Map(), UM.MODO_BIOMARCADORES, '2026-08-15');
    const panelEl = document.getElementById('sigc-pro-ultimo-movimento-map-panel');
    const originalAM = window.__sigcProAgendaLookups;
    window.__sigcProAgendaLookups = {
      ...originalAM,
      resetAgendaCache: () => {},
      fetchAgendaSlots: async () => ({ dados: [], em: Date.now(), cache: false }),
    };
    try {
      await UM.recarregarSlots(panelEl, zonaRows, joined, UM.MODO_BIOMARCADORES,
        { IdUf: '29' }, '2026-08-15');
      // Without a timestamp the reader cannot tell a fresh count from one
      // read twenty minutes ago — which is the whole reason to reload.
      expect(panelEl.querySelector('.sigc-pro-slots-stamp').textContent).toMatch(/\d{2}:\d{2}/);
    } finally {
      window.__sigcProAgendaLookups = originalAM;
      document.body.innerHTML = '';
    }
  });
});

describe('reloading slots does not duplicate the table chrome', () => {
  const zonaRows = [{
    idZona: 'Z1', nomeZona: 'Z1', aEntrevistar: 0, emAndamento: 0,
    semAgendamento: 0, agendamentoPendente: 1, agendadoBio: 0, coletado: 0,
    recusaBio: 0, inelegivel: 0, semEntrevista: 0, vencidos: 0,
    totalDomicilios: 1, semCoordenadas: 0,
  }];
  const joined = [{
    controle: 'C1', domicilio: '1', idZona: 'Z1', temZona: true,
    temCoordenadas: true, tipoEntrevista: 'Realizada', ultimaPosicao: 'Descarregado',
    status: 'A agendar', agendado: '', dataAgendada: '', dataFinalColeta: '20/08/2026',
  }];

  test('repeated reloads leave exactly one table per tab', async () => {
    // DataTables wraps the table in a _wrapper holding the length
    // selector, filter box, info line and pagination. Replacing only the
    // <table> leaves that wrapper in place; the fresh table is then no
    // longer a DataTable, so initPanelTables initialises it and nests a
    // SECOND wrapper inside the first — one more "50 linhas por página"
    // and one more pagination block per reload.
    document.body.innerHTML = UM.buildPanelHtml(
      joined, zonaRows, new Map(), new Map(), UM.MODO_BIOMARCADORES, '2026-08-15');
    const panelEl = document.getElementById('sigc-pro-ultimo-movimento-map-panel');
    const originalAM = window.__sigcProAgendaLookups;
    const originalJq = window.jQuery;
    // Models real DataTables: init WRAPS the table and destroy() unwraps.
    const jq = (el) => ({
      DataTable: () => {
        if (el && el.tagName === 'TABLE') {
          const wrap = document.createElement('div');
          wrap.className = 'dt-wrapper';
          wrap.innerHTML = '<div class="dt-length">50 linhas por página</div>';
          el.parentElement.insertBefore(wrap, el);
          wrap.appendChild(el);
        }
        return {
          page: { len: () => ({ draw: () => {} }) },
          destroy: () => {
            const wrap = el.closest('.dt-wrapper');
            if (wrap) { wrap.parentElement.insertBefore(el, wrap); wrap.remove(); }
          },
        };
      },
    });
    jq.fn = { dataTable: { isDataTable: (t) => !!(t.parentElement
      && t.parentElement.classList.contains('dt-wrapper')) } };
    window.jQuery = window.$ = jq;
    window.__sigcProAgendaLookups = {
      ...originalAM,
      resetAgendaCache: () => {},
      fetchAgendaSlots: async () => ({ dados: [], em: Date.now(), cache: false }),
    };
    try {
      UM.initPanelTables(panelEl);
      for (let i = 0; i < 3; i += 1) {
        await UM.recarregarSlots(panelEl, zonaRows, joined, UM.MODO_BIOMARCADORES,
          { IdUf: '29' }, '2026-08-15');
      }
      const zonasPanel = panelEl.querySelector('#sigc-pro-zonas-panel');
      expect(zonasPanel.querySelectorAll('table')).toHaveLength(1);
      expect(zonasPanel.querySelectorAll('.dt-wrapper')).toHaveLength(1);
      expect(zonasPanel.querySelectorAll('.dt-length')).toHaveLength(1);
    } finally {
      window.__sigcProAgendaLookups = originalAM;
      if (originalJq === undefined) { delete window.jQuery; delete window.$; } else {
        window.jQuery = window.$ = originalJq;
      }
      document.body.innerHTML = '';
    }
  });
});

describe('co-located households are shown, not explained', () => {
  test('the popup no longer states the count in words', () => {
    // The fan already says it visually; the sentence was a caption for a
    // picture the reader is looking at, and it never said WHICH other
    // households shared the point.
    const html = UM.buildPopupHtml({
      controle: 'C1', domicilio: '1', entrevistador: 'F', idZona: 'Z1',
      tipoEntrevista: 'Realizada', status: 'A agendar', lat: -12, lon: -38,
      agendado: '', coLocated: 4,
    }, UM.MODO_BIOMARCADORES);
    expect(html).not.toContain('neste mesmo ponto');
    // The household still identifies itself.
    expect(html).toContain('C1');
  });

  test('a lone household still renders a popup', () => {
    const html = UM.buildPopupHtml({
      controle: 'C1', domicilio: '1', entrevistador: 'F', idZona: 'Z1',
      tipoEntrevista: 'Realizada', status: 'A agendar', lat: -12, lon: -38,
      agendado: '', coLocated: 1,
    }, UM.MODO_BIOMARCADORES);
    expect(html).toContain('Domicílio: 1');
  });
});

describe('the fan draws its own explanation', () => {
  test('each fanned marker gets a leader line and the shared point a dot', () => {
    const rec = { linhas: [], pontos: [] };
    const layer = () => {
      const l = {
        addTo: () => l, bindTooltip: () => l, bindPopup: () => l, setRadius: () => l,
      };
      return l;
    };
    const L = {
      map: (c) => { if (c) c.innerHTML = ''; return {
        addLayer: () => {}, setView() { return this; }, fitBounds() { return this; },
        getZoom: () => 16, on: () => {},
      }; },
      tileLayer: layer, polygon: layer, circle: layer, marker: layer,
      polyline: (pts, opts) => { rec.linhas.push({ pts, opts }); return layer(); },
      circleMarker: (ll, opts) => { rec.pontos.push({ ll, opts }); return layer(); },
      divIcon: () => ({}), layerGroup: layer,
      DomUtil: { create: () => document.createElement('div') },
      control: Object.assign(() => ({ addTo: () => {}, onAdd: null }),
        { layers: () => ({ addTo: () => {} }) }),
    };
    // Three households on one geocode.
    const rows = ['1', '2', '3'].map((domicilio) => ({
      controle: 'C1', domicilio, idZona: 'Z1', temZona: true, temCoordenadas: true,
      lat: -12, lon: -38, tipoEntrevista: 'Realizada', ultimaPosicao: 'Descarregado',
      status: 'A agendar', agendado: '', dataAgendada: '', dataFinalColeta: '',
      entrevistador: '', agencia: 'A1',
    }));
    const container = document.createElement('div');
    document.body.appendChild(container);
    try {
      UM.renderLeafletMap(L, container, rows, UM.MODO_BIOMARCADORES);
      // One line per fanned household.
      expect(rec.linhas).toHaveLength(3);
      // Visible without zooming all the way in: the old 1px/0.5 line was
      // why the fan needed a written caption.
      expect(rec.linhas[0].opts.weight).toBeGreaterThan(1);
      expect(rec.linhas[0].opts.opacity).toBeGreaterThan(0.5);
      // Every line ends on the true geocode, and a dot marks it so they
      // do not converge on nothing.
      rec.linhas.forEach((l) => expect(l.pts[0]).toEqual([-12, -38]));
      const dots = rec.pontos.filter((p) => p.opts.radius === 2);
      expect(dots.length).toBeGreaterThan(0);
    } finally {
      container.remove();
    }
  });
});

describe('a total key mismatch is reported as such', () => {
  test('none-matched reads differently from some-missing', () => {
    // "1185 de 1185 não retornaram endereço" reads as a coverage gap,
    // but a 100% miss against a NON-EMPTY response is a join failure —
    // the two sides are keyed on different things, or scoped to
    // different populations. Different cause, different fix.
    const movimento = new Map([['A|1', {}], ['B|2', {}]]);
    const enderecos = new Map([['X|9', {}], ['Y|8', {}]]);
    expect(UM.missingEnderecoCount(movimento, enderecos)).toBe(2);
    expect(UM.diagnosticoEnderecos(movimento, enderecos).todosFaltando).toBe(true);
    const parcial = new Map([['A|1', {}], ['Z|9', {}]]);
    expect(UM.diagnosticoEnderecos(movimento, parcial).todosFaltando).toBe(false);
  });

  test('the diagnostic carries example keys from both sides', () => {
    // Without a sample of each, "they do not match" is untestable from a
    // bug report: the shapes are what say whether it is a key format or
    // a scope problem.
    const d = UM.diagnosticoEnderecos(
      new Map([['290570105000292|1', {}]]),
      new Map([['290030605000023|9', {}]]));
    expect(d.exemploRelatorio).toBe('290570105000292|1');
    expect(d.exemploEnderecos).toBe('290030605000023|9');
  });
});

describe('the agência layer control does not depend on a missing icon', () => {
  test('it is created expanded, so no toggle image is needed', () => {
    // Leaflet's collapsed control is a button whose only content is
    // background-image: url(images/layers.png) — and that file is not
    // vendored (only the three marker PNGs are), so it rendered as an
    // empty white square.
    const rec = { layersOpts: null };
    const layer = () => {
      const l = { addTo: () => l, bindTooltip: () => l, bindPopup: () => l, setRadius: () => l };
      return l;
    };
    const L = {
      map: (c) => { if (c) c.innerHTML = ''; return {
        addLayer: () => {}, setView() { return this; }, fitBounds() { return this; },
        getZoom: () => 13, on: () => {},
      }; },
      tileLayer: layer, polygon: layer, polyline: layer, circle: layer,
      circleMarker: layer, marker: layer, divIcon: () => ({}), layerGroup: layer,
      DomUtil: { create: () => document.createElement('div') },
      control: Object.assign(() => ({ addTo: () => {}, onAdd: null }), {
        layers: (_base, _overlays, opts) => { rec.layersOpts = opts; return { addTo: () => {} }; },
      }),
    };
    const linha = (agencia, domicilio) => ({
      controle: 'C1', domicilio, idZona: 'Z1', temZona: true, temCoordenadas: true,
      lat: -12, lon: -38, tipoEntrevista: 'Realizada', ultimaPosicao: 'Descarregado',
      status: 'A agendar', agendado: '', dataAgendada: '', dataFinalColeta: '',
      entrevistador: '', agencia,
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    try {
      UM.renderLeafletMap(L, container,
        [linha('A1', '1'), linha('A2', '2')], UM.MODO_BIOMARCADORES);
      expect(rec.layersOpts).not.toBeNull();
      expect(rec.layersOpts.collapsed).toBe(false);
    } finally {
      container.remove();
    }
  });
});

describe('popups carry what the reader is standing on', () => {
  test('a household popup names its agência', () => {
    // The map can be filtered by agência layer, so "whose household is
    // this" is a question the marker should answer without going back to
    // the table.
    const html = UM.buildPopupHtml({
      controle: 'C1', domicilio: '1', entrevistador: 'F', idZona: 'Z1',
      tipoEntrevista: 'Realizada', status: 'A agendar', lat: -12, lon: -38,
      agendado: '', agencia: '292740800',
    }, UM.MODO_BIOMARCADORES);
    expect(html).toContain('292740800');
  });

  test('a household with no agência does not print an empty line', () => {
    const html = UM.buildPopupHtml({
      controle: 'C1', domicilio: '1', entrevistador: 'F', idZona: 'Z1',
      tipoEntrevista: 'Realizada', status: 'A agendar', lat: -12, lon: -38,
      agendado: '', agencia: '',
    }, UM.MODO_BIOMARCADORES);
    expect(html).not.toContain('Agência:');
  });

  test('the zona popup summarises the zona, not just its id', () => {
    const zona = {
      idZona: 'Z1', nomeZona: '29.2.01.02 Pituba', aEntrevistar: 30,
      emAndamento: 5, semAgendamento: 2, agendamentoPendente: 8, vencidos: 3,
      agendadoBio: 4, coletado: 12, recusaBio: 1, inelegivel: 6,
      semEntrevista: 2, totalDomicilios: 70, semCoordenadas: 0,
    };
    const slots = [{ isoDate: '2026-08-20', horas: ['08:30', '09:00'] }];
    const html = UM.buildZonaPopupHtml(zona, { manha: 2, tarde: 1 }, slots);
    expect(html).toContain('Z1');
    expect(html).toContain('29.2.01.02 Pituba');
    // The numbers that decide whether to send anyone.
    expect(html).toContain('8');   // agendamento pendente
    expect(html).toContain('3');   // vencidos
    expect(html).toContain('70');  // total
    // And the slots it can be booked into.
    expect(html).toContain('08:30');
  });

  test('sem coordenadas shows in the popup only when nonzero', () => {
    // The tables no longer carry this as a column; the popup is where
    // the count lives now — and "0 sem coordenadas" would be noise on
    // every popup, so zero renders nothing.
    const zona = (semCoordenadas) => ({
      idZona: 'Z1', nomeZona: 'Pituba', aEntrevistar: 1, emAndamento: 0,
      semAgendamento: 0, agendamentoPendente: 0, vencidos: 0, agendadoBio: 0,
      coletado: 0, recusaBio: 0, inelegivel: 0, semEntrevista: 0,
      totalDomicilios: 1, semCoordenadas,
    });
    expect(UM.buildZonaPopupHtml(zona(2), {}, [])).toContain('(2 sem coordenadas)');
    expect(UM.buildZonaPopupHtml(zona(0), {}, [])).not.toContain('sem coordenadas');
    // Both variants: the field is variant-independent.
    expect(UM.buildZonaPopupHtml(zona(2), {}, [], UM.MODO_MOVIMENTO))
      .toContain('(2 sem coordenadas)');
  });

  test('a zona with no free slots says so rather than showing nothing', () => {
    const zona = {
      idZona: 'Z1', nomeZona: 'Pituba', aEntrevistar: 0, emAndamento: 0,
      semAgendamento: 0, agendamentoPendente: 2, vencidos: 0, agendadoBio: 0,
      coletado: 0, recusaBio: 0, inelegivel: 0, semEntrevista: 0,
      totalDomicilios: 2, semCoordenadas: 0,
    };
    const html = UM.buildZonaPopupHtml(zona, { manha: 0, tarde: 0 }, []);
    expect(html).toContain('Nenhum slot livre');
  });

  test('the hull binds that popup', () => {
    const rec = { popups: [] };
    const layer = () => {
      const l = {
        addTo: () => l, setRadius: () => l,
        bindTooltip: () => l,
        bindPopup: (h) => { rec.popups.push(h); return l; },
      };
      return l;
    };
    const L = {
      map: (c) => { if (c) c.innerHTML = ''; return {
        addLayer: () => {}, setView() { return this; }, fitBounds() { return this; },
        getZoom: () => 13, on: () => {},
      }; },
      tileLayer: layer, polygon: layer, polyline: layer, circle: layer,
      circleMarker: layer, marker: layer, divIcon: () => ({}), layerGroup: layer,
      DomUtil: { create: () => document.createElement('div') },
      control: Object.assign(() => ({ addTo: () => {}, onAdd: null }),
        { layers: () => ({ addTo: () => {} }) }),
    };
    const linha = (domicilio, lat, lon) => ({
      controle: 'C1', domicilio, idZona: 'Z1', zona: 'Pituba', temZona: true,
      temCoordenadas: true, lat, lon, tipoEntrevista: 'Realizada',
      ultimaPosicao: 'Descarregado', status: 'A agendar', agendado: '',
      dataAgendada: '', dataFinalColeta: '', entrevistador: '', agencia: 'A1',
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    try {
      // Three points so the hull is a polygon.
      UM.renderLeafletMap(L, container, [
        linha('1', -12, -38), linha('2', -12.01, -38.01), linha('3', -12.02, -38),
      ], UM.MODO_BIOMARCADORES,
      new Map([['Z1', {
        idZona: 'Z1', nomeZona: 'Pituba', aEntrevistar: 0, emAndamento: 0,
        semAgendamento: 0, agendamentoPendente: 3, vencidos: 0, agendadoBio: 0,
        coletado: 0, recusaBio: 0, inelegivel: 0, semEntrevista: 0,
        totalDomicilios: 3, semCoordenadas: 0,
      }]]),
      new Map([['Z1', { manha: 1, tarde: 0 }]]), new Map());
      expect(rec.popups.some((h) => h.includes('Pituba'))).toBe(true);
    } finally {
      container.remove();
    }
  });
});

describe('Domicílios rows link to the map', () => {
  const hoje = '2026-08-15';
  const d = (over) => ({
    controle: 'C1', domicilio: '1', idZona: 'Z1', tipoEntrevista: 'Realizada',
    ultimaPosicao: 'Descarregado', status: 'A agendar', agendado: '',
    dataAgendada: '', dataFinalColeta: '20/08/2026', dataVisita: '',
    nomeEquipe: '', siapeAgendamento: '', siapeColeta: '', statusSangue: '',
    statusUrina: '', entrevistador: '', data: '', lat: -12, lon: -38,
    temCoordenadas: true, ...over,
  });

  test('a mapped household gets a pin carrying its key', () => {
    // The Zonas tab has had one since the row-click was retired; the
    // household table had no way to the map at all, so finding a
    // household in the table left you unable to locate it.
    const html = UM.buildDomiciliosTabHtml([d()], UM.MODO_BIOMARCADORES, hoje);
    expect(html).toContain('sigc-pro-dom-pin');
    expect(html).toContain('data-dom-key="C1|1"');
  });

  test('a household with no coordinates gets no pin', () => {
    // Same rule as the Zonas pin: never offer a click that silently does
    // nothing.
    const html = UM.buildDomiciliosTabHtml(
      [d({ temCoordenadas: false })], UM.MODO_BIOMARCADORES, hoje);
    expect(html).not.toContain('sigc-pro-dom-pin');
  });

  test('the pin column is unsortable and does not reach the CSV', () => {
    const html = UM.buildDomiciliosTabHtml([d()], UM.MODO_BIOMARCADORES, hoje);
    expect(html).toMatch(/<th[^>]*data-orderable="false"/);
    document.body.innerHTML = `<div>${html}</div>`;
    try {
      const { header, rows } = UM.tabelaParaCsv(document.querySelector('table'));
      expect(header[0]).toBe('Controle');
      expect(rows[0][0]).toBe('C1');
    } finally {
      document.body.innerHTML = '';
    }
  });

  test('both variants keep header and body aligned', () => {
    [UM.MODO_MOVIMENTO, UM.MODO_BIOMARCADORES].forEach((modo) => {
      const html = UM.buildDomiciliosTabHtml([d()], modo, hoje);
      const ths = (html.match(/<th[ >]/g) || []).length;
      const tds = (html.match(/<td[ >]/g) || []).length;
      expect(tds).toBe(ths);
    });
  });
});

describe('focusing a single household on the map', () => {
  test('switches to the Mapa tab and zooms to that household', () => {
    document.body.innerHTML =
      '<div id="p">' +
      '<div id="sigc-pro-mapa-panel" class="sigc-pro-tab-panel"></div>' +
      '<div id="sigc-pro-domicilios-panel" class="sigc-pro-tab-panel sigc-pro-tab-panel-active">' +
      '</div>' +
      '<button class="sigc-pro-tab-btn" data-tab="mapa"></button>' +
      '<button class="sigc-pro-tab-btn sigc-pro-tab-active" data-tab="domicilios"></button>' +
      '</div>';
    const panelEl = document.getElementById('p');
    const chamadas = [];
    UM.setCurrentMapForTest({
      setView: (ll, z) => { chamadas.push({ ll, z }); },
      fitBounds: () => {},
    });
    try {
      UM.focusDomicilioOnMap(panelEl, [
        { controle: 'C1', domicilio: '1', temCoordenadas: true, lat: -12, lon: -38 },
        { controle: 'C1', domicilio: '2', temCoordenadas: true, lat: -13, lon: -39 },
      ], 'C1|2');
      // The Mapa tab is now the active one.
      expect(document.getElementById('sigc-pro-mapa-panel').classList
        .contains('sigc-pro-tab-panel-active')).toBe(true);
      // Zoomed to the household asked for, not the first in the list, and
      // close enough to see the building rather than the state.
      expect(chamadas).toHaveLength(1);
      expect(chamadas[0].ll).toEqual([-13, -39]);
      expect(chamadas[0].z).toBeGreaterThanOrEqual(16);
    } finally {
      UM.setCurrentMapForTest(null);
      document.body.innerHTML = '';
    }
  });

  test('an unknown or unmapped key does nothing', () => {
    document.body.innerHTML =
      '<div id="p"><div id="sigc-pro-mapa-panel" class="sigc-pro-tab-panel"></div></div>';
    const panelEl = document.getElementById('p');
    const chamadas = [];
    UM.setCurrentMapForTest({ setView: () => chamadas.push(1), fitBounds: () => {} });
    try {
      UM.focusDomicilioOnMap(panelEl, [
        { controle: 'C1', domicilio: '1', temCoordenadas: false, lat: null, lon: null },
      ], 'C1|1');
      UM.focusDomicilioOnMap(panelEl, [], 'Z|9');
      expect(chamadas).toHaveLength(0);
    } finally {
      UM.setCurrentMapForTest(null);
      document.body.innerHTML = '';
    }
  });
});

describe('the zona popup speaks each variant\'s own language', () => {
  const umZona = {
    idZona: 'Z1', nomeZona: 'Pituba', realizada: 5, naoIniciada: 2,
    domicilioFechado: 1, recusa: 1, outros: 3, naoDistribuida: 20,
    totalDomicilios: 32, semCoordenadas: 0,
  };

  test('Último Movimento shows its interview counts, not empty biomarcador ones', () => {
    // The popup listed aEntrevistar/coletado/etc, which only exist on the
    // biomarcadores page — on Último Movimento every one is undefined, so
    // the popup rendered a header, a blank gap and a slots line that
    // variant never has.
    const html = UM.buildZonaPopupHtml(umZona, {}, [], UM.MODO_MOVIMENTO);
    expect(html).toContain('Realizada');
    expect(html).toContain('Não distribuída');
    expect(html).toContain('32');
    // No agenda on this variant, so no slot line at all.
    expect(html).not.toContain('Slots livres');
    expect(html).not.toContain('Agendamento pendente');
  });

  test('biomarcadores keeps the collection breakdown and its slots', () => {
    const bioZona = {
      idZona: 'Z1', nomeZona: 'Pituba', aEntrevistar: 30, emAndamento: 5,
      semAgendamento: 2, agendamentoPendente: 8, vencidos: 3, agendadoBio: 4,
      coletado: 12, recusaBio: 1, inelegivel: 6, semEntrevista: 2,
      totalDomicilios: 70, semCoordenadas: 0,
    };
    const html = UM.buildZonaPopupHtml(bioZona, { manha: 2, tarde: 1 },
      [{ isoDate: '2026-08-20', horas: ['08:30'] }], UM.MODO_BIOMARCADORES);
    expect(html).toContain('Agendamento pendente');
    expect(html).toContain('3 vencido');
    expect(html).toContain('Slots livres');
    expect(html).toContain('08:30');
  });
});

describe('the zona name survives to the Domicílios tab', () => {
  const hoje = '2026-08-15';

  test('joinEnderecos keeps the report\'s own zona name when endereços has none', () => {
    // The biomarcadores report carries Nome Zona per household and the
    // parser reads it — but joinEnderecos overwrote `zona` from the
    // endereços response, discarding it whenever that lookup had no
    // entry for the household.
    const movimento = new Map([['C1|1', {
      controle: 'C1', domicilio: '1', idZona: '29XJYY',
      nomeZona: '29.2.01.02 Pituba', status: 'A agendar',
    }]]);
    const [row] = UM.joinEnderecos(movimento, new Map());
    expect(row.zona).toBe('29.2.01.02 Pituba');
    expect(row.idZona).toBe('29XJYY');
  });

  test('endereços still wins when it has the household', () => {
    // Lista de Endereços is the coordinate authority and its zona is the
    // one the map groups by, so where both exist it stays in charge.
    const movimento = new Map([['C1|1', {
      controle: 'C1', domicilio: '1', idZona: 'ANTIGA', nomeZona: 'Nome Antigo',
    }]]);
    const enderecos = new Map([['C1|1', {
      lat: -12, lon: -38, zona: 'Nome Novo', idZona: 'NOVA',
    }]]);
    const [row] = UM.joinEnderecos(movimento, enderecos);
    expect(row.zona).toBe('Nome Novo');
    expect(row.idZona).toBe('NOVA');
  });

  test('the Domicílios tab shows the name beside the id', () => {
    const html = UM.buildDomiciliosTabHtml([{
      controle: 'C1', domicilio: '1', idZona: '29XJYY', zona: '29.2.01.02 Pituba',
      tipoEntrevista: 'Realizada', ultimaPosicao: 'Descarregado',
      status: 'A agendar', agendado: '', dataAgendada: '', dataFinalColeta: '',
      dataVisita: '', nomeEquipe: '', siapeAgendamento: '', siapeColeta: '',
      statusSangue: '', statusUrina: '', entrevistador: '', data: '',
      temCoordenadas: true, lat: -12, lon: -38,
    }], UM.MODO_BIOMARCADORES, hoje);
    expect(html).toContain('29XJYY');
    expect(html).toContain('Pituba');
  });

  test('a household with no zona name shows just the id', () => {
    const html = UM.buildDomiciliosTabHtml([{
      controle: 'C1', domicilio: '1', idZona: '29XJYY', zona: '',
      tipoEntrevista: 'Realizada', ultimaPosicao: 'Descarregado',
      status: 'A agendar', agendado: '', dataAgendada: '', dataFinalColeta: '',
      dataVisita: '', nomeEquipe: '', siapeAgendamento: '', siapeColeta: '',
      statusSangue: '', statusUrina: '', entrevistador: '', data: '',
      temCoordenadas: true, lat: -12, lon: -38,
    }], UM.MODO_BIOMARCADORES, hoje);
    expect(html).toContain('29XJYY');
    expect(html).not.toContain('undefined');
  });
});

describe('the two refusals are counted apart, as the map already draws them', () => {
  const hoje = '2026-08-15';
  const d = (over) => ({
    tipoEntrevista: 'Realizada', ultimaPosicao: 'Descarregado',
    status: 'Não iniciado', dataAgendada: '', dataFinalColeta: '', ...over,
  });

  test('a biomarcador refusal and an interview refusal are different classes', () => {
    // The map already coloured them apart (#D55E00 vs #A63603) while the
    // tables merged them under one "Recusa" — internally inconsistent,
    // and the merged label reads as one problem when the two need
    // different responses: arguing for a blood draw is not arguing for
    // the survey.
    expect(UM.classificaDomicilio(d({ status: 'Recusa' }), hoje)).toBe('recusaBiomarcador');
    expect(UM.classificaDomicilio(
      d({ tipoEntrevista: 'Recusa', status: 'Não iniciado' }), hoje))
      .toBe('recusaEntrevista');
  });

  test('the column and the map agree on every refusal, not just Não iniciado', () => {
    // The split is only honest if the "Recusa entrev." column and the
    // #A63603 markers cover the same households — the comment on
    // classificaDomicilio justifies the split by saying the map already
    // drew them apart. statusColor used to check tipo === 'Recusa' only
    // inside the 'Não iniciado' branch, so a refused interview sitting at
    // 'A agendar', 'Indefinido', 'Outro Motivo' or 'Não elegível' was
    // counted as a refusal and drawn as demand.
    const statuses = ['Coletado Sangue e Urina', 'Agendado', 'Recusa',
      'Outro Motivo', 'Não elegível', 'A agendar', 'Indefinido',
      'Não iniciado', ''];
    const tipos = ['Recusa', 'Realizada', 'Não Iniciada', 'Domicílio Fechado',
      'Domicílio Vago', 'Não Foi Encontrado', ''];
    const divergentes = [];
    statuses.forEach((status) => tipos.forEach((tipoEntrevista) => {
      const row = d({ status, tipoEntrevista });
      const naColuna = UM.classificaDomicilio(row, hoje) === 'recusaEntrevista';
      const noMapa = UM.statusColor(row, UM.MODO_BIOMARCADORES, hoje) === '#A63603';
      if (naColuna !== noMapa) divergentes.push(`${status}/${tipoEntrevista}`);
    }));
    expect(divergentes).toEqual([]);
  });

  test('a household that refused BOTH counts once, under the biomarcador', () => {
    // R lets its two columns overlap (51 + 18 for 68 households). These
    // columns must sum to Total, so the overlap has to land somewhere:
    // the biomarcador refusal is the one blocking the collection this
    // page is about.
    expect(UM.classificaDomicilio(
      d({ status: 'Recusa', tipoEntrevista: 'Recusa' }), hoje))
      .toBe('recusaBiomarcador');
  });

  test('the BA split, exactly', () => {
    const rows = [
      ...Array.from({ length: 50 }, (_, i) => d({ domicilio: `a${i}`, status: 'Recusa' })),
      ...Array.from({ length: 17 }, (_, i) => d({
        domicilio: `b${i}`, tipoEntrevista: 'Recusa', status: 'Não iniciado',
      })),
      d({ domicilio: 'c', status: 'Recusa', tipoEntrevista: 'Recusa' }),
    ].map((r) => ({ ...r, controle: 'C1', idZona: 'Z1', temZona: true, temCoordenadas: true }));
    const z = UM.aggregateZonas(rows, new Map(), UM.MODO_BIOMARCADORES, hoje)[0];
    expect(z.recusaBiomarcador).toBe(51);
    expect(z.recusaEntrevista).toBe(17);
    expect(z.recusaBiomarcador + z.recusaEntrevista).toBe(68);
    expect(z.totalDomicilios).toBe(68);
  });

  test('both columns are rendered, named for which refusal they are', () => {
    const z = UM.aggregateZonas([
      d({ controle: 'C1', domicilio: '1', idZona: 'Z1', temZona: true,
        temCoordenadas: true, status: 'Recusa' }),
    ], new Map(), UM.MODO_BIOMARCADORES, hoje)[0];
    const html = UM.buildZonasTableHtml([z], new Map(), new Map(), UM.MODO_BIOMARCADORES);
    expect(html).toContain('Recusa biomarc.');
    expect(html).toContain('Recusa entrev.');
    const ths = (html.match(/<th[ >]/g) || []).length;
    const tds = (html.match(/<td[ >]/g) || []).length;
    expect(tds).toBe(ths);
  });
});

describe('the Entrevistadores tab', () => {
  const linhaMov = (over) => ({
    controle: 'C1', domicilio: '1', idZona: 'Z1', zona: 'Z1', temZona: true,
    temCoordenadas: true, tipoEntrevista: 'Não Iniciada',
    ultimaPosicao: 'Distribuido', agendado: '', entrevistador: 'F1', ...over,
  });

  test('aggregates by entrevistador with the movimento tipo counts', () => {
    const rows = [
      linhaMov({ domicilio: '1', controle: 'C1' }),
      linhaMov({ domicilio: '2', controle: 'C2', tipoEntrevista: 'Realizada', ultimaPosicao: 'Descarregado' }),
      // Blank entrevistador is real (still in distribution) — it must
      // land in "Sem entrevistador", never vanish.
      linhaMov({ domicilio: '3', entrevistador: '' }),
    ];
    const agg = UM.aggregateZonas(rows, null, UM.MODO_MOVIMENTO, undefined, UM.GRUPO_ENTREVISTADOR);
    const f1 = agg.find((b) => b.nomeZona === 'F1');
    expect(f1.naoIniciada).toBe(1);
    expect(f1.realizada).toBe(1);
    expect(f1.totalDomicilios).toBe(2);
    // The areas cell: the same unit the Controles tab uses.
    expect([...f1.grupos].sort()).toEqual(['C1', 'C2']);
    const sem = agg.find((b) => b.nomeZona === 'Sem entrevistador');
    expect(sem.totalDomicilios).toBe(1);
  });

  test('biomarcadores variant buckets the classification and collects zonas', () => {
    const linhaBio = (over) => ({
      controle: 'C1', domicilio: '1', idZona: 'Z1', zona: 'Z1', temZona: true,
      temCoordenadas: true, tipoEntrevista: 'Realizada', ultimaPosicao: 'Descarregado',
      status: 'A agendar', agendado: '', dataAgendada: '',
      dataFinalColeta: '20/08/2026', entrevistador: 'F1', ...over,
    });
    const rows = [
      linhaBio({ domicilio: '1', idZona: 'Z1' }),
      linhaBio({ domicilio: '2', idZona: 'Z2', status: 'Coletado Sangue e Urina' }),
    ];
    const agg = UM.aggregateZonas(rows, null, UM.MODO_BIOMARCADORES, '2026-08-15', UM.GRUPO_ENTREVISTADOR);
    const f1 = agg.find((b) => b.nomeZona === 'F1');
    expect(f1.agendamentoPendente).toBe(1);
    expect(f1.coletado).toBe(1);
    expect([...f1.grupos].sort()).toEqual(['Z1', 'Z2']);
  });

  test('the table shows each variant\'s own columns, no pin, areas sortable by count', () => {
    const rowsMov = UM.aggregateZonas(
      [linhaMov({}), linhaMov({ domicilio: '2', controle: 'C2' })],
      null, UM.MODO_MOVIMENTO, undefined, UM.GRUPO_ENTREVISTADOR);
    const htmlMov = UM.buildEntrevistadoresTableHtml(rowsMov, UM.MODO_MOVIMENTO);
    expect(htmlMov).toContain('<th>Entrevistador</th>');
    expect(htmlMov).toContain('Não distribuída');
    expect(htmlMov).toContain('>Controles</th>');
    expect(htmlMov).not.toContain('sigc-pro-zona-pin-col');
    expect(htmlMov).not.toContain('Slots');
    expect(htmlMov).toContain('data-order="2">C1 C2</td>');

    const htmlBio = UM.buildEntrevistadoresTableHtml([], UM.MODO_BIOMARCADORES);
    expect(htmlBio).toContain('A entrevistar');
    expect(htmlBio).toContain('>Zonas</th>');
    expect(htmlBio).not.toContain('Déficit');
  });

  test('most-loaded person first; Sem entrevistador always last', () => {
    const rows = [
      linhaMov({ domicilio: '1', entrevistador: '' }),
      linhaMov({ domicilio: '2', entrevistador: 'F2' }),
      linhaMov({ domicilio: '3', entrevistador: 'F1' }),
      linhaMov({ domicilio: '4', entrevistador: 'F1', controle: 'C2' }),
    ];
    const agg = UM.aggregateZonas(rows, null, UM.MODO_MOVIMENTO, undefined, UM.GRUPO_ENTREVISTADOR);
    const html = UM.buildEntrevistadoresTableHtml(agg, UM.MODO_MOVIMENTO);
    const f1 = html.indexOf('<td>F1</td>');
    const f2 = html.indexOf('<td>F2</td>');
    const sem = html.indexOf('<td>Sem entrevistador</td>');
    expect(f1).toBeGreaterThan(-1);
    expect(f1).toBeLessThan(f2);
    expect(sem).toBeGreaterThan(f2);
  });

  test('the panel carries the tab, its panel and its CSV button; filename passes through', () => {
    const html = UM.buildPanelHtml(
      [linhaMov({})], [], new Map(), new Map(), UM.MODO_MOVIMENTO, '2026-08-15');
    expect(html).toContain('data-tab="entrevistadores"');
    expect(html).toContain('id="sigc-pro-entrevistadores-panel"');
    expect(html).toContain('data-csv-aba="entrevistadores"');
    expect(UM.nomeCsvAba('entrevistadores', UM.MODO_MOVIMENTO, '2026-08-19'))
      .toBe('sigc-pro-ultimo-movimento-entrevistadores-2026-08-19.csv');
    expect(UM.nomeCsvAba('entrevistadores', UM.MODO_BIOMARCADORES, '2026-08-19'))
      .toBe('sigc-pro-biomarcadores-entrevistadores-2026-08-19.csv');
  });
});
