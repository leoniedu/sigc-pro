# SIGC-PRO — Roadmap

Working checklist; move items up/down freely. Specs live in
`docs/superpowers/specs/`.

## Done (v0.1.x)

- [x] MV3 extension, MAIN-world scripts, pesquisa gate + layout validation
- [x] PDF+KML button: tweaked PDF (trim/título/subtítulo) + KML with
      Selecionado Sim/Não layers, riding the native PDF pipeline
- [x] Native PDF button left untouched
- [x] DMS coordinate parsing (`dd mm ss.sss S`, `O` = Oeste)
- [x] Privacy: zero permissions/network/storage; pre-commit gate + CI action
- [x] Distribution zip auto-built on commit (`dist/sigc-pro-extension.zip`,
      includes LEIA-ME.txt manual)
- [x] pt-BR README, landing page, privacy policy
- [x] CSV-pro decoupled from PDF click, reading DataTables API directly
      (`2026-07-15-csv-export-design.md`)
- [x] Agenda CSV-PRO: exports `AdministracaoAgenda` calendar slots
      (any UF/pesquisa, URL-suffix gated), parsing Controle/Domicílio/etc.
      out of each slot's title, reading the rendered FullCalendar DOM (no
      network calls) — `2026-07-16-agenda-csv-export-design.md`. CSV
      build/escape/download helpers moved to `sigc-common.js`, shared with
      CSV-pro.
- [x] Agenda "Verificar Prazo": alerts on open (unbooked) slots dated
      before the minimum scheduling lead time (today+3 days, +4 if today
      is Friday) — standalone button, doesn't touch the CSV-PRO flow
      (`2026-07-16-agenda-lead-time-alert-design.md`). Agenda DOM-reading
      (`readAgendaSlots` and friends) moved to `sigc-common.js`, shared
      between both Agenda features.
- [x] Agenda "Verificar Prazo" renamed to "Verificar Slots"
      (`agenda-slot-checks/`) and extended with a name-consistency check:
      equipe names must fit `UF_Equipe_Local(_n)` (2–3 underscores) and
      every zona in a slot must share the equipe's key — the name up to the
      third underscore (`29_Linus_Lauro_1` → `29_Linus_Lauro`); malformed
      equipes and zona/equipe mismatches reported in the same alert as the
      lead-time check (all slots, not just open ones)
- [x] Agenda "Guia do Dia": Dia-view-only button downloading a
      self-contained HTML day guide (CSS-only tabs, no JS/network) —
      Resumo tab with day stats plus one tab per equipe with visit cards
      and LIVRE rows; printable per team
      (`2026-07-16-agenda-day-guide-design.md`)
- [x] Agenda "Guia + Mapa": opt-in coordinates fetch from SIGC's own
      /relatorio/filtrar (same-origin, click+confirm, quarantined in
      features/agenda-map/ by the reworked privacy gate) feeding the day
      guide with per-visit Google Maps route links, later replaced by the
      dynamic checkbox selector below
      (`2026-07-16-agenda-map-design.md`; a per-team GPX download shipped
      then was removed — its data: URI link doesn't open from a
      printed/PDF guide)
- [x] Resumo tab slot grid: half-hour-mark rows × equipe columns, each
      slot in the mark containing its (possibly misaligned) start with
      the real start time shown; per-equipe stats embedded as footer rows
- [x] Guia do Dia "Lab" tab: the Resumo repeated in shareable form for
      the lab — Controle truncated to 11 digits, no Domicílio, no
      personal data; Ctrl+P on the tab prints just that page
- [x] Guia + Mapa: reserved slots get their real zona from the fetched
      Lista de Endereços (Nome ZONA column) — the slot text lists every
      zona from slot creation, even though a filled slot belongs to
      exactly one. Shown on the visit card and used in the team-panel
      Zonas line; zona is only filled for selecionados, which is what
      the filtro requests (TipoVisualizacao S)
- [x] Guia + Mapa: inline SVG day-route sketch on Resumo (combined, all
      teams, colored legend) and each team tab (its own visits) — numbered
      stops in visit order, start-time labels, scale bar, north arrow, no
      tiles/imagery/network; Lab tab stays map-free
      (`2026-07-18-agenda-day-route-map-design.md`)
- [x] Real icon: location-pin mark replacing the flat blue square
- [x] Repo public, GitHub Pages (privacy policy), Chrome Web Store
      submission (unlisted)
- [x] Narrowed `content_scripts.matches` from `https://*.ibge.gov.br/*`
      to the three specific SIGC hosts: `portalweb.ibge.gov.br`,
      `portalweb2.ibge.gov.br` (both confirmed in daily use), and
      `w3sigcpns2025.ibge.gov.br` (confirmed as the F5-proxied backend)
      — not the whole ibge.gov.br domain. A `portalweb*` wildcard was
      tried first but Chrome rejects `*` glued mid-hostname (only a
      full-label `*.domain` wildcard is valid) — a future portalweb3/4/…
      needs a manifest update (and re-review) to be added
- [x] Guia + Mapa: dynamic route selection — the old auto-chunked,
      all-visits "Rota:" link replaced by a checkbox per stop (per team,
      capped at 9 per route, default state depends on routable count)
      plus a combined "Rota do dia" section on Resumo (always starts
      unchecked); the Google Maps link updates live via one inline
      `<script>` block, the guide's one deliberate exception to its
      no-JS constraint (`2026-07-22-agenda-day-guide-dynamic-route-design.md`)
- [x] Guia + Mapa: team-panel checkboxes moved from a standalone list
      above the cards onto each visit card itself, so a checked stop
      never needs cross-referencing against a separate list; Resumo's
      combined list is unaffected
      (`2026-07-22-agenda-day-guide-route-checkbox-on-card-design.md`)
- [x] SIGC added a blank-header "lupa" (map/KML) icon column as the new
      first column of Lista de Endereços — every column index in
      `PESQUISAS.PNS2026.columns` shifted +1; PDF export needed its own
      shifted-back-by-1 view since DataTables' PDF button excludes that
      icon column from its exported layout

## Next

- [x] **Shared button layer**: `mountWidget(...)` + `makeDtProButton`/
      `makeFcProButton` factories in sigc-common; ONE shared
      MutationObserver on document.body dispatches to all registered
      mounts (was 7+ observers). All 8 features migrated; bun test suite
      (tests/) pins mount lifecycle, factories, and pure helpers. See
      docs/superpowers/specs/2026-07-19-shared-button-layer-design.md.

- [ ] **PDF customization** (see `2026-07-14-pdf-customization-design.md`):
  - [ ] per-column styles (`fontSize`, `bold`, …) via pesquisa config
  - [ ] clickable map link per row (OSM template, lat/lon from dropped
        columns), plus same links in KML balloons
  - [ ] optional landscape / footer with page numbers
  - [x] move `parseCoord` to sigc-common (shared PDF/KML) — done 2026-07-14
        (PDF shows decimal degrees, Google Maps format)

## Later

- [ ] Field-test checklist on more report variations (other UFs, empty
      coordinates, filtered exports)
- [ ] Field-test Agenda CSV-PRO on more UFs/pesquisas/Dia view; consider
      whether `Endereço` should ever be sub-parsed into separate columns
      (deliberately left raw for now, see design doc)
- [ ] New pesquisas as they appear (add `PESQUISAS` entries; labels from the
      live table)
- [ ] Zip as Release asset via GitHub Action (covers commits made without
      the local hook)

## Known minors (deliberately deferred)

- [x] `cellText` uses `innerHTML` on a detached div — fixed 2026-07-16:
      switched to `DOMParser` (detached innerHTML still fetches `<img src>`
      and fires `onerror`, so this was a real network/exec hole, not just
      hygiene). Same commit: CSV formula-injection guard in
      `escapeCsvField` (leading `= + - @` neutralized unless plain number)
      and privacy-gate patterns extended (`import(`, quoted `fetch`,
      `RTCPeerConnection`)
