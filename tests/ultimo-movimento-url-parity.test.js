import { describe, test, expect } from 'bun:test';

// Three independent files each fetch the Último Movimento report and
// each build their own URL for /relatorio/filtrar?slug=relatorio-ultimo-
// movimento (deliberately not shared — see
// docs/superpowers/specs/2026-08-07-fix-ultimo-movimento-endpoint-design.md).
// That duplication is exactly how a third call site (lista-agenda.js)
// went unnoticed and unfixed when the first two were patched for this
// same endpoint migration. This file is the guard against that
// recurring: it pins all three builders to produce byte-identical URLs
// for the same inputs, so a future edit to one that silently diverges
// from the other two fails a test instead of shipping quietly broken.
await import('../extension/common/sigc-common.js');
await import('../extension/features/agenda-lookups/agenda-lookups.js');
await import('../extension/features/ultimo-movimento-export/ultimo-movimento-export.js');
await import('../extension/features/lista-agenda/lista-agenda.js');

const AM = window.__sigcProAgendaLookups;
const UME = window.__sigcProUltimoMovimentoExportInternals;
const LA = window.__sigcProListaAgendaInternals;

const SLUG = 'relatorio-ultimo-movimento';
const F5_HEX = '68747470733a2f2f773373696763706e73323032352e696267652e676f762e6272';
const F5_PATHNAME = `/f5-w-${F5_HEX}$$/UltimoMovimento`;
const ORIGIN = 'https://portalweb.ibge.gov.br';

describe('Último Movimento URL parity across the three independent builders', () => {
  test('simple mode, no F5 gateway: all three agree', () => {
    const expected = `${ORIGIN}/relatorio/filtrar?slug=${SLUG}`;
    expect(AM.filtrarUrl(ORIGIN, '/UltimoMovimento', SLUG, true)).toBe(expected);
    expect(UME.relatorioFiltrarUrl(ORIGIN, '/UltimoMovimento', true)).toBe(expected);
    expect(LA.filtrarUrlMovimento(ORIGIN, '/UltimoMovimento', true)).toBe(expected);
  });

  test('simple mode, F5 gateway: all three agree', () => {
    const expected = `${ORIGIN}/f5-w-${F5_HEX}$$/relatorio/filtrar?slug=${SLUG}`;
    expect(AM.filtrarUrl(ORIGIN, F5_PATHNAME, SLUG, true)).toBe(expected);
    expect(UME.relatorioFiltrarUrl(ORIGIN, F5_PATHNAME, true)).toBe(expected);
    expect(LA.filtrarUrlMovimento(ORIGIN, F5_PATHNAME, true)).toBe(expected);
  });

  test('fallback mode, F5 gateway (doubled /relatorio segment): all three agree', () => {
    const expected = `${ORIGIN}/f5-w-${F5_HEX}$$/relatorio/f5-h-$$/relatorio/filtrar?slug=${SLUG};F5_origin=${F5_HEX}&F5CH=I`;
    expect(AM.filtrarUrl(ORIGIN, F5_PATHNAME, SLUG, false)).toBe(expected);
    expect(UME.relatorioFiltrarUrl(ORIGIN, F5_PATHNAME, false)).toBe(expected);
    expect(LA.filtrarUrlMovimento(ORIGIN, F5_PATHNAME, false)).toBe(expected);
  });
});
