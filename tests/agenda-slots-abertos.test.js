import { describe, test, expect } from 'bun:test';

// Order matters: sigc-common.js assigns window.__sigcPro wholesale.
await import('../extension/common/sigc-common.js');
await import('../extension/features/agenda-slots-abertos/agenda-slots-abertos.js');

const { aggregateByZonaTurno, buildTableHtml, turnoOf } = window.__sigcPro.slotsAbertos;

const Z1 = '29001001 - Lab 1 Oeste';
const Z2 = '29001002 - 29001002';

function row({ reservado = false, horaInicio = '09:00', zonas = Z1 } = {}) {
  return { reservado, horaInicio, horaFim: '09:30', zonas, equipe: 'A' };
}

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

describe('aggregateByZonaTurno', () => {
  test('counts open over total per zona and turno', () => {
    const agg = aggregateByZonaTurno([
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
    const agg = aggregateByZonaTurno([row({ zonas: `${Z1}, ${Z2}` })]);
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
    const agg = aggregateByZonaTurno([row({ zonas: `${Z1}, ${Z2}` })]);
    expect(zonaNamed(agg, Z1).manha.totalPeso).toBeCloseTo(0.5, 9);
    expect(zonaNamed(agg, Z2).manha.totalPeso).toBeCloseTo(0.5, 9);
    expect(zonaNamed(agg, Z1).manha.abertosPeso).toBeCloseTo(0.5, 9);
  });

  test('weighted shares sum to the slot total, whole counts overshoot', () => {
    const agg = aggregateByZonaTurno([
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
    const agg = aggregateByZonaTurno([row({ zonas: Z1 })]);
    expect(zonaNamed(agg, Z1).manha.totalPeso).toBeCloseTo(1, 9);
  });

  // Dedup happens BEFORE weighting, so a duplicate listing must not
  // halve the zona's share — it is one zona, weight 1.0.
  test('a zona repeated within one slot is not double counted', () => {
    const agg = aggregateByZonaTurno([row({ zonas: `${Z1}, ${Z1}` })]);
    const z = zonaNamed(agg, Z1).manha;
    expect(z.abertos).toBe(1);
    expect(z.total).toBe(1);
    expect(z.totalPeso).toBeCloseTo(1, 9);
  });

  // Zona entries stay whole: the tail after " - " is free text with no
  // reliable token count, so no código/rota/lab splitting happens.
  test('keeps the zona entry whole, whatever its name shape', () => {
    const agg = aggregateByZonaTurno([
      row({ zonas: Z1 }),
      row({ zonas: Z2 }),
      row({ zonas: '29.3.03.03 29_Linus_Pituba' }),
    ]);
    expect(agg.zonas.map((z) => z.zona)).toEqual([
      '29.3.03.03 29_Linus_Pituba', Z1, Z2,
    ]);
  });

  test('rows with no zona are counted separately, not dropped', () => {
    const agg = aggregateByZonaTurno([row({ zonas: '' }), row({ zonas: Z1 })]);
    expect(agg.semZona).toBe(1);
    expect(agg.zonas).toHaveLength(1);
    expect(agg.totals.total).toBe(1);
  });

  test('rows with no readable time are counted separately, not guessed', () => {
    const agg = aggregateByZonaTurno([row({ horaInicio: '' }), row()]);
    expect(agg.semHora).toBe(1);
    expect(agg.totals.total).toBe(1);
  });

  test('zonas sort by entry, pt-BR', () => {
    const agg = aggregateByZonaTurno([
      row({ zonas: 'C - zona' }), row({ zonas: 'A - zona' }), row({ zonas: 'B - zona' }),
    ]);
    expect(agg.zonas.map((z) => z.zona)).toEqual(['A - zona', 'B - zona', 'C - zona']);
  });

  test('empty input yields empty aggregation', () => {
    const agg = aggregateByZonaTurno([]);
    expect(agg.zonas).toEqual([]);
    expect(agg.totals.total).toBe(0);
  });
});

describe('buildTableHtml', () => {
  test('renders abertos/total cells and a slot-counting TOTAL row', () => {
    const html = buildTableHtml(
      aggregateByZonaTurno([
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
      aggregateByZonaTurno([row({ reservado: true })]), 'x');
    expect(cheio).toContain('sp-cheio');
    const livre = buildTableHtml(
      aggregateByZonaTurno([row({ reservado: false })]), 'x');
    expect(livre).toContain('sp-livre');
  });

  test('shows the weighted share only where a slot is shared', () => {
    // Scoped to the table: the footer legend mentions sp-peso too, so a
    // document-wide match would pass even if no cell carried a share.
    const tabelaDe = (html) => html.slice(0, html.indexOf('</table>'));

    const partilhado = tabelaDe(buildTableHtml(
      aggregateByZonaTurno([row({ zonas: `${Z1}, ${Z2}` })]), 'x'));
    expect(partilhado).toContain('sp-peso');
    expect(partilhado).toContain('0,5/0,5');

    const exclusivo = tabelaDe(buildTableHtml(
      aggregateByZonaTurno([row({ zonas: Z1 })]), 'x'));
    // The share would just repeat "1/1" — omitted rather than shown.
    expect(exclusivo).not.toContain('sp-peso');
  });

  test('escapes zona text', () => {
    const html = buildTableHtml(
      aggregateByZonaTurno([row({ zonas: '<script>alert(1)</script>' })]), 'x');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('says so when there is nothing to show', () => {
    expect(buildTableHtml(aggregateByZonaTurno([]), 'x'))
      .toContain('Nenhum slot com zona');
  });

  // Excluded slots leave the TOTAL as well as the rows, so the footnote
  // has to say both. "não entram na tabela" alone reads as if TOTAL still
  // counted them, and TOTAL is the number capacity decisions rest on.
  test('the footnotes say excluded slots leave the TOTAL too', () => {
    const semZona = buildTableHtml(
      aggregateByZonaTurno([row({ zonas: '' }), row({ zonas: Z1 })]), 'x');
    expect(semZona).toContain('1 slot(s) sem zona não entram na tabela nem no TOTAL.');

    const semHora = buildTableHtml(
      aggregateByZonaTurno([row({ horaInicio: '' }), row()]), 'x');
    expect(semHora).toContain(
      '1 slot(s) sem horário legível não entram na tabela nem no TOTAL.');
  });
});
