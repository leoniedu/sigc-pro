// SIGC-PRO feature: "Guia do Dia" — downloads a self-contained HTML day
// guide from the Agenda's Dia view. Every reserved household carries ONE
// number for the whole day (dayNumberMap, time order), the same on its
// Resumo card, its team-tab card, its Lab row and its map dot: the guide
// exists so a logistics manager can compose a single route mixing teams
// and hand each team a print-out without ambiguity. Resumo tab: 4 day
// stats + the full numbered household list (each card with route
// checkbox) + the day map. One tab per equipe with the same cards. A
// "Lab" tab lists the day the way the laboratory's own system does: nº,
// hora, nome, município, zona — no Controle, no Domicílio, no birth
// date — print it to share. Data comes exclusively from
// window.__sigcPro.readAgendaSlots() (already-rendered FullCalendar DOM,
// no network); the file itself is inline-CSS-only with CSS radio tabs and
// an inline route-selector script for live Google Maps link updates — no
// external refs — so it opens anywhere from file:// and Ctrl+P on a tab
// prints that team's guide. Dia view only: the button is
// inserted/removed by the shared mountWidget observer (sigc-common.js) as
// the active view toggles.
// Spec: docs/superpowers/specs/2026-07-16-agenda-day-guide-design.md
(function () {
  'use strict';

  const TAG = '[sigc-agenda-day-guide]';

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
  // time-sorted, so first/last reserved row = primeiro/último. `zonas`
  // is the distinct real zonas of the reserved rows — the agenda's own
  // unit, unlike the controle the stats used to count — and is null
  // (unknown, not zero) when the endereços lookup never ran: the
  // declined-consulta guide must say "—", not claim "0 zonas".
  function computeStats(rows, enderecos) {
    const reservados = rows.filter((r) => r.reservado);
    const primeiro = reservados[0] || null;
    const ultimo = reservados[reservados.length - 1] || null;
    const zonas = enderecos
      ? [...new Set(reservados.map((r) => zonaLabel(slotInfo(r, enderecos))).filter(Boolean))]
      : null;
    return {
      reservados: reservados.length,
      primeiro: primeiro ? { hora: primeiro.horaInicio, equipe: primeiro.equipe } : null,
      ultimo: ultimo ? { hora: ultimo.horaInicio, equipe: ultimo.equipe } : null,
      zonas,
    };
  }

  // One-decimal pt-BR average ("1,5"), or null when the denominator is 0.
  function media1(num, den) {
    return den > 0 ? (num / den).toFixed(1).replace('.', ',') : null;
  }

  // --- endereços data: geo links, Google Maps route, real zona -------
  // All optional: every builder below is a no-op when enderecos is null,
  // keeping the plain Guia do Dia byte-identical. Entries are
  // { lat, lon, zona }; lat/lon may be null (household without valid
  // coordinates), so map/route builders check lat before using them.

  const enderecoKey = (r) => window.__sigcPro.enderecoKey(r);
  const slotInfo = (r, enderecos) => window.__sigcPro.routeMap.slotInfo(r, enderecos);

  // The "ID Zona" column alone ("29OU7L" — UF code plus an opaque token),
  // never with "Nome ZONA" appended: the ID is what identifies the zona
  // across SIGC and the coordination's own reporting, so the nome only
  // lengthens every label.
  //
  // Note these are the Lista de Endereços columns 18/19, NOT the dotted
  // codes in a slot's own Zonas text ("29.3.03.03 29_Linus_Pituba") that
  // agenda-slot-checks.js parses — different field, different format.
  //
  // Every zona in SIGC has an ID, so there is no nome-only fallback: a
  // row reaching here without one has no zona columns filled at all
  // (see agenda-lookups.js — coordinates alone are enough for an entry).
  function zonaLabel(info) {
    return info ? (info.idZona || '') : '';
  }

  // Card-facing variant of zonaLabel: ID plus nome when both are present,
  // same no-nome-only-fallback rule (a row with no idZona renders blank
  // even if it somehow carries a nome). Used by buildSlotCard — never by
  // buildLabList, which stays ID-only (list cells are space-constrained).
  function zonaFullLabel(info) {
    const id = zonaLabel(info);
    if (!id) return '';
    const nome = info && info.zona ? String(info.zona).trim() : '';
    return nome ? `${id} ${nome}` : id;
  }

  function fmtCoord(p) {
    return `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
  }

  function gmapsRouteUrl(points) {
    const way = points.slice(0, -1).map(fmtCoord).join('|');
    const dest = fmtCoord(points[points.length - 1]);
    return 'https://www.google.com/maps/dir/?api=1&travelmode=driving' +
      (way ? `&waypoints=${encodeURIComponent(way)}` : '') +
      `&destination=${encodeURIComponent(dest)}`;
  }

  // Short label ("HH:MM Nome-or-Controle") for routeCheckboxInput's
  // data-name attribute.
  function routeStopLabel(r) {
    return `${r.horaInicio} ${r.nome || r.controle}`;
  }

  // Builds the bare checkbox <input> for a RESERVED row. Routable rows
  // (info has lat/lon) get an enabled checkbox with data-lat/lon/name,
  // seeded from `checked`; non-routable rows get a permanently disabled,
  // unchecked <input> with no data-* attributes. Used only by
  // buildSlotCard — the Resumo and team lists are the same cards, so the
  // data-* attribute shape and escaping exist in exactly one place.
  function routeCheckboxInput(r, info, groupId, checked, idx) {
    const e = escapeHtml;
    if (info && info.lat != null) {
      const checkedAttr = checked ? ' checked' : '';
      const idxAttr = idx != null ? ` data-idx="${idx}"` : '';
      return `<input type="checkbox" class="route-chk" data-group="${e(groupId)}" ` +
        `data-lat="${info.lat.toFixed(6)}" data-lon="${info.lon.toFixed(6)}" ` +
        `data-name="${e(routeStopLabel(r))}"${idxAttr}${checkedAttr}>`;
    }
    return '<input type="checkbox" disabled>';
  }

  // --- SVG day-route map ----------------------------------------------
  // Extracted to route-map.js (2026-08-10) — pure projection geometry
  // and SVG string building, with no dependency on the document
  // assembly below. Bound here so the call sites read unchanged;
  // manifest load order guarantees route-map.js ran first.
  const {
    STOP_COLOR, dayNumberMap, routeIdxMap, buildRouteMapSvg,
  } = window.__sigcPro.routeMap;


  // --- HTML builders ------------------------------------------------

  const escapeHtml = (s) => window.__sigcPro.escapeHtml(s);

  // Stats/list table styles, shared by the full guide and the lab page.
  const TABLE_CSS = `table.stats { border-collapse: collapse; margin: .6rem 0; }
table.stats th, table.stats td { border: 1px solid #d0d7de; padding: .25rem .6rem; text-align: left; font-size: .92rem; }
table.lab-list .lab-num { font-weight: 700; text-align: center; }
table.lab-list .lab-hora { font-weight: 600; }
table.lab-list .lab-municipio { color: #555; text-transform: uppercase; font-size: .85em; }
table.lab-list .lab-zona { color: #555; font-size: .85em; }`;

  function metaLine(meta) {
    const e = escapeHtml;
    return [e(meta.uf), meta.dataBr ? `${e(meta.dataBr)} (${e(meta.diaSemana)})` : '',
      `gerado em ${e(meta.geradoEm)}`].filter(Boolean).join(' · ');
  }

  // One card per slot: reserved visits only (buildTeamPanel filters to
  // reservado rows before calling this). The !r.reservado (LIVRE) branch
  // is retained for generality — buildSlotCard can still render open
  // slots standalone if called directly — but is not exercised by
  // buildTeamPanel's current usage. Reserved cards show only the real zona
  // from the endereços fetch, when available — never the inflated slot-text
  // list. Missing fields (already normalized to '' by readAgendaSlots) are
  // omitted line by line — a sparse card never breaks.
  function buildSlotCard(r, enderecos, dayNums, routeGroupId, checked, idx) {
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
    const info = slotInfo(r, enderecos);
    const zona = zonaFullLabel(info);
    const ids = [
      r.telefone && `Tel: ${e(r.telefone)}`,
      info && info.agencia && `Agência: ${e(info.agencia)}`,
      r.controle && `Controle: ${e(r.controle)}`,
      r.domicilio && `Dom: ${e(r.domicilio)}`,
      zona && `Zona: ${e(zona)}`,
      info && info.entrevistador && `Entrevistador: ${e(info.entrevistador)}`,
    ].filter(Boolean).join(' &nbsp;·&nbsp; ');
    // The household's single number for the whole day (dayNumberMap) —
    // identical on the Resumo card, the team card, the Lab row and the
    // map dot, so a route composed across teams can be read out by
    // number. Rendered even for coordinate-less visits: the number
    // identifies the household in the lists whether or not it has a dot.
    const num = dayNums && dayNums.get(enderecoKey(r));
    const numBadge = num != null
      ? `<span class="badge badge-seq">${num}</span> ` : '';
    // The equipe, prominent on every card: the map and the numbers no
    // longer distinguish teams, and the manager composing a cross-team
    // route needs to see at a glance whose slot each household is.
    const equipeBadge = r.equipe
      ? ` <span class="badge badge-equipe">${e(r.equipe)}</span>` : '';
    const chk = `${routeCheckboxInput(r, info, routeGroupId, checked, idx)} `;

    return [
      '<div class="card">',
      `<div class="hora">${chk}${numBadge}${hora}${equipeBadge} <span class="badge">RESERVADO</span></div>`,
      r.endereco ? `<div class="endereco">${e(r.endereco)}</div>` : '',
      info && info.lat != null
        // Same Google Maps driving-directions link the Rota row uses
        // (gmapsRouteUrl degrades to a plain destination pin for one
        // point) — geo: links don't reliably open on desktop Chrome,
        // where field users read this guide.
        ? `<div class="geo"><a href="${e(gmapsRouteUrl([info]))}">abrir no mapa</a></div>` : '',
      morador,
      ids ? `<div class="ids">${ids}</div>` : '',
      r.observacao ? `<div class="obs">Obs: ${e(r.observacao)}</div>` : '',
      '</div>',
    ].filter(Boolean).join('\n');
  }

  function buildTeamPanel(group, enderecos, teamIndex, dayNums) {
    const e = escapeHtml;
    const s = computeStats(group.rows, enderecos);
    // Same stat set as the Resumo table, per team: primeiro, último,
    // zonas distintas, média por zona. Zona bits are simply omitted when
    // the endereços lookup never ran (s.zonas null) — an inline "—"
    // would read as a value.
    const mediaZona = s.zonas ? media1(s.reservados, s.zonas.length) : null;
    const statBits = [
      s.primeiro ? `primeiro ${e(s.primeiro.hora)}` : null,
      s.ultimo ? `último ${e(s.ultimo.hora)}` : null,
      s.zonas && s.zonas.length ? `${s.zonas.length} zona(s) distinta(s)` : null,
      mediaZona != null ? `${mediaZona} agendamento(s) por zona` : null,
    ].filter(Boolean).join(' &nbsp;·&nbsp; ');
    // Routable count decides the default: <=9 -> all checked (matches
    // the original auto-route), >9 -> none checked (chunking is gone, the
    // user must pick their own <=9 stops). Non-routable rows never count
    // toward this and always render a disabled checkbox on their card.
    const routableCount = group.rows.filter((r) => {
      if (!r.reservado) return false;
      const info = slotInfo(r, enderecos);
      return info && info.lat != null;
    }).length;
    const routeGroupId = `team-${teamIndex}`;
    const defaultChecked = routableCount <= 9;
    const idxMap = routeIdxMap([{ rows: group.rows }], enderecos);
    // Only reserved visits render as cards — open (LIVRE) slots are not
    // shown at all, per design decision 2026-08-06.
    const cards = group.rows.filter((r) => r.reservado).map((r) =>
      buildSlotCard(r, enderecos, dayNums, routeGroupId, defaultChecked, idxMap.get(enderecoKey(r)))
    );
    const teamMap = enderecos
      ? buildRouteMapSvg(
          [{ rows: group.rows.filter((r) => r.reservado), color: STOP_COLOR }],
          enderecos, 480, 320, routeGroupId, dayNums
        )
      : '';
    // Bare link placeholder (no checkbox list — checkboxes now live on
    // each card above). Sits right before the SVG map so the live link
    // and the visual route it feeds are next to each other.
    const rotaLink = `<div class="rota-link" id="rota-link-${e(routeGroupId)}"></div>`;
    return [
      `<h2>${e(group.equipe)}</h2>`,
      `<div class="teamstats">${statBits}</div>`,
      ...cards,
      rotaLink,
      teamMap,
    ].filter(Boolean).join('\n');
  }

  function buildSummaryPanel(allRows, lab, enderecos, dayNums) {
    const e = escapeHtml;
    const day = computeStats(allRows, enderecos);
    const titulo = lab
      ? 'Resumo do dia — Lab (nome e município, sem Controle nem domicílio)'
      : 'Resumo do dia';
    // Four stats only — what the logistics manager acts on. Counts of
    // equipes/slots/ocupação belonged to a capacity view this guide no
    // longer is; zonas replace controles because the zona is the
    // agenda's own unit. "—" for the zona stats means UNKNOWN (endereços
    // lookup declined/failed), never zero.
    const linhas = [
      ['Primeiro agendamento', day.primeiro ? `${day.primeiro.hora} — ${day.primeiro.equipe}` : '—'],
      ['Último agendamento', day.ultimo ? `${day.ultimo.hora} — ${day.ultimo.equipe}` : '—'],
      ['Zonas distintas', day.zonas ? String(day.zonas.length) : '—'],
      ['Média de agendamentos por zona',
        day.zonas ? (media1(day.reservados, day.zonas.length) ?? '—') : '—'],
    ].map(([k, v]) => `<tr><th>${e(k)}</th><td>${e(v)}</td></tr>`).join('\n');
    if (lab) {
      // The shareable, privacy-stripped view: same stats, then the
      // numbered lab-safe list. Never a map, never route checkboxes —
      // see spec Placement.
      return [
        `<h2>${e(titulo)}</h2>`,
        `<table class="stats">\n${linhas}\n</table>`,
        buildLabList(allRows, enderecos, dayNums),
      ].filter(Boolean).join('\n');
    }
    // The day's households, one full card each, in day (time) order
    // across teams — the same cards the team tabs show, each carrying
    // its day number and equipe. Always starts unchecked: the day route
    // is an intentional, opt-in selection, unlike a single team's
    // default-all-checked rule in buildTeamPanel. The SAME reserved-only
    // rowSet feeds routeIdxMap and buildRouteMapSvg, which is what keeps
    // a checkbox's data-idx joined to its dot's.
    const reservados = allRows.filter((r) => r.reservado);
    const rowSet = [{ rows: reservados, color: STOP_COLOR }];
    const idxMap = routeIdxMap(rowSet, enderecos);
    const cards = reservados.map((r) =>
      buildSlotCard(r, enderecos, dayNums, 'resumo', false, idxMap.get(enderecoKey(r))));
    const rotaSection = cards.length
      ? ['<h3>Rota do dia</h3>', ...cards, '<div class="rota-link" id="rota-link-resumo"></div>'].join('\n')
      : '';
    const routeMap = enderecos
      ? [
          '<h3>Mapa do dia</h3>',
          buildRouteMapSvg(rowSet, enderecos, 640, 420, 'resumo', dayNums),
        ].join('\n')
      : '';
    return [
      `<h2>${e(titulo)}</h2>`,
      `<table class="stats">\n${linhas}\n</table>`,
      rotaSection,
      routeMap,
    ].filter(Boolean).join('\n');
  }

  // The Lab tab's list: one numbered row per reserved visit, in day
  // order. SANCTIONED FIELDS — nº, hora, nome, município, zona — and
  // nothing else; no Controle, no Domicílio, no birth date, no
  // telefone/endereço/observação. Município comes from the Controle's
  // first 7 digits (the IBGE código), never from personal data; zona is
  // here by an explicit decision (the lab needs the area to plan
  // routes), accepting that it narrows location below município level.
  // The nº is the household's day number, so the lab and the field talk
  // about "o 7" and mean the same visit.
  //
  // This is the artifact designed to LEAVE the institution. Adding a
  // field here is a privacy decision, not a formatting one: argue it in
  // the commit message, and update the whitelist in
  // tests/agenda-day-guide-lab-list.test.js, which fails until that
  // list is edited. See ROADMAP.md.
  function buildLabList(allRows, enderecos, dayNums) {
    const e = escapeHtml;
    const reservados = allRows.filter((r) => r.reservado);
    if (!reservados.length) return '';
    const head = '<tr><th>Nº</th><th>Hora</th><th>Nome</th><th>Município</th><th>Zona</th></tr>';
    const body = reservados.map((r) => {
      const num = dayNums && dayNums.get(enderecoKey(r));
      const municipio = window.__sigcPro.municipioFromControle(r.controle);
      const zona = zonaLabel(slotInfo(r, enderecos));
      return `<tr><td class="lab-num">${num != null ? num : ''}</td>` +
        `<td class="lab-hora">${e(r.horaInicio)}</td>` +
        `<td class="lab-nome">${e(r.nome) || '—'}</td>` +
        `<td class="lab-municipio">${e(municipio)}</td>` +
        `<td class="lab-zona">${e(zona)}</td></tr>`;
    }).join('\n');
    return `<table class="stats lab-list">\n${head}\n${body}\n</table>`;
  }

  // Complete standalone document. Tabs are CSS-only: one hidden radio per
  // tab as direct children of <main>, so #tab-i:checked ~ #panel-i works;
  // @media print hides the tab bar and prints only the checked panel.
  function buildGuideHtml(meta, groups, allRows, enderecos) {
    const e = escapeHtml;
    // ONE numbering for the whole document, computed here and threaded
    // to every panel: allRows is the day in time order (readAgendaSlots
    // sorts by isoDate, horaInicio, equipe), so the numbers read as the
    // day's chronology on every tab.
    const dayNums = dayNumberMap(allRows);
    // The Lab tab repeats the Resumo in the shape the laboratory's own
    // system uses (nome + município, no Controle, no Domicílio, no birth
    // date) — Ctrl+P on it prints just that page for the laboratory.
    const panels = [
      { label: 'Resumo', html: buildSummaryPanel(allRows, false, enderecos, dayNums) },
      { label: 'Lab', html: buildSummaryPanel(allRows, true, enderecos, dayNums) },
      ...groups.map((g, i) => ({ label: g.equipe, html: buildTeamPanel(g, enderecos, i, dayNums) })),
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
.card .hora .route-chk { margin-right: .4rem; font-weight: normal; }
.badge { background: #005a9c; color: #fff; border-radius: 3px; font-size: .7rem; padding: .1rem .4rem; vertical-align: middle; }
.badge-equipe { background: #444; }
.endereco { font-size: 1.05rem; font-weight: 600; margin: .15rem 0; }
.morador, .ids, .zonas, .obs { font-size: .92rem; margin-top: .1rem; }
.ids, .zonas { color: #555; }
.card.livre { border-style: dashed; background: #fafafa; }
.badge-livre { background: #8a8f98; }
.badge-seq { border-radius: 50%; width: 1.3em; height: 1.3em; display: inline-flex; align-items: center; justify-content: center; padding: 0; font-weight: 700; }
.livre-edge { color: #666; border: 1px dashed #bbb; border-radius: 6px; padding: .25rem .8rem; margin: .5rem 0; font-size: .9rem; }
a { color: #005a9c; }
.geo, .rota { font-size: .92rem; margin-top: .1rem; }
.rota-link { margin-top: .4rem; font-size: .92rem; }
.teamstats { color: #333; margin: .2rem 0 .4rem; font-size: .92rem; }
.route-map { margin: .6rem 0; page-break-inside: avoid; }
.route-map-missing { color: #666; font-size: .85rem; margin-top: .3rem; }
.route-stop-dim { opacity: .35; }
${TABLE_CSS}
${tabRules}
@media print { .tabs { display: none; } }
</style>
</head>
<body>
<header>
<h1>SIGC-PRO — Guia do Dia</h1>
<div class="meta">${metaLine(meta)}</div>
</header>
<main>
${radios}
<div class="tabs">
${labels}
</div>
${sections}
</main>
<script>
(function () {
  'use strict';
  // Matches the build-time default-checked threshold (buildTeamPanel's
  // routableCount <= 9) — the cap on how many stops one route link covers.
  var MAX_STOPS = 9;
  // Standalone copy of gmapsRouteUrl's URL shape — the generated file has
  // no access to the extension's build-time closures, so this is an
  // intentional duplicate (spec: gmapsRouteUrl duplication). Keeps the
  // per-visit static "abrir no mapa" pins untouched at build time.
  function buildGmapsUrl(stops) {
    var fmt = function (s) { return s.lat.toFixed(6) + ',' + s.lon.toFixed(6); };
    var way = stops.slice(0, -1).map(fmt).join('|');
    var dest = fmt(stops[stops.length - 1]);
    return 'https://www.google.com/maps/dir/?api=1&travelmode=driving' +
      (way ? '&waypoints=' + encodeURIComponent(way) : '') +
      '&destination=' + encodeURIComponent(dest);
  }

  function refreshGroup(groupId) {
    var boxes = document.querySelectorAll('.route-chk[data-group="' + groupId + '"]');
    var checked = [];
    boxes.forEach(function (b) { if (b.checked) checked.push(b); });
    // Cap enforcement: at MAX_STOPS checked, disable the rest; below it, re-enable.
    boxes.forEach(function (b) {
      if (!b.checked) b.disabled = checked.length >= MAX_STOPS;
    });

    // Map redraw: dim unchecked stops, rebuild the line from checked ones
    // in data-idx order (already time order). Runs regardless of the
    // link's own visibility rule below — the map has no "hidden below 2"
    // state of its own for dots, only for the line. Scoped to this
    // group's own <svg> (found via its uniquely-id'd polyline) since
    // data-idx values are only unique within one map, not document-wide.
    var line = document.getElementById('route-line-' + groupId);
    var svg = line ? line.closest('svg') : null;
    if (svg) {
      var checkedIdx = new Set(checked.map(function (b) { return b.dataset.idx; }));
      var stopGs = svg.querySelectorAll('g[data-idx]');
      var checkedGs = [];
      stopGs.forEach(function (g) {
        if (checkedIdx.has(g.dataset.idx)) {
          g.classList.remove('route-stop-dim');
          checkedGs.push(g);
        } else {
          g.classList.add('route-stop-dim');
        }
      });
      if (checkedGs.length >= 2) {
        checkedGs.sort(function (a, b) { return Number(a.dataset.idx) - Number(b.dataset.idx); });
        var points = checkedGs.map(function (g) {
          return g.dataset.x + ',' + g.dataset.y;
        }).join(' ');
        line.setAttribute('points', points);
        line.style.display = '';
      } else {
        line.style.display = 'none';
      }
    }

    var link = document.getElementById('rota-link-' + groupId);
    if (!link) return;
    if (checked.length < 2) {
      link.innerHTML = '';
      return;
    }
    var stops = checked.map(function (b) {
      return { lat: parseFloat(b.dataset.lat), lon: parseFloat(b.dataset.lon) };
    });
    var url = buildGmapsUrl(stops);
    link.innerHTML = '<a href="' + url.replace(/"/g, '&quot;') + '">Google Maps</a>';
  }

  document.addEventListener('change', function (ev) {
    if (!ev.target.classList || !ev.target.classList.contains('route-chk')) return;
    refreshGroup(ev.target.dataset.group);
  });

  // Initial paint: every group present in the document gets its link
  // computed once on load, matching whatever defaultAllChecked produced.
  var groups = new Set();
  document.querySelectorAll('.route-chk[data-group]').forEach(function (b) {
    groups.add(b.dataset.group);
  });
  groups.forEach(refreshGroup);
})();
</script>
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
    const uf = window.__sigcPro.getAgendaUf().name;
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

  // Shared click-time guards; returns null (after alerting) when the
  // guide can't be generated.
  function readDayRows() {
    // Never expected: the button only exists in Dia view. Kept as a
    // fallback in case a click lands mid view-switch.
    if (!diaViewActive()) {
      alert('SIGC-PRO: mude para a visualização "Dia" para gerar o Guia do Dia.');
      return null;
    }
    const rows = window.__sigcPro.readAgendaSlots();
    if (rows.length === 0) {
      alert('SIGC-PRO: nenhum slot encontrado na agenda — confira se UF/dia já carregaram.');
      return null;
    }
    return rows;
  }

  function generate(enderecos) {
    const rows = readDayRows();
    if (!rows) return;
    const groups = groupByEquipe(rows);
    const meta = guideMeta(rows);
    const html = buildGuideHtml(meta, groups, rows, enderecos || null);
    window.__sigcPro.downloadFile(fileName(meta), html, 'text/html;charset=utf-8');
    console.log(`${TAG} guide exported: ${groups.length} equipe(s), ${rows.length} slot(s).`);
  }

  // Exposed only for tests — not part of the runtime public surface.
  window.__sigcProAgendaDayGuideInternals = { zonaFullLabel };

  // Consumed by agenda-lookups, which owns the only guide button: it calls
  // generate(enderecos) after its fetch, or generate(null) when there is
  // nothing to fetch, the fetch fails, or the user declines the consulta.
  // generate(null) is therefore still a live path — the map-free guide —
  // even though no button reaches it directly anymore.
  window.__sigcPro.dayGuide = { generate, diaViewActive, buildTeamPanel, buildSummaryPanel, buildGuideHtml, routeCheckboxInput, buildSlotCard, buildLabList, routeIdxMap, buildRouteMapSvg, dayNumberMap };

  // No button of its own: this module renders the guide, agenda-lookups mounts
  // the single "Guia do Dia" button that drives it. Two buttons differing
  // only by whether they made the consulta was clutter — declining the
  // prompt now yields the same map-free guide the second button did.
  // diaViewActive is exported above so agenda-lookups can reuse the Dia-only
  // gating this module defines.
})();
