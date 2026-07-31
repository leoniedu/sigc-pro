import { describe, test, expect } from 'bun:test';

// Order matters: sigc-common.js assigns window.__sigcPro wholesale.
await import('../extension/common/sigc-common.js');
await import('../extension/features/agenda-slots-abertos/agenda-slots-abertos.js');

const { aggregateByZonaTurno, buildTableHtml, turnoOf, zonaSortKey } =
  window.__sigcPro.slotsAbertos;

const Z1 = '29001001 - Lab 1 Oeste';
const Z2 = '29001002 - 29001002';

// isoDate defaults well after LIMITE, so every row is within the prazo
// unless a test says otherwise and the other assertions keep testing what
// they were testing before the prazo filter existed.
const LIMITE = '2026-07-20';

function row({
  reservado = false, horaInicio = '09:00', zonas = Z1, isoDate = '2026-08-01',
} = {}) {
  return { reservado, horaInicio, horaFim: '09:30', zonas, isoDate, equipe: 'A' };
}

// Always pins the cutoff: aggregateByZonaTurno defaults it to today's
// prazo, so an unpinned call would mean something different each day.
const aggAt = (rows, limite = LIMITE) => aggregateByZonaTurno(rows, limite);

const zonaNamed = (agg, name) => agg.zonas.find((z) => z.zona === name);

describe('turnoOf', () => {
  test('splits Manhã/Tarde at 13:00', () => {
    expect(turnoOf({ horaInicio: '12:59' })).toBe('manha');
    expect(turnoOf({ horaInicio: '13:00' })).toBe('tarde');
    expect(turnoOf({ horaInicio: '07:30' })).toBe('manha');
    expect(turnoOf({ horaInicio: '17:45' })).toBe('tarde');
  });

  test('returns null for an unparseable time', () => {
    expect(turnoOf({ horaInicio: '' })).toBeNull();
    expect(turnoOf({})).toBeNull();
  });
});

describe('zonaSortKey', () => {
  test('takes the part after the first " - "', () => {
    expect(zonaSortKey('29GAIR - 29.3.02.02 29')).toBe('29.3.02.02 29');
    expect(zonaSortKey('29001001 - Lab 1 Oeste')).toBe('Lab 1 Oeste');
  });

  // Only the FIRST separator splits, so a name containing " - " keeps
  // its own hyphenated tail rather than losing everything after it.
  test('splits once, keeping later separators in the name', () => {
    expect(zonaSortKey('29X - Lab 1 - Oeste')).toBe('Lab 1 - Oeste');
  });

  test('falls back to the whole entry when there is no separator', () => {
    expect(zonaSortKey('29.3.03.03 29_Linus_Pituba')).toBe('29.3.03.03 29_Linus_Pituba');
    expect(zonaSortKey('29001002')).toBe('29001002');
  });

  // A hyphen without surrounding spaces is not the separator — zona
  // names contain those, and treating them as a split would truncate.
  test('requires spaces around the hyphen', () => {
    expect(zonaSortKey('29X-Y')).toBe('29X-Y');
  });

  test('tolerates empty and missing input', () => {
    expect(zonaSortKey('')).toBe('');
    expect(zonaSortKey(null)).toBe('');
    expect(zonaSortKey(undefined)).toBe('');
  });
});

describe('aggregateByZonaTurno', () => {
  test('counts open over total per zona and turno', () => {
    const agg = aggAt([
      row({ reservado: false, horaInicio: '08:00' }),
      row({ reservado: true, horaInicio: '09:00' }),
      row({ reservado: false, horaInicio: '14:00' }),
      row({ reservado: true, horaInicio: '15:00' }),
      row({ reservado: true, horaInicio: '16:00' }),
    ]);
    const z = zonaNamed(agg, Z1);
    expect(z.manha).toMatchObject({ abertos: 1, total: 2 });
    expect(z.tarde).toMatchObject({ abertos: 1, total: 3 });
    expect(z.abertos).toBe(2);
    expect(z.total).toBe(5);
  });

  // The core modelling decision: a slot listing several zonas really is
  // fillable from any of them, so it counts toward each.
  test('a multi-zona slot counts toward every zona it lists', () => {
    const agg = aggAt([row({ zonas: `${Z1}, ${Z2}` })]);
    expect(agg.zonas).toHaveLength(2);
    expect(zonaNamed(agg, Z1).manha).toMatchObject({ abertos: 1, total: 1 });
    expect(zonaNamed(agg, Z2).manha).toMatchObject({ abertos: 1, total: 1 });
    // …but the TOTAL row counts slots, so it stays at one.
    expect(agg.totals.total).toBe(1);
    expect(agg.totals.abertos).toBe(1);
  });

  // The weighted share exists so the rows reconcile with TOTAL, which
  // the whole counts deliberately don't.
  test('weighted share divides a slot evenly across its zonas', () => {
    const agg = aggAt([row({ zonas: `${Z1}, ${Z2}` })]);
    expect(zonaNamed(agg, Z1).manha.totalPeso).toBeCloseTo(0.5, 9);
    expect(zonaNamed(agg, Z2).manha.totalPeso).toBeCloseTo(0.5, 9);
    expect(zonaNamed(agg, Z1).manha.abertosPeso).toBeCloseTo(0.5, 9);
  });

  test('weighted shares sum to the slot total, whole counts overshoot', () => {
    const agg = aggAt([
      row({ zonas: `${Z1}, ${Z2}, C - zona` }),
      row({ zonas: Z1, reservado: true }),
    ]);
    const somaPeso = agg.zonas.reduce((s, z) => s + z.totalPeso, 0);
    const somaInteira = agg.zonas.reduce((s, z) => s + z.total, 0);
    expect(somaPeso).toBeCloseTo(agg.totals.total, 9);
    expect(somaPeso).toBeCloseTo(2, 9);
    expect(somaInteira).toBe(4);
  });

  test('an unshared slot weighs the same as its whole count', () => {
    const agg = aggAt([row({ zonas: Z1 })]);
    expect(zonaNamed(agg, Z1).manha.totalPeso).toBeCloseTo(1, 9);
  });

  // Dedup happens BEFORE weighting, so a duplicate listing must not
  // halve the zona's share — it is one zona, weight 1.0.
  test('a zona repeated within one slot is not double counted', () => {
    const agg = aggAt([row({ zonas: `${Z1}, ${Z1}` })]);
    const z = zonaNamed(agg, Z1).manha;
    expect(z.abertos).toBe(1);
    expect(z.total).toBe(1);
    expect(z.totalPeso).toBeCloseTo(1, 9);
  });

  // Zona entries stay whole: the tail after " - " is free text with no
  // reliable token count, so no código/rota/lab splitting happens.
  test('keeps the zona entry whole, whatever its name shape', () => {
    const agg = aggAt([
      row({ zonas: Z1 }),
      row({ zonas: Z2 }),
      row({ zonas: '29.3.03.03 29_Linus_Pituba' }),
    ]);
    // Order is by name (Z2's name is its own código, so it precedes
    // Z1's "Lab 1 Oeste"); what this test pins is that each entry
    // survives WHOLE, separator or not.
    expect(agg.zonas.map((z) => z.zona)).toEqual([
      '29.3.03.03 29_Linus_Pituba', Z2, Z1,
    ]);
  });

  test('rows with no zona are counted separately, not dropped', () => {
    const agg = aggAt([row({ zonas: '' }), row({ zonas: Z1 })]);
    expect(agg.semZona).toBe(1);
    expect(agg.zonas).toHaveLength(1);
    expect(agg.totals.total).toBe(1);
  });

  test('rows with no readable time are counted separately, not guessed', () => {
    const agg = aggAt([row({ horaInicio: '' }), row()]);
    expect(agg.semHora).toBe(1);
    expect(agg.totals.total).toBe(1);
  });

  // Deliberately built so ID order and name order DISAGREE: sorting by
  // the whole entry would give A/B/C, which is what the panel used to do.
  test('zonas sort by name, not by the leading ID', () => {
    const agg = aggAt([
      row({ zonas: 'A - Pituba' }),
      row({ zonas: 'B - Barra' }),
      row({ zonas: 'C - Amaralina' }),
    ]);
    expect(agg.zonas.map((z) => z.zona)).toEqual([
      'C - Amaralina', 'B - Barra', 'A - Pituba',
    ]);
  });

  test('sorts names with acentos naturally (pt-BR collation)', () => {
    const agg = aggAt([
      row({ zonas: '1 - Zumbi' }), row({ zonas: '2 - Água' }), row({ zonas: '3 - Boca' }),
    ]);
    expect(agg.zonas.map((z) => z.zona)).toEqual([
      '2 - Água', '3 - Boca', '1 - Zumbi',
    ]);
  });

  // An entry with no " - " keys on itself, so it still sorts among the
  // others instead of being dropped or clumped at one end.
  test('an entry with no separator sorts on the whole entry', () => {
    const agg = aggAt([
      row({ zonas: 'A - Zebra' }),
      row({ zonas: '29.3.03.03 29_Linus_Pituba' }),
      row({ zonas: 'B - Abelha' }),
    ]);
    expect(agg.zonas.map((z) => z.zona)).toEqual([
      '29.3.03.03 29_Linus_Pituba', 'B - Abelha', 'A - Zebra',
    ]);
  });

  // Two zonas sharing a name must still order deterministically, or the
  // table's row order would depend on input order.
  test('ties on the name fall back to the whole entry', () => {
    const agg = aggAt([row({ zonas: 'B - Centro' }), row({ zonas: 'A - Centro' })]);
    expect(agg.zonas.map((z) => z.zona)).toEqual(['A - Centro', 'B - Centro']);
  });

  test('empty input yields empty aggregation', () => {
    const agg = aggAt([]);
    expect(agg.zonas).toEqual([]);
    expect(agg.totals.total).toBe(0);
  });
});

// The prazo mínimo: a free slot before the cutoff can no longer be
// filled, so counting it as "aberto" would advertise capacity that does
// not exist. Only abertos is filtered — the slot still occupies the zona,
// so it stays in the denominator.
describe('aggregateByZonaTurno — prazo mínimo', () => {
  test('a free slot before the cutoff is not counted as open', () => {
    const agg = aggAt([row({ isoDate: '2026-07-19' })]);
    const z = zonaNamed(agg, Z1).manha;
    expect(z.abertos).toBe(0);
    expect(z.total).toBe(1);
    expect(agg.foraDoPrazo).toBe(1);
  });

  test('the cutoff date itself still counts as open', () => {
    const agg = aggAt([row({ isoDate: LIMITE })]);
    expect(zonaNamed(agg, Z1).manha.abertos).toBe(1);
    expect(agg.foraDoPrazo).toBe(0);
  });

  test('a reserved slot before the cutoff is not counted as foraDoPrazo', () => {
    // It was never open, so the prazo has nothing to say about it —
    // counting it would inflate the note into meaninglessness.
    const agg = aggAt([row({ isoDate: '2026-07-19', reservado: true })]);
    expect(agg.foraDoPrazo).toBe(0);
    expect(zonaNamed(agg, Z1).manha).toMatchObject({ abertos: 0, total: 1 });
  });

  test('TOTAL keeps every slot, only abertos shrinks', () => {
    const agg = aggAt([
      row({ isoDate: '2026-07-19' }),
      row({ isoDate: '2026-08-01' }),
    ]);
    expect(agg.totals.total).toBe(2);
    expect(agg.totals.abertos).toBe(1);
  });

  test('the weighted share follows the same filter', () => {
    const agg = aggAt([row({ isoDate: '2026-07-19', zonas: `${Z1}, ${Z2}` })]);
    const z = zonaNamed(agg, Z1).manha;
    expect(z.abertosPeso).toBeCloseTo(0, 9);
    expect(z.totalPeso).toBeCloseTo(0.5, 9);
  });

  test('a row with no date is kept rather than guessed out', () => {
    const agg = aggAt([row({ isoDate: '' })]);
    expect(zonaNamed(agg, Z1).manha.abertos).toBe(1);
  });

  // The +3/+4 rule itself lives in agendaMinScheduleDate; this pins that
  // the panel actually defaults to it rather than to today.
  test('defaults to the SIGC prazo when no cutoff is passed', () => {
    const esperado = window.__sigcPro.dateToIso(
      window.__sigcPro.agendaMinScheduleDate(new Date()));
    expect(aggregateByZonaTurno([]).limite).toBe(esperado);
  });
});

describe('buildTableHtml', () => {
  test('renders abertos/total cells and a slot-counting TOTAL row', () => {
    const html = buildTableHtml(
      aggAt([
        row({ reservado: false, horaInicio: '08:00' }),
        row({ reservado: true, horaInicio: '09:00' }),
        row({ reservado: true, horaInicio: '14:00' }),
      ]),
      '13/07/2026 – 19/07/2026'
    );
    expect(html).toContain('1/2');
    expect(html).toContain('0/1');
    expect(html).toContain('13/07/2026 – 19/07/2026');
    expect(html).toContain('TOTAL (slots)');
  });

  test('marks a saturated zona and a fully open one', () => {
    const cheio = buildTableHtml(
      aggAt([row({ reservado: true })]), 'x');
    expect(cheio).toContain('sp-cheio');
    const livre = buildTableHtml(
      aggAt([row({ reservado: false })]), 'x');
    expect(livre).toContain('sp-livre');
  });

  test('shows the weighted share only where a slot is shared', () => {
    // Scoped to the table: the footer legend mentions sp-peso too, so a
    // document-wide match would pass even if no cell carried a share.
    const tabelaDe = (html) => html.slice(0, html.indexOf('</table>'));

    const partilhado = tabelaDe(buildTableHtml(
      aggAt([row({ zonas: `${Z1}, ${Z2}` })]), 'x'));
    expect(partilhado).toContain('sp-peso');
    expect(partilhado).toContain('0,5/0,5');

    const exclusivo = tabelaDe(buildTableHtml(
      aggAt([row({ zonas: Z1 })]), 'x'));
    // The share would just repeat "1/1" — omitted rather than shown.
    expect(exclusivo).not.toContain('sp-peso');
  });

  test('escapes zona text', () => {
    const html = buildTableHtml(
      aggAt([row({ zonas: '<script>alert(1)</script>' })]), 'x');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  // A 0/8 cell is ambiguous on its own — saturated, or merely past the
  // prazo? The notes have to name the cutoff for the table to be readable.
  test('names the cutoff date and counts the slots it excluded', () => {
    const html = buildTableHtml(
      aggAt([row({ isoDate: '2026-07-19' }), row()]), 'x');
    expect(html).toContain('20/07/2026');
    expect(html).toContain('1 slot(s) livre(s) já fora do prazo');
  });

  test('omits the excluded-slots note when nothing was excluded', () => {
    const html = buildTableHtml(aggAt([row()]), 'x');
    expect(html).toContain('20/07/2026');
    expect(html).not.toContain('fora do prazo não entram');
  });

  test('says so when there is nothing to show', () => {
    expect(buildTableHtml(aggAt([]), 'x'))
      .toContain('Nenhum slot com zona');
  });

  // Excluded slots leave the TOTAL as well as the rows, so the footnote
  // has to say both. "não entram na tabela" alone reads as if TOTAL still
  // counted them, and TOTAL is the number capacity decisions rest on.
  test('the footnotes say excluded slots leave the TOTAL too', () => {
    const semZona = buildTableHtml(
      aggAt([row({ zonas: '' }), row({ zonas: Z1 })]), 'x');
    expect(semZona).toContain('1 slot(s) sem zona não entram na tabela nem no TOTAL.');

    const semHora = buildTableHtml(
      aggAt([row({ horaInicio: '' }), row()]), 'x');
    expect(semHora).toContain(
      '1 slot(s) sem horário legível não entram na tabela nem no TOTAL.');
  });
});
