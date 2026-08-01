import { describe, test, expect } from 'bun:test';

// Order matters: sigc-common.js assigns window.__sigcPro wholesale.
await import('../extension/common/sigc-common.js');
await import('../extension/features/lista-agenda/lista-agenda.js');

const {
  parseSlots, zonaIdOf, indexByControle, indexZonaLivres, pickAgendado, indexMovimento, buildResumoHtml,
  buildDomiciliosTable, buildDomiciliosDocHtml, enderecoDomicilio, fetchLabel, nomeArquivoDomicilios,
} = window.__sigcPro.listaAgenda;

// A reserved slot's title carries every field; an open slot's title is
// ONLY "Zonas: …" — confirmed live in
// docs/superpowers/specs/2026-07-16-agenda-csv-export-design.md (addendum).
const tituloReservado = [
  'Zonas: 29JDM8 - 29.2.01.02 29_Linus_Lauro',
  'Controle: 292740805060337',
  'Domicílio: 1',
  'Nome:  - ',
  'Endereço: RUA X, Nº: 237: - Compl: APTO 303  - SALVADOR',
  'Telefone: 71 99999-0000',
].join('\n');

const tituloAberto = 'Zonas: 29JDM8 - 29.2.01.02 29_Linus_Lauro, 29LR9E - 29.2.01.01 29_Linus_Lauro';

const slotJson = (over = {}) => ({
  id: 'x', end: '2026-08-10T10:00:00', resourceId: 'r1',
  status: 1, backgroundColor: '#fff',
  start: '2026-08-10T09:00:00', title: tituloReservado, ...over,
});

describe('parseSlots', () => {
  test('keeps only the sanctioned fields', () => {
    const [s] = parseSlots([slotJson()]);
    expect(Object.keys(s).sort()).toEqual(
      ['aberto', 'controle', 'domicilio', 'isoDate', 'start', 'zonas'].sort());
  });

  // The response carries name, address and telephone per slot. Dropping
  // them at the parse boundary is a privacy requirement, not tidiness.
  test('discards personal data', () => {
    const json = JSON.stringify(parseSlots([slotJson()]));
    expect(json).not.toContain('RUA X');
    expect(json).not.toContain('71 99999-0000');
  });

  test('an open slot has no controle and is flagged aberto', () => {
    const [s] = parseSlots([slotJson({ title: tituloAberto })]);
    expect(s.aberto).toBe(true);
    expect(s.controle).toBe('');
  });

  test('a reserved slot is not aberto', () => {
    expect(parseSlots([slotJson()])[0].aberto).toBe(false);
  });

  test('derives isoDate from start', () => {
    expect(parseSlots([slotJson()])[0].isoDate).toBe('2026-08-10');
  });

  test('tolerates an empty or malformed response', () => {
    expect(parseSlots([])).toEqual([]);
    expect(parseSlots(null)).toEqual([]);
  });
});

describe('zonaIdOf', () => {
  test('takes the ID before the first " - "', () => {
    expect(zonaIdOf('29JDM8 - 29.2.01.02 29_Linus_Lauro')).toBe('29JDM8');
  });

  test('falls back to the whole entry with no separator', () => {
    expect(zonaIdOf('29.3.03.03 29_Linus_Pituba')).toBe('29.3.03.03 29_Linus_Pituba');
  });

  test('tolerates empty and missing input', () => {
    expect(zonaIdOf('')).toBe('');
    expect(zonaIdOf(null)).toBe('');
  });
});

describe('indexByControle', () => {
  test('keys on controle|domicilio', () => {
    const idx = indexByControle(parseSlots([slotJson()]));
    expect(idx.get('292740805060337|1')).toHaveLength(1);
  });

  test('groups repeat schedules under one key', () => {
    const idx = indexByControle(parseSlots([
      slotJson(), slotJson({ start: '2026-09-01T09:00:00' }),
    ]));
    expect(idx.get('292740805060337|1')).toHaveLength(2);
  });

  test('skips open slots, which belong to no household', () => {
    const idx = indexByControle(parseSlots([slotJson({ title: tituloAberto })]));
    expect(idx.size).toBe(0);
  });
});

describe('indexZonaLivres', () => {
  const abertoEm = (isoDate, zonas) => slotJson({
    start: `${isoDate}T09:00:00`, title: `Zonas: ${zonas}`,
  });

  test('counts open slots on or after the cutoff', () => {
    const idx = indexZonaLivres(
      parseSlots([abertoEm('2026-08-10', '29JDM8 - 29.2.01.02 29_Linus_Lauro')]),
      '2026-08-01');
    expect(idx.get('29JDM8').inteiro).toBe(1);
  });

  test('excludes open slots before the cutoff', () => {
    const idx = indexZonaLivres(
      parseSlots([abertoEm('2026-07-20', '29JDM8 - 29.2.01.02 29_Linus_Lauro')]),
      '2026-08-01');
    expect(idx.size).toBe(0);
  });

  test('the cutoff date itself counts', () => {
    const idx = indexZonaLivres(
      parseSlots([abertoEm('2026-08-01', '29JDM8 - 29.2.01.02 29_Linus_Lauro')]),
      '2026-08-01');
    expect(idx.get('29JDM8').inteiro).toBe(1);
  });

  test('excludes reserved slots however future', () => {
    const idx = indexZonaLivres(parseSlots([slotJson()]), '2026-01-01');
    expect(idx.size).toBe(0);
  });

  // A shared slot counts whole in each zona (how many slots could I book
  // into?) and 1/n in the weighted figure (how many are really mine?).
  test('a shared slot counts whole in each zona and 1/n weighted', () => {
    const idx = indexZonaLivres(parseSlots([
      abertoEm('2026-08-10',
        '29JDM8 - 29.2.01.02 29_Linus_Lauro, 29LR9E - 29.2.01.01 29_Linus_Lauro'),
    ]), '2026-08-01');
    expect(idx.get('29JDM8').inteiro).toBe(1);
    expect(idx.get('29JDM8').peso).toBeCloseTo(0.5, 9);
    expect(idx.get('29JDM8').compartilhado).toBe(true);
  });

  test('an exclusive slot is not flagged compartilhado', () => {
    const idx = indexZonaLivres(
      parseSlots([abertoEm('2026-08-10', '29JDM8 - 29.2.01.02 29_Linus_Lauro')]),
      '2026-08-01');
    expect(idx.get('29JDM8').compartilhado).toBe(false);
  });

  test('a zona repeated in one slot is not double counted', () => {
    const idx = indexZonaLivres(parseSlots([
      abertoEm('2026-08-10',
        '29JDM8 - 29.2.01.02 29_Linus_Lauro, 29JDM8 - 29.2.01.02 29_Linus_Lauro'),
    ]), '2026-08-01');
    expect(idx.get('29JDM8').inteiro).toBe(1);
    expect(idx.get('29JDM8').peso).toBeCloseTo(1, 9);
  });
});

describe('pickAgendado', () => {
  const em = (isoDate) => parseSlots([slotJson({ start: `${isoDate}T09:00:00` })])[0];

  // Only one schedule is live at a time, so a future date wins outright.
  test('prefers the live (future) date', () => {
    const r = pickAgendado([em('2026-06-01'), em('2026-09-01')], '2026-07-31');
    expect(r).toEqual({ data: '01/09/2026', futura: true });
  });

  test('falls back to the most recent past date', () => {
    const r = pickAgendado([em('2026-05-01'), em('2026-06-01')], '2026-07-31');
    expect(r).toEqual({ data: '01/06/2026', futura: false });
  });

  test('today counts as live', () => {
    expect(pickAgendado([em('2026-07-31')], '2026-07-31').futura).toBe(true);
  });

  test('returns null with no slots', () => {
    expect(pickAgendado([], '2026-07-31')).toBeNull();
  });
});

describe('indexMovimento', () => {
  // Column positions are found by header label, never hardcoded: the
  // Último Movimento report is a different table from the Lista de
  // Endereços and its layout is not pinned by any test we own.
  //
  // Verbatim live header (browser console, real Último Movimento report):
  // the four columns we read sit at indexes 0, 1, 4, 5 — non-adjacent —
  // with Entrevistador/Tipo de Entrevista/Observação in between and
  // around them, so a tidy 4-column fixture would not have caught the
  // 'Data Transmissão' vs 'Data' mismatch this test guards against.
  const header = ['Controle', 'Domicilio', 'Entrevistador', 'Tipo de Entrevista',
    'Última Posição', 'Data', 'Observação'];
  const rows = [
    ['292740805060337', '1', 'João', 'Presencial', 'TRANSMITIDO', '28/07/2026', ''],
    ['292740805060337', '2', 'João', 'Presencial', 'EM COLETA', '', ''],
  ];

  test('keys on controle|domicilio', () => {
    const { index } = indexMovimento(header, rows);
    expect(index.get('292740805060337|1'))
      .toEqual({ situacao: 'TRANSMITIDO', transmissao: '28/07/2026' });
  });

  test('keeps an empty transmission date as empty', () => {
    expect(indexMovimento(header, rows).index.get('292740805060337|2').transmissao).toBe('');
  });

  test('tolerates accent and case differences in headers', () => {
    const alt = ['CONTROLE', 'DOMICILIO', 'ENTREVISTADOR', 'TIPO DE ENTREVISTA',
      'ULTIMA POSICAO', 'DATA', 'OBSERVACAO'];
    expect(indexMovimento(alt, rows).index.get('292740805060337|1').situacao).toBe('TRANSMITIDO');
  });

  test('returns an empty index when a required column is missing', () => {
    expect(indexMovimento(['Controle', 'Domicílio'], rows).index.size).toBe(0);
  });

  // The signal a caller needs to tell "columns not found" apart from
  // genuine no-data — an all-"—" column must never look like "nothing
  // scheduled" when it is actually a parsing failure.
  test('flags colunasNaoEncontradas when a required column is missing', () => {
    expect(indexMovimento(['Controle', 'Domicílio'], rows).colunasNaoEncontradas).toBe(true);
  });

  // Regression guard for the live defect: 'Data Transmissão' does not
  // exist in the real report, only 'Data'. A header carrying the old,
  // wrong label must be treated exactly like a missing column.
  test('flags colunasNaoEncontradas when the header still says Data Transmissão', () => {
    const oldHeader = ['Controle', 'Domicílio', 'Última Posição', 'Data Transmissão'];
    expect(indexMovimento(oldHeader, rows).colunasNaoEncontradas).toBe(true);
  });

  test('does not flag colunasNaoEncontradas when all columns are found', () => {
    expect(indexMovimento(header, rows).colunasNaoEncontradas).toBe(false);
  });

  test('tolerates empty input', () => {
    expect(indexMovimento(header, []).index.size).toBe(0);
    expect(indexMovimento(null, null).index.size).toBe(0);
    expect(indexMovimento(null, null).colunasNaoEncontradas).toBe(true);
  });
});

describe('buildResumoHtml', () => {
  const livres = new Map([
    ['29JDM8', { inteiro: 12, peso: 3, compartilhado: true }],
    ['29LR9E', { inteiro: 4, peso: 4, compartilhado: false }],
    ['29TBAN', { inteiro: 0, peso: 0, compartilhado: false }],
  ]);
  const meta = { minDateBr: '03/08/2026', agendaEm: '09:31', movimentoEm: '09:31', falhas: [] };

  test('names the cutoff and the fetch time', () => {
    const html = buildResumoHtml(['29JDM8'], livres, meta);
    expect(html).toContain('03/08/2026');
    expect(html).toContain('09:31');
  });

  // The weighted figure says something only where slots are shared;
  // elsewhere it would just repeat the whole count.
  test('shows the weighted figure only where shared', () => {
    const html = buildResumoHtml(['29JDM8', '29LR9E'], livres, meta);
    expect(html).toContain('12');
    expect(html).toContain('3,0 ponderado');
    expect(html).toContain('4');
    expect(html.match(/ponderado/g)).toHaveLength(1);
  });

  test('lists only the zonas present in the table', () => {
    const html = buildResumoHtml(['29JDM8'], livres, meta);
    expect(html).toContain('29JDM8');
    expect(html).not.toContain('29LR9E');
  });

  test('shows zero for a zona of the table with no free slots', () => {
    const html = buildResumoHtml(['29TBAN'], livres, meta);
    expect(html).toContain('29TBAN');
    expect(html).toContain('0');
  });

  test('shows zero for a zona absent from the index entirely', () => {
    const html = buildResumoHtml(['29XXXX'], livres, meta);
    expect(html).toContain('29XXXX');
    expect(html).toContain('0');
  });

  // An all-"—" column must never be mistaken for "nothing scheduled".
  test('names a failed source', () => {
    const html = buildResumoHtml(['29JDM8'], livres,
      { ...meta, falhas: ['Último Movimento: HTTP 500'] });
    expect(html).toContain('Último Movimento: HTTP 500');
  });

  test('shows two fetch times when they differ', () => {
    const html = buildResumoHtml(['29JDM8'], livres,
      { ...meta, agendaEm: '09:31', movimentoEm: '09:47' });
    expect(html).toContain('09:31');
    expect(html).toContain('09:47');
  });

  test('escapes zona ids', () => {
    const html = buildResumoHtml(['<script>alert(1)</script>'], new Map(), meta);
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });

  // A false "0 free slots" reads as real capacity and is exactly the
  // signal that causes a double-booking. livresIdx === null (the agenda
  // source failed) must never render a fabricated zero.
  test('agenda failed → no fabricated zeros', () => {
    const html = buildResumoHtml(['29JDM8', '29LR9E'], null,
      { ...meta, falhas: ['Agenda: HTTP 500'] });
    expect(html).not.toContain(': 0');
    expect(html).toContain('29JDM8');
    expect(html).toContain('?');
  });

  // The per-household list moved out to a downloaded file; the panel now
  // just names it, so a reader knows where the detail went.
  test('names the downloaded file when given', () => {
    const html = buildResumoHtml(['29JDM8'], livres, meta, 'lista-enderecos-x_agenda.html');
    expect(html).toContain('lista-enderecos-x_agenda.html');
  });

  test('no download line when no filename is given', () => {
    const html = buildResumoHtml(['29JDM8'], livres, meta);
    expect(html).not.toContain('sp-download');
  });

  test('escapes the filename', () => {
    const html = buildResumoHtml(['29JDM8'], livres, meta, '<script>alert(1)</script>.html');
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });
});

const { annotateRow } = window.__sigcPro.listaAgenda;

describe('annotateRow', () => {
  const agendaIdx = indexByControle(parseSlots([slotJson({ start: '2026-09-01T09:00:00' })]));
  const movimentoIdx = new Map([
    ['292740805060337|1', { situacao: 'TRANSMITIDO', transmissao: '28/07/2026' }],
  ]);
  const ctx = { agendaIdx, movimentoIdx, todayIso: '2026-07-31' };

  test('combines both sources onto one row', () => {
    expect(annotateRow('292740805060337', '1', ctx)).toEqual({
      agendado: '01/09/2026', futura: true,
      situacao: 'TRANSMITIDO', transmissao: '28/07/2026',
    });
  });

  // A failed source must not cost the other's columns.
  test('annotates from the agenda alone when movimento is empty', () => {
    const r = annotateRow('292740805060337', '1',
      { ...ctx, movimentoIdx: new Map() });
    expect(r.agendado).toBe('01/09/2026');
    expect(r.situacao).toBe('');
  });

  test('annotates from movimento alone when the agenda is empty', () => {
    const r = annotateRow('292740805060337', '1', { ...ctx, agendaIdx: new Map() });
    expect(r.agendado).toBe('');
    expect(r.situacao).toBe('TRANSMITIDO');
  });

  test('an unmatched household yields empty strings, never undefined', () => {
    expect(annotateRow('999', '9', ctx)).toEqual({
      agendado: '', futura: false, situacao: '', transmissao: '',
    });
  });
});

describe('enderecoDomicilio', () => {
  test('combines logradouro and número', () => {
    expect(enderecoDomicilio('RUA X', '237')).toBe('RUA X, Nº 237');
  });

  test('tolerates missing values', () => {
    expect(enderecoDomicilio('', '')).toBe('');
    expect(enderecoDomicilio(undefined, null)).toBe('');
  });
});

describe('buildDomiciliosTable', () => {
  const comDados = {
    endereco: 'RUA X, Nº 237', nDomicilio: '1',
    agendado: '01/09/2026', futura: true, situacao: 'TRANSMITIDO', transmissao: '28/07/2026',
  };
  const semDados = {
    endereco: 'RUA Y, Nº 10', nDomicilio: '2',
    agendado: '', futura: false, situacao: '', transmissao: '',
  };

  test('a household with data appears with every field', () => {
    const html = buildDomiciliosTable([comDados]);
    expect(html).toContain('RUA X, Nº 237');
    expect(html).toContain('01/09/2026');
    expect(html).toContain('TRANSMITIDO');
    expect(html).toContain('28/07/2026');
  });

  // THE reversal from the old buildDomiciliosHtml: nothing is omitted, and
  // there is no omission count — a downloaded file is meant to be complete.
  test('a household with no data from any source still appears, fields as —', () => {
    const html = buildDomiciliosTable([comDados, semDados]);
    expect(html).toContain('RUA Y, Nº 10');
    expect(html).not.toMatch(/omitid/);
    // Domicílio 2's row has three "—" cells: Agendado, Situação, Data.
    const row2 = html.split('RUA Y, Nº 10')[1].split('</tr>')[0];
    expect((row2.match(/—/g) || []).length).toBe(3);
  });

  test('no households at all renders an empty table body, not an error', () => {
    const html = buildDomiciliosTable([]);
    expect(html).toContain('<tbody></tbody>');
  });

  // sp-futura/sp-passada distinction, carried over from the old <td> classes.
  test('a future/live appointment renders distinctly from a past one', () => {
    const passada = { ...comDados, endereco: 'RUA Z, Nº 5', nDomicilio: '3', futura: false };
    const html = buildDomiciliosTable([comDados, passada]);
    expect(html).toContain('sp-futura');
    expect(html).toContain('sp-passada');
  });

  test('an appointment without a date renders no futura/passada span', () => {
    const semAgendado = { ...comDados, endereco: 'RUA W, Nº 1', nDomicilio: '4', agendado: '' };
    const html = buildDomiciliosTable([semAgendado]);
    expect(html).toContain('RUA W, Nº 1');
    expect(html).not.toContain('sp-futura');
    expect(html).not.toContain('sp-passada');
  });

  test('escapes interpolated values', () => {
    const malicioso = {
      endereco: '<script>alert(1)</script>', nDomicilio: '<b>1</b>', agendado: '', futura: false,
      situacao: '<b>x</b>', transmissao: '',
    };
    const html = buildDomiciliosTable([malicioso]);
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<b>x</b>');
    expect(html).not.toContain('<b>1</b>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;b&gt;');
  });

  test('column headers carry a sort type for the inline script', () => {
    const html = buildDomiciliosTable([]);
    expect(html).toContain('data-tipo="data"');
    expect(html).toContain('data-tipo="texto"');
  });
});

describe('buildDomiciliosDocHtml', () => {
  const meta = { controle: '292740805060337', quando: 'dados de 09:31', geradoEm: '2026-07-31 09:31:00' };
  const resumoHtml = '<div id="sigc-pro-lista-agenda-resumo"><div class="sp-titulo">Slots livres</div></div>';
  const domicilios = [
    { endereco: 'RUA X, Nº 237', nDomicilio: '1', agendado: '01/09/2026', futura: true, situacao: 'TRANSMITIDO', transmissao: '28/07/2026' },
    { endereco: '', nDomicilio: '2', agendado: '', futura: false, situacao: '', transmissao: '' },
  ];

  test('names the Controle and the fetch time in the header', () => {
    const html = buildDomiciliosDocHtml(meta, resumoHtml, domicilios);
    expect(html).toContain('292740805060337');
    expect(html).toContain('dados de 09:31');
    expect(html).toContain('2026-07-31 09:31:00');
  });

  test('embeds the resumo (zona summary) verbatim', () => {
    const html = buildDomiciliosDocHtml(meta, resumoHtml, domicilios);
    expect(html).toContain('sigc-pro-lista-agenda-resumo');
    expect(html).toContain('Slots livres');
  });

  // Every household appears — including the data-less one — since the
  // whole point of downloading is a complete, scannable list.
  test('every household appears, including data-less ones', () => {
    const html = buildDomiciliosDocHtml(meta, resumoHtml, domicilios);
    expect(html).toContain('RUA X, Nº 237');
    expect(html).toContain('Domicílio 2');
  });

  test('missing values render as —', () => {
    const html = buildDomiciliosDocHtml(meta, resumoHtml, domicilios);
    const row2 = html.split('Domicílio 2')[1].split('</tr>')[0];
    expect((row2.match(/—/g) || []).length).toBe(3);
  });

  test('future/past scheduled dates render distinctly', () => {
    const html = buildDomiciliosDocHtml(meta, resumoHtml, domicilios);
    expect(html).toContain('sp-futura');
  });

  test('escapes interpolated Controle and household values', () => {
    const malicioso = [{ endereco: '<script>alert(1)</script>', nDomicilio: '1', agendado: '', futura: false, situacao: '', transmissao: '' }];
    const html = buildDomiciliosDocHtml({ ...meta, controle: '<script>x</script>' }, resumoHtml, malicioso);
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  // Self-contained: must open and work offline from a Downloads folder,
  // with no CDN/font/image reference of any kind.
  test('the document is self-contained: no http(s) reference', () => {
    const html = buildDomiciliosDocHtml(meta, resumoHtml, domicilios);
    expect(html).not.toContain('http://');
    expect(html).not.toContain('https://');
  });

  test('carries a single inline sort script, no external script tags', () => {
    const html = buildDomiciliosDocHtml(meta, resumoHtml, domicilios);
    expect((html.match(/<script/g) || []).length).toBe(1);
    expect(html).not.toMatch(/<script[^>]+src=/);
  });
});

describe('fetchLabel', () => {
  // The panel shows the fetch time specifically because a stale count
  // causes a real double-booking — a cache hit (up to 5 min old) must not
  // read identically to a just-fetched value.
  test('a fresh fetch shows only the time, no cache marker', () => {
    const em = new Date('2026-07-31T09:31:00').getTime();
    const label = fetchLabel(em, false);
    expect(label).not.toContain('cache');
    expect(label).toContain('09:31');
  });

  test('a cache hit is marked distinctly from a fresh fetch', () => {
    const em = new Date('2026-07-31T09:31:00').getTime();
    const cached = fetchLabel(em, true);
    expect(cached).not.toBe(fetchLabel(em, false));
    expect(cached).toContain('cache');
    expect(cached).toContain('09:31');
  });
});

describe('nomeArquivoDomicilios', () => {
  // Repeat exports in one page life must not collide: consentGiven
  // latches, so a second click re-downloads with no other change to the
  // filename unless the time component makes it unique.
  test('appends the time so repeat exports get distinct names', () => {
    const a = nomeArquivoDomicilios('lista-enderecos-cd_292740805060337_selecionados_2026-07-31', '093100');
    const b = nomeArquivoDomicilios('lista-enderecos-cd_292740805060337_selecionados_2026-07-31', '094512');
    expect(a).not.toBe(b);
  });

  test('keeps the exportFileBase prefix and the _agenda tag', () => {
    const nome = nomeArquivoDomicilios('lista-enderecos-cd_292740805060337_selecionados_2026-07-31', '093100');
    expect(nome).toBe('lista-enderecos-cd_292740805060337_selecionados_2026-07-31_agenda_093100.html');
  });
});
