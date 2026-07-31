// SIGC-PRO feature: annotates the Lista de Endereços (selecionados view)
// with data the page itself does not carry — each household's scheduled
// interview and collection status, plus how many slots remain bookable
// in its zonas.
//
// Two sources, both same-origin and behind one click+confirm:
//   Agenda          GET  AdministracaoAgenda/ObterSlots  (JSON)
//   Último Movimento POST /relatorio/filtrar             (HTML fragment)
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
  // reading whatever happens to sit at a guessed position.
  function indexMovimento(header, rows) {
    const map = new Map();
    const iControle = acharColuna(header, 'Controle');
    const iDomicilio = acharColuna(header, 'Domicílio');
    const iPosicao = acharColuna(header, 'Última Posição');
    const iTransmissao = acharColuna(header, 'Data Transmissão');
    if (iControle === -1 || iDomicilio === -1 || iPosicao === -1 || iTransmissao === -1) {
      console.warn(`${TAG} Último Movimento: colunas esperadas não encontradas`,
        JSON.stringify(header));
      return map;
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
    return map;
  }

  // One decimal, pt-BR comma — same shape the day guide uses.
  const num1 = (n) => n.toFixed(1).replace('.', ',');

  // Free slots for the zonas THIS table's households belong to, not the
  // whole UF: the question is "where can I still book these people?".
  // Fetch times are shown because a stale count causes a real
  // double-booking; two are shown when the sources aged differently,
  // since one timestamp would misreport the older.
  function buildResumoHtml(zonaIdsDaTabela, livresIdx, meta) {
    const e = window.__sigcPro.escapeHtml;
    const ids = [...new Set((zonaIdsDaTabela || []).filter(Boolean))].sort();
    const celulas = ids.map((id) => {
      const c = (livresIdx && livresIdx.get(id)) || { inteiro: 0, peso: 0, compartilhado: false };
      const pond = c.compartilhado ? ` (${num1(c.peso)} ponderado)` : '';
      return `<span class="sp-zona-livre"><strong>${e(id)}</strong>: ${c.inteiro}${pond}</span>`;
    }).join(' ');

    const quando = meta.agendaEm === meta.movimentoEm
      ? `dados de ${e(meta.agendaEm)}`
      : `agenda de ${e(meta.agendaEm)}, movimento de ${e(meta.movimentoEm)}`;

    const falhas = (meta.falhas || []).length
      ? `<div class="sp-falha">Sem dados de ${(meta.falhas || []).map(e).join('; ')}. ` +
        'As colunas correspondentes ficam vazias.</div>'
      : '';

    return [
      '<div id="sigc-pro-lista-agenda-resumo">',
      `<div class="sp-titulo">Slots livres (a partir de ${e(meta.minDateBr)}) · ${quando}</div>`,
      `<div class="sp-zonas">${celulas || '<em>Nenhuma zona nesta tabela.</em>'}</div>`,
      falhas,
      '</div>',
    ].join('\n');
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
        Referer: `${location.origin}/AdministracaoAgenda`,
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
    const res = await fetchViaGateway('/relatorio/filtrar?slug=UltimoMovimento', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: 'filtro=' + encodeURIComponent(JSON.stringify(filtro)),
    });
    return parseMovimentoHtml(await res.text());
  }

  // DOMParser is inert — nothing in the fetched markup can load resources
  // or run handlers. Same guarantee ultimo-movimento-export relies on.
  function parseMovimentoHtml(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const table = doc.querySelector('table');
    if (!table) return null;
    const header = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    const rows = [...table.querySelectorAll('tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()));
    return { header, rows };
  }

  window.__sigcPro.listaAgenda = {
    parseSlots, zonaIdOf, indexByControle, indexZonaLivres, pickAgendado, indexMovimento, buildResumoHtml, annotateRow,
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
  const COLUNAS = ['Agendado', 'Situação', 'Transmissão'];

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
    const movimentoIdx = indexMovimento(movimento.header, movimento.rows);
    const minDate = window.__sigcPro.agendaMinScheduleDate(new Date());
    const minDateIso = window.__sigcPro.dateToIso(minDate);
    const livresIdx = indexZonaLivres(slots, minDateIso);
    const todayIso = window.__sigcPro.dateToIso(new Date());

    const anotacoes = tabela.rows.map((r) => annotateRow(
      r[cols.controle.index], r[cols.nDomicilio.index],
      { agendaIdx, movimentoIdx, todayIso }));

    escreverColunas(anotacoes);
    escreverResumo(
      tabela.rows.map((r) => String(r[cols.idZona.index] || '').trim()),
      livresIdx,
      {
        minDateBr: window.__sigcPro.isoToBr(minDateIso),
        agendaEm: ag ? horaDe(ag.em) : '—',
        movimentoEm: mv ? horaDe(mv.em) : '—',
        falhas,
      });
    console.log(`${TAG} ${anotacoes.length} linha(s) anotadas; ` +
      `${livresIdx.size} zona(s) com slots livres.`);
  }

  // Appended, never inserted: indexes 0-19 must stay put, since
  // tableMatchesLayout validates by index and PDF/KML read fixed ones.
  function escreverColunas(anotacoes) {
    const dt = window.__sigcPro.getDataTable();
    if (!dt) return;
    const thead = dt.table().header();
    const jaTem = [...thead.querySelectorAll('th')]
      .some((th) => th.textContent.trim() === COLUNAS[0]);
    if (!jaTem) {
      const tr = thead.querySelector('tr');
      COLUNAS.forEach((nome) => {
        const th = document.createElement('th');
        th.textContent = nome;
        tr.appendChild(th);
      });
    }
    const corpo = dt.table().body();
    [...corpo.querySelectorAll('tr')].forEach((tr, i) => {
      const a = anotacoes[i];
      if (!a) return;
      // Re-annotating replaces rather than appends again.
      [...tr.querySelectorAll('td.sigc-pro-anotacao')].forEach((td) => td.remove());
      [
        { texto: a.agendado, classe: a.futura ? 'sp-futura' : 'sp-passada' },
        { texto: a.situacao, classe: '' },
        { texto: a.transmissao, classe: '' },
      ].forEach(({ texto, classe }) => {
        const td = document.createElement('td');
        td.className = `sigc-pro-anotacao ${classe}`.trim();
        td.textContent = texto || '—';
        tr.appendChild(td);
      });
    });
  }

  function escreverResumo(zonaIds, livresIdx, meta) {
    const antigo = document.getElementById('sigc-pro-lista-agenda-resumo');
    if (antigo) antigo.remove();
    const alvo = document.querySelector('.dataTables_wrapper') ||
      window.__sigcPro.getDataTable().table().container();
    const div = document.createElement('div');
    // Built from escaped strings only (escapeHtml on every zona id).
    div.innerHTML = buildResumoHtml(zonaIds, livresIdx, meta);
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
td.sigc-pro-anotacao.sp-futura { font-weight: 700; color: #161; }
td.sigc-pro-anotacao.sp-passada { color: #777; }
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
