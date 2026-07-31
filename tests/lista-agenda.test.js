import { describe, test, expect } from 'bun:test';

// Order matters: sigc-common.js assigns window.__sigcPro wholesale.
await import('../extension/common/sigc-common.js');
await import('../extension/features/lista-agenda/lista-agenda.js');

const {
  parseSlots, zonaIdOf, indexByControle, indexZonaLivres, pickAgendado, indexMovimento, buildResumoHtml,
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
  const header = ['Controle', 'Domicílio', 'Última Posição', 'Data Transmissão'];
  const rows = [
    ['292740805060337', '1', 'TRANSMITIDO', '28/07/2026'],
    ['292740805060337', '2', 'EM COLETA', ''],
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
    const alt = ['CONTROLE', 'DOMICILIO', 'ULTIMA POSICAO', 'DATA TRANSMISSAO'];
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

const { chaveDeLinha } = window.__sigcPro.listaAgenda;

// The bug this guards against: escreverColunas resolves each rendered <tr>
// to its household via dt.row(tr).data(), a DIFFERENT row-data shape than
// tabela.rows (readDataTable's cellText-cleaned array). Both call sites
// must key identically or annotations land on the wrong household as soon
// as the table sorts, filters or paginates.
describe('chaveDeLinha', () => {
  const cols = { controle: { index: 1 }, nDomicilio: { index: 3 } };

  test('builds the same key as chaveDomicilio from plain-text cells', () => {
    const row = ['x', '292740805060337', 'y', '1'];
    expect(chaveDeLinha(row, cols.controle.index, cols.nDomicilio.index))
      .toBe('292740805060337|1');
  });

  // dt.row(tr).data() returns raw cell data, which — unlike tabela.rows —
  // has NOT been through cellText. Any markup must strip to the same text.
  test('strips HTML the same way cellText does, so keys match tabela.rows', () => {
    const row = ['x', '<span>292740805060337</span>', 'y', ' 1 '];
    expect(chaveDeLinha(row, cols.controle.index, cols.nDomicilio.index))
      .toBe('292740805060337|1');
  });

  test('missing cells key on empty strings rather than throwing', () => {
    const row = ['x', undefined, 'y', null];
    expect(chaveDeLinha(row, cols.controle.index, cols.nDomicilio.index)).toBe('|');
  });
});
