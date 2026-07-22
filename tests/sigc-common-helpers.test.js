import { describe, test, expect } from 'bun:test';

await import('../extension/common/sigc-common.js');
const P = window.__sigcPro;

describe('parseCoord', () => {
  test('DMS with hemisphere letters and comma seconds', () => {
    expect(P.parseCoord('12 34 56.7 S')).toBeCloseTo(-12.5824167, 5);
    expect(P.parseCoord('38 30 15,5 O')).toBeCloseTo(-38.5043056, 5);
    expect(P.parseCoord('12 34 56.7 N')).toBeCloseTo(12.5824167, 5);
  });
  test('plain decimals, dot or comma', () => {
    expect(P.parseCoord('-23,55')).toBe(-23.55);
    expect(P.parseCoord('-23.55')).toBe(-23.55);
  });
  test('missing/invalid → null', () => {
    expect(P.parseCoord('-')).toBeNull();
    expect(P.parseCoord('')).toBeNull();
    expect(P.parseCoord('12 61 00 S')).toBeNull(); // minutes >= 60
  });
});

describe('buildCsv (incl. field escaping)', () => {
  test('semicolon-delimited with CRLF and trailing newline', () => {
    expect(P.buildCsv(['a', 'b'], [['1', '2']])).toBe('a;b\r\n1;2\r\n');
  });
  test('quotes fields containing delimiter/quotes', () => {
    expect(P.buildCsv(['h'], [['a;b']])).toBe('h\r\n"a;b"\r\n');
    expect(P.buildCsv(['h'], [['say "hi"']])).toBe('h\r\n"say ""hi"""\r\n');
  });
  test('formula-injection guard, numbers exempt', () => {
    expect(P.buildCsv(['h'], [['=1+1']])).toBe("h\r\n'=1+1\r\n");
    expect(P.buildCsv(['h'], [['-12,5']])).toBe('h\r\n-12,5\r\n');
  });
});

describe('slug', () => {
  test('deaccents, collapses non-alphanumerics, trims, lowercases', () => {
    expect(P.slug('São Paulo — Área 1')).toBe('sao-paulo-area-1');
    expect(P.slug('  -já-  ')).toBe('ja');
  });
});

describe('agendaMinScheduleDate', () => {
  test('+3 calendar days normally', () => {
    // 2026-07-16 is a Thursday
    const d = P.agendaMinScheduleDate(new Date(2026, 6, 16));
    expect(P.dateToIso(d)).toBe('2026-07-19');
  });
  test('+4 when refDate is a Friday', () => {
    // 2026-07-17 is a Friday
    const d = P.agendaMinScheduleDate(new Date(2026, 6, 17));
    expect(P.dateToIso(d)).toBe('2026-07-21');
  });
});

describe('parseZonaEntries', () => {
  test('splits on commas, trims, drops empties', () => {
    expect(P.parseZonaEntries('a, b ,,c ')).toEqual(['a', 'b', 'c']);
  });
});

describe('exportFileBase', () => {
  const pesquisa = { id: 'PNS2026', columns: P.PESQUISAS.PNS2026.columns };
  const today = new Date().toISOString().slice(0, 10);
  // Lista de Endereços row: 20 columns (index 0 is the "lupa" icon
  // column), controle at 1, selecionado at 15.
  function listaRow({ controle = 'C1', selecionado = 'Sim' } = {}) {
    const row = new Array(20).fill('');
    row[1] = controle;
    row[15] = selecionado;
    return row;
  }

  test('single controle, all selected', () => {
    expect(P.exportFileBase(pesquisa, [listaRow(), listaRow()])).toBe(
      `lista-enderecos-pns2026_C1_selecionados_${today}`
    );
  });
  test('mixed controles, not all selected', () => {
    const rows = [listaRow(), listaRow({ controle: 'C2', selecionado: 'Não' })];
    expect(P.exportFileBase(pesquisa, rows)).toBe(
      `lista-enderecos-pns2026_varios-controles_completos_${today}`
    );
  });
});
