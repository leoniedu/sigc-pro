import { describe, test, expect } from 'bun:test';

await import('../extension/common/sigc-common.js');
const P = window.__sigcPro;

describe('makeDtProButton', () => {
  test('produces a native-classed 36px toolbar button', () => {
    let clicked = 0;
    const btn = P.makeDtProButton({
      id: 'dt-x',
      lines: ['KML', 'PRO'],
      title: 'Exportar KML (SIGC-PRO)',
      onClick: () => (clicked += 1),
    });
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.id).toBe('dt-x');
    expect(btn.type).toBe('button');
    expect(btn.className).toBe('dt-button buttons-html5 dt-btn-icon');
    expect(btn.title).toBe('Exportar KML (SIGC-PRO)');
    expect(btn.querySelector('span').innerHTML).toBe('KML<br>PRO');
    expect(btn.style.width).toBe('36px');
    expect(btn.style.background).toBe('#005a9c');
    btn.click();
    expect(clicked).toBe(1);
  });
});

describe('makeFcProButton', () => {
  test('produces an fc-classed toolbar button', () => {
    let clicked = 0;
    const btn = P.makeFcProButton({
      id: 'fc-x',
      text: 'CSV-PRO',
      title: 'Exportar slots da agenda (SIGC-PRO)',
      onClick: () => (clicked += 1),
    });
    expect(btn.className).toBe('fc-button fc-button-primary');
    expect(btn.textContent).toBe('CSV-PRO');
    expect(btn.style.marginLeft).toBe('4px');
    expect(btn.style.background).toBe('#005a9c');
    btn.click();
    expect(clicked).toBe(1);
  });

  test('id and onClick are optional (date-picker wraps its own)', () => {
    const btn = P.makeFcProButton({ text: '📅', title: 'Ir para a data (SIGC-PRO)' });
    expect(btn.id).toBe('');
    btn.click(); // must not throw
  });
});
