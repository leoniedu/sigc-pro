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

## Next

- [ ] **PDF customization** (see `2026-07-14-pdf-customization-design.md`):
  - [ ] per-column styles (`fontSize`, `bold`, …) via pesquisa config
  - [ ] clickable map link per row (OSM template, lat/lon from dropped
        columns), plus same links in KML balloons
  - [ ] optional landscape / footer with page numbers
  - [ ] move `parseCoord` to sigc-common (shared PDF/KML)
- [ ] Real icon (map pin / "SP" lettering) instead of blue square

## Later

- [ ] Field-test checklist on more report variations (other UFs, empty
      coordinates, filtered exports)
- [ ] New pesquisas as they appear (add `PESQUISAS` entries; labels from the
      live table)
- [ ] Go public: decide fate of `docs/superpowers/` on Pages, enable GitHub
      Pages, cut a GitHub Release with the zip
- [ ] Chrome Web Store (unlisted) once non-technical users depend on it —
      auto-updates, one-click install
- [ ] Zip as Release asset via GitHub Action (covers commits made without
      the local hook)

## Known minors (deliberately deferred)

- [x] ~~SPA navigation loses the PDF+KML button~~ — fixed: MutationObserver
      re-inserts whenever the toolbar is rebuilt (2026-07-14)
- [ ] `cellText` uses `innerHTML` on a detached div; `DOMParser` would be
      inert-safer
- [ ] KML button copies its CSS class from the first toolbar button
      (cosmetic fragility)
