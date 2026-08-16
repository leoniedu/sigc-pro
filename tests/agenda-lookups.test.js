import { describe, test, expect } from 'bun:test';

await import('../extension/common/sigc-common.js');
await import('../extension/features/agenda-lookups/agenda-lookups.js');

const AM = window.__sigcProAgendaLookups;

describe('filtrarUrl', () => {
  const origin = 'https://portalweb.ibge.gov.br';
  const F5_HEX = '68747470733a2f2f773373696763706e73323032352e696267652e676f762e6272';
  const F5_PATHNAME = `/f5-w-${F5_HEX}$$/UltimoMovimento`;

  test('ListaEnderecos slug, simple mode, direct host', () => {
    expect(AM.filtrarUrl(origin, '/Agenda', 'ListaEnderecos', true))
      .toBe(`${origin}/relatorio/filtrar?slug=ListaEnderecos`);
  });

  test('relatorio-ultimo-movimento slug, simple mode, F5 gateway', () => {
    expect(AM.filtrarUrl(origin, F5_PATHNAME, 'relatorio-ultimo-movimento', true))
      .toBe(`${origin}/f5-w-${F5_HEX}$$/relatorio/filtrar?slug=relatorio-ultimo-movimento`);
  });

  test('relatorio-ultimo-movimento slug, fallback mode, F5 gateway', () => {
    expect(AM.filtrarUrl(origin, F5_PATHNAME, 'relatorio-ultimo-movimento', false))
      .toBe(`${origin}/f5-w-${F5_HEX}$$/relatorio/f5-h-$$/relatorio/filtrar?slug=relatorio-ultimo-movimento;F5_origin=${F5_HEX}&F5CH=I`);
  });
});

describe('parseUltimoMovimentoTable', () => {
  test('maps Controle+Domicílio to {entrevistador} by header label', () => {
    const headers = ['Controle', 'Domicilio', 'Entrevistador', 'Situação'];
    const rows = [
      ['290570120000125', '1', 'Fulano de Tal', 'Entrevistado'],
      ['290570120000999', '3', 'Beltrano da Silva', 'Pendente'],
    ];
    const map = AM.parseUltimoMovimentoTable(headers, rows);
    expect(map.get('290570120000125|1')).toEqual({ entrevistador: 'Fulano de Tal' });
    expect(map.get('290570120000999|3')).toEqual({ entrevistador: 'Beltrano da Silva' });
  });

  test('is tolerant of header order and extra columns', () => {
    const headers = ['Situação', 'Entrevistador', 'Domicilio', 'Controle'];
    const rows = [['Entrevistado', 'Fulano', 'D1', 'C1']];
    const map = AM.parseUltimoMovimentoTable(headers, rows);
    expect(map.get('C1|D1')).toEqual({ entrevistador: 'Fulano' });
  });

  test('returns null when a required header is missing', () => {
    const headers = ['Controle', 'Domicilio', 'Situação'];
    const rows = [['C1', 'D1', 'Entrevistado']];
    expect(AM.parseUltimoMovimentoTable(headers, rows)).toBeNull();
  });

  test('returns null when Domicilio itself is missing (fail-closed, same as Controle/Entrevistador)', () => {
    const headers = ['Controle', 'Entrevistador'];
    const rows = [['C1', 'Fulano']];
    expect(AM.parseUltimoMovimentoTable(headers, rows)).toBeNull();
  });

  test('skips rows with a blank Controle', () => {
    const headers = ['Controle', 'Domicilio', 'Entrevistador'];
    const rows = [['', 'D1', 'Fulano'], ['C1', 'D1', 'Fulano']];
    const map = AM.parseUltimoMovimentoTable(headers, rows);
    expect(map.size).toBe(1);
    expect(map.has('C1|D1')).toBe(true);
  });

  test('tolerates the live #!/! header marker (real live header row, 2026-08-07)', () => {
    const headers = ['#!Controle', '!Domicílio', 'Entrevistador', 'Tipo Entrevista', 'Última Posição', 'Data', 'Observação'];
    const rows = [['292740805220571', '1', 'Fulano de Tal', 'Realizada', 'Descarregado', '07/08/2026 10:27:20', '']];
    const map = AM.parseUltimoMovimentoTable(headers, rows);
    expect(map.get('292740805220571|1')).toEqual({ entrevistador: 'Fulano de Tal' });
  });

  test('still resolves the old unmarked header form (no #!/! prefix)', () => {
    const headers = ['Controle', 'Domicilio', 'Entrevistador'];
    const rows = [['C1', 'D1', 'Fulano']];
    const map = AM.parseUltimoMovimentoTable(headers, rows);
    expect(map.get('C1|D1')).toEqual({ entrevistador: 'Fulano' });
  });

  test('trims whitespace from cell values, including Domicilio', () => {
    const headers = ['Controle', 'Domicilio', 'Entrevistador'];
    const rows = [[' C1 ', ' D1 ', ' Fulano de Tal ']];
    const map = AM.parseUltimoMovimentoTable(headers, rows);
    expect(map.get('C1|D1')).toEqual({ entrevistador: 'Fulano de Tal' });
  });

  test('two Domicílios under the same Controle keep their own distinct Entrevistador (regression: used to collapse to one per Controle)', () => {
    const headers = ['Controle', 'Domicilio', 'Entrevistador'];
    const rows = [
      ['292740805180317', '1', 'Fulano de Tal'],
      ['292740805180317', '2', 'Beltrano da Silva'],
    ];
    const map = AM.parseUltimoMovimentoTable(headers, rows);
    expect(map.get('292740805180317|1')).toEqual({ entrevistador: 'Fulano de Tal' });
    expect(map.get('292740805180317|2')).toEqual({ entrevistador: 'Beltrano da Silva' });
    expect(map.size).toBe(2);
  });
});

describe('mergeUltimoMovimento', () => {
  test('adds entrevistador by matching the full controle|domicilio key, not just controle', () => {
    const enderecos = new Map([
      ['C1|D1', { lat: -12.9, lon: -38.5, zona: 'Centro', idZona: 'Z1' }],
      ['C1|D2', { lat: -12.8, lon: -38.4, zona: 'Centro', idZona: 'Z1' }],
      ['C2|D1', { lat: -13.0, lon: -38.6, zona: 'Norte', idZona: 'Z2' }],
    ]);
    const umMap = new Map([
      ['C1|D1', { entrevistador: 'Fulano' }],
      ['C1|D2', { entrevistador: 'Beltrano' }],
    ]);
    const merged = AM.mergeUltimoMovimento(enderecos, umMap);
    expect(merged.get('C1|D1')).toEqual({ lat: -12.9, lon: -38.5, zona: 'Centro', idZona: 'Z1', entrevistador: 'Fulano' });
    expect(merged.get('C1|D2')).toEqual({ lat: -12.8, lon: -38.4, zona: 'Centro', idZona: 'Z1', entrevistador: 'Beltrano' });
    // C2|D1 has no Último Movimento match: passes through untouched.
    expect(merged.get('C2|D1')).toEqual({ lat: -13.0, lon: -38.6, zona: 'Norte', idZona: 'Z2' });
  });

  test('returns the original map unchanged when umMap is empty', () => {
    const enderecos = new Map([['C1|D1', { lat: -12.9, lon: -38.5 }]]);
    const merged = AM.mergeUltimoMovimento(enderecos, new Map());
    expect(merged.get('C1|D1')).toEqual({ lat: -12.9, lon: -38.5 });
  });

  test('does not mutate the input enderecos map', () => {
    const original = { lat: -12.9, lon: -38.5 };
    const enderecos = new Map([['C1|D1', original]]);
    AM.mergeUltimoMovimento(enderecos, new Map([['C1|D1', { entrevistador: 'Fulano' }]]));
    expect(original).toEqual({ lat: -12.9, lon: -38.5 });
  });
});

describe('parseDistribuicaoTable', () => {
  test('maps Controle to {agencia} using Agência Distribuida (not Sugerida)', () => {
    const headers = ['Controle', 'Município', 'Agência Sugerida', 'Agência Distribuida', 'Data Distribuição', 'Usuário da Distribuição'];
    const rows = [
      ['292370405000008', 'PARATINGA', 'BOM JESUS DA LAPA (sugerida)', 'BOM JESUS DA LAPA', '07/07/2026 00:00:00', 'EDUARDO LACRETA LEONI'],
    ];
    const map = AM.parseDistribuicaoTable(headers, rows);
    expect(map.get('292370405000008')).toEqual({ agencia: 'BOM JESUS DA LAPA' });
  });

  test('is tolerant of header order and extra columns', () => {
    const headers = ['Usuário da Distribuição', 'Agência Distribuida', 'Controle', 'Agência Sugerida'];
    const rows = [['Fulano', 'A1', 'C1', 'A0 (sugerida)']];
    const map = AM.parseDistribuicaoTable(headers, rows);
    expect(map.get('C1')).toEqual({ agencia: 'A1' });
  });

  test('returns null when Agência Distribuida is missing (Sugerida alone does not satisfy it)', () => {
    const headers = ['Controle', 'Agência Sugerida'];
    const rows = [['C1', 'A0']];
    expect(AM.parseDistribuicaoTable(headers, rows)).toBeNull();
  });

  test('returns null when Controle is missing', () => {
    const headers = ['Agência Distribuida'];
    const rows = [['A1']];
    expect(AM.parseDistribuicaoTable(headers, rows)).toBeNull();
  });

  test('skips rows with a blank Controle', () => {
    const headers = ['Controle', 'Agência Distribuida'];
    const rows = [['', 'A1'], ['C1', 'A1']];
    const map = AM.parseDistribuicaoTable(headers, rows);
    expect(map.size).toBe(1);
    expect(map.has('C1')).toBe(true);
  });

  test('trims whitespace from cell values', () => {
    const headers = ['Controle', 'Agência Distribuida'];
    const rows = [[' C1 ', ' BOM JESUS DA LAPA ']];
    const map = AM.parseDistribuicaoTable(headers, rows);
    expect(map.get('C1')).toEqual({ agencia: 'BOM JESUS DA LAPA' });
  });
});

describe('mergeDistribuicao', () => {
  test('adds agencia to every entry sharing that Controle', () => {
    const enderecos = new Map([
      ['C1|D1', { lat: -12.9, lon: -38.5, entrevistador: 'Fulano' }],
      ['C1|D2', { lat: -12.8, lon: -38.4, entrevistador: 'Fulano' }],
      ['C2|D1', { lat: -13.0, lon: -38.6 }],
    ]);
    const distMap = new Map([
      ['C1', { agencia: 'BOM JESUS DA LAPA' }],
    ]);
    const merged = AM.mergeDistribuicao(enderecos, distMap);
    expect(merged.get('C1|D1')).toEqual({ lat: -12.9, lon: -38.5, entrevistador: 'Fulano', agencia: 'BOM JESUS DA LAPA' });
    expect(merged.get('C1|D2')).toEqual({ lat: -12.8, lon: -38.4, entrevistador: 'Fulano', agencia: 'BOM JESUS DA LAPA' });
    expect(merged.get('C2|D1')).toEqual({ lat: -13.0, lon: -38.6 });
  });

  test('returns entries unchanged when distMap is empty', () => {
    const enderecos = new Map([['C1|D1', { lat: -12.9, lon: -38.5 }]]);
    const merged = AM.mergeDistribuicao(enderecos, new Map());
    expect(merged.get('C1|D1')).toEqual({ lat: -12.9, lon: -38.5 });
  });

  test('does not mutate the input enderecos map', () => {
    const original = { lat: -12.9, lon: -38.5 };
    const enderecos = new Map([['C1|D1', original]]);
    AM.mergeDistribuicao(enderecos, new Map([['C1', { agencia: 'A1' }]]));
    expect(original).toEqual({ lat: -12.9, lon: -38.5 });
  });
});

describe('fetchEnderecosByAgencia caching', () => {
  test('a second call for the same uf|agencia does not refetch', async () => {
    const AM = window.__sigcProAgendaLookups;
    AM.resetEnderecosAgenciaCache();
    let calls = 0;
    const original = global.fetch;
    global.fetch = async () => {
      calls += 1;
      return { ok: true, status: 200, text: async () => `
        <table id="tableRelatorio">
          <thead><tr><th>Controle</th><th>N.º Domicilio</th><th>Latitude</th><th>Longitude</th><th>ID Zona</th><th>Nome ZONA</th></tr></thead>
          <tbody><tr><td>123</td><td>1</td><td>-12.5</td><td>-38.5</td><td>Z1</td><td>Centro</td></tr></tbody>
        </table>
      ` };
    };
    try {
      await AM.fetchEnderecosByAgencia('29', 'AG1');
      await AM.fetchEnderecosByAgencia('29', 'AG1');
      expect(calls).toBe(1);
    } finally {
      global.fetch = original;
    }
  });

  test('a different agência is fetched separately', async () => {
    const AM = window.__sigcProAgendaLookups;
    AM.resetEnderecosAgenciaCache();
    let calls = 0;
    const original = global.fetch;
    global.fetch = async () => {
      calls += 1;
      return { ok: true, status: 200, text: async () => `
        <table id="tableRelatorio">
          <thead><tr><th>Controle</th><th>N.º Domicilio</th><th>Latitude</th><th>Longitude</th><th>ID Zona</th><th>Nome ZONA</th></tr></thead>
          <tbody><tr><td>123</td><td>1</td><td>-12.5</td><td>-38.5</td><td>Z1</td><td>Centro</td></tr></tbody>
        </table>
      ` };
    };
    try {
      await AM.fetchEnderecosByAgencia('29', 'AG1');
      await AM.fetchEnderecosByAgencia('29', 'AG2');
      expect(calls).toBe(2);
    } finally {
      global.fetch = original;
    }
  });
});

describe('agenda helpers moved from lista-agenda', () => {
  const AM = () => window.__sigcProAgendaLookups;

  test('parseSlots keeps only the sanctioned fields', () => {
    const [s] = AM().parseSlots([{
      start: '2026-08-10T09:00:00',
      title: 'Zonas: 29JDM8 - x\nControle: 292740805060337\nDomicílio: 1\nTelefone: 71 99999-0000',
    }]);
    expect(Object.keys(s).sort())
      .toEqual(['aberto', 'controle', 'domicilio', 'isoDate', 'start', 'zonas'].sort());
    expect(JSON.stringify(s)).not.toContain('71 99999-0000');
  });

  test('pickAgendado prefers the next future visit', () => {
    const slots = [
      { start: '2026-07-01T09:00:00', isoDate: '2026-07-01' },
      { start: '2026-09-01T09:00:00', isoDate: '2026-09-01' },
    ];
    const r = AM().pickAgendado(slots, '2026-08-01');
    expect(r.futura).toBe(true);
    expect(r.ordenavel).toBe('2026-09-01T09:00:00');
  });

  test('slotsLivresDaJanela + agruparPorDia list open slots by day', () => {
    const slots = [
      { aberto: true, isoDate: '2026-08-12', start: '2026-08-12T09:00:00', zonas: '29JDM8 - x' },
      { aberto: true, isoDate: '2026-08-12', start: '2026-08-12T14:00:00', zonas: '29JDM8 - x' },
      { aberto: false, isoDate: '2026-08-12', start: '2026-08-12T10:00:00', zonas: '29JDM8 - x' },
    ];
    const livres = AM().slotsLivresDaJanela(slots, '29JDM8', '2026-08-01', '2026-08-31');
    expect(livres).toHaveLength(2);
    const grupos = AM().agruparPorDia(livres);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].horas).toEqual(['09:00', '14:00']);
  });
});

describe('biomarcadores report', () => {
  // Header row copied verbatim from a live capture (BA/Pituba,
  // 2026-08-14) — including the "#!"/"!" sort decoration, the mixed-case
  // "Siape", the slashed "Data/hora coleta sangue", and the DEGREE SIGN
  // in "1°" where "N.º Domicílio" uses the MASCULINE ORDINAL. Anything
  // that stops matching this HTML is a live-parity break.
  const LIVE_HEADERS = [
    'UF', 'Agência', 'Município', 'ID Zona', 'Nome Zona', '#!Controle',
    '!N.º Domicílio', 'Tipo Entrevista', 'Nome Equipe', 'Status',
    'Siape Agendamento', 'Data Resposta 25A.01', 'Data Agendada',
    'Data Visita Biomarcadores', 'Siape Coleta Biomarcadores',
    'Data Final para Coleta', 'Dias Prazo Final', 'Data/hora coleta sangue',
    'Status sangue', 'Motivo sangue', 'Data/hora coleta urina',
    'Status urina', 'Motivo urina', 'Dias entre 1° agendamento e coleta',
  ];

  function liveHtml(bodyRows) {
    const th = LIVE_HEADERS.map((h) => `<th>${h}</th>`).join('');
    const trs = bodyRows.map(
      (cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('');
    return `<div><table id="tableRelatorio"><thead><tr>${th}</tr></thead>` +
      `<tbody>${trs}</tbody></table></div>`;
  }

  // The three sample rows from the same capture: one Controle, three
  // domicílios, all "Não iniciado" with every later column empty.
  const NAO_INICIADO = (dom) => [
    '29', '292740800', '2927408', '29XJYY', '29.3.01.02 29_Linus_Pituba',
    '292740805220571', dom, '', '', 'Não iniciado',
    '', '', '', '', '', '', '', '', '', '', '', '', '', '',
  ];

  test('parses the live header row, decoration and all', () => {
    const map = AM.parseBiomarcadoresHtml(liveHtml([NAO_INICIADO('1')]));
    expect(map).not.toBeNull();
    const row = map.get('292740805220571|1');
    expect(row).toBeDefined();
    expect(row.status).toBe('Não iniciado');
    expect(row.idZona).toBe('29XJYY');
    expect(row.nomeZona).toBe('29.3.01.02 29_Linus_Pituba');
  });

  test('keys by controle|domicilio, not controle alone', () => {
    // The live capture shows one Controle spanning domicílios 1, 2 and 3.
    // Keying by Controle would collapse them to a single household.
    const map = AM.parseBiomarcadoresHtml(
      liveHtml([NAO_INICIADO('1'), NAO_INICIADO('2'), NAO_INICIADO('3')]));
    expect(map.size).toBe(3);
    expect(map.get('292740805220571|2').domicilio).toBe('2');
  });

  test('reads the columns the proxy never had', () => {
    const cells = NAO_INICIADO('7');
    cells[9] = 'Agendado';
    cells[12] = '20/08/2026';   // Data Agendada
    cells[11] = '01/08/2026';   // Data Resposta 25A.01
    cells[15] = '26/08/2026';   // Data Final para Coleta
    cells[16] = '3';            // Dias Prazo Final
    cells[8] = 'EQUIPE 1';      // Nome Equipe
    const row = AM.parseBiomarcadoresHtml(liveHtml([cells])).get('292740805220571|7');
    expect(row.status).toBe('Agendado');
    expect(row.dataAgendada).toBe('20/08/2026');
    expect(row.dataResposta25a01).toBe('01/08/2026');
    expect(row.dataFinalColeta).toBe('26/08/2026');
    expect(row.diasPrazoFinal).toBe('3');
    expect(row.nomeEquipe).toBe('EQUIPE 1');
  });

  test('fails closed when a required header is missing', () => {
    const broken = LIVE_HEADERS.filter((h) => h !== 'Status');
    const th = broken.map((h) => `<th>${h}</th>`).join('');
    const html = `<table id="tableRelatorio"><thead><tr>${th}</tr></thead><tbody></tbody></table>`;
    // null, never a map with an undefined column silently joined.
    expect(AM.parseBiomarcadoresHtml(html)).toBeNull();
  });

  test('tolerates the ordinal/degree confusion in the last column', () => {
    // Same header with the MASCULINE ORDINAL instead of DEGREE SIGN: SIGC
    // already mixes the two in one row, so neither spelling may break it.
    const swapped = LIVE_HEADERS.map(
      (h) => h.replace('1° agendamento', '1º agendamento'));
    const th = swapped.map((h) => `<th>${h}</th>`).join('');
    const html = `<table id="tableRelatorio"><thead><tr>${th}</tr></thead>` +
      `<tbody><tr>${NAO_INICIADO('1').map((c) => `<td>${c}</td>`).join('')}</tr></tbody></table>`;
    expect(AM.parseBiomarcadoresHtml(html)).not.toBeNull();
  });

  test('filtro body pins the scope and wildcards the rest', () => {
    const body = AM.filtroBodyBiomarcadores({
      IdUf: '29', IdAgencia: '*', IdMunicipio: '2927408', Controle: '*',
    });
    const filtro = JSON.parse(decodeURIComponent(body.replace(/^filtro=/, '')));
    expect(filtro.IdFiltro).toBe('relatorio-acomp-biomarc');
    expect(filtro.IdUf).toBe('29');
    expect(filtro.IdMunicipio).toBe('2927408');
    // This report's field set differs from Último Movimento's: it has
    // IdSupervisores/IdZona and no IdTipoAcompanhamento.
    expect(filtro.IdSupervisores).toBe('*');
    expect(filtro.IdZona).toBe('*');
    expect(filtro).not.toHaveProperty('IdTipoAcompanhamento');
  });
});

describe('Último Movimento by filter scope', () => {
  const HEADERS = ['Controle', 'Domicilio', 'Entrevistador', 'Tipo Entrevista',
    'Última Posição', 'Data'];
  const html = (rows) => {
    const th = HEADERS.map((h) => `<th>${h}</th>`).join('');
    const trs = rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('');
    return `<table id="tableRelatorio"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
  };

  test('parses ultimaPosicao, which the per-Controle parser drops', () => {
    // The biomarcadores report has no Última Posição column at all, so
    // this is the only way that page can tell a distributed household
    // from one nobody has reached yet.
    const map = AM.parsePosicoesHtml(html([
      ['C1', '1', 'Fulano', 'Realizada', 'Descarregado Parcialmente', '01/08/2026'],
      ['C1', '2', '', '', 'Distribuido', ''],
    ]));
    expect(map.get('C1|1').ultimaPosicao).toBe('Descarregado Parcialmente');
    expect(map.get('C1|2').ultimaPosicao).toBe('Distribuido');
  });

  test('the filtro replays the page scope instead of pinning a Controle', () => {
    // One request for the whole scope, like the other two reports — not
    // one per Controle, which for a município-wide report is dozens.
    const body = AM.filtroBodyUltimoMovimentoPorFiltro({
      IdUf: '29', IdAgencia: '*', IdMunicipio: '2927408', Controle: '*',
    });
    const filtro = JSON.parse(decodeURIComponent(body.replace(/^filtro=/, '')));
    expect(filtro.IdFiltro).toBe('relatorio-ultimo-movimento');
    expect(filtro.IdMunicipio).toBe('2927408');
    expect(filtro.Controle).toBe('*');
    // This report's field set, not the biomarcadores one.
    expect(filtro.IdTipoAcompanhamento).toBe('*');
    expect(filtro).not.toHaveProperty('IdZona');
  });

  test('fails closed when Última Posição is missing', () => {
    const semPosicao = HEADERS.filter((h) => h !== 'Última Posição');
    const th = semPosicao.map((h) => `<th>${h}</th>`).join('');
    expect(AM.parsePosicoesHtml(
      `<table id="tableRelatorio"><thead><tr>${th}</tr></thead><tbody></tbody></table>`
    )).toBeNull();
  });
});

describe('biomarcadores: the collection-side columns', () => {
  const H = [
    'UF', 'Agência', 'Município', 'ID Zona', 'Nome Zona', '#!Controle',
    '!N.º Domicílio', 'Tipo Entrevista', 'Nome Equipe', 'Status',
    'Siape Agendamento', 'Data Resposta 25A.01', 'Data Agendada',
    'Data Visita Biomarcadores', 'Siape Coleta Biomarcadores',
    'Data Final para Coleta', 'Dias Prazo Final', 'Data/hora coleta sangue',
    'Status sangue', 'Motivo sangue', 'Data/hora coleta urina',
    'Status urina', 'Motivo urina', 'Dias entre 1° agendamento e coleta',
  ];
  const R = [
    '29', '0570', '2927408', 'Z1', 'Pituba', 'C1', '1', 'Realizada', 'EQ1',
    'Coletado Sangue e Urina', '111', '01/08/2026', '10/08/2026',
    '12/08/2026', '222', '26/08/2026', '3', '12/08/2026 09:00',
    'Coletado', '', '12/08/2026 09:10', 'Coletado', '', '2',
  ];

  test('parses who scheduled, who collected, and each sample outcome', () => {
    // The Domicílios tab is on the biomarcadores page, so the people and
    // dates that matter are the collection's — not Último Movimento's
    // interviewer.
    const row = AM.parseBiomarcadoresHtml(
      `<table id="tableRelatorio"><thead><tr>${H.map((h) => `<th>${h}</th>`).join('')}` +
      `</tr></thead><tbody><tr>${R.map((c) => `<td>${c}</td>`).join('')}</tr></tbody></table>`
    ).get('C1|1');
    expect(row.siapeAgendamento).toBe('111');
    expect(row.siapeColeta).toBe('222');
    expect(row.statusSangue).toBe('Coletado');
    expect(row.statusUrina).toBe('Coletado');
    expect(row.dataVisita).toBe('12/08/2026');
    expect(row.nomeEquipe).toBe('EQ1');
  });
});

describe('endereços cache keys every field it was scoped by', () => {
  test('two zonas in one município do not share a cached response', async () => {
    // The cache key was uf|agencia|municipio|controle, so a biomarcadores
    // filter narrowed by IdZona hit the SAME entry as any other zona in
    // that município. A second Mapa click then reused the first zona's
    // addresses, and the join count changed between identical runs with
    // no data change — 1185/1185 missing on one press, 540/1185 on the
    // next (reported live 2026-08-15).
    const pedidos = [];
    const originalFetch = window.fetch;
    window.fetch = async (url, opts) => {
      pedidos.push(String(opts && opts.body));
      return {
        ok: true,
        text: async () => '<table id="tableRelatorio"><thead><tr>' +
          '<th>Controle</th><th>N.º Domicilio</th><th>Latitude</th>' +
          '<th>Longitude</th><th>ID Zona</th><th>Nome ZONA</th></tr></thead>' +
          '<tbody><tr><td>C1</td><td>1</td><td>-12,0</td><td>-38,0</td>' +
          '<td>Z1</td><td>Zona 1</td></tr></tbody></table>',
      };
    };
    try {
      AM.resetEnderecosAgenciaCache();
      await AM.fetchEnderecosPorFiltro({
        IdUf: '29', IdAgencia: '*', IdMunicipio: '2927408', Controle: '*', IdZona: 'Z1',
      });
      await AM.fetchEnderecosPorFiltro({
        IdUf: '29', IdAgencia: '*', IdMunicipio: '2927408', Controle: '*', IdZona: 'Z2',
      });
      // Two distinct scopes must produce two requests, not one plus a
      // cache hit.
      expect(pedidos).toHaveLength(2);
    } finally {
      window.fetch = originalFetch;
      AM.resetEnderecosAgenciaCache();
    }
  });

  test('the same scope is still served from cache', async () => {
    const pedidos = [];
    const originalFetch = window.fetch;
    window.fetch = async (url, opts) => {
      pedidos.push(String(opts && opts.body));
      return {
        ok: true,
        text: async () => '<table id="tableRelatorio"><thead><tr>' +
          '<th>Controle</th><th>N.º Domicilio</th><th>Latitude</th>' +
          '<th>Longitude</th><th>ID Zona</th><th>Nome ZONA</th></tr></thead>' +
          '<tbody><tr><td>C1</td><td>1</td><td>-12,0</td><td>-38,0</td>' +
          '<td>Z1</td><td>Zona 1</td></tr></tbody></table>',
      };
    };
    try {
      AM.resetEnderecosAgenciaCache();
      const f = { IdUf: '29', IdAgencia: '*', IdMunicipio: '2927408', Controle: '*', IdZona: 'Z1' };
      await AM.fetchEnderecosPorFiltro(f);
      await AM.fetchEnderecosPorFiltro({ ...f });
      expect(pedidos).toHaveLength(1);
    } finally {
      window.fetch = originalFetch;
      AM.resetEnderecosAgenciaCache();
    }
  });
});

describe('the Lista de Endereços filtro keeps to the fields that report knows', () => {
  test('sends exactly the five fields the R reference sends', () => {
    // pns.zonas' fetch_enderecos_uf (R/sigc_enderecos.R:51) posts
    // IdFiltro/IdUf/IdAgencia/IdMunicipio/Controle/TipoVisualizacao and
    // nothing else. Adding IdZona — which the biomarcadores report does
    // accept — made this endpoint answer with something that has no
    // #tableRelatorio at all: "tabela não reconhecida".
    const body = AM.filtroBody('29', '*', 'ListaEnderecos', '*', '2927408', 'Z1');
    const filtro = JSON.parse(decodeURIComponent(body.replace(/^filtro=/, '')));
    expect(Object.keys(filtro).sort()).toEqual([
      'Controle', 'IdAgencia', 'IdFiltro', 'IdMunicipio', 'IdUf', 'TipoVisualizacao',
    ]);
    expect(filtro).not.toHaveProperty('IdZona');
  });

  test('the zona still separates cache entries', () => {
    // The scope narrowing has to stay in the KEY even though it cannot
    // be sent: two zonas of one município must not share a response.
    expect(AM.chaveEnderecos({ IdUf: '29', IdMunicipio: '2927408', IdZona: 'Z1' }))
      .not.toBe(AM.chaveEnderecos({ IdUf: '29', IdMunicipio: '2927408', IdZona: 'Z2' }));
  });
});

describe('report POSTs carry a Referer, as the R reference does', () => {
  test('the Referer names the report being asked for', async () => {
    // pns.zonas sends Referer: <base>/relatorio/<slug> on every one of
    // these calls (R/sigc_enderecos.R:69, R/sigc_biomarcadores.R:162) and
    // gets a whole UF back — 7.140 endereços in one request. Without it
    // the same request answered with 180 rows for a 1.185-row report.
    const vistos = [];
    const originalFetch = window.fetch;
    window.fetch = async (url, opts) => {
      vistos.push(opts || {});
      return {
        ok: true,
        text: async () => '<table id="tableRelatorio"><thead><tr>' +
          '<th>Controle</th><th>N.º Domicilio</th><th>Latitude</th>' +
          '<th>Longitude</th><th>ID Zona</th><th>Nome ZONA</th></tr></thead>' +
          '<tbody><tr><td>C1</td><td>1</td><td>-12,0</td><td>-38,0</td>' +
          '<td>Z1</td><td>Zona 1</td></tr></tbody></table>',
      };
    };
    try {
      AM.resetEnderecosAgenciaCache();
      await AM.fetchEnderecosPorFiltro({ IdUf: '29', IdMunicipio: '2927408' });
      expect(vistos).toHaveLength(1);
      // Set via `referrer`: Referer is a forbidden header name, so
      // putting it in `headers` would be dropped by the browser.
      expect(vistos[0].referrer).toContain('/relatorio/ListaEnderecos');
    } finally {
      window.fetch = originalFetch;
      AM.resetEnderecosAgenciaCache();
    }
  });

  test('each slug gets its own Referer', () => {
    expect(AM.refererDoSlug('ListaEnderecos')).toContain('/relatorio/ListaEnderecos');
    expect(AM.refererDoSlug('relatorio-acomp-biomarc'))
      .toContain('/relatorio/relatorio-acomp-biomarc');
  });
});
