import { describe, test, expect, afterEach } from 'bun:test';

await import('../extension/common/sigc-common.js');
await import('../extension/common/sigc-panel.js');
const P = window.__sigcPro.panel;

afterEach(() => { delete window.jQuery; delete window.$; });

// A jQuery double just rich enough for initPanelTables: it records the
// options DataTables is constructed with.
function fakeJq(capturado) {
  const jq = () => ({
    DataTable(opts) {
      capturado.push(opts);
      return { columns: undefined };
    },
  });
  jq.fn = { dataTable: { isDataTable: () => false } };
  return jq;
}

describe('initPanelTables', () => {
  test('a header declaring data-sigc-type becomes a columnDefs entry', () => {
    const opts = [];
    window.jQuery = fakeJq(opts);
    const el = document.createElement('div');
    el.innerHTML = '<table><thead><tr><th>Nome</th><th data-sigc-type="num">N</th><th data-sigc-type="num">%</th></tr></thead>' +
      '<tbody><tr><td>a</td><td>1</td><td>2</td></tr></tbody></table>';
    P.initPanelTables(el);
    expect(opts).toHaveLength(1);
    expect(opts[0].columnDefs.map((d) => [d.targets, d.type])).toEqual([[1, 'num'], [2, 'num']]);
    expect(opts[0].columnDefs.every((d) => d.render === P.renderNumerico)).toBe(true);
  });

  test('skip leaves the matching tables alone', () => {
    const opts = [];
    window.jQuery = fakeJq(opts);
    const el = document.createElement('div');
    el.innerHTML = '<table class="prosa"><thead><tr><th>A</th></tr></thead><tbody><tr><td>x</td></tr></tbody></table>';
    P.initPanelTables(el, { skip: '.prosa' });
    expect(opts).toHaveLength(0);
  });

  test('a body that disagrees with its header is not handed to DataTables', () => {
    const opts = [];
    window.jQuery = fakeJq(opts);
    const el = document.createElement('div');
    el.innerHTML = '<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>x</td></tr></tbody></table>';
    P.initPanelTables(el);
    expect(opts).toHaveLength(0);
  });
});

describe('initPanelTables: tables the page script already initialised', () => {
  // isDataTable flips to false once destroy() has run, as in DataTables.
  function jqReivindicado(eventos) {
    let reivindicada = true;
    const jq = () => ({
      DataTable(opts) {
        if (opts) { eventos.push(['construir', opts]); reivindicada = true; return { columns: undefined }; }
        return {
          destroy() { eventos.push(['destruir']); reivindicada = false; },
          page: { len() { eventos.push(['ajustar']); return { draw() {} }; } },
          columns: undefined,
        };
      },
    });
    jq.fn = { dataTable: { isDataTable: () => reivindicada } };
    return jq;
  }
  const tabela = (th) => {
    const el = document.createElement('div');
    el.innerHTML = `<table><thead><tr><th>A</th><th${th}>B</th></tr></thead><tbody><tr><td>x</td><td>1</td></tr></tbody></table>`;
    return el;
  };

  test('with a declared column type it is rebuilt, so the type takes effect', () => {
    const eventos = [];
    window.jQuery = jqReivindicado(eventos);
    P.initPanelTables(tabela(' data-sigc-type="num"'));
    expect(eventos.map((e) => e[0])).toEqual(['destruir', 'construir']);
    expect(eventos[1][1].columnDefs.map((d) => [d.targets, d.type])).toEqual([[1, 'num']]);
  });

  test('without one it is adjusted in place, as before', () => {
    const eventos = [];
    window.jQuery = jqReivindicado(eventos);
    P.initPanelTables(tabela(''));
    expect(eventos.map((e) => e[0])).toEqual(['ajustar']);
  });
});

describe('valorNumerico / renderNumerico', () => {
  test('reads the number out of a cell, comma or dot, with or without %', () => {
    expect(P.valorNumerico('12,5%')).toBe(12.5);
    expect(P.valorNumerico('<span class="sigc-pro-csv-valor">33,3</span>%')).toBe(33.3);
    expect(P.valorNumerico('033.3333')).toBe(33.3333);
    expect(P.valorNumerico('100%')).toBe(100);
    expect(P.valorNumerico('7')).toBe(7);
    expect(P.valorNumerico({ display: '<b>12,9</b>%', sort: 'x' })).toBe(12.9);
  });
  test('"12,9" is not truncated to 12, and orders after "12,5" and before "33,1"', () => {
    const v = ['33,1%', '12,9%', '12,5%', '100%', '5%'].map(P.valorNumerico);
    expect([...v].sort((a, b) => a - b)).toEqual([5, 12.5, 12.9, 33.1, 100]);
  });
  test('a cell with no number sorts first rather than breaking the column', () => {
    expect(P.valorNumerico('—')).toBe(-1);
    expect(P.valorNumerico(null)).toBe(-1);
  });
  test('only sort and type are rewritten; display and filter pass through', () => {
    expect(P.renderNumerico('12,5%', 'sort')).toBe(12.5);
    expect(P.renderNumerico('12,5%', 'type')).toBe(12.5);
    expect(P.renderNumerico('12,5%', 'display')).toBe('12,5%');
    expect(P.renderNumerico('12,5%', 'filter')).toBe('12,5%');
  });
});

describe('celulaParaTexto', () => {
  test('exports the .sigc-pro-csv-valor span instead of the cell text', () => {
    const td = document.createElement('td');
    td.innerHTML = '<span class="sigc-pro-csv-valor">12,3</span>%';
    expect(P.celulaParaTexto(td)).toBe('12,3');
  });
  test('a lone placeholder dash exports blank', () => {
    const td = document.createElement('td');
    td.textContent = '—';
    expect(P.celulaParaTexto(td)).toBe('');
  });
});
