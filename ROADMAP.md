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
- [x] Real icon: location-pin mark replacing the flat blue square
- [x] Repo public, GitHub Pages (privacy policy), Chrome Web Store
      submission (unlisted)

## Next

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
- [ ] Narrow `content_scripts.matches` from `https://*.ibge.gov.br/*` to the
      actual SIGC host — likely reduces Chrome Web Store review friction
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
