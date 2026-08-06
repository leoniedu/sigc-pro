# Fix: Agência via Relatório Distribuição, not Último Movimento — design

2026-08-06. Status: approved direction, pre-implementation.
Supersedes the Agência half of
`2026-08-06-guia-do-dia-agencia-entrevistador-zona-nome-design.md`.

## Root cause (verified against the live server)

The prior implementation assumed `/UltimoMovimento/Filtrar`'s results
table (`#tb_ultimo_movimento`) had a `Agência` column. It does not. The
real header row (captured live) is:

```
Controle | Domicilio | Entrevistador | Tipo de Entrevista | Última Posição | Data | Observação
```

`parseUltimoMovimentoTable` required all three of
`Controle`/`Agência`/`Entrevistador` to resolve or it returns `null`
(fail-closed, by design, to avoid silently joining the wrong columns).
Since `Agência` never matches, every call returns `null` — so
**Entrevistador silently disappeared too**, even though its own column
was present and would have resolved correctly on its own. Zero warnings
were logged (this is `null`-return, not a thrown error) — `0
controle(s) com agência/entrevistador` in the console was the only
symptom, seen on every "Guia do Dia" click since the feature shipped.

## Fix, part 1: stop requiring Agência from Último Movimento

`ULTIMO_MOVIMENTO_LABELS` drops `agencia`; `parseUltimoMovimentoTable`
only requires `Controle` and `Entrevistador` to resolve. Its returned
entries carry `entrevistador` only (no `agencia` key at all — the
caller no longer expects one from this source).

## Fix, part 2: source Agência from Relatório Distribuição

New endpoint, confirmed live (captured via curl against
`/RelatorioDistribuicao/Filtrar`, same F5-gateway pattern the other two
endpoints already use):

- Path: `/RelatorioDistribuicao/Filtrar`
- Filtro body shape (URL-encoded `filtro=` JSON, matching the other two
  endpoints' construction):
  ```json
  {"IdFiltro": "", "IdUf": "<uf>", "IdMunicipio": "*", "Controle": "<controle>"}
  ```
  (No `IdAgencia` field at all — this report is scoped by Controle only,
  unlike Último Movimento's `IdAgencia: '*'`.)
- Response table id: `tb_distribuir` (not `tb_ultimo_movimento` —
  different report, different table).
- Real header row (captured live):
  ```
  Controle | Município | Agência Sugerida | Agência Distribuida | Data Distribuição | Usuário da Distribuição
  ```
  Note: **"Distribuida" has no accent** in the live markup — match it
  exactly, the same way the codebase already treats "Nome ZONA" (no
  accent normalization beyond `normalizeLabel`'s case/whitespace fold).
- The field we want is **Agência Distribuida** (the agência the
  household was actually assigned to), not **Agência Sugerida** (a
  distinct column — the system's suggestion, which may differ from
  where it was actually distributed). Do not confuse the two; only
  `Agência Distribuida` is parsed.

## Implementation shape

Mirrors the existing per-Controle fetch pattern
(`fetchUltimoMovimento`/`postUltimoMovimento`/`ultimoMovimentoCache` in
`agenda-map.js`) as a sibling, not a rewrite of it:

- `filtroBodyDistribuicao(uf, controle)` — builds the filtro body above.
- `parseDistribuicaoTable(headers, rows)` — resolves `Controle` and
  `Agência Distribuida` by header label (same `normalizeLabel`-based
  fail-closed matching as `parseUltimoMovimentoTable`); returns
  `Map<controle, {agencia}> | null`.
- `postDistribuicao(uf, controle)` — POST via
  `window.__sigcPro.fetchViaGateway`, parse `#tb_distribuir`, call
  `parseDistribuicaoTable`.
- `distribuicaoCache` (mirrors `ultimoMovimentoCache`) and
  `fetchDistribuicao(uf, controles)` (mirrors `fetchUltimoMovimento`,
  same per-Controle try/catch/log/continue failure isolation).
- `mergeUltimoMovimento` is renamed in scope to accept a second source:
  simplest is to keep it as-is (merges `{entrevistador}` from the
  Último Movimento map) and add a second, symmetric
  `mergeDistribuicao(enderecos, distMap)` (merges `{agencia}`) — two
  small, single-purpose merges are clearer than one function juggling
  two independently-fallible sources with different key sets.
- `exportGuideMap` sequences three fetches after `fetchEnderecos`:
  Último Movimento (entrevistador) then Distribuição (agência), each
  merged in turn — same fail-open pattern as today (a failure in either
  is caught, logged, and never blocks the guide or the other fetch).
- `CONSENT_MSG` already mentions "agência e entrevistador" — no wording
  change needed, it was already describing the intended end state, just
  not yet backed by a working fetch.

## Card rendering

No change to `buildSlotCard` — it already reads `info.agencia` and
`info.entrevistador` from whatever `enderecos` entry it's given; this
fix only corrects how those two fields get populated upstream.

## Testing

- `parseDistribuicaoTable`: unit tests mirroring
  `parseUltimoMovimentoTable`'s existing coverage (header order
  tolerance, missing-header fail-closed, blank-Controle skip,
  whitespace trim) — plus one test asserting `Agência Sugerida` is
  never read even when present alongside `Agência Distribuida`.
- `parseUltimoMovimentoTable`: existing tests updated — drop the
  `agencia` expectations, keep `entrevistador`; add a test using the
  now-known real header set (`Controle`, `Domicilio`, `Entrevistador`,
  `Tipo de Entrevista`, `Última Posição`, `Data`, `Observação`) to
  guard against this exact regression recurring silently.
- `mergeDistribuicao`: same three-case coverage as the existing
  `mergeUltimoMovimento` tests (partial match, empty map, no mutation).
- Network-touching functions stay manually-verified-only, per existing
  project convention.

## Manual verification

Same "Guia do Dia" click flow as before. Confirm the console now logs
non-zero counts for both Último Movimento and Distribuição, and that a
generated card shows both Agência and Entrevistador with real values.
