import { describe, test, expect } from 'bun:test';

// Order matters: sigc-common.js assigns window.__sigcPro wholesale.
await import('../extension/common/sigc-common.js');
await import('../extension/features/lista-agenda/lista-agenda.js');

const {
  parseSlots, zonaIdOf, indexByControle, indexZonaLivres, pickAgendado,
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
