# Changelog

User-facing changes only. Internal refactors, test-only changes and
doc-only commits are omitted. Sectioned by Chrome Web Store submission —
only versions actually submitted to the store get their own heading.
Only two historical submissions are confirmed (v0.2.60, v0.2.103); older
versions were dev patch-bumps whose store-submission status isn't
tracked, so they're collapsed into one "Early releases" section.

## Unreleased (v0.2.104–0.2.126)

Since the current store release, v0.2.103.

- Guia do Dia's visit cards now show Agência and Entrevistador, sourced
  from Último Movimento and Relatório Distribuição.
- LIVRE (open-slot) cards and the Zonas: summary line removed from the
  printable day guide.
- Fixed the Último Movimento report's endpoint move
  (`/UltimoMovimento/Filtrar` → `/relatorio/filtrar`) breaking CSV TODAS,
  Agenda-pro's annotation, and the day guide's coordinate/agência lookup.
- Fixed Agenda-pro's Entrevistador collapsing across households sharing a
  Controle — now keyed by Controle **and** Domicílio.
- Designed (not yet shipped) a Mapa + Zonas panel for the Último Movimento
  report.

## v0.2.103 — 2026-08-03 (current store release)

- Agenda-pro's free-slot panel splits by turno (Manhã/Tarde) over a
  2-week window and lists the open zona slots underneath the counts.
- Agenda-pro shows the tipo de entrevista per domicílio.
- Lista de Endereços rows link straight to Google Maps when coordinates
  are known.
- Agenda-pro shows the Agendado time and gates on zona presence instead
  of hiding the whole panel.
- Lista de Endereços is filtered to matching rows rather than disabling
  AGENDA PRO outright.
- Agenda-pro: Lista de Endereços annotation — each domicílio row gets its
  scheduled date/time, situação and tipo de entrevista from the último
  movimento, fetched from the SIGC server on click and confirmation.
- Guia do Dia: household detail exports as a sortable, standalone HTML
  file.
- Slots Abertos: week-view panel with a zona × turno table of open slots
  vs. each zona's total capacity.
- Zonas are labeled by ID alone (dropped a misleading nome fallback).
- Guia do Dia's Lab tab follows the laboratory's own zona/system listing
  instead of a hardcoded one.
- Slots do dia grid shows zona per slot.

## v0.2.60 — 2026-07-23 (previous store release)

- Guia do Dia: day-route map gets checkbox-selectable stops (up to 9) per
  team, with a live-updating Google Maps multi-stop link and per-visit
  navigation link.
- Último Movimento: "CSV TODAS" advanced export — one CSV of every
  agência in the current UF, gated behind an off-by-default flag on a
  new Options page (loops one same-origin request per agência).

## Early releases (v0.1.1–v0.2.59)

- Initial release: PDF-pro (IBGE listagem-style PDF re-export) and
  KML-pro (colorblind-safe placemark layers for selected/unselected
  domicílios) on the Lista de Endereços report.
- CSV-pro: table-to-CSV export on any report with a table, working
  around the portal's VPN-only native CSV/Excel download.
- Agenda-pro: Guia do Dia — an HTML day guide with a summary tab (slot
  grid), a shareable Lab tab (no Controle/domicílio), and one tab per
  team with printable visit cards; a day-route SVG map with team colors,
  built from an opt-in same-origin coordinates fetch.
- Agenda-pro: CSV-PRO calendar export and a lead-time (prazo) alert;
  Verificar Slots checks zona/equipe name consistency.
- Agenda-pro: date-picker button to jump to any date.
