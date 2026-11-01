import { describe, test, expect } from 'bun:test';

await import('../extension/common/sigc-common.js');
const P = window.__sigcPro;

describe('makeDtProButton disabled styling', () => {
  // The DataTables buttons set `background` INLINE, so a stylesheet
  // :disabled rule can never take effect — without repainting the inline
  // value, a click that kicks off a multi-second fetch looked identical to
  // an idle button. The FullCalendar buttons got this free from
  // .fc-button:disabled; these never did (reported 2026-08-12).
  const bg = (btn) => btn.style.background.replace(/\s/g, '').toLowerCase();
  const BLUE = '#005a9c';
  const WASHED = '#7fb3d3';

  test('starts enabled in full PRO blue', () => {
    const btn = P.makeDtProButton({ id: 'dt-c1', lines: ['A', 'B'], title: 't', onClick: () => {} });
    expect(btn.disabled).toBe(false);
    expect(bg(btn)).toBe(BLUE);
  });

  // The whole point of wrapping the property: every existing
  // `btn.disabled = true` call site repaints with no code change.
  test('washes out when disabled and restores when re-enabled', () => {
    const btn = P.makeDtProButton({ id: 'dt-c2', lines: ['A', 'B'], title: 't', onClick: () => {} });
    btn.disabled = true;
    expect(bg(btn)).toBe(WASHED);
    expect(btn.disabled).toBe(true);
    btn.disabled = false;
    expect(bg(btn)).toBe(BLUE);
    expect(btn.disabled).toBe(false);
  });

  // The property must keep behaving like the real DOM one: actually
  // blocking clicks, not merely recolouring.
  test('still suppresses clicks while disabled', () => {
    let clicked = 0;
    const btn = P.makeDtProButton({ id: 'dt-c3', lines: ['A', 'B'], title: 't', onClick: () => (clicked += 1) });
    document.body.appendChild(btn);
    btn.disabled = true;
    btn.click();
    expect(clicked).toBe(0);
    btn.disabled = false;
    btn.click();
    expect(clicked).toBe(1);
    btn.remove();
  });
});

describe('makeDtProButton', () => {
  test('produces a native-classed 44px toolbar button', () => {
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
    // Sized to the longest label in use ("MAPA"), which ellipsised to
    // "M…" at the original 36px.
    expect(btn.style.width).toBe('44px');
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

describe('makeSigcFormButton', () => {
  test('produces a btn-sigc-classed form button', () => {
    let clicked = 0;
    const btn = P.makeSigcFormButton({
      id: 'sigc-x',
      text: 'CSV TODAS',
      title: 'Exportar todas as agências (SIGC-PRO)',
      onClick: () => (clicked += 1),
    });
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.id).toBe('sigc-x');
    expect(btn.type).toBe('button');
    expect(btn.className).toBe('btn btn-primary btn-sigc');
    expect(btn.textContent).toBe('CSV TODAS');
    expect(btn.title).toBe('Exportar todas as agências (SIGC-PRO)');
    expect(btn.style.background).toBe('#005a9c');
    btn.click();
    expect(clicked).toBe(1);
  });

  test('small: wraps text onto two lines split on the first space', () => {
    const btn = P.makeSigcFormButton({
      id: 'sigc-y',
      text: 'CSV TODAS',
      title: 'x',
      onClick: () => {},
      small: true,
    });
    expect(btn.textContent).toBe('CSVTODAS'); // <br> contributes no text
    expect(btn.querySelector('br')).not.toBeNull();
    expect(btn.style.width).toBe('64px');
  });

  test('small: a single-word text renders with no <br>', () => {
    const btn = P.makeSigcFormButton({
      id: 'sigc-z',
      text: 'Mapa',
      title: 'x',
      onClick: () => {},
      small: true,
    });
    expect(btn.textContent).toBe('Mapa');
    expect(btn.querySelector('br')).toBeNull();
  });
});
