// SIGC-PRO feature: Gerenciamento da Coleta (relatorio-aprov-coleta-
// gerencial) — parsing. One row per sample household, carrying the
// portal's own label for where it stands in the interview flow
// (`andamento`). Pure given a DOM: no network here (the POST is
// window.__sigcPro.postRelatorio, called from gerenciamento-report.js).
// Spec: docs/superpowers/specs/2026-10-15-gerenciamento-coleta-design.md
(function () {
  'use strict';

  const TABLE_ID = 'tableRelatorio';

  // Header -> row field. Keys are the header as the portal sends it AFTER
  // stripping the DataTables decoration ("^", "@", "#!", "!") and folding
  // accents/case: "^@IdAgencia" -> "idagencia", "!Domicílio" -> "domicilio".
  const HEADERS = {
    controle: 'controle',
    domicilio: 'domicilio',
    idagencia: 'idAgencia',
    agencia: 'agenciaTexto',
    iduf: 'uf',
    'amostra biomarcadores': 'bio',
    'ultima posicao': 'ultimaPosicao',
    'status coleta': 'statusColeta',
    'situacao da entrevista': 'situacaoEntrevista',
    'andamento da entrevista': 'andamento',
  };
  // Without these the row means nothing; a missing one fails closed
  // (null) instead of guessing a column, same as the other report parsers.
  // `agencia` (the "code - NAME" text) and `iduf` are optional: the code
  // comes from IdAgencia and the UF from the request.
  const REQUIRED = [
    'controle', 'domicilio', 'idAgencia', 'bio', 'ultimaPosicao',
    'statusColeta', 'situacaoEntrevista', 'andamento',
  ];

  // Accents, case, en/em dash and spacing normalised: the one comparison
  // form for both header names (here) and andamento labels (aggregate).
  function fold(s) {
    return String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function headerKey(text) {
    return fold(String(text ?? '').replace(/^[\s#!^@]+/, ''));
  }

  // "03" -> "3": the portal pads this report's domicílio, and the key used
  // everywhere else (enderecoKey, pns.zonas) is the unpadded form.
  function normalizeDomicilio(v) {
    const t = String(v ?? '').trim();
    return /^\d+$/.test(t) ? String(parseInt(t, 10)) : t;
  }

  // "290490200 - CACHOEIRA" -> { codigo, nome }. Text without the dash
  // shape is all name.
  function splitAgencia(texto) {
    const m = /^\s*(\d+)\s*-\s*(.*)$/.exec(String(texto ?? ''));
    return m ? { codigo: m[1], nome: m[2].trim() } : { codigo: '', nome: String(texto ?? '').trim() };
  }

  // HTML -> { rows, warnings } | null.
  //   null            : a table is there but its columns are not the ones
  //                     this parser knows (a portal change) — the caller
  //                     must say so, never show a guess.
  //   { rows: [] }    : no table, i.e. the portal's answer for zero rows.
  // DOMParser is inert: nothing in the fetched markup loads resources or
  // runs handlers.
  function parseGerenciamentoHtml(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const table = doc.getElementById(TABLE_ID);
    if (!table) return { rows: [], warnings: [] };

    const ths = [...table.querySelectorAll('thead tr:first-child th')];
    const fields = ths.map((th) => HEADERS[headerKey(th.textContent)] || null);
    if (!REQUIRED.every((f) => fields.includes(f))) return null;

    const warnings = [];
    const rows = [];
    const vistos = new Set();
    const enderecoKey = window.__sigcPro.enderecoKey;
    let incompletas = 0;
    let duplicadas = 0;
    let agenciaDivergente = 0;
    let controleCurto = 0;

    table.querySelectorAll('tbody tr').forEach((tr) => {
      const tds = [...tr.querySelectorAll('td')];
      // DataTables' "no data" row is one colspan cell; a half-rendered
      // row is not a household either. Counted, not silently dropped.
      if (tds.length !== ths.length) { incompletas += 1; return; }
      const r = {};
      tds.forEach((td, i) => { if (fields[i]) r[fields[i]] = td.textContent.trim(); });

      r.domicilio = normalizeDomicilio(r.domicilio);
      r.municipio = r.controle.slice(0, 7);
      const ag = splitAgencia(r.agenciaTexto);
      r.agenciaNome = ag.nome;
      delete r.agenciaTexto;
      if (ag.codigo && ag.codigo !== r.idAgencia) agenciaDivergente += 1;
      if (!/^\d{15}$/.test(r.controle)) controleCurto += 1;

      // A household is one row. A repeat would be counted twice in every
      // total, so only the first is kept — and the panel says so.
      const chave = enderecoKey(r);
      if (vistos.has(chave)) { duplicadas += 1; return; }
      vistos.add(chave);
      rows.push(r);
    });

    if (incompletas) warnings.push(`${incompletas} linha(s) ignorada(s) por não terem todas as colunas.`);
    if (duplicadas) warnings.push(`${duplicadas} linha(s) repetida(s) (mesmo controle e domicílio) descartada(s).`);
    if (agenciaDivergente) warnings.push(`${agenciaDivergente} linha(s) em que o código da agência difere de IdAgencia.`);
    if (controleCurto) warnings.push(`${controleCurto} controle(s) fora do formato de 15 dígitos.`);
    return { rows, warnings };
  }

  window.__sigcProGerenciamento = Object.assign(window.__sigcProGerenciamento || {}, {
    parseGerenciamentoHtml,
    fold,
    headerKey,
    normalizeDomicilio,
    splitAgencia,
  });
})();
