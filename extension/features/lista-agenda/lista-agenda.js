// SIGC-PRO feature: annotates the Lista de Endereços (selecionados view)
// with data the page itself does not carry — each household's scheduled
// interview and collection status, plus how many slots remain bookable
// in its zonas.
//
// Two sources, both same-origin and behind one click+confirm:
//   Agenda          GET  AdministracaoAgenda/ObterSlots  (JSON)
//   Último Movimento POST /UltimoMovimento/Filtrar       (HTML fragment)
// Both key on (Controle, Domicílio), the table's own key.
//
// Three seams — acquire / index / render — so the fetches stay
// independent (either may fail without costing the other's columns) and
// every decision worth testing lives in a pure function.
//
// Spec: docs/superpowers/specs/2026-07-31-lista-agenda-design.md
(function () {
  'use strict';

  const TAG = '[sigc-lista-agenda]';

  // --- index (pure) ---------------------------------------------------

  // The agenda response carries name, sex, birth date, address and
  // telephone per slot. Keep ONLY what the annotations need, so no richer
  // object is ever held in memory or reachable from a later change.
  function parseSlots(json) {
    if (!Array.isArray(json)) return [];
    return json.map((s) => {
      const f = window.__sigcPro.parseAgendaSlotTitle(s && s.title);
      const start = String((s && s.start) || '');
      return {
        start,
        isoDate: start.slice(0, 10),
        controle: f['Controle'] || '',
        domicilio: f['Domicílio'] || '',
        zonas: f['Zonas'] || '',
        // An open slot's title is only "Zonas: …" — no Controle line,
        // since nothing is assigned yet. The JSON has no CSS class to
        // read, so this IS the open test.
        aberto: !f['Controle'],
      };
    });
  }

  // "29JDM8 - 29.2.01.02 29_Linus_Lauro" -> "29JDM8", the same ID Zona
  // the table carries in column 18. Entries without the separator key on
  // themselves rather than being dropped.
  function zonaIdOf(entry) {
    const s = String(entry ?? '').trim();
    const i = s.indexOf(' - ');
    return i === -1 ? s : s.slice(0, i).trim();
  }

  const chaveDomicilio = (controle, domicilio) => `${controle}|${domicilio}`;

  function indexByControle(slots) {
    const map = new Map();
    slots.forEach((s) => {
      if (s.aberto || !s.controle) return;
      const k = chaveDomicilio(s.controle, s.domicilio);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(s);
    });
    return map;
  }

  // Free = open AND on/after the prazo mínimo. A slot before the cutoff
  // cannot be filled anymore, so counting it would advertise capacity
  // that does not exist.
  function indexZonaLivres(slots, minDateIso) {
    const map = new Map();
    slots.forEach((s) => {
      if (!s.aberto) return;
      if (s.isoDate && s.isoDate < minDateIso) return;
      const ids = new Set(
        window.__sigcPro.parseZonaEntries(s.zonas).map(zonaIdOf).filter(Boolean));
      if (ids.size === 0) return;
      const peso = 1 / ids.size;
      ids.forEach((id) => {
        if (!map.has(id)) map.set(id, { inteiro: 0, peso: 0, compartilhado: false });
        const cell = map.get(id);
        cell.inteiro += 1;
        cell.peso += peso;
        if (ids.size > 1) cell.compartilhado = true;
      });
    });
    return map;
  }

  // Only one schedule is live at a time, so a future date wins outright;
  // otherwise show the most recent past one, flagged so a completed
  // interview does not read as an upcoming appointment.
  function pickAgendado(slots, todayIso) {
    if (!slots || slots.length === 0) return null;
    const ordenado = [...slots].sort((a, b) => a.isoDate.localeCompare(b.isoDate));
    const futura = ordenado.find((s) => s.isoDate >= todayIso);
    const escolhido = futura || ordenado[ordenado.length - 1];
    return {
      data: window.__sigcPro.isoToBr(escolhido.isoDate),
      futura: !!futura,
    };
  }

  // Header labels vary in accent/case between SIGC screens, so match
  // normalized rather than exact.
  function normalizar(s) {
    return String(s ?? '').trim().toUpperCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  function acharColuna(header, alvo) {
    const want = normalizar(alvo);
    return (header || []).findIndex((h) => normalizar(h) === want);
  }

  // The Último Movimento report is a different table from the Lista de
  // Endereços, and no test in this repo pins its layout — so find columns
  // by label and return an empty index if any is missing, rather than
  // reading whatever happens to sit at a guessed position. `colunasNaoEncontradas`
  // lets the caller distinguish that failure from genuine no-data: without
  // it, a wrong/renamed header label produces an all-"—" column that reads
  // exactly like "not collected yet", which the spec forbids.
  function indexMovimento(header, rows) {
    const map = new Map();
    const iControle = acharColuna(header, 'Controle');
    const iDomicilio = acharColuna(header, 'Domicílio');
    const iPosicao = acharColuna(header, 'Última Posição');
    const iTransmissao = acharColuna(header, 'Data');
    if (iControle === -1 || iDomicilio === -1 || iPosicao === -1 || iTransmissao === -1) {
      console.warn(`${TAG} Último Movimento: colunas esperadas não encontradas`,
        JSON.stringify(header));
      return { index: map, colunasNaoEncontradas: true };
    }
    (rows || []).forEach((r) => {
      const controle = String(r[iControle] ?? '').trim();
      const domicilio = String(r[iDomicilio] ?? '').trim();
      if (!controle) return;
      map.set(chaveDomicilio(controle, domicilio), {
        situacao: String(r[iPosicao] ?? '').trim(),
        transmissao: String(r[iTransmissao] ?? '').trim(),
      });
    });
    return { index: map, colunasNaoEncontradas: false };
  }

  // One decimal, pt-BR comma — same shape the day guide uses.
  const num1 = (n) => n.toFixed(1).replace('.', ',');

  // Free slots for the zonas THIS table's households belong to, not the
  // whole UF: the question is "where can I still book these people?".
  // Fetch times are shown because a stale count causes a real
  // double-booking; two are shown when the sources aged differently,
  // since one timestamp would misreport the older.
  //
  // livresIdx === null means the agenda source failed outright — there is
  // no data to count from, not zero free slots. A fabricated "0" there
  // reads as real capacity information and is exactly the false signal
  // that causes a double-booking, so that case renders "?" instead.
  function buildResumoHtml(zonaIdsDaTabela, livresIdx, meta, domicilios) {
    const e = window.__sigcPro.escapeHtml;
    const ids = [...new Set((zonaIdsDaTabela || []).filter(Boolean))].sort();
    const celulas = ids.map((id) => {
      if (livresIdx === null) {
        return `<span class="sp-zona-livre"><strong>${e(id)}</strong>: ?</span>`;
      }
      const c = (livresIdx && livresIdx.get(id)) || { inteiro: 0, peso: 0, compartilhado: false };
      const pond = c.compartilhado ? ` (${num1(c.peso)} ponderado)` : '';
      return `<span class="sp-zona-livre"><strong>${e(id)}</strong>: ${c.inteiro}${pond}</span>`;
    }).join(' ');

    const quando = meta.agendaEm === meta.movimentoEm
      ? `dados de ${e(meta.agendaEm)}`
      : `agenda de ${e(meta.agendaEm)}, movimento de ${e(meta.movimentoEm)}`;

    const falhas = (meta.falhas || []).length
      ? `<div class="sp-falha">Sem dados de ${(meta.falhas || []).map(e).join('; ')}. ` +
        'As colunas correspondentes ficam vazias' +
        (livresIdx === null ? ' e a contagem de slots livres por zona é desconhecida (marcada "?")' : '') +
        '.</div>'
      : '';

    return [
      '<div id="sigc-pro-lista-agenda-resumo">',
      `<div class="sp-titulo">Slots livres (a partir de ${e(meta.minDateBr)}) · ${quando}</div>`,
      `<div class="sp-zonas">${celulas || '<em>Nenhuma zona nesta tabela.</em>'}</div>`,
      falhas,
      buildDomiciliosHtml(domicilios || []),
      '</div>',
    ].join('\n');
  }

  // Per-household detail, rendered inside the summary panel INSTEAD of
  // extra table columns. DataTables owns the table's column model
  // (aoColumns): appending <th>/<td> elements from outside leaves that
  // model out of sync with the DOM, and a later adjust()/redraw walks off
  // the end of it and throws (live: "Cannot read properties of undefined
  // (reading 'colEl')"). The table must stay untouched; this panel is the
  // only place per-household data can safely live.
  // One line per household with data — bare Controle is
  // unreadable, so logradouro + número identifies it, with the domicílio
  // number to tell apart multiple households at the same address.
  //
  // Households with NO data from either source are omitted rather than
  // padding the list with rows of "—", but the omitted count is shown so
  // "nothing scheduled" (a household IS listed, fields are "—") reads
  // differently from "not shown" (never fetched/matched at all).
  function buildDomiciliosHtml(domicilios) {
    const e = window.__sigcPro.escapeHtml;
    const comDados = (domicilios || []).filter((d) =>
      d.agendado || d.situacao || d.transmissao);
    const omitidos = (domicilios || []).length - comDados.length;

    if (comDados.length === 0) {
      const nada = omitidos > 0
        ? `<em>Nenhum domicílio com dados de agenda/movimento (${omitidos} sem dados omitido(s)).</em>`
        : '<em>Nenhum domicílio anotado.</em>';
      return `<div class="sp-domicilios">${nada}</div>`;
    }

    const linhas = comDados.map((d) => {
      const classe = d.futura ? 'sp-futura' : 'sp-passada';
      const agendado = d.agendado
        ? `<span class="${classe}">${e(d.agendado)}</span>`
        : '—';
      return '<li>' +
        `<strong>${e(d.identificador)}</strong>: ` +
        `agendado ${agendado} · ` +
        `situação ${e(d.situacao || '—')} · ` +
        `transmissão ${e(d.transmissao || '—')}` +
        '</li>';
    }).join('\n');

    const rodape = omitidos > 0
      ? `<div class="sp-omitidos">${e(String(omitidos))} domicílio(s) sem dados de agenda/movimento omitido(s).</div>`
      : '';

    return [
      '<div class="sp-domicilios">',
      `<ul>${linhas}</ul>`,
      rodape,
      '</div>',
    ].join('\n');
  }

  // Human-readable household identifier: logradouro + número, with the
  // domicílio number appended to disambiguate multiple households at one
  // address. A bare Controle carries no meaning to a reader of this panel.
  function identificadorDomicilio(logradouro, numero, nDomicilio) {
    const end = [logradouro, numero].map((s) => String(s ?? '').trim()).filter(Boolean).join(', Nº ');
    const base = end || `Domicílio ${String(nDomicilio ?? '').trim()}`;
    return `${base} (dom. ${String(nDomicilio ?? '').trim()})`;
  }

  // Returns an OBJECT, not a bare string, so a further source adds a key
  // rather than changing every caller's signature. Empty strings (never
  // undefined) so the render step can write cells without guarding.
  function annotateRow(controle, domicilio, ctx) {
    const k = chaveDomicilio(String(controle ?? '').trim(), String(domicilio ?? '').trim());
    const ag = pickAgendado((ctx.agendaIdx && ctx.agendaIdx.get(k)) || [], ctx.todayIso);
    const mv = (ctx.movimentoIdx && ctx.movimentoIdx.get(k)) || null;
    return {
      agendado: ag ? ag.data : '',
      futura: ag ? ag.futura : false,
      situacao: mv ? mv.situacao : '',
      transmissao: mv ? mv.transmissao : '',
    };
  }

  // --- acquire --------------------------------------------------------
  // F5 BIG-IP rewrites every path to "/f5-w-<hex>$$/<path>" off-VPN.
  // Duplicated from ultimo-movimento-export.js rather than shared: moving
  // fetch-adjacent code into sigc-common.js would put it outside the
  // privacy gate's sanctioned directories.
  function f5Prefix(pathname) {
    const m = /^\/f5-w-([0-9a-f]+)\$\$/.exec(String(pathname || ''));
    return m ? { prefix: m[0], hex: m[1] } : null;
  }

  function gatewayUrl(origin, pathname, path, simple) {
    const f5 = f5Prefix(pathname);
    if (!f5) return `${origin}${path}`;
    return simple
      ? `${origin}${f5.prefix}${path}`
      : `${origin}${f5.prefix}/f5-h-$$${path};F5_origin=${f5.hex}&F5CH=I`;
  }

  async function fetchViaGateway(path, options) {
    const urls = [...new Set([
      gatewayUrl(location.origin, location.pathname, path, true),
      gatewayUrl(location.origin, location.pathname, path, false),
    ])];
    let lastErr = new Error('sem resposta');
    for (const url of urls) {
      try {
        const res = await fetch(url, options);
        if (!res.ok) { lastErr = new Error(`HTTP ${res.status}`); continue; }
        return res;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }

  // Query built by hand: percent-encoding the "$$" in the F5 path turns
  // the URL into a 404 (learned in pns.zonas/R/sigc_agendamentos.R).
  async function fetchAgenda(uf, startIso, endIso) {
    const query = `idUf=${encodeURIComponent(uf)}` +
      `&start=${encodeURIComponent(startIso)}` +
      `&end=${encodeURIComponent(endIso)}` +
      '&semana=true&idEquipe=';
    const res = await fetchViaGateway(`/AdministracaoAgenda/ObterSlots?${query}`, {
      credentials: 'same-origin',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
      },
    });
    return parseSlots(await res.json());
  }

  // One request for the whole Controle: buildAgenciaFilterBody's payload
  // with Controle set to the real value instead of "*" returns every
  // domicílio at once. NOT the multi-agência loop.
  async function fetchMovimento(uf, controle) {
    const filtro = {
      IdFiltro: '',
      IdUf: String(uf),
      IdAgencia: '*',
      IdMunicipio: '*',
      Controle: String(controle),
      IdEntrevistadores: '*',
      IdTipoAcompanhamento: '*',
    };
    const res = await fetchViaGateway('/UltimoMovimento/Filtrar', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: 'filtro=' + encodeURIComponent(JSON.stringify(filtro)),
    });
    return parseMovimentoHtml(await res.text());
  }

  // DOMParser is inert — nothing in the fetched markup can load resources
  // or run handlers. Same guarantee ultimo-movimento-export relies on.
  function parseMovimentoHtml(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const table = doc.getElementById('tb_ultimo_movimento');
    if (!table) return null;
    const header = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    const rows = [...table.querySelectorAll('tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()));
    return { header, rows };
  }

  window.__sigcPro.listaAgenda = {
    parseSlots, zonaIdOf, indexByControle, indexZonaLivres, pickAgendado, indexMovimento, buildResumoHtml, annotateRow,
    buildDomiciliosHtml, identificadorDomicilio,
  };

  // --- caches ---------------------------------------------------------
  // In-memory only, never persisted (zero-storage guarantee). A TTL is
  // needed where agenda-map's coordinate cache has none: someone else
  // booking a slot makes these counts wrong within a page's life.
  const TTL_MS = 5 * 60 * 1000;
  const cacheAgenda = new Map();
  const cacheMovimento = new Map();

  function doCache(cache, chave, produzir) {
    const hit = cache.get(chave);
    if (hit && Date.now() - hit.em < TTL_MS) return Promise.resolve(hit);
    return produzir().then((dados) => {
      const entrada = { dados, em: Date.now() };
      cache.set(chave, entrada);
      return entrada;
    });
  }

  const horaDe = (ms) => new Date(ms).toTimeString().slice(0, 5);

  // --- render ---------------------------------------------------------
  let consentGiven = false;
  const CONSENT_MSG =
    'SIGC-PRO: isto fará duas consultas ao próprio servidor do SIGC — a ' +
    'agenda da UF e o último movimento deste controle. Nenhum dado sai do ' +
    'IBGE. Continuar?';

  async function anotar(btn) {
    if (!consentGiven) {
      if (!confirm(CONSENT_MSG)) return;
      consentGiven = true;
    }
    const pesquisa = window.__sigcPro.detectPesquisa();
    const tabela = pesquisa && window.__sigcPro.getTableRows(pesquisa);
    if (!tabela) {
      alert('SIGC-PRO: tabela não encontrada ou com layout inesperado.');
      return;
    }
    const cols = pesquisa.columns;
    if (tabela.rows.length === 0) {
      alert('SIGC-PRO: não há linhas na tabela para anotar.');
      return;
    }
    const controle = String(tabela.rows[0][cols.controle.index] || '').trim();
    const uf = controle.slice(0, 2);
    if (!controle) {
      alert('SIGC-PRO: não foi possível ler o Controle da tabela.');
      return;
    }

    const ano = new Date().getFullYear();
    const falhas = [];
    btn.disabled = true;
    // Independent, NOT Promise.all: a failed movimento request must not
    // cost the user their Agendado column.
    const [ag, mv] = await Promise.all([
      doCache(cacheAgenda, uf, () =>
        fetchAgenda(uf, `${ano}-01-01T00:00:00`, `${ano + 1}-01-01T00:00:00`))
        .catch((err) => { falhas.push(`Agenda: ${err && err.message}`); return null; }),
      doCache(cacheMovimento, controle, () => fetchMovimento(uf, controle))
        .catch((err) => { falhas.push(`Último Movimento: ${err && err.message}`); return null; }),
    ]);
    btn.disabled = false;

    if (!ag && !mv) {
      alert(`SIGC-PRO: nenhuma das consultas funcionou — ${falhas.join('; ')}`);
      return;
    }

    const slots = ag ? ag.dados : [];
    const movimento = mv && mv.dados ? mv.dados : { header: [], rows: [] };
    const agendaIdx = indexByControle(slots);
    const { index: movimentoIdx, colunasNaoEncontradas } = indexMovimento(movimento.header, movimento.rows);
    // A non-empty response that still yielded an empty index means the
    // report's column labels didn't match what we look for — a parsing
    // failure, not "nothing happened yet". Left silent, it looks identical
    // to real no-data.
    if (mv && movimento.rows.length > 0 && colunasNaoEncontradas) {
      falhas.push('Último Movimento: layout do relatório não reconhecido (colunas não encontradas)');
    }
    const minDate = window.__sigcPro.agendaMinScheduleDate(new Date());
    const minDateIso = window.__sigcPro.dateToIso(minDate);
    const livresIdx = ag ? indexZonaLivres(slots, minDateIso) : null;
    const todayIso = window.__sigcPro.dateToIso(new Date());

    // Keyed by household, NOT positional: tabela.rows is the full dataset
    // in original data order (readDataTable's "stable across pagination/
    // sort" guarantee); the panel lists every household regardless of
    // current page/sort/filter, so this order is exactly what we want.
    const domicilios = tabela.rows.map((r) => {
      const a = annotateRow(r[cols.controle.index], r[cols.nDomicilio.index],
        { agendaIdx, movimentoIdx, todayIso });
      return {
        ...a,
        identificador: identificadorDomicilio(
          r[cols.logradouro.index], r[cols.numero.index], r[cols.nDomicilio.index]),
      };
    });

    escreverResumo(
      tabela.rows.map((r) => String(r[cols.idZona.index] || '').trim()),
      livresIdx,
      {
        minDateBr: window.__sigcPro.isoToBr(minDateIso),
        agendaEm: ag ? horaDe(ag.em) : '—',
        movimentoEm: mv ? horaDe(mv.em) : '—',
        falhas,
      },
      domicilios);
    console.log(`${TAG} ${domicilios.length} domicílio(s) anotados; ` +
      `${livresIdx ? livresIdx.size : '?'} zona(s) com slots livres.`);
  }

  function escreverResumo(zonaIds, livresIdx, meta, domicilios) {
    const antigo = document.getElementById('sigc-pro-lista-agenda-resumo');
    if (antigo) antigo.remove();
    const alvo = document.querySelector('.dataTables_wrapper') ||
      window.__sigcPro.getDataTable().table().container();
    const div = document.createElement('div');
    // Built from escaped strings only (escapeHtml on every interpolated
    // value, including per-household fields — see buildDomiciliosHtml).
    div.innerHTML = buildResumoHtml(zonaIds, livresIdx, meta, domicilios);
    alvo.parentNode.insertBefore(div.firstElementChild, alvo);
  }

  const STYLE_ID = 'sigc-pro-lista-agenda-style';
  const CSS = `
#sigc-pro-lista-agenda-resumo { margin: .4rem 0; padding: .4rem .6rem;
  border: 1px solid #d0d7de; border-radius: 6px; background: #f6f8fa;
  font: 12px/1.45 -apple-system, "Segoe UI", Roboto, sans-serif; color: #1a1a1a; }
#sigc-pro-lista-agenda-resumo .sp-titulo { color: #555; margin-bottom: .2rem; }
#sigc-pro-lista-agenda-resumo .sp-zona-livre { display: inline-block; margin-right: .9rem; }
#sigc-pro-lista-agenda-resumo .sp-falha { color: #a11; margin-top: .2rem; }
#sigc-pro-lista-agenda-resumo .sp-domicilios { margin-top: .3rem; border-top: 1px solid #d0d7de; padding-top: .3rem; }
#sigc-pro-lista-agenda-resumo .sp-domicilios ul { margin: 0; padding-left: 1.1rem; }
#sigc-pro-lista-agenda-resumo .sp-domicilios li { margin: .1rem 0; }
#sigc-pro-lista-agenda-resumo .sp-domicilios .sp-futura { font-weight: 700; color: #161; }
#sigc-pro-lista-agenda-resumo .sp-domicilios .sp-passada { color: #777; }
#sigc-pro-lista-agenda-resumo .sp-omitidos { color: #555; margin-top: .2rem; }
`;

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  // Selecionados view only — a correctness requirement, not a
  // preference: zona columns are populated only for selecionado
  // households, so on the completos view the zona index would silently
  // under-count (see agenda-map.js).
  function noSelecionados() {
    const pesquisa = window.__sigcPro.detectPesquisa();
    const tabela = pesquisa && window.__sigcPro.getTableRows(pesquisa);
    if (!tabela || tabela.rows.length === 0) return false;
    const i = pesquisa.columns.selecionado.index;
    return tabela.rows.every((r) => /^sim$/i.test(String(r[i] || '').trim()));
  }

  window.__sigcPro.mountWidget({
    id: 'sigc-pro-lista-agenda-button',
    // dtToolbar() is the ".dt-buttons" bar, the same anchor csv-export
    // uses. onListaEnderecos is a direct __sigcPro export, NOT on ctx.
    anchor: (ctx) => ctx.dtToolbar(),
    when: () => window.__sigcPro.onListaEnderecos() && noSelecionados(),
    build: () => {
      ensureStyle();
      console.log(`${TAG} Agenda button added.`);
      return window.__sigcPro.makeDtProButton({
        id: 'sigc-pro-lista-agenda-button',
        lines: ['AGENDA', 'PRO'],
        title: 'Anotar agendamento e situação de cada domicílio (SIGC-PRO)',
        onClick: (e) => anotar(e.currentTarget),
      });
    },
  });
})();
