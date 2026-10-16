# Fix: Entrevistador collapses to one per Controle, not per Domicílio — design

2026-08-08. Status: approved direction, pre-implementation.

## Root cause

Último Movimento's response table has **one row per Domicílio**, each
with its own Entrevistador (confirmed by an earlier live capture: a
single Controle appeared 15 times, once per `Dom 1`–`Dom 15`, several
with different Entrevistador values). But `parseUltimoMovimentoTable`
keys its output `Map` by **Controle alone**:

```js
map.set(controle, { entrevistador: ... });
```

Every row for the same Controle overwrites the previous one — only the
LAST row processed survives. `mergeUltimoMovimento` then looks this map
up by `controleFromKey(k)` (Controle only, stripped from the
`controle|domicilio` key), so **every household under a Controle gets
whichever Entrevistador happened to be on the last row in the table**,
and every other household's real Entrevistador is silently discarded —
no error, no warning, present-only rendering hides the loss entirely.

This is a design decision from the original spec (2026-08-06), not a
typo: the map was deliberately built per-Controle. It's wrong given the
real data shape.

## Fix

`parseUltimoMovimentoTable` reads a fourth column, `Domicilio` (the
live header, unaccented — same table this function already parses;
`Domicilio` sits between `Controle`/`#!Controle` and `Entrevistador` in
the live header row, per the earlier capture), and keys its map by
`` `${controle}|${domicilio}` `` — the exact same key shape
`agenda-map.js`'s own `enderecoKey`/`chaveDomicilio` convention already
uses elsewhere in this codebase (and matches `lista-agenda.js`'s
`indexMovimento`, which already keys correctly this way and is
unaffected by this bug).

`mergeUltimoMovimento` no longer needs `controleFromKey` — it matches
`umMap` directly on the full `controle|domicilio` key, same as
`enderecos` itself is already keyed. `controleFromKey` stays defined
(still used by `mergeDistribuicao`, unaffected — see below) but is no
longer called from `mergeUltimoMovimento`.

## Out of scope: Relatório Distribuição stays per-Controle

Relatório Distribuição's response table has **no Domicílio column at
all** (confirmed: the live capture shows one row per Controle, columns
Controle/Município/Agência Sugerida/Agência Distribuida/Data
Distribuição/Usuário da Distribuição) — agência assignment is genuinely
scoped to the Controle/setor, not the household. `parseDistribuicaoTable`
and `mergeDistribuicao` are correct as-is and stay untouched.

## Testing

- `parseUltimoMovimentoTable`: existing 6 tests updated to include a
  `Domicilio` column and expect `controle|domicilio` keys instead of
  bare `controle` keys. New regression test: two rows sharing one
  Controle but different Domicílio AND different Entrevistador — both
  must resolve to their own distinct entry, proving the collision is
  fixed (this is the exact shape that was silently broken).
- `mergeUltimoMovimento`: existing tests updated for the new key shape
  (no behavior change to the merge contract itself — still non-mutating,
  still passes through non-matches unchanged — only the lookup key
  changes from Controle-derived to direct).
- `mergeDistribuicao`/`parseDistribuicaoTable`: unchanged, no test
  changes needed.

## Manual verification

Guia do Dia, a Controle with multiple Domicílios scheduled the same day
(if reproducible) — confirm each card shows its own real Entrevistador,
not all cards under one Controle collapsing to the same name.
