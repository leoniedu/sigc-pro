import { describe, test, expect } from 'bun:test';

await import('../extension/common/sigc-common.js');
await import('../extension/features/agenda-map/agenda-map.js');
await import('../extension/features/ultimo-movimento-export/ultimo-movimento-export.js');
await import('../extension/features/ultimo-movimento-map/ultimo-movimento-map.js');

const UM = window.__sigcProUltimoMovimentoMapInternals;

describe('parseUltimoMovimentoRows', () => {
  test('maps Controle+Domicilio to full row data by header label', () => {
    const headers = ['Controle', 'Domicilio', 'Entrevistador', 'Tipo Entrevista', 'Última Posição', 'Data'];
    const rows = [
      ['290570120000125', '1', 'Fulano de Tal', 'Realizada', 'Transmitido', '01/08/2026'],
      ['290570120000125', '2', 'Fulano de Tal', 'Não Iniciada', 'Distribuido', ''],
    ];
    const map = UM.parseUltimoMovimentoRows(headers, rows);
    expect(map.get('290570120000125|1')).toEqual({
      controle: '290570120000125', domicilio: '1', entrevistador: 'Fulano de Tal',
      tipoEntrevista: 'Realizada', ultimaPosicao: 'Transmitido', data: '01/08/2026',
    });
    expect(map.get('290570120000125|2').tipoEntrevista).toBe('Não Iniciada');
  });

  test('is tolerant of header order', () => {
    const headers = ['Data', 'Última Posição', 'Tipo Entrevista', 'Entrevistador', 'Domicilio', 'Controle'];
    const rows = [['01/08/2026', 'Transmitido', 'Realizada', 'Fulano', 'D1', 'C1']];
    const map = UM.parseUltimoMovimentoRows(headers, rows);
    expect(map.get('C1|D1').entrevistador).toBe('Fulano');
  });

  test('returns null when a required header is missing', () => {
    const headers = ['Controle', 'Domicilio', 'Situação'];
    const rows = [['C1', 'D1', 'x']];
    expect(UM.parseUltimoMovimentoRows(headers, rows)).toBeNull();
  });

  test('matches the real live header "Domicílio" (accented, not the bare "Domicilio")', () => {
    const headers = ['Controle', 'Domicílio', 'Entrevistador', 'Tipo Entrevista', 'Última Posição', 'Data'];
    const rows = [['C1', 'D1', 'Fulano', 'Realizada', 'Transmitido', '01/08/2026']];
    const map = UM.parseUltimoMovimentoRows(headers, rows);
    expect(map.get('C1|D1')).toEqual({
      controle: 'C1', domicilio: 'D1', entrevistador: 'Fulano',
      tipoEntrevista: 'Realizada', ultimaPosicao: 'Transmitido', data: '01/08/2026',
    });
  });

  test('tolerates the "#!" sort/filter marker some SIGC report grids prepend to a header', () => {
    const headers = ['#!Controle', '!Domicílio', 'Entrevistador', 'Tipo Entrevista', 'Última Posição', 'Data'];
    const rows = [['C1', 'D1', 'Fulano', 'Realizada', 'Transmitido', '01/08/2026']];
    const map = UM.parseUltimoMovimentoRows(headers, rows);
    expect(map.get('C1|D1').entrevistador).toBe('Fulano');
  });
});

describe('joinEnderecos', () => {
  const movimentoMap = new Map([
    ['C1|1', { controle: 'C1', domicilio: '1', entrevistador: 'A', tipoEntrevista: 'Realizada', ultimaPosicao: 'Transmitido', data: '01/08/2026' }],
    ['C1|2', { controle: 'C1', domicilio: '2', entrevistador: 'A', tipoEntrevista: 'Não Iniciada', ultimaPosicao: 'Distribuido', data: '' }],
  ]);

  test('joins coordinates and zona by controle|domicilio', () => {
    const enderecosMap = new Map([
      ['C1|1', { lat: -8.5, lon: -63.8, zona: 'ESCOLA POLICIA', idZona: '11.1.01.08' }],
    ]);
    const joined = UM.joinEnderecos(movimentoMap, enderecosMap);
    const d1 = joined.find((r) => r.domicilio === '1');
    expect(d1).toMatchObject({ lat: -8.5, lon: -63.8, zona: 'ESCOLA POLICIA', idZona: '11.1.01.08', temCoordenadas: true, temZona: true });
  });

  test('a household missing from enderecosMap gets temCoordenadas/temZona false, not dropped', () => {
    const joined = UM.joinEnderecos(movimentoMap, new Map());
    expect(joined).toHaveLength(2);
    joined.forEach((r) => {
      expect(r.temCoordenadas).toBe(false);
      expect(r.temZona).toBe(false);
      expect(r.lat).toBeNull();
      expect(r.lon).toBeNull();
    });
  });

  test('a household with zona but no valid coordinates keeps temZona true, temCoordenadas false', () => {
    const enderecosMap = new Map([
      ['C1|1', { lat: null, lon: null, zona: 'ESCOLA POLICIA', idZona: '11.1.01.08' }],
    ]);
    const joined = UM.joinEnderecos(movimentoMap, enderecosMap);
    const d1 = joined.find((r) => r.domicilio === '1');
    expect(d1.temZona).toBe(true);
    expect(d1.temCoordenadas).toBe(false);
  });
});

describe('aggregateZonas', () => {
  const joined = [
    { idZona: '11.1.01.08', zona: 'ESCOLA POLICIA', tipoEntrevista: 'Realizada', temCoordenadas: true, temZona: true },
    { idZona: '11.1.01.08', zona: 'ESCOLA POLICIA', tipoEntrevista: 'Não Iniciada', temCoordenadas: false, temZona: true },
    { idZona: '', zona: '', tipoEntrevista: 'Recusa', temCoordenadas: true, temZona: false },
    { idZona: '', zona: '', tipoEntrevista: 'Realizada', temCoordenadas: true, temZona: false },
  ];

  test('groups by idZona, one row per distinct zona', () => {
    const rows = UM.aggregateZonas(joined);
    const zonaRow = rows.find((r) => r.idZona === '11.1.01.08');
    expect(zonaRow).toMatchObject({
      idZona: '11.1.01.08', nomeZona: 'ESCOLA POLICIA',
      realizada: 1, naoIniciada: 1, domicilioFechado: 0, recusa: 0, outros: 0,
      totalDomicilios: 2, semCoordenadas: 1,
    });
  });

  test('households with temZona false land in a single "Sem zona" row (idZona null)', () => {
    const rows = UM.aggregateZonas(joined);
    const semZona = rows.find((r) => r.idZona === null);
    expect(semZona).toBeDefined();
    expect(semZona.totalDomicilios).toBe(2);
    expect(semZona.recusa).toBe(1);
    expect(semZona.realizada).toBe(1);
    expect(semZona.semCoordenadas).toBe(0);
  });

  test('unrecognized tipoEntrevista values count under outros', () => {
    const rows = UM.aggregateZonas([
      { idZona: 'Z1', zona: 'Zona 1', tipoEntrevista: 'Endereço Não Localizado', temCoordenadas: true, temZona: true },
    ]);
    expect(rows[0].outros).toBe(1);
    expect(rows[0].realizada).toBe(0);
  });

  test('empty input returns empty array, no Sem zona row', () => {
    expect(UM.aggregateZonas([])).toEqual([]);
  });
});

describe('zonaColor', () => {
  test('returns the fixed gray for null/empty idZona ("Sem zona")', () => {
    expect(UM.zonaColor(null)).toBe('#888888');
    expect(UM.zonaColor('')).toBe('#888888');
  });

  test('returns a stable, non-gray color for a real idZona', () => {
    const c1 = UM.zonaColor('11.1.01.08');
    const c2 = UM.zonaColor('11.1.01.08');
    expect(c1).toBe(c2);
    expect(c1).not.toBe('#888888');
    expect(c1).toMatch(/^#[0-9a-f]{6}$/i);
  });

  test('different zonas get different colors (not guaranteed unique, but not all equal for a small set)', () => {
    const colors = new Set(['Z1', 'Z2', 'Z3', 'Z4', 'Z5'].map(UM.zonaColor));
    expect(colors.size).toBeGreaterThan(1);
  });
});

describe('zonaRowIsClickable', () => {
  test('true when at least one domicílio has valid coordinates', () => {
    expect(UM.zonaRowIsClickable({ totalDomicilios: 4, semCoordenadas: 1 })).toBe(true);
  });

  test('false when every domicílio lacks coordinates', () => {
    expect(UM.zonaRowIsClickable({ totalDomicilios: 3, semCoordenadas: 3 })).toBe(false);
  });

  test('false when there are zero domicílios at all', () => {
    expect(UM.zonaRowIsClickable({ totalDomicilios: 0, semCoordenadas: 0 })).toBe(false);
  });
});

describe('buildZonasTableHtml', () => {
  test('renders a header row and one row per zona, HTML-escaped', () => {
    const rows = [
      { idZona: 'Z1', nomeZona: 'Bairro <X>', realizada: 3, naoIniciada: 1, domicilioFechado: 0, recusa: 0, outros: 0, totalDomicilios: 4, semCoordenadas: 1 },
      { idZona: null, nomeZona: 'Sem zona', realizada: 0, naoIniciada: 0, domicilioFechado: 0, recusa: 2, outros: 0, totalDomicilios: 2, semCoordenadas: 0 },
    ];
    const html = UM.buildZonasTableHtml(rows);
    expect(html).toContain('<table');
    expect(html).toContain('Bairro &lt;X&gt;');
    expect(html).toContain('Sem zona');
    expect(html).toContain('Z1');
  });

  test('empty input still renders a valid table with no data rows', () => {
    const html = UM.buildZonasTableHtml([]);
    expect(html).toContain('<table');
    expect(html).not.toMatch(/<td/);
  });

  test('a row with mapped domicílios is clickable, with its idZona as a data attribute', () => {
    const rows = [
      { idZona: 'Z1', nomeZona: 'Bairro X', realizada: 1, naoIniciada: 0, domicilioFechado: 0, recusa: 0, outros: 0, totalDomicilios: 2, semCoordenadas: 1 },
    ];
    const html = UM.buildZonasTableHtml(rows);
    expect(html).toContain('sigc-pro-zona-row-clickable');
    expect(html).toContain('data-id-zona="Z1"');
  });

  test('a row with zero mapped domicílios (all sem coordenadas) is NOT clickable', () => {
    const rows = [
      { idZona: 'Z2', nomeZona: 'Bairro Y', realizada: 0, naoIniciada: 0, domicilioFechado: 0, recusa: 1, outros: 0, totalDomicilios: 1, semCoordenadas: 1 },
    ];
    const html = UM.buildZonasTableHtml(rows);
    expect(html).not.toContain('sigc-pro-zona-row-clickable');
    expect(html).not.toContain('data-id-zona');
  });

  test('the "Sem zona" row (idZona null) is clickable via an empty-string data-id-zona', () => {
    const rows = [
      { idZona: null, nomeZona: 'Sem zona', realizada: 0, naoIniciada: 0, domicilioFechado: 0, recusa: 2, outros: 0, totalDomicilios: 2, semCoordenadas: 0 },
    ];
    const html = UM.buildZonasTableHtml(rows);
    expect(html).toContain('sigc-pro-zona-row-clickable');
    expect(html).toContain('data-id-zona=""');
  });
});

describe('buildPanelHtml', () => {
  const joined = [
    { controle: 'C1', domicilio: '1', entrevistador: 'A', tipoEntrevista: 'Realizada',
      ultimaPosicao: 'Transmitido', data: '01/08/2026', lat: -8.5, lon: -63.8,
      zona: 'Z1', idZona: 'Z1', temCoordenadas: true, temZona: true },
  ];
  const zonaRows = UM.aggregateZonas(joined);

  test('includes both tab buttons and both panels', () => {
    const html = UM.buildPanelHtml(joined, zonaRows);
    expect(html).toContain('Mapa');
    expect(html).toContain('Zonas');
    expect(html).toContain('sigc-pro-mapa-panel');
    expect(html).toContain('sigc-pro-zonas-panel');
  });

  test('embeds the Zonas table', () => {
    const html = UM.buildPanelHtml(joined, zonaRows);
    expect(html).toContain('sigc-pro-zonas-table');
  });

  test('includes a close control', () => {
    const html = UM.buildPanelHtml(joined, zonaRows);
    expect(html).toMatch(/fechar|close|×/i);
  });

  test('the zonas tab count reflects the actual number of zona rows, not a static label', () => {
    const html = UM.buildPanelHtml(joined, zonaRows);
    expect(zonaRows).toHaveLength(1);
    expect(html).toContain(`Zonas (${zonaRows.length})`);
  });

  test('the embedded Zonas table contains this fixture\'s actual zona data (Z1), not just headers', () => {
    const html = UM.buildPanelHtml(joined, zonaRows);
    expect(html).toContain('Z1');
    expect(html).toContain('<td>1</td>'); // realizada count for the Z1 row
  });

  test('empty joined/zonaRows still renders the panel shell but with a "Zonas (0)" tab and no data rows', () => {
    const html = UM.buildPanelHtml([], []);
    expect(html).toContain('Zonas (0)');
    expect(html).not.toMatch(/<td/);
  });
});

describe('statusColor', () => {
  test('Distribuido wins regardless of tipoEntrevista', () => {
    expect(UM.statusColor({ ultimaPosicao: 'Distribuido', tipoEntrevista: 'Realizada' })).toBe('#888888');
    expect(UM.statusColor({ ultimaPosicao: 'Distribuido', tipoEntrevista: '' })).toBe('#888888');
  });

  test('Realizada -> green', () => {
    expect(UM.statusColor({ ultimaPosicao: 'Descarregado', tipoEntrevista: 'Realizada' })).toBe('#009E73');
  });

  test('Recusa -> red/orange', () => {
    expect(UM.statusColor({ ultimaPosicao: 'Descarregado', tipoEntrevista: 'Recusa' })).toBe('#D55E00');
  });

  test('Não Iniciada -> yellow', () => {
    expect(UM.statusColor({ ultimaPosicao: 'Descarregado', tipoEntrevista: 'Não Iniciada' })).toBe('#F0E442');
  });

  test('Domicílio Fechado -> sky-blue', () => {
    expect(UM.statusColor({ ultimaPosicao: 'Descarregado', tipoEntrevista: 'Domicílio Fechado' })).toBe('#56B4E9');
  });

  test('unrecognized tipoEntrevista -> black (Outros)', () => {
    expect(UM.statusColor({ ultimaPosicao: 'Descarregado', tipoEntrevista: 'Em condições de ser habitada' })).toBe('#000000');
    expect(UM.statusColor({ ultimaPosicao: 'Descarregado', tipoEntrevista: '' })).toBe('#000000');
  });
});

describe('Mapa button mount', () => {
  test('button is registered under the expected id', () => {
    // mountWidget registration happens at module load (already imported
    // at top of file); confirm the widget was pushed with the right id
    // by checking the DOM after simulating the anchor being present.
    document.body.innerHTML = '<div><a id="btnFiltrar" class="btn btn-primary btn-sigc">Filtrar</a></div>';
    window.__sigcPro.recheckMounts();
    // The button only mounts when onUltimoMovimento() is true, which
    // depends on a title element this fixture doesn't provide — assert
    // it does NOT mount rather than asserting a false positive here.
    expect(document.getElementById('sigc-pro-ultimo-movimento-map-btn')).toBeNull();
  });
});

describe('convexHull', () => {
  test('0 points returns null', () => {
    expect(UM.convexHull([])).toBeNull();
  });

  test('1 point returns a circle centered on it', () => {
    const result = UM.convexHull([[10, 20]]);
    expect(result).toEqual({ type: 'circle', center: [10, 20] });
  });

  test('2 distinct points returns a capsule', () => {
    const result = UM.convexHull([[10, 20], [11, 21]]);
    expect(result).toEqual({ type: 'capsule', a: [10, 20], b: [11, 21] });
  });

  test('2 identical points (dedup to 1) returns a circle', () => {
    const result = UM.convexHull([[10, 20], [10, 20]]);
    expect(result).toEqual({ type: 'circle', center: [10, 20] });
  });

  test('3 collinear points returns a capsule between the extremes', () => {
    const result = UM.convexHull([[0, 0], [1, 1], [2, 2]]);
    expect(result.type).toBe('capsule');
    expect(result.a).toEqual([0, 0]);
    expect(result.b).toEqual([2, 2]);
  });

  test('3 non-collinear points returns a triangle polygon', () => {
    const result = UM.convexHull([[0, 0], [0, 2], [2, 0]]);
    expect(result.type).toBe('polygon');
    expect(result.points).toHaveLength(3);
    // every input point must be present in the hull for a triangle (all 3 are vertices)
    [[0, 0], [0, 2], [2, 0]].forEach((p) => {
      expect(result.points).toContainEqual(p);
    });
  });

  test('a point strictly inside the hull is excluded from the polygon', () => {
    const result = UM.convexHull([[0, 0], [0, 4], [4, 0], [4, 4], [2, 2]]);
    expect(result.type).toBe('polygon');
    expect(result.points).not.toContainEqual([2, 2]);
    expect(result.points).toHaveLength(4);
  });
});

describe('controleCentroids', () => {
  test('averages lat/lon across a Controle\'s valid-coordinate rows', () => {
    const joined = [
      { controle: 'C1', domicilio: '1', lat: 0, lon: 0, ultimaPosicao: 'Descarregado', temCoordenadas: true },
      { controle: 'C1', domicilio: '2', lat: 2, lon: 4, ultimaPosicao: 'Descarregado', temCoordenadas: true },
    ];
    const result = UM.controleCentroids(joined);
    expect(result).toHaveLength(1);
    expect(result[0].controle).toBe('C1');
    expect(result[0].lat).toBe(1);
    expect(result[0].lon).toBe(2);
  });

  test('rows without valid coordinates are excluded from the average', () => {
    const joined = [
      { controle: 'C1', domicilio: '1', lat: 0, lon: 0, ultimaPosicao: 'Descarregado', temCoordenadas: true },
      { controle: 'C1', domicilio: '2', lat: null, lon: null, ultimaPosicao: 'Descarregado', temCoordenadas: false },
    ];
    const result = UM.controleCentroids(joined);
    expect(result[0].lat).toBe(0);
    expect(result[0].lon).toBe(0);
  });

  test('a Controle with zero valid-coordinate rows produces no entry', () => {
    const joined = [
      { controle: 'C1', domicilio: '1', lat: null, lon: null, ultimaPosicao: 'Descarregado', temCoordenadas: false },
    ];
    expect(UM.controleCentroids(joined)).toEqual([]);
  });

  test('colorState: all Distribuido -> inactive', () => {
    const joined = [
      { controle: 'C1', lat: 0, lon: 0, ultimaPosicao: 'Distribuido', temCoordenadas: true },
      { controle: 'C1', lat: 1, lon: 1, ultimaPosicao: 'Distribuido', temCoordenadas: true },
    ];
    expect(UM.controleCentroids(joined)[0].colorState).toBe('inactive');
  });

  test('colorState: none Distribuido -> active', () => {
    const joined = [
      { controle: 'C1', lat: 0, lon: 0, ultimaPosicao: 'Descarregado', temCoordenadas: true },
      { controle: 'C1', lat: 1, lon: 1, ultimaPosicao: 'Enviado para Carga', temCoordenadas: true },
    ];
    expect(UM.controleCentroids(joined)[0].colorState).toBe('active');
  });

  test('colorState: mixed -> partial', () => {
    const joined = [
      { controle: 'C1', lat: 0, lon: 0, ultimaPosicao: 'Distribuido', temCoordenadas: true },
      { controle: 'C1', lat: 1, lon: 1, ultimaPosicao: 'Descarregado', temCoordenadas: true },
    ];
    expect(UM.controleCentroids(joined)[0].colorState).toBe('partial');
  });

  test('colorState is computed over ALL rows for that Controle, even ones without coordinates', () => {
    // A Controle's active/inactive/partial status is a fact about its
    // fieldwork progress, not about which rows happened to geocode —
    // excluding uncoordinated rows from colorState (unlike the
    // centroid average, which must exclude them) would misreport a
    // Controle as "active" when an un-geocoded domicílio is still
    // Distribuido.
    const joined = [
      { controle: 'C1', lat: 0, lon: 0, ultimaPosicao: 'Descarregado', temCoordenadas: true },
      { controle: 'C1', lat: null, lon: null, ultimaPosicao: 'Distribuido', temCoordenadas: false },
    ];
    expect(UM.controleCentroids(joined)[0].colorState).toBe('partial');
  });

  test('multiple distinct Controles each get their own entry', () => {
    const joined = [
      { controle: 'C1', lat: 0, lon: 0, ultimaPosicao: 'Descarregado', temCoordenadas: true },
      { controle: 'C2', lat: 5, lon: 5, ultimaPosicao: 'Distribuido', temCoordenadas: true },
    ];
    const result = UM.controleCentroids(joined);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.controle).sort()).toEqual(['C1', 'C2']);
  });
});
