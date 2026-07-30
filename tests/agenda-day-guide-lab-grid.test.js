import { describe, test, expect } from 'bun:test';

// Order matters: sigc-common.js assigns window.__sigcPro wholesale, and
// municipios.js augments it — same order as manifest.json.
await import('../extension/common/sigc-common.js');
await import('../extension/common/municipios.js');
await import('../extension/features/agenda-day-guide/agenda-day-guide.js');

const { municipioFromControle } = window.__sigcPro;
const { buildDayGrid } = window.__sigcPro.dayGuide;

// Controle carries the 7-digit IBGE código as its first digits:
// 2927408 = Salvador - BA, 2919207 = Lauro de Freitas - BA.
function row({
  reservado = true, horaInicio = '09:00', nome = 'Fulano de Tal',
  controle = '2927408000123', domicilio = 'D1', dtNascimento = '17/02/1948',
} = {}) {
  return { reservado, horaInicio, horaFim: '09:30', nome, controle, domicilio, dtNascimento, equipe: 'A' };
}

describe('municipioFromControle', () => {
  test('maps a Controle to its "MUNICÍPIO - UF" label', () => {
    expect(municipioFromControle('2927408000123')).toBe('SALVADOR - BA');
    expect(municipioFromControle('2919207000456')).toBe('LAURO DE FREITAS - BA');
  });

  test('accepts a bare 7-digit código', () => {
    expect(municipioFromControle('2927408')).toBe('SALVADOR - BA');
  });

  test('ignores non-digits in the Controle', () => {
    expect(municipioFromControle('29.274-08/000123')).toBe('SALVADOR - BA');
  });

  // The packed table drops the 7th digit (IBGE's check digit) and scopes
  // lookup by the 2-digit UF prefix. These pin both halves of that: the
  // check digit must not affect the result, and a 4-digit code reused in
  // another UF must not leak across.
  test('ignores the 7th check digit', () => {
    const labels = new Set(
      '0123456789'.split('').map((c) => municipioFromControle(`292740${c}000123`))
    );
    expect([...labels]).toEqual(['SALVADOR - BA']);
  });

  test('same 4-digit code in a different UF resolves to that UF', () => {
    // 2919207 = Lauro de Freitas - BA; 1919207 is not a real UF prefix.
    expect(municipioFromControle('2919207000001')).toBe('LAURO DE FREITAS - BA');
    expect(municipioFromControle('1919207000001')).toBe('');
  });

  test('returns "" for missing, short, or unknown códigos', () => {
    expect(municipioFromControle('')).toBe('');
    expect(municipioFromControle(null)).toBe('');
    expect(municipioFromControle(undefined)).toBe('');
    expect(municipioFromControle('12345')).toBe('');
    expect(municipioFromControle('9999999000123')).toBe('');
  });
});

describe('buildDayGrid — Lab variant', () => {
  const groups = () => [{ equipe: 'Equipe A', rows: [row()] }];

  test('shows nome and município instead of Controle', () => {
    const html = buildDayGrid(groups(), true);
    expect(html).toContain('Fulano de Tal');
    expect(html).toContain('SALVADOR - BA');
    expect(html).toContain('grid-nome');
    expect(html).toContain('grid-municipio');
  });

  test('leaks no Controle, Domicílio or birth date', () => {
    const html = buildDayGrid(groups(), true);
    expect(html).not.toContain('2927408000123');
    // not even the previously truncated 11-digit prefix
    expect(html).not.toContain('29274080001');
    expect(html).not.toContain('grid-ctrl');
    expect(html).not.toContain('Dom D1');
    expect(html).not.toContain('17/02/1948');
  });

  test('unknown código: nome still shown, município omitted', () => {
    const g = [{ equipe: 'Equipe A', rows: [row({ controle: '9999999000123' })] }];
    const html = buildDayGrid(g, true);
    expect(html).toContain('Fulano de Tal');
    expect(html).not.toContain('grid-municipio');
  });

  test('reserved row with no nome falls back to em dash', () => {
    const g = [{ equipe: 'Equipe A', rows: [row({ nome: '' })] }];
    const html = buildDayGrid(g, true);
    expect(html).toContain('<span class="grid-nome">—</span>');
  });

  test('escapes nome', () => {
    const g = [{ equipe: 'Equipe A', rows: [row({ nome: '<script>alert(1)</script>' })] }];
    const html = buildDayGrid(g, true);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('open slots still render LIVRE, not a name row', () => {
    const g = [{ equipe: 'Equipe A', rows: [row({ reservado: false })] }];
    const html = buildDayGrid(g, true);
    expect(html).toContain('LIVRE');
    expect(html).not.toContain('grid-nome');
  });
});

describe('buildDayGrid — non-Lab variant is unchanged', () => {
  test('still shows the full Controle and Domicílio, no nome/município', () => {
    const html = buildDayGrid([{ equipe: 'Equipe A', rows: [row()] }], false);
    expect(html).toContain('2927408000123');
    expect(html).toContain('Dom D1');
    expect(html).not.toContain('grid-nome');
    expect(html).not.toContain('grid-municipio');
  });
});

// The zona comes from the opt-in endereços fetch, so every grid cell must
// still render correctly when that Map is absent (the default path).
describe('buildDayGrid — zona', () => {
  const enderecos = (entry = { lat: -12.9, lon: -38.5, zona: 'Centro', idZona: '12' }) =>
    new Map([['2927408000123|D1', entry]]);

  test('appends the zona in the non-Lab variant', () => {
    const html = buildDayGrid([{ equipe: 'Equipe A', rows: [row()] }], false, enderecos());
    expect(html).toContain('<span class="grid-zona">Zona 12 Centro</span>');
    expect(html).toContain('2927408000123');
  });

  test('appends the zona in the Lab variant', () => {
    const html = buildDayGrid([{ equipe: 'Equipe A', rows: [row()] }], true, enderecos());
    expect(html).toContain('<span class="grid-zona">Zona 12 Centro</span>');
    expect(html).toContain('SALVADOR - BA');
    expect(html).not.toContain('2927408000123');
  });

  test('omits the zona when no endereços were fetched', () => {
    expect(buildDayGrid([{ equipe: 'Equipe A', rows: [row()] }], false)).not.toContain('grid-zona');
    expect(buildDayGrid([{ equipe: 'Equipe A', rows: [row()] }], true)).not.toContain('grid-zona');
  });

  test('omits the zona when the entry carries none', () => {
    const e = enderecos({ lat: -12.9, lon: -38.5, zona: null, idZona: null });
    expect(buildDayGrid([{ equipe: 'Equipe A', rows: [row()] }], false, e)).not.toContain('grid-zona');
  });

  test('renders idZona or zona alone when the other is missing', () => {
    const soId = enderecos({ lat: null, lon: null, zona: null, idZona: '12' });
    expect(buildDayGrid([{ equipe: 'Equipe A', rows: [row()] }], false, soId))
      .toContain('<span class="grid-zona">Zona 12</span>');
    const soNome = enderecos({ lat: null, lon: null, zona: 'Centro', idZona: null });
    expect(buildDayGrid([{ equipe: 'Equipe A', rows: [row()] }], false, soNome))
      .toContain('<span class="grid-zona">Zona Centro</span>');
  });

  test('a row with no matching endereço gets no zona', () => {
    const g = [{ equipe: 'Equipe A', rows: [row({ domicilio: 'D9' })] }];
    expect(buildDayGrid(g, false, enderecos())).not.toContain('grid-zona');
  });

  test('open slots never show a zona', () => {
    const g = [{ equipe: 'Equipe A', rows: [row({ reservado: false })] }];
    expect(buildDayGrid(g, false, enderecos())).not.toContain('grid-zona');
  });

  test('escapes the zona', () => {
    const e = enderecos({ lat: null, lon: null, zona: '<script>alert(1)</script>', idZona: null });
    const html = buildDayGrid([{ equipe: 'Equipe A', rows: [row()] }], false, e);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
