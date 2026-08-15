import { describe, test, expect } from 'bun:test';

await import('../extension/common/sigc-common.js');
const P = window.__sigcPro;

// getDataTable() must find the SIGC report's table and never SIGC-PRO's
// own. The Mapa panel injects tables into document.body, so the old bare
// `jq('table')` selector matched them too — which could hand a caller
// like readUltimoMovimentoTable OUR table and make it parse the wrong
// data entirely (found 2026-08-12, via the panel being auto-paged at 10).
describe('getDataTable ignores SIGC-PRO tables', () => {
  const withJq = (selectorSeen) => {
    const prev = window.jQuery;
    const fake = (sel) => {
      selectorSeen.push(sel);
      return { DataTable: () => null };
    };
    fake.fn = { dataTable: {} };
    window.jQuery = fake;
    return () => { window.jQuery = prev; };
  };

  const fixture = () => {
    document.body.innerHTML =
      '<table id="tableRelatorio"><tbody><tr><td>x</td></tr></tbody></table>' +
      '<div id="p" data-sigc-pro>' +
      '  <table class="sigc-pro-domicilios-table"><tbody><tr><td>y</td></tr></tbody></table>' +
      '  <table id="plain-inside-panel"><tbody><tr><td>z</td></tr></tbody></table>' +
      '</div>';
  };

  test('isSigcProTable spots both a sigc-pro class and a panel ancestor', () => {
    fixture();
    const byId = (id) => document.getElementById(id);
    expect(P.isSigcProTable(byId('tableRelatorio'))).toBe(false);
    expect(P.isSigcProTable(document.querySelector('.sigc-pro-domicilios-table'))).toBe(true);
    // The ancestor case: no sigc-pro class of its own, but inside the panel.
    expect(P.isSigcProTable(byId('plain-inside-panel'))).toBe(true);
    document.body.innerHTML = '';
  });

  test('getDataTable hands jQuery only the page-owned tables', () => {
    fixture();
    const seen = [];
    const restore = withJq(seen);
    try {
      P.getDataTable();
    } finally {
      restore();
      document.body.innerHTML = '';
    }
    expect(seen).toHaveLength(1);
    const passed = Array.from(seen[0]).map((t) => t.id);
    expect(passed).toEqual(['tableRelatorio']);
  });

  test('returns null rather than grabbing a panel table when the page has none', () => {
    document.body.innerHTML =
      '<div data-sigc-pro><table class="sigc-pro-zonas-table"><tbody></tbody></table></div>';
    const seen = [];
    const restore = withJq(seen);
    try {
      expect(P.getDataTable()).toBeNull();
    } finally {
      restore();
      document.body.innerHTML = '';
    }
    expect(seen).toHaveLength(0); // never even asked jQuery
  });
});

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

describe('parseAgendaSlotTitle', () => {
  test('is exported for other modules to reuse', () => {
    expect(typeof window.__sigcPro.parseAgendaSlotTitle).toBe('function');
  });

  // Splits on the FIRST colon only: Endereço values contain more.
  test('splits each line on the first colon', () => {
    const f = window.__sigcPro.parseAgendaSlotTitle(
      'Controle: 292740805060337\nEndereço: RUA X, Nº: 237: - Compl: APTO');
    expect(f['Controle']).toBe('292740805060337');
    expect(f['Endereço']).toBe('RUA X, Nº: 237: - Compl: APTO');
  });

  // SIGC renders an empty field as a literal " - ", which MISSING_VALUES
  // collapses, so the key is absent rather than present-and-blank.
  test('omits empty fields rather than storing blanks', () => {
    const f = window.__sigcPro.parseAgendaSlotTitle('Nome:  - \nTelefone: ');
    expect(f['Nome']).toBeUndefined();
    expect(f['Telefone']).toBeUndefined();
  });
});

describe('toMin / fmtMin', () => {
  test('parses HH:MM to minutes since midnight', () => {
    expect(window.__sigcPro.toMin('00:00')).toBe(0);
    expect(window.__sigcPro.toMin('09:30')).toBe(570);
    expect(window.__sigcPro.toMin('23:59')).toBe(1439);
  });

  // A one-digit hour is what the agenda's own slot text emits.
  test('accepts a one-digit hour', () => {
    expect(window.__sigcPro.toMin('9:05')).toBe(545);
  });

  // Callers branch on null, so an unparseable value must not become 0 —
  // midnight and "no time at all" are different things.
  test('returns null when there is no parseable time', () => {
    expect(window.__sigcPro.toMin('')).toBeNull();
    expect(window.__sigcPro.toMin(null)).toBeNull();
    expect(window.__sigcPro.toMin('LIVRE')).toBeNull();
  });

  test('ignores trailing text after the time', () => {
    expect(window.__sigcPro.toMin('09:30 - 10:00')).toBe(570);
  });

  test('fmtMin renders zero-padded HH:MM', () => {
    expect(window.__sigcPro.fmtMin(0)).toBe('00:00');
    expect(window.__sigcPro.fmtMin(570)).toBe('09:30');
    expect(window.__sigcPro.fmtMin(1439)).toBe('23:59');
  });

  test('fmtMin round-trips toMin', () => {
    expect(window.__sigcPro.fmtMin(window.__sigcPro.toMin('14:45'))).toBe('14:45');
  });
});

// A page whose report failed to render (proxy timeout, partial HTML) can
// leave a malformed table behind. getDataTable() used to call .DataTable()
// on it, which INITIALIZES an uninitialized table — and DataTables reports
// a column-count mismatch through its own alert(), not a thrown error, so
// no try/catch could contain it. The user got an undismissable modal on
// every mount tick.
describe('getDataTable never initializes a table', () => {
  const fixture = () =>
    (document.body.innerHTML =
      '<table id="tableRelatorio"><thead><tr><th>A</th><th>B</th></tr></thead>' +
      '<tbody><tr><td>quebrado</td></tr></tbody></table>');

  test('an uninitialized page table is left alone', () => {
    fixture();
    const prev = window.jQuery;
    let construiu = false;
    const fake = () => ({
      DataTable: () => { construiu = true; return null; },
    });
    fake.fn = { dataTable: { isDataTable: () => false } };
    window.jQuery = window.$ = fake;
    try {
      expect(P.getDataTable()).toBeNull();
      expect(construiu).toBe(false);
    } finally {
      window.jQuery = window.$ = prev;
      document.body.innerHTML = '';
    }
  });

  test('an already-initialized page table is still returned', () => {
    fixture();
    const prev = window.jQuery;
    const tabela = { table: () => ({ node: () => document.getElementById('tableRelatorio') }) };
    const fake = () => ({ DataTable: () => tabela });
    fake.fn = { dataTable: { isDataTable: () => true } };
    window.jQuery = window.$ = fake;
    try {
      expect(P.getDataTable()).toBe(tabela);
    } finally {
      window.jQuery = window.$ = prev;
      document.body.innerHTML = '';
    }
  });

  test('with several page tables, only the initialized ones are read', () => {
    document.body.innerHTML =
      '<table id="a"><tbody><tr><td>1</td></tr></tbody></table>' +
      '<table id="b"><tbody><tr><td>2</td></tr></tbody></table>';
    const prev = window.jQuery;
    const vistos = [];
    const tabela = { table: () => ({ node: () => document.getElementById('b') }) };
    const fake = (sel) => {
      vistos.push(Array.from(sel).map((t) => t.id));
      return { DataTable: () => tabela };
    };
    fake.fn = { dataTable: { isDataTable: (t) => t.id === 'b' } };
    window.jQuery = window.$ = fake;
    try {
      expect(P.getDataTable()).toBe(tabela);
      expect(vistos).toEqual([['b']]);
    } finally {
      window.jQuery = window.$ = prev;
      document.body.innerHTML = '';
    }
  });
});
