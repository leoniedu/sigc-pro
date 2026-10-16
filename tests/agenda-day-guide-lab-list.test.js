import { describe, test, expect } from 'bun:test';

// Order matters: sigc-common.js assigns window.__sigcPro wholesale, and
// municipios.js augments it — same order as manifest.json.
await import('../extension/common/sigc-common.js');
await import('../extension/common/municipios.js');
await import('../extension/features/agenda-day-guide/route-map.js');
await import('../extension/features/agenda-day-guide/agenda-day-guide.js');

const { municipioFromControle } = window.__sigcPro;
const { buildLabList, dayNumberMap } = window.__sigcPro.dayGuide;

// Controle carries the 7-digit IBGE código as its first digits:
// 2927408 = Salvador - BA, 2919207 = Lauro de Freitas - BA.
function row({
  reservado = true, horaInicio = '09:00', nome = 'Fulano de Tal',
  controle = '2927408000123', domicilio = 'D1', dtNascimento = '17/02/1948',
  telefone = '', endereco = '', sexo = '', idade = '', observacao = '',
} = {}) {
  return {
    reservado, horaInicio, horaFim: '09:30', nome, controle, domicilio,
    dtNascimento, telefone, endereco, sexo, idade, observacao, equipe: 'A',
  };
}

const listFor = (rows, enderecos) => buildLabList(rows, enderecos, dayNumberMap(rows));

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

describe('buildLabList', () => {
  test('shows nº, hora, first name + birth year, domicílio and município — never the Controle', () => {
    const html = listFor([row()]);
    expect(html).toContain('<td class="lab-num">1</td>');
    expect(html).toContain('09:00');
    // First name and birth year only — enough for the lab to confirm
    // whose samples these are, without the full identity.
    expect(html).toContain('<td class="lab-morador">Fulano (1948)</td>');
    expect(html).toContain('<td class="lab-dom">D1</td>');
    expect(html).toContain('SALVADOR - BA');
    expect(html).not.toContain('2927408000123');
  });

  test('leaks no Controle, no full nome, no full birth date', () => {
    const html = listFor([row()]);
    expect(html).not.toContain('2927408000123');
    // not even the previously truncated 11-digit prefix
    expect(html).not.toContain('29274080001');
    expect(html).not.toContain('Fulano de Tal');
    expect(html).not.toContain('de Tal');
    expect(html).not.toContain('17/02/1948');
    expect(html).not.toContain('17/02');
  });

  test('each row carries a tickmark checkbox', () => {
    const html = listFor([row()]);
    expect(html).toContain('<td class="lab-sel"><input type="checkbox" class="lab-chk"></td>');
  });

  // WHITELIST, deliberately the inverse of the test above. The Lab tab
  // is the one artifact designed to leave the institution, and a
  // blacklist only catches fields someone already thought to forbid — a
  // newly added field passes it silently (that is exactly how zona
  // entered the Lab tab in 0c0eb28 without review).
  //
  // The sanctioned set is {tickmark, nº, hora, primeiro nome + ano,
  // domicílio, município, zona, equipe}. Adding a further field must be
  // a deliberate edit to THIS list, with the privacy question answered
  // in the commit message — not a silent pass. Zona is in the set by an
  // explicit decision: the laboratory needs the area to plan its
  // collection routes. The nº carries no data of its own — it is the
  // day-wide position, shared with every other tab.
  test('Lab rows carry ONLY the sanctioned fields', () => {
    // Deliberately POPULATED with every sensitive field a real reserved
    // slot carries. A sparse fixture would defeat the whole test: a
    // newly rendered field whose fixture value is empty emits nothing
    // and passes silently, which is the failure mode this test exists
    // to prevent.
    const cheio = row({
      telefone: '71 99999-0000',
      endereco: 'Rua Exemplo, 100',
      sexo: 'F',
      idade: '78',
      observacao: 'observação sensível',
    });
    const enderecos = new Map([
      ['2927408000123|D1', { idZona: '12', zona: 'Centro', lat: null, lon: null }],
    ]);
    const html = listFor([cheio], enderecos);

    // Each entry here is an explicit decision — see buildLabList's
    // comment: equipe (the grouping the lab works in), domicílio (how
    // sample material is labeled; locates nothing without its Controle),
    // morador (FIRST name + birth YEAR only), sel (the tickmark, no
    // data of its own).
    const SANCTIONED = ['lab-sel', 'lab-num', 'lab-hora', 'lab-morador',
      'lab-dom', 'lab-municipio', 'lab-zona', 'lab-equipe'];
    const cellClasses = [...html.matchAll(/<t[dh] class="(lab-[a-z-]+)"/g)]
      .map((m) => m[1]);
    expect(cellClasses.length).toBeGreaterThan(0);
    const unexpected = [...new Set(cellClasses)]
      .filter((c) => !SANCTIONED.includes(c));
    expect(unexpected).toEqual([]);

    // The sanctioned fields are present…
    expect(html).toContain('<td class="lab-num">1</td>');
    expect(html).toContain('09:00');
    expect(html).toContain('<td class="lab-morador">Fulano (1948)</td>');
    expect(html).toContain('<td class="lab-dom">D1</td>');
    expect(html).toContain('SALVADOR - BA');
    expect(html).toContain('<td class="lab-zona">12</td>');

    // …and no populated non-sanctioned value leaked through — including
    // the full nome and the full birth date, of which only the first
    // name and the year survive.
    ['71 99999-0000', 'Rua Exemplo, 100', 'observação sensível',
      '17/02/1948', 'Fulano de Tal']
      .forEach((v) => expect(html).not.toContain(v));
  });

  test('unknown código: morador still shown, município cell empty', () => {
    const html = listFor([row({ controle: '9999999000123' })]);
    expect(html).toContain('Fulano (1948)');
    expect(html).toContain('<td class="lab-municipio"></td>');
  });

  test('missing pieces degrade one by one, never as a fake value', () => {
    // No nome, only the year; no birth date, only the name; neither.
    expect(listFor([row({ nome: '' })]))
      .toContain('<td class="lab-morador">— (1948)</td>');
    expect(listFor([row({ dtNascimento: '' })]))
      .toContain('<td class="lab-morador">Fulano</td>');
    expect(listFor([row({ nome: '', dtNascimento: '' })]))
      .toContain('<td class="lab-morador">—</td>');
  });

  test('escapes nome', () => {
    const html = listFor([row({ nome: '<script>alert(1)</script>' })]);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('open slots never render a row; an all-open day renders nothing', () => {
    expect(listFor([row({ reservado: false })])).toBe('');
    const html = listFor([row({ reservado: false, horaInicio: '08:00' }), row()]);
    expect((html.match(/<td class="lab-num">/g) || []).length).toBe(1);
  });

  test('rows group by team (name order) and keep their day numbers', () => {
    const rows = [
      { ...row({ horaInicio: '08:00', domicilio: 'D1' }), equipe: 'B' },
      { ...row({ horaInicio: '09:00', domicilio: 'D2' }), equipe: 'A' },
      { ...row({ horaInicio: '10:00', domicilio: 'D3' }), equipe: 'B' },
    ];
    const html = listFor(rows);
    // Each team named prominently on its own header row, A before B.
    expect(html).toContain('<th class="lab-equipe" colspan="7">A</th>');
    expect(html).toContain('<th class="lab-equipe" colspan="7">B</th>');
    expect(html.indexOf('colspan="7">A<')).toBeLessThan(html.indexOf('colspan="7">B<'));
    // Day numbers are identity, not row order: grouped by team they are
    // deliberately NOT sequential down the page (A's household is the
    // day's 2nd), and within a team time order holds (1 before 3).
    const nums = [...html.matchAll(/<td class="lab-num">(\d+)<\/td>/g)].map((m) => m[1]);
    expect(nums).toEqual(['2', '1', '3']);
  });

  test('escapes the equipe name', () => {
    const rows = [{ ...row(), equipe: '<script>alert(1)</script>' }];
    const html = listFor(rows);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

// The zona comes from the opt-in endereços fetch, so every list row must
// still render correctly when that Map is absent (the default path).
describe('buildLabList — zona', () => {
  const enderecos = (entry = { lat: -12.9, lon: -38.5, zona: 'Centro', idZona: '12' }) =>
    new Map([['2927408000123|D1', entry]]);

  test('shows the zona ID when the endereços fetch supplied one', () => {
    const html = listFor([row()], enderecos());
    expect(html).toContain('<td class="lab-zona">12</td>');
    expect(html).not.toContain('2927408000123');
  });

  test('zona cell is empty when no endereços were fetched', () => {
    expect(listFor([row()])).toContain('<td class="lab-zona"></td>');
  });

  test('zona cell is empty when the entry carries none', () => {
    const e = enderecos({ lat: -12.9, lon: -38.5, zona: null, idZona: null });
    expect(listFor([row()], e)).toContain('<td class="lab-zona"></td>');
  });

  // The ID alone identifies the zona; the nome is never appended to it.
  test('shows the ID alone when both ID and name are present', () => {
    const ambos = enderecos({ lat: null, lon: null, zona: 'Centro', idZona: '12' });
    const html = listFor([row()], ambos);
    expect(html).toContain('<td class="lab-zona">12</td>');
    expect(html).not.toContain('Centro');
  });

  // No nome-only fallback: every zona in SIGC has an ID, so a row without
  // one has no zona at all and must render blank rather than a bare nome.
  test('renders no zona when there is no idZona', () => {
    const soNome = enderecos({ lat: null, lon: null, zona: 'Centro', idZona: null });
    const html = listFor([row()], soNome);
    expect(html).toContain('<td class="lab-zona"></td>');
    expect(html).not.toContain('Centro');
  });

  test('a row with no matching endereço gets no zona', () => {
    const html = listFor([row({ domicilio: 'D9' })], enderecos());
    expect(html).toContain('<td class="lab-zona"></td>');
  });

  // Payload goes in idZona, the field actually rendered — putting it in
  // zona would pass vacuously now that the nome is never shown.
  test('escapes the zona', () => {
    const e = enderecos({ lat: null, lon: null, zona: '', idZona: '<script>alert(1)</script>' });
    const html = listFor([row()], e);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
