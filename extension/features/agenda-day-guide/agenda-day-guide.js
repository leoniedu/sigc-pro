// SIGC-PRO feature: "Guia do Dia" — downloads a self-contained HTML day
// guide from the Agenda's Dia view: a Resumo tab (day stats) plus one tab
// per equipe with a card per slot (reserved: endereço/morador/telefone/
// Controle/observação; open: LIVRE row). Data comes exclusively from
// window.__sigcPro.readAgendaSlots() (already-rendered FullCalendar DOM,
// no network); the file itself is inline-CSS-only with CSS radio tabs —
// no <script>, no external refs — so it opens anywhere from file:// and
// Ctrl+P on a tab prints that team's guide. Dia view only: the button is
// inserted/removed by the MutationObserver as the active view toggles.
// Spec: docs/superpowers/specs/2026-07-16-agenda-day-guide-design.md
(function () {
  'use strict';

  const TAG = '[sigc-agenda-day-guide]';
  const BUTTON_ID = 'sigc-pro-agenda-guia-button';

  // --- pure data helpers -------------------------------------------

  // rows (readAgendaSlots order) -> [{ equipe, rows }], teams sorted by
  // name, each team's rows kept in time order.
  function groupByEquipe(rows) {
    const map = new Map();
    rows.forEach((r) => {
      const k = r.equipe || '(sem equipe)';
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(r);
    });
    return [...map.keys()].sort().map((equipe) => ({ equipe, rows: map.get(equipe) }));
  }

  // Stat block for any row set (whole day or one team). Rows arrive
  // time-sorted, so first/last reserved row = primeiro/último.
  function computeStats(rows) {
    const reservados = rows.filter((r) => r.reservado);
    const total = rows.length;
    const primeiro = reservados[0] || null;
    const ultimo = reservados[reservados.length - 1] || null;
    const controles = [...new Set(reservados.map((r) => r.controle).filter(Boolean))];
    return {
      total,
      reservados: reservados.length,
      livres: total - reservados.length,
      ocupacaoPct: total > 0 ? Math.round((100 * reservados.length) / total) : null,
      primeiro: primeiro ? { hora: primeiro.horaInicio, equipe: primeiro.equipe } : null,
      ultimo: ultimo ? { hora: ultimo.horaInicio, equipe: ultimo.equipe } : null,
      controles,
    };
  }

  // Distinct comma-separated zona entries across rows, first-seen order.
  function zonasUnion(rows) {
    const set = new Set();
    rows.forEach((r) => String(r.zonas || '').split(',').map((s) => s.trim())
      .filter(Boolean).forEach((z) => set.add(z)));
    return [...set];
  }

  // One-decimal pt-BR average ("1,5"), or null when the denominator is 0.
  function media1(num, den) {
    return den > 0 ? (num / den).toFixed(1).replace('.', ',') : null;
  }

  // --- coordinates: geo links, Google Maps route, GPX ---------------
  // All optional: every builder below is a no-op when coords is null,
  // keeping the plain Guia do Dia byte-identical.

  function escapeXml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  }

  function coordKey(r) {
    return `${r.controle}|${r.domicilio}`;
  }

  function slotCoord(r, coords) {
    return (r.reservado && coords && coords.get(coordKey(r))) || null;
  }

  function fmtCoord(p) {
    return `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
  }

  // Splits a day into Google-Maps-sized legs (max 10 stops = 9 waypoints
  // + destination; origin omitted = the device's current location).
  // Consecutive legs share their boundary stop so navigation is seamless.
  function chunkRoute(points, maxStops) {
    const max = maxStops || 10;
    if (points.length <= max) return [points];
    const chunks = [];
    let start = 0;
    while (start < points.length - 1) {
      const end = Math.min(start + max, points.length);
      chunks.push(points.slice(start, end));
      if (end >= points.length) break;
      start = end - 1;
    }
    return chunks;
  }

  function gmapsRouteUrl(points) {
    const way = points.slice(0, -1).map(fmtCoord).join('|');
    const dest = fmtCoord(points[points.length - 1]);
    return 'https://www.google.com/maps/dir/?api=1&travelmode=driving' +
      (way ? `&waypoints=${encodeURIComponent(way)}` : '') +
      `&destination=${encodeURIComponent(dest)}`;
  }

  function buildGpx(points) {
    const wpts = points.map((p) =>
      `  <wpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}"><name>${escapeXml(p.name)}</name></wpt>`);
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<gpx version="1.1" creator="SIGC-PRO" xmlns="http://www.topografix.com/GPX/1/1">',
      ...wpts,
      '</gpx>',
    ].join('\n');
  }

  function gpxDataUri(gpx) {
    return 'data:application/gpx+xml;charset=utf-8,' + encodeURIComponent(gpx);
  }

  // --- HTML builders ------------------------------------------------

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Leading/trailing open slots: real information (the day could start
  // earlier / run later) but not route gaps — kept low-key as a slim
  // row, zonas inline since that's what matters while the slot can
  // still be filled.
  function buildLivreEdgeRow(r) {
    const e = escapeHtml;
    const zonas = r.zonas ? ` — Zonas: ${e(r.zonas)}` : '';
    return `<div class="livre-edge">${e(r.horaInicio)}–${e(r.horaFim)} — LIVRE${zonas}</div>`;
  }

  // One card per slot at full visual weight: reserved visits, and open
  // slots BETWEEN visits — a mid-day gap is route information (where a
  // callback or re-visit fits) and must not be overlooked. Open cards
  // show their zonas (useful while the slot can still be filled);
  // reserved cards don't (the visit already has an address). Missing
  // fields (already normalized to '' by readAgendaSlots) are omitted
  // line by line — a sparse card never breaks.
  function buildSlotCard(r, coords) {
    const e = escapeHtml;
    const hora = `${e(r.horaInicio)}–${e(r.horaFim)}`;
    if (!r.reservado) {
      return [
        '<div class="card livre">',
        `<div class="hora">${hora} <span class="badge badge-livre">LIVRE</span></div>`,
        r.zonas ? `<div class="zonas">Zonas: ${e(r.zonas)}</div>` : '',
        '</div>',
      ].filter(Boolean).join('\n');
    }

    const detalhes = [r.sexo && e(r.sexo), r.idade && `${e(r.idade)} anos`]
      .filter(Boolean).join(', ');
    const nasc = r.dtNascimento ? `(${e(r.dtNascimento)})` : '';
    const partes = [
      r.nome ? `<strong>${e(r.nome)}</strong>` : '',
      [detalhes, nasc].filter(Boolean).join(' '),
    ].filter(Boolean);
    const morador = partes.length
      ? `<div class="morador">${partes.join(' — ')}</div>`
      : '';
    const ids = [
      r.telefone && `Tel: ${e(r.telefone)}`,
      r.controle && `Controle: ${e(r.controle)}`,
      r.domicilio && `Dom: ${e(r.domicilio)}`,
    ].filter(Boolean).join(' &nbsp;·&nbsp; ');

    return [
      '<div class="card">',
      `<div class="hora">${hora} <span class="badge">RESERVADO</span></div>`,
      r.endereco ? `<div class="endereco">${e(r.endereco)}</div>` : '',
      (() => { const p = slotCoord(r, coords);
        return p ? `<div class="geo"><a href="geo:${fmtCoord(p)}">abrir no mapa</a></div>` : ''; })(),
      morador,
      ids ? `<div class="ids">${ids}</div>` : '',
      r.observacao ? `<div class="obs">Obs: ${e(r.observacao)}</div>` : '',
      '</div>',
    ].filter(Boolean).join('\n');
  }

  function buildTeamPanel(group, coords) {
    const e = escapeHtml;
    const s = computeStats(group.rows);
    const zonas = zonasUnion(group.rows);
    const statBits = [
      `${s.reservados} reservado(s) × ${s.livres} livre(s)`,
      s.ocupacaoPct != null ? `ocupação ${s.ocupacaoPct}%` : null,
      s.primeiro ? `primeiro ${e(s.primeiro.hora)}` : null,
      s.ultimo ? `último ${e(s.ultimo.hora)}` : null,
      s.controles.length ? `${s.controles.length} controle(s) distinto(s)` : null,
    ].filter(Boolean).join(' &nbsp;·&nbsp; ');
    // Open slots outside the reserved span (before the first visit,
    // after the last, or the whole day when nothing is reserved) render
    // as slim livre-edge rows; open slots between visits get full card
    // weight via buildSlotCard.
    const first = group.rows.findIndex((r) => r.reservado);
    const last = group.rows.length - 1 -
      [...group.rows].reverse().findIndex((r) => r.reservado);
    const cards = group.rows.map((r, i) => {
      const edge = first === -1 || i < first || i > last;
      return !r.reservado && edge ? buildLivreEdgeRow(r) : buildSlotCard(r, coords);
    });
    // Route links only when >= 2 reserved visits have coordinates.
    // Tapping the Google Maps link sends that leg's coordinates to
    // Google — a deliberate user action, never automatic.
    const stops = group.rows
      .filter((r) => r.reservado)
      .map((r) => {
        const p = slotCoord(r, coords);
        return p ? { lat: p.lat, lon: p.lon, name: `${r.horaInicio} ${r.nome || r.controle}` } : null;
      })
      .filter(Boolean);
    let rota = '';
    if (stops.length >= 2) {
      const legs = chunkRoute(stops, 10);
      const links = legs.map((leg, i) =>
        `<a href="${e(gmapsRouteUrl(leg))}">Google Maps${legs.length > 1 ? ` ${i + 1}` : ''}</a>`);
      links.push(
        `<a href="${e(gpxDataUri(buildGpx(stops)))}" download="rota-${e(window.__sigcPro.slug(group.equipe))}.gpx">GPX</a>`);
      rota = `<div class="rota">Rota: ${links.join(' &nbsp;·&nbsp; ')}</div>`;
    }
    return [
      `<h2>${e(group.equipe)}</h2>`,
      `<div class="teamstats">${statBits}</div>`,
      zonas.length ? `<div class="zonas">Zonas: ${zonas.map(e).join(', ')}</div>` : '',
      rota,
      ...cards,
    ].filter(Boolean).join('\n');
  }

  function buildSummaryPanel(groups, allRows) {
    const e = escapeHtml;
    const day = computeStats(allRows);
    const comReserva = groups.filter((g) => g.rows.some((r) => r.reservado)).length;
    const linhas = [
      ['Equipes ativas', String(groups.length)],
      ['Equipes com reserva', String(comReserva)],
      ['Agendamentos (reservados)', String(day.reservados)],
      ['Slots livres', String(day.livres)],
      ['Total de slots', String(day.total)],
      ['Taxa de ocupação', day.ocupacaoPct != null ? `${day.ocupacaoPct}%` : '—'],
      ['Primeiro agendamento', day.primeiro ? `${day.primeiro.hora} — ${day.primeiro.equipe}` : '—'],
      ['Último agendamento', day.ultimo ? `${day.ultimo.hora} — ${day.ultimo.equipe}` : '—'],
      ['Controles distintos', String(day.controles.length)],
      ['Média de agendamentos por equipe ativa', media1(day.reservados, groups.length) ?? '—'],
      ['Média de agendamentos por controle', media1(day.reservados, day.controles.length) ?? '—'],
    ].map(([k, v]) => `<tr><th>${e(k)}</th><td>${e(v)}</td></tr>`).join('\n');
    const porEquipe = groups.map((g) => {
      const s = computeStats(g.rows);
      const oc = s.ocupacaoPct != null ? `${s.ocupacaoPct}%` : '—';
      return `<tr><td>${e(g.equipe)}</td><td>${s.reservados}</td><td>${s.livres}</td><td>${oc}</td></tr>`;
    }).join('\n');
    return [
      '<h2>Resumo do dia</h2>',
      `<table class="stats">\n${linhas}\n</table>`,
      '<h3>Por equipe</h3>',
      '<table class="stats"><tr><th>Equipe</th><th>Reservados</th><th>Livres</th><th>Ocupação</th></tr>',
      porEquipe,
      '</table>',
    ].join('\n');
  }

  // Complete standalone document. Tabs are CSS-only: one hidden radio per
  // tab as direct children of <main>, so #tab-i:checked ~ #panel-i works;
  // @media print hides the tab bar and prints only the checked panel.
  function buildGuideHtml(meta, groups, allRows, coords) {
    const e = escapeHtml;
    const panels = [
      { label: 'Resumo', html: buildSummaryPanel(groups, allRows) },
      ...groups.map((g) => ({ label: g.equipe, html: buildTeamPanel(g, coords) })),
    ];
    const radios = panels.map((_, i) =>
      `<input type="radio" name="tab" id="tab-${i}"${i === 0 ? ' checked' : ''}>`).join('\n');
    const labels = panels.map((p, i) =>
      `<label for="tab-${i}">${e(p.label)}</label>`).join('\n');
    const sections = panels.map((p, i) =>
      `<section class="panel" id="panel-${i}">\n${p.html}\n</section>`).join('\n');
    const tabRules = panels.map((_, i) =>
      `#tab-${i}:checked ~ #panel-${i} { display: block; }\n` +
      `#tab-${i}:checked ~ .tabs label[for="tab-${i}"] { background: #005a9c; color: #fff; }`
    ).join('\n');

    return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SIGC-PRO — Guia do Dia — ${e(meta.dataBr)}</title>
<style>
body { margin: 0; font: 14px/1.45 -apple-system, "Segoe UI", Roboto, sans-serif; color: #1a1a1a; }
header { padding: 1rem 1.2rem .6rem; border-bottom: 2px solid #005a9c; }
header h1 { margin: 0; font-size: 1.3rem; color: #005a9c; }
header .meta { color: #555; font-size: .9rem; }
main { padding: 0 1.2rem 2rem; max-width: 52rem; }
input[type="radio"] { display: none; }
.tabs { display: flex; flex-wrap: wrap; gap: .3rem; margin: 1rem 0; }
.tabs label { border: 1px solid #005a9c; color: #005a9c; border-radius: 4px; padding: .3rem .7rem; cursor: pointer; font-size: .9rem; }
.panel { display: none; }
h2 { margin: .6rem 0 .2rem; font-size: 1.15rem; }
h3 { margin: .8rem 0 .2rem; font-size: 1rem; }
.card { border: 1px solid #d0d7de; border-radius: 6px; padding: .6rem .8rem; margin: .5rem 0; page-break-inside: avoid; }
.card .hora { font-weight: 600; }
.badge { background: #005a9c; color: #fff; border-radius: 3px; font-size: .7rem; padding: .1rem .4rem; vertical-align: middle; }
.endereco { font-size: 1.05rem; font-weight: 600; margin: .15rem 0; }
.morador, .ids, .zonas, .obs { font-size: .92rem; margin-top: .1rem; }
.ids, .zonas { color: #555; }
.card.livre { border-style: dashed; background: #fafafa; }
.badge-livre { background: #8a8f98; }
.livre-edge { color: #666; border: 1px dashed #bbb; border-radius: 6px; padding: .25rem .8rem; margin: .5rem 0; font-size: .9rem; }
a { color: #005a9c; }
.geo, .rota { font-size: .92rem; margin-top: .1rem; }
.teamstats { color: #333; margin: .2rem 0 .4rem; font-size: .92rem; }
table.stats { border-collapse: collapse; margin: .6rem 0; }
table.stats th, table.stats td { border: 1px solid #d0d7de; padding: .25rem .6rem; text-align: left; font-size: .92rem; }
${tabRules}
@media print { .tabs, .geo, .rota { display: none; } }
</style>
</head>
<body>
<header>
<h1>SIGC-PRO — Guia do Dia</h1>
<div class="meta">${[e(meta.uf), meta.dataBr ? `${e(meta.dataBr)} (${e(meta.diaSemana)})` : '', `gerado em ${e(meta.geradoEm)}`].filter(Boolean).join(' · ')}</div>
</header>
<main>
${radios}
<div class="tabs">
${labels}
</div>
${sections}
</main>
</body>
</html>
`;
  }

  // --- wiring ---------------------------------------------------------

  function diaViewActive() {
    return !!document.querySelector(
      '.fc-resourceTimeGridDay-button.fc-button-active, ' +
        '.fc-timeGridDay-button.fc-button-active'
    );
  }

  function guideMeta(rows) {
    const ufSelect = document.getElementById('selectUf');
    const uf = ufSelect && ufSelect.selectedIndex > 0
      ? ufSelect.options[ufSelect.selectedIndex].text.trim()
      : '';
    const isoDate = (rows.find((r) => r.isoDate) || {}).isoDate || '';
    // No isoDate on any row (unexpected) -> blank date AND blank weekday,
    // rather than showing today's weekday next to an empty date.
    const d = isoDate ? new Date(`${isoDate}T00:00:00`) : null;
    const { data, hora } = window.__sigcPro.timestampSlug();
    return {
      uf,
      dataBr: window.__sigcPro.isoToBr(isoDate),
      diaSemana: d ? window.__sigcPro.WEEKDAYS_PT[d.getDay()] : '',
      geradoEm: `${data} ${hora.slice(0, 2)}:${hora.slice(2, 4)}`,
    };
  }

  // sigc-pro-guia_<uf>_<dd-mm-aaaa do dia>_<data>_<hora>.html
  function fileName(meta) {
    const { data, hora } = window.__sigcPro.timestampSlug();
    const dia = meta.dataBr.replace(/\//g, '-');
    return ['sigc-pro-guia', window.__sigcPro.slug(meta.uf), dia, data, hora]
      .filter(Boolean).join('_') + '.html';
  }

  function generate(coords) {
    // Never expected: the button only exists in Dia view. Kept as a
    // fallback in case a click lands mid view-switch.
    if (!diaViewActive()) {
      alert('SIGC-PRO: mude para a visualização "Dia" para gerar o Guia do Dia.');
      return;
    }
    const rows = window.__sigcPro.readAgendaSlots();
    if (rows.length === 0) {
      alert('SIGC-PRO: nenhum slot encontrado na agenda — confira se UF/dia já carregaram.');
      return;
    }
    const groups = groupByEquipe(rows);
    const meta = guideMeta(rows);
    const html = buildGuideHtml(meta, groups, rows, coords || null);
    window.__sigcPro.downloadFile(fileName(meta), html, 'text/html;charset=utf-8');
    console.log(`${TAG} guide exported: ${groups.length} equipe(s), ${rows.length} slot(s).`);
  }

  function exportGuide() {
    generate(null);
  }

  function insertButton(chunk) {
    if (document.getElementById(BUTTON_ID)) return;
    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.type = 'button';
    btn.className = 'fc-button fc-button-primary';
    btn.textContent = 'Guia do Dia';
    btn.title = 'Baixar guia do dia por equipe (SIGC-PRO)';
    btn.style.background = '#005a9c';
    btn.style.borderColor = '#005a9c';
    btn.style.marginLeft = '4px';
    btn.addEventListener('click', exportGuide);
    chunk.appendChild(btn);
    console.log(`${TAG} Guia do Dia button added.`);
  }

  // Consumed by agenda-map ("Guia + Mapa"): same pipeline, plus coords.
  window.__sigcPro.dayGuide = { generate, diaViewActive };

  // Unlike the other agenda buttons, this one exists only while the Dia
  // view is active: each observer tick inserts or REMOVES it. attributes:
  // ['class'] is observed so the fc-button-active toggle itself fires a
  // tick even if the toolbar isn't re-rendered.
  window.__sigcPro.whenReadyGeneric(
    () => window.__sigcPro.onAgendaPage() && window.__sigcPro.findAgendaToolbarChunk(),
    () => {
      const tryUpdate = () => {
        const existing = document.getElementById(BUTTON_ID);
        const chunk = window.__sigcPro.findAgendaToolbarChunk();
        if (window.__sigcPro.onAgendaPage() && chunk && diaViewActive()) {
          if (!existing) insertButton(chunk);
        } else if (existing) {
          existing.remove();
        }
      };
      tryUpdate();
      new MutationObserver(tryUpdate).observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class'],
      });
    }
  );
})();
