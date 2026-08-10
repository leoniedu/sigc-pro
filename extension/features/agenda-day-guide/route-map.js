// SIGC-PRO: the SVG day-route map rendered inside the "Guia do Dia"
// download. Split out of agenda-day-guide.js on 2026-08-10 — it was a
// self-contained ~235-line block in an otherwise 937-line file, and it
// is the one part of the guide that is pure geometry rather than
// document assembly.
//
// Inline SVG rather than a tile-based map library on purpose: the guide
// is a self-contained HTML file meant to be saved and printed, so the
// map must survive serialization to a blob, render offline from
// file://, and print deterministically. Leaflet lives in
// ultimo-movimento-map/ instead, where the map is live and interactive.
//
// Populates window.__sigcPro.routeMap, consumed by agenda-day-guide.js;
// it must therefore load BEFORE agenda-day-guide.js in the manifest
// (see tests/manifest-load-order.test.js).
// Spec: docs/superpowers/specs/2026-07-18-agenda-day-route-map-design.md
(function () {
  'use strict';

  const escapeHtml = (s) => window.__sigcPro.escapeHtml(s);
  const enderecoKey = (r) => window.__sigcPro.enderecoKey(r);

  // This row's fetched endereço entry ({lat, lon, zona, ...}), or null
  // for an unreserved row or when the lookup was declined/failed. Every
  // builder here is a no-op on null, which is what keeps the plain
  // (map-free) Guia do Dia byte-identical. Shared with
  // agenda-day-guide.js, which re-exposes it as its own slotInfo.
  function slotInfo(r, enderecos) {
    return (r.reservado && enderecos && enderecos.get(enderecoKey(r))) || null;
  }

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

  // enderecoKey -> sequence number (1-based, time order) for a row set's
  // PLOTTABLE reserved visits — the exact same numbering buildRouteMapSvg
  // assigns that set on the map, so a card's badge always matches its
  // dot. A coordinate-less reserved visit gets no entry (it has no dot).
  function stopSequenceMap(rows, enderecos) {
    const map = new Map();
    let seq = 0;
    rows.forEach((r) => {
      const info = slotInfo(r, enderecos);
      if (info && info.lat != null) {
        seq += 1;
        map.set(enderecoKey(r), seq);
      }
    });
    return map;
  }

  // enderecoKey -> single flat 0-based index across ALL rowSets' PLOTTABLE
  // (reserved + has coordinates) rows, in rowSets order then each set's own
  // row order — the counter does NOT reset per set. This is the join key
  // shared by a checkbox's data-idx and its dot's data-idx in
  // buildRouteMapSvg: both must walk identically-shaped rowSets in the
  // same order for the two to agree, so callers always pass the SAME
  // rowSets array (or an array built the same way) to both this function
  // and buildRouteMapSvg. Unlike stopSequenceMap (which restarts at 1 per
  // call, matching each dot's VISIBLE number), this index is never shown
  // to the user — it exists only for the inline script to match a
  // checkbox to its dot.
  function routeIdxMap(rowSets, enderecos) {
    const map = new Map();
    let idx = 0;
    rowSets.forEach((set) => {
      set.rows.forEach((r) => {
        const info = slotInfo(r, enderecos);
        if (info && info.lat != null) {
          map.set(enderecoKey(r), idx);
          idx += 1;
        }
      });
    });
    return map;
  }

  // rowSets: Array<{ rows: Array<row>, color: string }>, each already this
  // team's reserved rows in time order. Builds one shared projection across
  // ALL plottable points from every set (so a combined map's teams share
  // one coordinate frame), then draws each set's dots/line in its color,
  // each set numbered independently starting at 1. Rows whose slotInfo has
  // no usable lat/lon are excluded from plotting and listed in a single
  // combined coordinate-less note below the map (never silently dropped).
  function buildRouteMapSvg(rowSets, enderecos, width, height, groupId) {
    const PADDING = 28;
    const idxMap = routeIdxMap(rowSets, enderecos);
    const plottableSets = rowSets.map((set) => {
      const plottable = [];
      const missing = [];
      set.rows.forEach((r) => {
        const info = slotInfo(r, enderecos);
        if (info && info.lat != null) {
          plottable.push({ lat: info.lat, lon: info.lon, hora: r.horaInicio, idx: idxMap.get(enderecoKey(r)) });
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
    // Combined-across-sets ordered point list, used to draw ONE polyline
    // spanning every plottable stop (in flattened order) regardless of how
    // many rowSets were passed in. A single-set caller (team panel) still
    // gets one line in that set's own color; a multi-set caller (Resumo)
    // gets one neutral-colored line instead of one per team — the route
    // link built by the inline script is already a single combined link,
    // so the static line matches it from the start.
    const allProjectedInOrder = [];
    plottableSets.forEach((set) => {
      const pts = projected.slice(cursor, cursor + set.plottable.length);
      cursor += set.plottable.length;
      if (pts.length === 0) return;

      pts.forEach((p, i) => {
        allProjectedInOrder.push(p);
        const hora = set.plottable[i].hora;
        const idx = set.plottable[i].idx;
        const seq = i + 1;
        svgParts.push(
          `<g data-idx="${idx}" data-x="${p.x.toFixed(1)}" data-y="${p.y.toFixed(1)}">` +
          `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="9" fill="${set.color}" stroke="#fff" stroke-width="1.5"/>` +
          `<text x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" text-anchor="middle" dominant-baseline="central" ` +
            `font-size="9" font-weight="700" fill="#fff">${seq}</text>` +
          `<text x="${p.x.toFixed(1)}" y="${(p.y + 20).toFixed(1)}" text-anchor="middle" ` +
            `font-size="9" fill="#333">${escapeHtml(hora)}</text>` +
          '</g>'
        );
      });
    });

    if (allProjectedInOrder.length >= 2) {
      const line = allProjectedInOrder.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
      const lineColor = plottableSets.length > 1 ? '#333' : plottableSets[0].color;
      // Prepended so dots/labels draw on top of the line, unchanged from
      // the original per-set drawing order.
      svgParts.unshift(
        `<polyline id="route-line-${escapeHtml(groupId)}" points="${line}" fill="none" ` +
          `stroke="${lineColor}" stroke-width="1.5" opacity="0.7"/>`
      );
    }

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

  window.__sigcPro.routeMap = {
    projectPoints,
    slotInfo,
    teamColor,
    stopSequenceMap,
    routeIdxMap,
    buildRouteMapSvg,
    buildLegend,
  };
})();
