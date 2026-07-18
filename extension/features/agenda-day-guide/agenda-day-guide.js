// SIGC-PRO feature: "Guia do Dia" — downloads a self-contained HTML day
// guide from the Agenda's Dia view: a Resumo tab (day stats + a time ×
// equipe slot grid with per-team totals) plus one tab
// per equipe with a card per slot (reserved: endereço/morador/telefone/
// Controle/observação; open: LIVRE row). A "Lab" tab repeats the Resumo
// in shareable form: Controle truncated to 11 digits, no Domicílio, no
// personal data — print it to share. Data comes exclusively from
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

  // Distinct zona entries across rows, first-seen order. Reserved slots
  // take their real zona from the endereços fetch when available — the
  // slot text lists every zona from slot creation, even though a filled
  // slot belongs to exactly one. Open slots keep the slot-text list
  // (they can still be filled from any of those zonas).
  function zonasUnion(rows, enderecos) {
    const set = new Set();
    rows.forEach((r) => {
      const real = zonaLabel(slotInfo(r, enderecos));
      if (real) {
        set.add(real);
        return;
      }
      window.__sigcPro.parseZonaEntries(r.zonas).forEach((z) => set.add(z));
    });
    return [...set];
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

  function enderecoKey(r) {
    return `${r.controle}|${r.domicilio}`;
  }

  function slotInfo(r, enderecos) {
    return (r.reservado && enderecos && enderecos.get(enderecoKey(r))) || null;
  }

  // "ID Zona Nome ZONA" (either alone when the other is missing) — the
  // same "código nome" shape the slot-text zonas use.
  function zonaLabel(info) {
    return info ? [info.idZona, info.zona].filter(Boolean).join(' ') : '';
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

  // --- SVG day-route map ----------------------------------------------
  // Spec: docs/superpowers/specs/2026-07-18-agenda-day-route-map-design.md

  // Fits `points` (lat/lon) into an SVG-pixel box of `width`x`height` with
  // `padding` on every side, using an equirectangular projection corrected
  // for longitude compression at this latitude: physical x is proportional
  // to lon * cos(meanLat), physical y to lat. A single point centers with a
  // small fixed default span (nothing to fit a scale to). Also returns a
  // friendly rounded scale-bar length (scaleBarKm) and its pixel width
  // (scaleBarPx) for the caller to draw.
  function projectPoints(points, width, height, padding) {
    const meanLat = points.reduce((s, p) => s + p.lat, 0) / points.length;
    const cosLat = Math.cos(meanLat * Math.PI / 180);
    // Physical-ish units: degrees, with longitude compressed by cosLat so
    // equal physical distances in lat and lon map to equal plot distances.
    const px = (p) => p.lon * cosLat;
    const py = (p) => p.lat;

    const innerW = width - 2 * padding;
    const innerH = height - 2 * padding;

    let minX, maxX, minY, maxY, spanX, spanY;
    if (points.length === 1) {
      // No spread to fit: center with a small fixed default span so the
      // single dot sits in the middle rather than at a degenerate corner.
      const DEFAULT_SPAN_DEG = 0.01; // ~1.1km of latitude, plenty for one dot
      const x0 = px(points[0]), y0 = py(points[0]);
      minX = x0 - DEFAULT_SPAN_DEG / 2; maxX = x0 + DEFAULT_SPAN_DEG / 2;
      minY = y0 - DEFAULT_SPAN_DEG / 2; maxY = y0 + DEFAULT_SPAN_DEG / 2;
    } else {
      const xs = points.map(px), ys = points.map(py);
      minX = Math.min(...xs); maxX = Math.max(...xs);
      minY = Math.min(...ys); maxY = Math.max(...ys);
    }
    spanX = maxX - minX || 1e-9;
    spanY = maxY - minY || 1e-9;

    // Preserve aspect ratio: scale by whichever axis is tighter, so the
    // sketch's shape isn't stretched to fill a non-matching viewport.
    const scale = Math.min(innerW / spanX, innerH / spanY);
    const usedW = spanX * scale, usedH = spanY * scale;
    const offX = padding + (innerW - usedW) / 2;
    const offY = padding + (innerH - usedH) / 2;

    const projected = points.map((p) => ({
      x: offX + (px(p) - minX) * scale,
      // y grows downward in SVG; lat grows northward, so flip.
      y: offY + (maxY - py(p)) * scale,
    }));

    // Scale bar: a friendly rounded real-world distance approximating a
    // fraction of the plotted span, converted back to pixels via the same
    // scale. 1 degree of latitude ~= 111.32 km.
    const KM_PER_DEG_LAT = 111.32;
    const spanKm = spanY * KM_PER_DEG_LAT;
    const targetKm = spanKm > 0 ? spanKm / 4 : 0.5;
    const NICE = [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 50, 100];
    const scaleBarKm = NICE.reduce((best, n) =>
      Math.abs(n - targetKm) < Math.abs(best - targetKm) ? n : best, NICE[0]);
    const scaleBarPx = (scaleBarKm / KM_PER_DEG_LAT) * scale;

    return { projected, scaleBarKm, scaleBarPx };
  }

  // Okabe-Ito colorblind-safe 8-color palette (same design system as
  // KML export's vermillion/sky-blue pair, extended to the full set here
  // since more than 2 teams need distinguishing on the combined map).
  const TEAM_COLORS = [
    '#E69F00', '#56B4E9', '#009E73', '#F0E442',
    '#0072B2', '#D55E00', '#CC79A7', '#000000',
  ];

  // equipeIndex: 0-based position of a team within groupByEquipe's
  // already-name-sorted output. Cycles past 8 teams.
  function teamColor(equipeIndex) {
    return TEAM_COLORS[equipeIndex % TEAM_COLORS.length];
  }

  // Name-or-controle fallback for a row's display label, used in the
  // coordinate-less note below the map.
  function stopLabel(r) {
    return r.nome || r.controle || '';
  }

  // rowSets: Array<{ rows: Array<row>, color: string }>, each already this
  // team's reserved rows in time order. Builds one shared projection across
  // ALL plottable points from every set (so a combined map's teams share
  // one coordinate frame), then draws each set's dots/line in its color,
  // each set numbered independently starting at 1. Rows whose slotInfo has
  // no usable lat/lon are excluded from plotting and listed in a single
  // combined coordinate-less note below the map (never silently dropped).
  function buildRouteMapSvg(rowSets, enderecos, width, height) {
    const PADDING = 28;
    const plottableSets = rowSets.map((set) => {
      const plottable = [];
      const missing = [];
      set.rows.forEach((r) => {
        const info = slotInfo(r, enderecos);
        if (info && info.lat != null) {
          plottable.push({ lat: info.lat, lon: info.lon, hora: r.horaInicio });
        } else {
          missing.push(r);
        }
      });
      return { plottable, missing, color: set.color };
    });

    const allPoints = plottableSets.flatMap((s) => s.plottable);
    if (allPoints.length === 0) return '';

    const { projected, scaleBarKm, scaleBarPx } = projectPoints(allPoints, width, height, PADDING);

    // Walk projected in the same flattened order to hand each set back its
    // own slice (projectPoints doesn't know about sets, only points).
    let cursor = 0;
    const svgParts = [];
    plottableSets.forEach((set) => {
      const pts = projected.slice(cursor, cursor + set.plottable.length);
      cursor += set.plottable.length;
      if (pts.length === 0) return;

      if (pts.length >= 2) {
        const line = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
        svgParts.push(
          `<polyline points="${line}" fill="none" stroke="${set.color}" stroke-width="1.5" opacity="0.7"/>`
        );
      }

      pts.forEach((p, i) => {
        const hora = set.plottable[i].hora;
        const seq = i + 1;
        svgParts.push(
          `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="9" fill="${set.color}" stroke="#fff" stroke-width="1.5"/>` +
          `<text x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" text-anchor="middle" dominant-baseline="central" ` +
            `font-size="9" font-weight="700" fill="#fff">${seq}</text>` +
          `<text x="${p.x.toFixed(1)}" y="${(p.y + 20).toFixed(1)}" text-anchor="middle" ` +
            `font-size="9" fill="#333">${escapeHtml(hora)}</text>`
        );
      });
    });

    // Scale bar: bottom-left corner.
    const barX = PADDING, barY = height - 12;
    svgParts.push(
      `<line x1="${barX}" y1="${barY}" x2="${(barX + scaleBarPx).toFixed(1)}" y2="${barY}" stroke="#333" stroke-width="1.5"/>` +
      `<text x="${barX}" y="${barY - 4}" font-size="9" fill="#333">${scaleBarKm} km</text>`
    );

    // North arrow: top-right corner. The projection keeps lat-increasing
    // "up" by construction, so a fixed arrow is legitimate here.
    const arrowX = width - PADDING, arrowY = PADDING;
    svgParts.push(
      `<text x="${arrowX}" y="${arrowY}" text-anchor="middle" font-size="11" font-weight="700" fill="#333">N ↑</text>`
    );

    const svg = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" ` +
      `style="border:1px solid #d0d7de;background:#fff;max-width:100%;">${svgParts.join('')}</svg>`;

    const allMissing = plottableSets.flatMap((s) => s.missing);
    const missingNote = allMissing.length
      ? `<div class="route-map-missing">${allMissing.length} visita(s) sem coordenadas válidas: ` +
        allMissing.map((r) => `${escapeHtml(r.horaInicio)} ${escapeHtml(stopLabel(r))}`).join(', ') +
        '</div>'
      : '';

    return `<div class="route-map">${svg}${missingNote}</div>`;
  }

  // Small color-key legend for the combined Resumo map: one swatch + name
  // per team, in groups' existing (name-sorted) order.
  function buildLegend(groups) {
    if (groups.length === 0) return '';
    const items = groups.map((g, i) =>
      `<span class="route-map-legend-item"><span class="route-map-swatch" style="background:${teamColor(i)}"></span>${escapeHtml(g.equipe)}</span>`
    ).join('');
    return `<div class="route-map-legend">${items}</div>`;
  }

  // --- HTML builders ------------------------------------------------

  const escapeHtml = (s) => window.__sigcPro.escapeHtml(s);

  // Stats/grid table styles, shared by the full guide and the lab page.
  const TABLE_CSS = `table.stats { border-collapse: collapse; margin: .6rem 0; }
table.stats th, table.stats td { border: 1px solid #d0d7de; padding: .25rem .6rem; text-align: left; font-size: .92rem; }
table.grid td { text-align: center; }
table.grid .grid-hora { font-weight: 600; }
table.grid .grid-livre { color: #8a8f98; font-size: .85em; }
table.grid .grid-dom { color: #555; font-size: .8em; }
table.grid td.sem-slot { background: #fafafa; }
table.grid tr.grid-foot th, table.grid tr.grid-foot td { background: #f6f8fa; }`;

  function metaLine(meta) {
    const e = escapeHtml;
    return [e(meta.uf), meta.dataBr ? `${e(meta.dataBr)} (${e(meta.diaSemana)})` : '',
      `gerado em ${e(meta.geradoEm)}`].filter(Boolean).join(' · ');
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
  // show their slot-text zonas (useful while the slot can still be
  // filled); reserved cards show only the real zona from the endereços
  // fetch, when available — never the inflated slot-text list. Missing
  // fields (already normalized to '' by readAgendaSlots) are omitted
  // line by line — a sparse card never breaks.
  function buildSlotCard(r, enderecos) {
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
    const zona = zonaLabel(info);
    const ids = [
      r.telefone && `Tel: ${e(r.telefone)}`,
      r.controle && `Controle: ${e(r.controle)}`,
      r.domicilio && `Dom: ${e(r.domicilio)}`,
      zona && `Zona: ${e(zona)}`,
    ].filter(Boolean).join(' &nbsp;·&nbsp; ');

    return [
      '<div class="card">',
      `<div class="hora">${hora} <span class="badge">RESERVADO</span></div>`,
      r.endereco ? `<div class="endereco">${e(r.endereco)}</div>` : '',
      info && info.lat != null
        ? `<div class="geo"><a href="geo:${fmtCoord(info)}">abrir no mapa</a></div>` : '',
      morador,
      ids ? `<div class="ids">${ids}</div>` : '',
      r.observacao ? `<div class="obs">Obs: ${e(r.observacao)}</div>` : '',
      '</div>',
    ].filter(Boolean).join('\n');
  }

  function buildTeamPanel(group, enderecos) {
    const e = escapeHtml;
    const s = computeStats(group.rows);
    const zonas = zonasUnion(group.rows, enderecos);
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
      return !r.reservado && edge ? buildLivreEdgeRow(r) : buildSlotCard(r, enderecos);
    });
    // Route links only when >= 2 reserved visits have coordinates.
    // Tapping the Google Maps link sends that leg's coordinates to
    // Google — a deliberate user action, never automatic.
    const stops = group.rows
      .filter((r) => r.reservado)
      .map((r) => {
        const p = slotInfo(r, enderecos);
        return p && p.lat != null
          ? { lat: p.lat, lon: p.lon, name: `${r.horaInicio} ${r.nome || r.controle}` } : null;
      })
      .filter(Boolean);
    let rota = '';
    if (stops.length >= 2) {
      const legs = chunkRoute(stops, 10);
      const links = legs.map((leg, i) =>
        `<a href="${e(gmapsRouteUrl(leg))}">Google Maps${legs.length > 1 ? ` ${i + 1}` : ''}</a>`);
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

  function buildSummaryPanel(groups, allRows, lab) {
    const e = escapeHtml;
    const day = computeStats(allRows);
    const comReserva = groups.filter((g) => g.rows.some((r) => r.reservado)).length;
    const titulo = lab
      ? 'Resumo do dia — Lab (Controle truncado, sem dados pessoais)'
      : 'Resumo do dia';
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
    return [
      `<h2>${e(titulo)}</h2>`,
      `<table class="stats">\n${linhas}\n</table>`,
      '<h3>Slots do dia</h3>',
      buildDayGrid(groups, lab),
    ].join('\n');
  }

  // Full day at a glance: rows = fixed half-hour marks (slot starts
  // don't necessarily align to :00/:30, so each slot lands in the mark
  // containing its start and the cell shows the actual start time),
  // columns = equipes; cells show LIVRE or Controle/Domicílio. The
  // per-equipe stats live in the grid's footer rows, so this table
  // replaces the old separate "Por equipe" one. lab = the shareable
  // variant: Controle truncated to its first 11 digits, no Domicílio.
  function buildDayGrid(groups, lab) {
    const e = escapeHtml;
    const toMin = (hhmm) => {
      const m = /^(\d{1,2}):(\d{2})/.exec(hhmm || '');
      return m ? Number(m[1]) * 60 + Number(m[2]) : null;
    };
    const fmtMin = (min) =>
      `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
    const starts = groups.flatMap((g) => g.rows.map((r) => toMin(r.horaInicio)))
      .filter((v) => v != null);
    if (!starts.length) return '';
    const marks = [];
    for (let t = Math.min(...starts) - (Math.min(...starts) % 30);
      t <= Math.max(...starts); t += 30) marks.push(t);
    const head = `<tr><th>Hora</th>${groups.map((g) => `<th>${e(g.equipe)}</th>`).join('')}</tr>`;
    const body = marks.map((t) => {
      const cells = groups.map((g) => {
        const slots = g.rows.filter((r) => {
          const s = toMin(r.horaInicio);
          return s != null && s - (s % 30) === t;
        });
        if (!slots.length) return '<td class="sem-slot"></td>';
        const conteudo = slots.map((r) => {
          const hora = `<span class="grid-hora">${e(r.horaInicio)}</span>`;
          if (!r.reservado) return `${hora} <span class="grid-livre">LIVRE</span>`;
          const ctrl = lab ? String(r.controle).slice(0, 11) : r.controle;
          const dom = !lab && r.domicilio ? ` <span class="grid-dom">Dom ${e(r.domicilio)}</span>` : '';
          return `${hora}<br><span class="grid-ctrl">${e(ctrl) || '—'}</span>${dom}`;
        }).join('<br>');
        return `<td>${conteudo}</td>`;
      }).join('');
      return `<tr><th>${fmtMin(t)}</th>${cells}</tr>`;
    }).join('\n');
    const stats = groups.map((g) => computeStats(g.rows));
    const foot = [
      ['Reservados', stats.map((s) => String(s.reservados))],
      ['Livres', stats.map((s) => String(s.livres))],
      ['Ocupação', stats.map((s) => (s.ocupacaoPct != null ? `${s.ocupacaoPct}%` : '—'))],
    ].map(([rotulo, vals]) =>
      `<tr class="grid-foot"><th>${e(rotulo)}</th>${vals.map((v) => `<td>${e(v)}</td>`).join('')}</tr>`
    ).join('\n');
    return `<table class="stats grid">\n${head}\n${body}\n${foot}\n</table>`;
  }

  // Complete standalone document. Tabs are CSS-only: one hidden radio per
  // tab as direct children of <main>, so #tab-i:checked ~ #panel-i works;
  // @media print hides the tab bar and prints only the checked panel.
  function buildGuideHtml(meta, groups, allRows, enderecos) {
    const e = escapeHtml;
    // The Lab tab repeats the Resumo in shareable form (Controle
    // truncated to 11 digits, no Domicílio, no personal data) — Ctrl+P
    // on it prints just that page for the laboratory.
    const panels = [
      { label: 'Resumo', html: buildSummaryPanel(groups, allRows) },
      { label: 'Lab', html: buildSummaryPanel(groups, allRows, true) },
      ...groups.map((g) => ({ label: g.equipe, html: buildTeamPanel(g, enderecos) })),
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

  // Consumed by agenda-map ("Guia + Mapa"): same pipeline, plus enderecos.
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
