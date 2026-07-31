# SIGC-PRO — Roadmap

Working checklist; move items up/down freely. Specs live in
`docs/superpowers/specs/`.

## Done (v0.1.x)

- [x] MV3 extension, MAIN-world scripts, pesquisa gate + layout validation
- [x] PDF+KML button: tweaked PDF (trim/título/subtítulo) + KML with
      Selecionado Sim/Não layers, riding the native PDF pipeline
- [x] Native PDF button left untouched
- [x] DMS coordinate parsing (`dd mm ss.sss S`, `O` = Oeste)
- [x] Privacy: zero permissions/network/storage at launch; pre-commit gate
      + CI action (later amended — see `storage` permission and second
      fetch exception below)
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
      dynamic checkbox selector below. (This and the "Guia + Mapa" entries
      that follow record the feature under its original name; the button
      is now simply "Guia do Dia" — see the consolidation entry below)
      (`2026-07-16-agenda-map-design.md`; a per-team GPX download shipped
      then was removed — its data: URI link doesn't open from a
      printed/PDF guide)
- [x] Resumo tab slot grid: half-hour-mark rows × equipe columns, each
      slot in the mark containing its (possibly misaligned) start with
      the real start time shown; per-equipe stats embedded as footer rows
- [x] Guia do Dia "Lab" tab: the Resumo repeated in shareable form for
      the lab — Controle truncated to 11 digits, no Domicílio, no
      personal data; Ctrl+P on the tab prints just that page
- [x] Lab tab follows the laboratory's own system listing: each slot
      shows nome + município instead of a truncated Controle (município
      derived from the Controle's first 7 digits, the IBGE código, via
      the generated `common/municipios.js` table); no Controle, no
      Domicílio, no birth date
- [x] Lab tab sanctioned fields, decided explicitly: **hora, nome,
      município, zona** — and nothing else. Zona is included because the
      laboratory needs the collection area to plan its routes; it is
      accepted that zona narrows location below município level, so this
      is a deliberate trade, not an oversight. Adding a fifth field is a
      privacy decision that must be argued in its own commit — the
      whitelist test in `tests/agenda-day-guide-lab-grid.test.js` ("Lab
      cells carry ONLY the sanctioned fields") fails until this list is
      edited, so the decision cannot be made silently
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
      (`2026-07-18-agenda-day-route-map-design.md`). Note the rule is
      "no map in Lab", not "nothing fetched reaches Lab": zona comes
      from the same opt-in endereços fetch and IS shown there, per the
      sanctioned-fields decision above
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
- [x] Guia + Mapa: the per-team and Resumo SVG route maps redraw live as
      route checkboxes are toggled (previously only the Google Maps link
      updated live, the map stayed static) — data-idx groups on each
      dot, per-SVG-scoped queries so team maps and Resumo never collide
      (`2026-07-23-agenda-day-guide-checkbox-reactive-map-design.md`)
- [x] Guia do Dia consolidated to ONE button: the standalone map-free
      button is gone, and agenda-map's is renamed from "Guia + Mapa" to
      "Guia do Dia". Two buttons differing only by whether they made the
      consulta was clutter, and the map-free guide is not lost — declining
      the consent prompt (or a failed fetch, or a day with no reserved
      controles) still calls `generate(null)` and produces exactly the
      artifact the second button used to. Declining is deliberately not a
      cancel, since this is now the only way to reach the guide
- [x] **Último Movimento multi-agência CSV export** (advanced,
      off-by-default flag): "CSV TODAS" button next to Filtrar on the
      Último Movimento report fetches every agência in the current UF
      (2s apart, same-origin, skip-and-continue on failure) and downloads
      one combined CSV — ports the standalone `ultimo_movimento.py`
      script's request shape into the extension, including the F5
      BIG-IP gateway URL rewriting agenda-map.js already had to solve.
      First feature to request a browser permission (`storage`, for the
      flag only) and the second to make network calls; both gated behind
      a real Options page (`chrome://extensions` → Opções), not an
      on-page button. Privacy docs (README, index.html, store-listing.md,
      PRIVACY_POLICY.html) updated to match
      (`2026-07-24-ultimo-movimento-multi-agencia-export-design.md`)
- [x] **Agenda "Slots Abertos"**: Semana-view-only panel answering what
      the Guia do Dia cannot — across the whole week, where is there still
      capacity to open? A zona × turno table (Manhã before 13:00, Tarde
      from 13:00), each cell `abertos/total`. A slot listing several zonas
      is shown two ways in the same cell because neither alone suffices:
      the whole count counts it in every zona it lists ("de quantos slots
      esta zona pode ser preenchida?"), which makes zona rows overshoot
      the slot total, and the grey weighted share divides each slot evenly
      across its zonas so the rows reconcile with TOTAL. Zona entries stay
      whole ("29001001 - Lab 1 Oeste") — the tail after " - " is free text
      with no reliable token count, so any split would mangle rows. Reads
      only already-rendered FullCalendar DOM via `readAgendaSlots()`, same
      zero-network guarantee as agenda-csv-export
- [x] Slots Abertos counts only slots within the SIGC prazo mínimo (+3
      days, +4 on Fridays so the horizon clears the weekend) as `abertos`,
      reusing `agendaMinScheduleDate` rather than restating the rule
      Verificar Slots already enforces. Only the numerator is filtered:
      an unfillable slot still occupies the zona, so removing it from
      `total` would overstate how free the zona is and stop TOTAL
      reconciling with the week on screen. Since a `0/8` cell is otherwise
      ambiguous between "saturated" and "past the prazo", the notes name
      the cutoff date and count the free slots it excluded
- [x] Zona labels are the ID alone ("29OU7L" — UF code plus an opaque
      token), never with the nome appended: the ID is what identifies a
      zona across SIGC and the coordination's own reporting. Applies to
      the Guia do Dia grid and the route selector alike. Every zona has an
      ID, so the nome-only fallback was unreachable and is gone — a row
      arriving without one has no zona columns filled at all. Note these
      are the Lista de Endereços columns 18/19, NOT the dotted codes in a
      slot's own Zonas text ("29.3.03.03 29_Linus_Pituba")
- [x] `manifest.json`'s `content_scripts` order pinned by a test: it is a
      load-order contract nothing about the file's appearance declares,
      and alphabetizing the array puts `common/municipios.js` before
      `common/sigc-common.js` — backwards, since sigc-common assigns
      `window.__sigcPro` wholesale and would discard
      `municipioFromControle`. Every other test imports modules explicitly
      in the right order, so none of them could catch it; it broke in the
      browser instead
- [x] `scripts/gen-municipios.R` stops when run outside the repo root:
      the output path is repo-relative, so running it from `scripts/`
      silently created `scripts/extension/common/` and left the real table
      stale, surfacing only later as a lookup that did not reflect the
      regeneration
- [x] **Lista de Endereços × Agenda + Último Movimento**: the selecionados
      view gains Agendado / Situação / Transmissão columns per household
      and a per-zona free-slots header, from two same-origin fetches
      behind one click+confirm (ObterSlots for the UF's year, /relatorio/
      filtrar for this Controle). Reverses 2026-07-16-agenda-csv-export's
      decision not to call ObterSlots — that spec's DOM alternative does
      not exist on this page, so the choice was fetch or drop the feature.
      Agenda responses are narrowed to Controle/Domicílio/Zonas/start at
      the parse boundary; the rest (name, address, telephone) is never
      held. Columns are appended so indexes 0-19 stay intact
      (`2026-07-31-lista-agenda-design.md`)

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
