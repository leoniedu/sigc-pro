// SIGC-PRO feature: on the Lista de Endereços (selecionados view), consults
// the agenda and the último movimento of the current Controle — data the
// page itself does not carry — and downloads a self-contained HTML file
// with a sortable per-household table (scheduled interview, collection
// status). The on-page panel itself only shows a free-slots-per-zona
// summary and points at the downloaded file; it does not annotate the
// portal's own table.
//
// Two sources, both same-origin and behind one click+confirm:
//   Agenda          GET  AdministracaoAgenda/ObterSlots            (JSON)
//   Último Movimento POST /relatorio/filtrar?slug=relatorio-ultimo-movimento
//                                                                   (HTML fragment)
// As of 2026-08-07, Último Movimento moved onto the same generic
// /relatorio/filtrar?slug=... mechanism Lista de Endereços already used —
// see fetchMovimento/filtrarUrlMovimento below.
// Both key on (Controle, Domicílio), the table's own key.
//
// Three seams — acquire / index / render — so the fetches stay
// independent (either may fail without costing the other's columns) and
// every decision worth testing lives in a pure function.
//
// The on-page panel keeps only the free-slots-per-zona summary; the
// per-household detail is a sortable table in a downloaded, self-contained
// HTML file (buildDomiciliosDocHtml), same shape as agenda-day-guide's
// buildGuideHtml — a wall of 15-40 households does not belong on the page.
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

  // Zona columns are populated only for selecionado households (see
  // agenda-lookups.js), so counting free slots over a mixed table would
  // undercount. Filtering the rows down to Selecionado = Sim fixes that at
  // the source, letting the button work on every Lista de Endereços view
  // — including the default mixed report — instead of being disabled
  // outright whenever the table isn't already all-selecionados. The
  // per-household annotation was never at risk from non-selecionado rows;
  // this filter just also narrows its scope to match the zona figures.
  function linhasSelecionadas(rows, iSelecionado) {
    return (rows || []).filter((r) => /^sim$/i.test(String(r[iSelecionado] ?? '').trim()));
  }

  // Domicílios/setores/controles without a zona have no agendamentos at
  // all — pure predicate over a column's worth of values (whatever shape
  // the caller already has: a DataTables column dump or a rows[][] slice),
  // so the AGENDA PRO button's enable/disable check can be unit-tested
  // with no DOM/DataTables harness at all.
  function algumaLinhaTemZona(valores) {
    return (valores || []).some((v) => String(v ?? '').trim() !== '');
  }

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
  // that does not exist. fimIso (optional) bounds the far end so a slot
  // months out does not overstate realistically bookable capacity.
  //
  // Manhã before 13:00, Tarde from 13:00 — the same cut Slots Abertos
  // uses. Shared boundary, or the two features drift.
  const TARDE_FROM_MIN = 13 * 60;

  function indexZonaLivres(slots, minDateIso, fimIso) {
    const map = new Map();
    slots.forEach((s) => {
      if (!s.aberto) return;
      if (s.isoDate && s.isoDate < minDateIso) return;
      if (fimIso && s.isoDate && s.isoDate > fimIso) return;
      const min = window.__sigcPro.toMin(horaDeIso(s.start));
      if (min == null) return;
      const turno = min < TARDE_FROM_MIN ? 'manha' : 'tarde';
      const ids = new Set(
        window.__sigcPro.parseZonaEntries(s.zonas).map(zonaIdOf).filter(Boolean));
      if (ids.size === 0) return;
      const peso = 1 / ids.size;
      ids.forEach((id) => {
        if (!map.has(id)) {
          map.set(id, { manha: 0, tarde: 0, inteiro: 0, peso: 0, compartilhado: false });
        }
        const cell = map.get(id);
        cell[turno] += 1;
        cell.inteiro += 1;
        cell.peso += peso;
        if (ids.size > 1) cell.compartilhado = true;
      });
    });
    return map;
  }

  // The ONE selection behind both the turno counts and the list below
  // them. Deriving them separately is how a summary ends up disagreeing
  // with the detail it summarises.
  function slotsLivresDaJanela(slots, zonaId, minDateIso, fimIso) {
    return (slots || [])
      .filter((s) => {
        if (!s.aberto) return false;
        if (!s.isoDate || s.isoDate < minDateIso || s.isoDate > fimIso) return false;
        if (window.__sigcPro.toMin(horaDeIso(s.start)) == null) return false;
        return window.__sigcPro.parseZonaEntries(s.zonas).map(zonaIdOf).includes(zonaId);
      })
      .map((s) => ({ isoDate: s.isoDate, hora: horaDeIso(s.start) }))
      .sort((a, b) => a.isoDate.localeCompare(b.isoDate) || a.hora.localeCompare(b.hora));
  }

  function agruparPorDia(livres) {
    const dias = new Map();
    (livres || []).forEach((s) => {
      if (!dias.has(s.isoDate)) dias.set(s.isoDate, []);
      dias.get(s.isoDate).push(s.hora);
    });
    return [...dias.entries()].map(([isoDate, horas]) => ({ isoDate, horas }));
  }

  // Grouped by day rather than a flat list: a fortnight of slots stays a
  // short block you can scan for "when this week?".
  function buildSlotsLivresHtml(grupos) {
    const e = window.__sigcPro.escapeHtml;
    if (!grupos || grupos.length === 0) {
      return '<p class="sp-livres-vazio">Nenhum slot livre no período.</p>';
    }
    const linhas = grupos.map((g) => {
      const dia = `${g.isoDate.slice(8, 10)}/${g.isoDate.slice(5, 7)}`;
      const horas = g.horas.map((h) => `<span class="sp-hora">${e(h)}</span>`).join(' ');
      return `<div class="sp-dia"><strong>${e(dia)}</strong> ${horas}</div>`;
    }).join('\n');
    return `<div class="sp-livres">${linhas}</div>`;
  }

  // HH:MM out of a full ISO timestamp, or '' if unparsable — a household
  // scheduled at 09:00 vs 15:30 matters when planning a day, so the time
  // is shown alongside the date wherever it renders.
  function horaDoStart(start) {
    const m = /^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})/.exec(String(start || ''));
    return m ? `${m[1]}:${m[2]}` : '';
  }

  // HH:MM from an ISO string for the turno split — a bare slice rather
  // than a regex so the caller passes the result to toMin, which rejects
  // unparseable values itself.
  const horaDeIso = (iso) => String(iso || '').slice(11, 16);

  // Only one schedule is live at a time, so a future date wins outright;
  // otherwise show the most recent past one, flagged so a completed
  // interview does not read as an upcoming appointment. Sorted by the
  // full `start` timestamp, not just isoDate: two slots on the same day
  // would otherwise order arbitrarily (whichever the response listed
  // first), so the earliest appointment of a day was not deterministically
  // chosen.
  function pickAgendado(slots, todayIso) {
    if (!slots || slots.length === 0) return null;
    const ordenado = [...slots].sort((a, b) => a.start.localeCompare(b.start));
    const futura = ordenado.find((s) => s.isoDate >= todayIso);
    const escolhido = futura || ordenado[ordenado.length - 1];
    return {
      data: window.__sigcPro.isoToBr(escolhido.isoDate),
      hora: horaDoStart(escolhido.start),
      // Raw ISO timestamp, kept alongside the pt-BR display string as the
      // exported table's sort key: it sorts correctly as a plain string,
      // sparing the inline sort script from parsing "dd/mm/yyyy HH:MM".
      ordenavel: escolhido.start,
      futura: !!futura,
    };
  }

  // "dd/mm/yyyy HH:MM", degrading to date-only when the time can't be
  // parsed — never "dd/mm/yyyy undefined" or a stray trailing separator.
  function fmtAgendado(data, hora) {
    if (!data) return '';
    return hora ? `${data} ${hora}` : data;
  }

  // Header labels vary in accent/case between SIGC screens, so match
  // normalized rather than exact.
  function normalizar(s) {
    return String(s ?? '').trim().toUpperCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  // Strips a leading run of "#"/"!" characters some SIGC report grids
  // prepend to a sortable/filterable column's header text (confirmed
  // live 2026-08-07: "#!Controle", "!Domicílio") — a UI decoration, not
  // part of the label's identity, so it must not be baked into any label
  // constant (that would break the day this decoration is toggled off
  // again). Same targeted fix as agenda-lookups.js's stripHeaderMarker.
  function stripHeaderMarker(h) {
    return String(h ?? '').replace(/^[#!]+/, '');
  }

  function acharColuna(header, alvo) {
    const want = normalizar(alvo);
    return (header || []).findIndex((h) => normalizar(stripHeaderMarker(h)) === want);
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
    const iTipo = acharColuna(header, 'Tipo Entrevista');
    const iTransmissao = acharColuna(header, 'Data');
    if (iControle === -1 || iDomicilio === -1 || iPosicao === -1 || iTipo === -1 || iTransmissao === -1) {
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
        tipo: String(r[iTipo] ?? '').trim(),
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
  //
  // The per-household list used to render here too; it now lives in a
  // downloaded standalone file (buildDomiciliosDocHtml) instead, since a
  // wall of 15-40 households made this on-page panel unwieldy. `arquivo`,
  // when given, names that download so the panel points at where the
  // detail went rather than just dropping it silently.
  function buildResumoHtml(zonaIdsDaTabela, livresIdx, meta, arquivo, livres) {
    const e = window.__sigcPro.escapeHtml;
    const ids = [...new Set((zonaIdsDaTabela || []).filter(Boolean))].sort();
    const celulas = ids.map((id) => {
      if (livresIdx === null) {
        return `<span class="sp-zona-livre"><strong>${e(id)}</strong>: ?</span>`;
      }
      const c = (livresIdx && livresIdx.get(id)) || { manha: 0, tarde: 0, inteiro: 0, peso: 0, compartilhado: false };
      const pond = c.compartilhado ? ` (${num1(c.peso)} ponderado)` : '';
      return `<span class="sp-zona-livre"><strong>${e(id)}</strong> — Manhã: ${c.manha} Tarde: ${c.tarde} Total: ${c.inteiro}${pond}</span>`;
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

    const download = arquivo
      ? `<div class="sp-download">Tabela detalhada por domicílio baixada em <strong>${e(arquivo)}</strong>.</div>`
      : '';

    return [
      '<div id="sigc-pro-lista-agenda-resumo">',
      `<div class="sp-titulo">Slots livres (a partir de ${e(meta.minDateBr)}, próximas 2 semanas) · ${quando}</div>`,
      `<div class="sp-zonas">${celulas || '<em>Nenhuma zona nesta tabela.</em>'}</div>`,
      livresIdx !== null ? buildSlotsLivresHtml(livres || []) : '',
      falhas,
      download,
      '</div>',
    ].join('\n');
  }

  // Per-household detail used to live in the on-page panel as an <ul>, but
  // 15-40 households made that panel an unwieldy wall of text. It is now a
  // sortable table inside a DOWNLOADED, SELF-CONTAINED HTML file instead
  // (buildDomiciliosTableHtml below) — this function builds just the
  // <table> markup, reused by both the standalone document and (were it
  // ever needed) any other host, same seam agenda-day-guide's builders use.
  //
  // Every household in the Controle appears, INCLUDING those with no data
  // from either source — missing fields render "—" rather than being
  // omitted, since the point of a downloaded file is a complete list to
  // scan/search/sort, not a curated one.
  function buildDomiciliosTable(domicilios) {
    const e = window.__sigcPro.escapeHtml;
    const linhas = (domicilios || []).map((d) => {
      const classe = d.agendado ? (d.futura ? 'sp-futura' : 'sp-passada') : '';
      const agendadoTxt = d.agendado ? e(d.agendado) : '—';
      const agendadoCell = classe
        ? `<span class="${classe}">${agendadoTxt}</span>`
        : agendadoTxt;
      const endereco = d.endereco || `Domicílio ${d.nDomicilio ?? ''}`.trim();
      const url = window.__sigcPro.gmapsDestinoUrl(d.lat, d.lon);
      const enderecoCell = url
        ? `<a href="${e(url)}" target="_blank" rel="noopener">${e(endereco || '—')}</a>`
        : e(endereco || '—');
      return '<tr>' +
        `<td>${enderecoCell}</td>` +
        `<td>${e(String(d.nDomicilio ?? '').trim() || '—')}</td>` +
        `<td data-sort="${e(d.agendadoOrdenavel || '')}">${agendadoCell}</td>` +
        `<td>${e(d.situacao || '—')}</td>` +
        `<td>${e(d.tipo || '—')}</td>` +
        `<td data-sort="${e(d.transmissao || '')}">${e(d.transmissao || '—')}</td>` +
        '</tr>';
    }).join('\n');

    return [
      '<table class="sp-tabela" id="sp-tabela-domicilios">',
      '<thead><tr>',
      '<th data-tipo="texto">Endereço</th>',
      '<th data-tipo="texto">Domicílio</th>',
      // Agendado's data-sort is the raw ISO timestamp (see annotateRow),
      // which sorts correctly with plain string comparison — data-tipo
      // "texto" here, NOT "data" (that parser expects dd/mm/yyyy, the
      // display format, not the sort key).
      '<th data-tipo="texto">Agendado</th>',
      '<th data-tipo="texto">Situação</th>',
      '<th data-tipo="texto">Tipo</th>',
      '<th data-tipo="data">Data</th>',
      '</tr></thead>',
      `<tbody>${linhas}</tbody>`,
      '</table>',
    ].join('\n');
  }

  // Complete standalone document: header (Controle + fetch times, the same
  // information the on-page panel's sp-titulo carries), the free-slots-per-
  // zona summary (buildResumoHtml's own markup, reused verbatim so the
  // rendering logic exists in exactly one place), and the sortable
  // households table. One inline <script> for sorting, no external
  // resources of any kind — must open and work from a Downloads folder
  // with no network, same contract as agenda-day-guide's buildGuideHtml.
  function buildDomiciliosDocHtml(meta, resumoHtml, domicilios) {
    const e = window.__sigcPro.escapeHtml;
    return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SIGC-PRO — Domicílios — ${e(meta.controle)}</title>
<style>
body { margin: 0; font: 14px/1.45 -apple-system, "Segoe UI", Roboto, sans-serif; color: #1a1a1a; }
header { padding: 1rem 1.2rem .6rem; border-bottom: 2px solid #005a9c; }
header h1 { margin: 0; font-size: 1.3rem; color: #005a9c; }
header .meta { color: #555; font-size: .9rem; }
main { padding: 0 1.2rem 2rem; }
#sigc-pro-lista-agenda-resumo { margin: .8rem 0; padding: .4rem .6rem;
  border: 1px solid #d0d7de; border-radius: 6px; background: #f6f8fa;
  font-size: 12px; line-height: 1.45; color: #1a1a1a; }
#sigc-pro-lista-agenda-resumo .sp-titulo { color: #555; margin-bottom: .2rem; }
#sigc-pro-lista-agenda-resumo .sp-zona-livre { display: inline-block; margin-right: .9rem; }
#sigc-pro-lista-agenda-resumo .sp-falha { color: #a11; margin-top: .2rem; }
#sigc-pro-lista-agenda-resumo .sp-livres { margin-top: .4rem; border-top: 1px solid #d0d7de; padding-top: .3rem; }
#sigc-pro-lista-agenda-resumo .sp-dia { margin-bottom: .15rem; }
#sigc-pro-lista-agenda-resumo .sp-hora { display: inline-block; margin-right: .35rem; color: #333; }
#sigc-pro-lista-agenda-resumo .sp-livres-vazio { color: #888; margin-top: .3rem; }
table.sp-tabela { border-collapse: collapse; width: 100%; margin-top: .4rem; }
table.sp-tabela th, table.sp-tabela td { border: 1px solid #d0d7de; padding: .3rem .6rem; text-align: left; font-size: .92rem; }
table.sp-tabela th { background: #f6f8fa; cursor: pointer; user-select: none; white-space: nowrap; }
table.sp-tabela th.sp-asc::after { content: " \\25B2"; }
table.sp-tabela th.sp-desc::after { content: " \\25BC"; }
table.sp-tabela .sp-futura { font-weight: 700; color: #161; }
table.sp-tabela .sp-passada { color: #777; }
</style>
</head>
<body>
<header>
<h1>SIGC-PRO — Domicílios do Controle ${e(meta.controle)}</h1>
<div class="meta">${e(meta.quando)} · gerado em ${e(meta.geradoEm)}</div>
</header>
<main>
${resumoHtml}
<h2>Domicílios</h2>
${buildDomiciliosTable(domicilios)}
</main>
<script>
(function () {
  'use strict';
  // dd/mm/yyyy -> a comparable number (yyyymmdd), or null when unparsable
  // (including the empty string a missing value leaves in data-sort).
  function parseDateBr(s) {
    var m = /^(\\d{2})\\/(\\d{2})\\/(\\d{4})$/.exec(s || '');
    return m ? Number(m[3] + m[2] + m[1]) : null;
  }

  function cellValue(td) {
    return td.dataset.sort != null ? td.dataset.sort : td.textContent.trim();
  }

  function compareRows(a, b, colIdx, tipo, dir) {
    var va = cellValue(a.children[colIdx]);
    var vb = cellValue(b.children[colIdx]);
    // Missing values sort to the END regardless of direction — they are
    // noise when scanning for scheduled visits, so they never lead.
    var aEmpty = va === '';
    var bEmpty = vb === '';
    if (aEmpty && bEmpty) return 0;
    if (aEmpty) return 1;
    if (bEmpty) return -1;

    var result;
    if (tipo === 'data') {
      result = parseDateBr(va) - parseDateBr(vb);
    } else {
      result = va.localeCompare(vb, 'pt-BR');
    }
    return dir === 'desc' ? -result : result;
  }

  document.querySelectorAll('#sp-tabela-domicilios th').forEach(function (th, colIdx) {
    th.addEventListener('click', function () {
      var table = th.closest('table');
      var tbody = table.querySelector('tbody');
      var tipo = th.dataset.tipo;
      var dir = th.classList.contains('sp-asc') ? 'desc' : 'asc';

      table.querySelectorAll('th').forEach(function (h) {
        h.classList.remove('sp-asc', 'sp-desc');
      });
      th.classList.add(dir === 'asc' ? 'sp-asc' : 'sp-desc');

      var rows = Array.prototype.slice.call(tbody.querySelectorAll('tr'));
      rows.sort(function (a, b) { return compareRows(a, b, colIdx, tipo, dir); });
      rows.forEach(function (tr) { tbody.appendChild(tr); });
    });
  });
})();
</script>
</body>
</html>
`;
  }

  // "logradouro, Nº número" for the table's Endereço column. The domicílio
  // number gets its own Domicílio column in the table rather than being
  // folded in here.
  function enderecoDomicilio(logradouro, numero) {
    return [logradouro, numero].map((s) => String(s ?? '').trim()).filter(Boolean).join(', Nº ');
  }

  // Returns an OBJECT, not a bare string, so a further source adds a key
  // rather than changing every caller's signature. Empty strings (never
  // undefined) so the render step can write cells without guarding.
  function annotateRow(controle, domicilio, ctx) {
    const k = chaveDomicilio(String(controle ?? '').trim(), String(domicilio ?? '').trim());
    const ag = pickAgendado((ctx.agendaIdx && ctx.agendaIdx.get(k)) || [], ctx.todayIso);
    const mv = (ctx.movimentoIdx && ctx.movimentoIdx.get(k)) || null;
    return {
      agendado: ag ? fmtAgendado(ag.data, ag.hora) : '',
      agendadoOrdenavel: ag ? ag.ordenavel : '',
      futura: ag ? ag.futura : false,
      situacao: mv ? mv.situacao : '',
      transmissao: mv ? mv.transmissao : '',
      tipo: mv ? mv.tipo : '',
    };
  }

  // --- acquire --------------------------------------------------------

  // Query built by hand: percent-encoding the "$$" in the F5 path turns
  // the URL into a 404 (learned in pns.zonas/R/sigc_agendamentos.R).
  async function fetchAgenda(uf, startIso, endIso) {
    const query = `idUf=${encodeURIComponent(uf)}` +
      `&start=${encodeURIComponent(startIso)}` +
      `&end=${encodeURIComponent(endIso)}` +
      '&semana=true&idEquipe=';
    const res = await window.__sigcPro.fetchViaGateway(`/AdministracaoAgenda/ObterSlots?${query}`, {
      credentials: 'same-origin',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
      },
    });
    return parseSlots(await res.json());
  }

  // As of 2026-08-07, Último Movimento is served through the same generic
  // /relatorio/filtrar?slug=... mechanism Lista de Endereços already
  // used, not a dedicated endpoint — so this file, like agenda-lookups.js and
  // ultimo-movimento-export.js, needs its own local URL builder (each
  // network file owns its URL logic; this file has no dependency on
  // either of those two). simple=true: plain prefixed path. simple=false:
  // replicate the fuller shape captured from the live gateway (f5-h-$$
  // segment + F5_origin/F5CH params).
  const ULTIMO_MOVIMENTO_SLUG = 'relatorio-ultimo-movimento';

  function filtrarUrlMovimento(origin, pathname, simple) {
    const f5 = window.__sigcPro.f5Prefix(pathname);
    if (!f5) return `${origin}/relatorio/filtrar?slug=${ULTIMO_MOVIMENTO_SLUG}`;
    return simple
      ? `${origin}${f5.prefix}/relatorio/filtrar?slug=${ULTIMO_MOVIMENTO_SLUG}`
      : `${origin}${f5.prefix}/relatorio/f5-h-$$/relatorio/filtrar?slug=${ULTIMO_MOVIMENTO_SLUG};F5_origin=${f5.hex}&F5CH=I`;
  }

  // One request for the whole Controle: buildAgenciaFilterBody's payload
  // with Controle set to the real value instead of "*" returns every
  // domicílio at once. NOT the multi-agência loop. Tries the simple
  // prefixed URL first, then the full captured F5 form (identical on the
  // direct host, where the Set collapses them) — same two-mode retry
  // shape as agenda-lookups.js's postUltimoMovimento and
  // ultimo-movimento-export.js's fetchAgenciaReport.
  async function fetchMovimento(uf, controle) {
    const filtro = {
      IdFiltro: ULTIMO_MOVIMENTO_SLUG,
      IdUf: String(uf),
      IdAgencia: '*',
      IdMunicipio: '*',
      Controle: String(controle),
      IdEntrevistadores: '*',
      IdTipoAcompanhamento: '*',
    };
    const urls = [...new Set([
      filtrarUrlMovimento(location.origin, location.pathname, true),
      filtrarUrlMovimento(location.origin, location.pathname, false),
    ])];
    let lastErr = new Error('sem resposta');
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: 'filtro=' + encodeURIComponent(JSON.stringify(filtro)),
        });
        if (!res.ok) { lastErr = new Error(`HTTP ${res.status}`); continue; }
        const parsed = parseMovimentoHtml(await res.text());
        if (parsed) return parsed;
        lastErr = new Error('tabela não reconhecida');
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }

  // DOMParser is inert — nothing in the fetched markup can load resources
  // or run handlers. Same guarantee ultimo-movimento-export relies on.
  function parseMovimentoHtml(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const table = doc.querySelector('#tableRelatorio');
    if (!table) return null;
    const header = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    const rows = [...table.querySelectorAll('tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()));
    return { header, rows };
  }

  window.__sigcPro.listaAgenda = {
    parseSlots, zonaIdOf, indexByControle, indexZonaLivres, pickAgendado, indexMovimento, buildResumoHtml, annotateRow,
    buildDomiciliosTable, buildDomiciliosDocHtml, enderecoDomicilio, fetchLabel, nomeArquivoDomicilios, linhasSelecionadas,
    algumaLinhaTemZona, slotsLivresDaJanela, agruparPorDia, buildSlotsLivresHtml,
  };

  // Exposed only for tests — not part of the runtime public surface.
  window.__sigcProListaAgendaInternals = { filtrarUrlMovimento };

  // --- caches ---------------------------------------------------------
  // In-memory only, never persisted (zero-storage guarantee). A TTL is
  // needed where agenda-lookups' coordinate cache has none: someone else
  // booking a slot makes these counts wrong within a page's life.
  const TTL_MS = 5 * 60 * 1000;
  const cacheAgenda = new Map();
  const cacheMovimento = new Map();

  function doCache(cache, chave, produzir) {
    const hit = cache.get(chave);
    if (hit && Date.now() - hit.em < TTL_MS) return Promise.resolve({ ...hit, cache: true });
    return produzir().then((dados) => {
      const entrada = { dados, em: Date.now() };
      cache.set(chave, entrada);
      return { ...entrada, cache: false };
    });
  }

  const horaDe = (ms) => new Date(ms).toTimeString().slice(0, 5);

  // A cache hit and a fresh fetch must not look the same: the panel shows
  // the fetch time specifically because a stale count causes a real
  // double-booking, so the one case that IS knowably stale (served from
  // the in-memory cache, up to TTL_MS old) has to say so rather than just
  // naming the clock time as if it had just been fetched.
  function fetchLabel(em, cache) {
    return cache ? `${horaDe(em)} (em cache)` : horaDe(em);
  }

  // --- render ---------------------------------------------------------
  let consentGiven = false;
  const CONSENT_MSG =
    'SIGC-PRO: isto fará duas consultas ao próprio servidor do SIGC — a ' +
    'agenda da UF e o último movimento deste controle. Nenhum dado sai do ' +
    'IBGE. Continuar?';
  const SEM_ZONA_MSG =
    'SIGC-PRO: nenhum domicílio deste Controle tem uma zona (ID Zona) ' +
    'atribuída, portanto não há agendamentos para consultar.';

  async function anotar(btn) {
    const pesquisa = window.__sigcPro.detectPesquisa();
    const tabela = pesquisa && window.__sigcPro.getTableRows(pesquisa);
    if (!tabela) {
      alert('SIGC-PRO: tabela não encontrada ou com layout inesperado.');
      return;
    }
    const cols = pesquisa.columns;
    // Guard again at click time (in case the button's disabled state,
    // refreshed only per shared-observer tick, is stale) rather than
    // fetching only to show an empty result.
    if (!algumaLinhaTemZona(tabela.rows.map((r) => r[cols.idZona.index]))) {
      alert(SEM_ZONA_MSG);
      return;
    }
    // Filtered here, once, and used everywhere below instead of
    // tabela.rows: zona columns are only populated for selecionado
    // households (see linhasSelecionadas), so a mixed table's non-Sim rows
    // must never reach the domicilios build, the download or the zona
    // count. A report that is entirely non-selecionado (rows.length > 0 but
    // nothing survives the filter) has nothing to annotate — checked here,
    // before spending the confirm/fetch, rather than after.
    const linhas = linhasSelecionadas(tabela.rows, cols.selecionado.index);
    if (linhas.length === 0) {
      alert('SIGC-PRO: não há domicílios selecionados (Selecionado = Sim) nesta tabela para anotar.');
      return;
    }
    if (!consentGiven) {
      if (!confirm(CONSENT_MSG)) return;
      consentGiven = true;
    }
    const controle = String(linhas[0][cols.controle.index] || '').trim();
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
    const fim = new Date();
    fim.setDate(fim.getDate() + 14);
    const fimIso = window.__sigcPro.dateToIso(fim);
    const livresIdx = ag ? indexZonaLivres(slots, minDateIso, fimIso) : null;
    const zonaIds = linhas.map((r) => String(r[cols.idZona.index] || '').trim()).filter(Boolean);
    const zonaId = zonaIds[0] || '';
    const livres = ag && zonaId
      ? agruparPorDia(slotsLivresDaJanela(slots, zonaId, minDateIso, fimIso))
      : [];
    const todayIso = window.__sigcPro.dateToIso(new Date());

    // Keyed by household, NOT positional: linhas is the selecionado subset
    // of the full dataset in original data order (readDataTable's "stable
    // across pagination/sort" guarantee); the downloaded table lists every
    // selecionado household regardless of current page/sort/filter, so this
    // order is exactly what we want (the file's own sort takes over from
    // there).
    const domicilios = linhas.map((r) => {
      const a = annotateRow(r[cols.controle.index], r[cols.nDomicilio.index],
        { agendaIdx, movimentoIdx, todayIso });
      return {
        ...a,
        endereco: enderecoDomicilio(r[cols.logradouro.index], r[cols.numero.index]),
        nDomicilio: String(r[cols.nDomicilio.index] ?? '').trim(),
        lat: window.__sigcPro.parseCoord(r[cols.latitude.index]),
        lon: window.__sigcPro.parseCoord(r[cols.longitude.index]),
        tipo: a.tipo,
      };
    });

    const meta = {
      minDateBr: window.__sigcPro.isoToBr(minDateIso),
      agendaEm: ag ? fetchLabel(ag.em, ag.cache) : '—',
      movimentoEm: mv ? fetchLabel(mv.em, mv.cache) : '—',
      falhas,
    };
    const arquivo = baixarTabelaDomicilios(controle, meta, pesquisa, linhas, domicilios, livresIdx, livres);

    escreverResumo(
      linhas.map((r) => String(r[cols.idZona.index] || '').trim()),
      livresIdx,
      meta,
      arquivo,
      livres);
    console.log(`${TAG} ${domicilios.length} domicílio(s) anotados e exportados para ${arquivo}; ` +
      `${livresIdx ? livresIdx.size : '?'} zona(s) com slots livres.`);
  }

  // Downloads the standalone households table and returns its filename, so
  // the caller can point the on-page panel at it. Follows exportFileBase's
  // established naming (lista-enderecos-<pesquisa>_<controle>_<tipo>_<data>)
  // — the same base every other Lista de Endereços export uses — with an
  // "_agenda" tag added so this file (agenda/movimento annotations) is
  // never confused with the plain CSV/KML/PDF exports of the same table.
  //
  // The time (HHMMSS) is appended too, not just the date: consentGiven
  // latches after the first click, so every later export in the same page
  // life re-downloads under what would otherwise be the identical name —
  // Chrome then silently appends "(1)", "(2)"… with no way to tell which
  // file is which. A time-distinct name makes repeat exports self-naming.
  function nomeArquivoDomicilios(base, hora) {
    return `${base}_agenda_${hora}.html`;
  }

  function baixarTabelaDomicilios(controle, meta, pesquisa, rows, domicilios, livresIdx, livres) {
    const base = window.__sigcPro.exportFileBase(pesquisa, rows);
    const { data, hora } = window.__sigcPro.timestampSlug();
    const arquivo = nomeArquivoDomicilios(base, hora);
    const quando = meta.agendaEm === meta.movimentoEm
      ? `dados de ${meta.agendaEm}`
      : `agenda de ${meta.agendaEm}, movimento de ${meta.movimentoEm}`;
    // Reuse buildResumoHtml verbatim (same zona counts the panel shows,
    // same rendering logic in exactly one place) but with no download
    // note of its own — that line only makes sense on the PAGE, pointing
    // at this very file, not inside the file itself.
    const resumoHtml = buildResumoHtml(
      rows.map((r) => String(r[pesquisa.columns.idZona.index] || '').trim()),
      livresIdx, meta, null, livres);
    const docHtml = buildDomiciliosDocHtml(
      { controle, quando, geradoEm: `${data} ${hora.slice(0, 2)}:${hora.slice(2, 4)}:${hora.slice(4, 6)}` },
      resumoHtml, domicilios);
    window.__sigcPro.downloadFile(arquivo, docHtml, 'text/html;charset=utf-8');
    return arquivo;
  }

  function escreverResumo(zonaIds, livresIdx, meta, arquivo, livres) {
    const antigo = document.getElementById('sigc-pro-lista-agenda-resumo');
    if (antigo) antigo.remove();
    const alvo = document.querySelector('.dataTables_wrapper') ||
      window.__sigcPro.getDataTable().table().container();
    const div = document.createElement('div');
    // Built from escaped strings only (escapeHtml on every interpolated
    // value, including the filename — see buildResumoHtml).
    div.innerHTML = buildResumoHtml(zonaIds, livresIdx, meta, arquivo, livres);
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
#sigc-pro-lista-agenda-resumo .sp-download { margin-top: .3rem; border-top: 1px solid #d0d7de; padding-top: .3rem; color: #333; }
#sigc-pro-lista-agenda-resumo .sp-livres { margin-top: .4rem; border-top: 1px solid #d0d7de; padding-top: .3rem; }
#sigc-pro-lista-agenda-resumo .sp-dia { margin-bottom: .15rem; }
#sigc-pro-lista-agenda-resumo .sp-hora { display: inline-block; margin-right: .35rem; color: #333; }
#sigc-pro-lista-agenda-resumo .sp-livres-vazio { color: #888; margin-top: .3rem; }
`;

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  const BUTTON_ID = 'sigc-pro-lista-agenda-button';
  const TITLE_ATIVO = 'Consulta a agenda e o último movimento dos domicílios selecionados ' +
    'deste Controle (mediante confirmação) e baixa uma tabela por domicílio (SIGC-PRO)';
  const TITLE_SEM_ZONA = SEM_ZONA_MSG;

  // Cheap, column-scoped read for the per-tick gate: table.column(i).data()
  // reads ONE column across every page without DOMParser touching the rest
  // of the table (unlike getTableRows/readDataTable, which parse every
  // cell of every column on every page — too costly to run on EVERY shared-
  // observer tick, which is what `when` is). Short-circuits on the first
  // non-empty zona instead of building the whole column array.
  function tabelaTemZona() {
    const pesquisa = window.__sigcPro.detectPesquisa();
    const table = window.__sigcPro.getDataTable();
    if (!pesquisa || !table) return false;
    let achou = false;
    table.column(pesquisa.columns.idZona.index).data().each((v) => {
      if (!achou && String(v ?? '').trim() !== '') achou = true;
    });
    return achou;
  }

  // Button stays VISIBLE either way — an absent button is indistinguishable
  // from a broken extension, a mistake already made once in this project.
  // Disabled + a Portuguese tooltip explains itself instead.
  function atualizarEstadoBotao() {
    const btn = document.getElementById(BUTTON_ID);
    if (!btn) return;
    const temZona = tabelaTemZona();
    btn.disabled = !temZona;
    btn.title = temZona ? TITLE_ATIVO : TITLE_SEM_ZONA;
  }

  window.__sigcPro.mountWidget({
    id: BUTTON_ID,
    // dtToolbar() is the ".dt-buttons" bar, the same anchor csv-export
    // uses. onListaEnderecos is a direct __sigcPro export, NOT on ctx.
    anchor: (ctx) => ctx.dtToolbar(),
    // when is re-evaluated on EVERY shared-observer tick (tickMount in
    // sigc-common.js) — this module owns no MutationObserver of its own.
    // That makes it the right place to also refresh the button's
    // disabled/title state, as a side effect, since tickMount only calls
    // build() once (on insert) and never again while the button exists.
    when: (ctx) => {
      const ok = window.__sigcPro.onListaEnderecos() && !!ctx.dtToolbar();
      if (ok) atualizarEstadoBotao();
      return ok;
    },
    build: () => {
      ensureStyle();
      console.log(`${TAG} Agenda button added.`);
      const btn = window.__sigcPro.makeDtProButton({
        id: BUTTON_ID,
        lines: ['AGENDA', 'PRO'],
        title: TITLE_ATIVO,
        onClick: (e) => anotar(e.currentTarget),
      });
      return btn;
    },
  });
})();
