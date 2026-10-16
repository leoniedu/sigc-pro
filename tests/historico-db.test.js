import { describe, test, expect, beforeEach } from 'bun:test';
import { IDBFactory } from 'fake-indexeddb';

await import('../extension/features/gerenciamento-historico/historico-db.js');
const { criarDb } = globalThis.__sigcProHistoricoDb;

let db;
beforeEach(() => { db = criarDb(new IDBFactory()); });

const rec = (uf, dia, extra) => ({ uf, dia, run_ts: Date.parse(`${dia}T12:00:00Z`), total: 100, agencias: {}, contagens: [], recusaDomicilio: [], ...extra });

describe('salvarExecucao / listar / getResumo', () => {
  test('the last run of a UF-day replaces the earlier one; other days and UFs stay', async () => {
    await db.salvarExecucao(rec('29', '2026-10-14', { total: 10 }));
    await db.salvarExecucao(rec('29', '2026-10-15', { total: 20 }));
    await db.salvarExecucao(rec('29', '2026-10-15', { total: 30 }));
    await db.salvarExecucao(rec('31', '2026-10-15', { total: 99 }));
    const ba = await db.listar('29');
    expect(ba.map((r) => [r.dia, r.total])).toEqual([['2026-10-14', 10], ['2026-10-15', 30]]);
    expect((await db.listar('31')).map((r) => r.total)).toEqual([99]);
    expect(await db.listar('35')).toEqual([]);
  });

  test('the key is "<uf>|<dia>"', async () => {
    await db.salvarExecucao(rec('29', '2026-10-15'));
    expect((await db.listar('29'))[0].chave).toBe('29|2026-10-15');
  });

  test('listar returns the last run of each ISO week plus the two latest days; todos returns every day', async () => {
    const sem = (dia, semana, total) => rec('29', dia, { semana, total });
    await db.salvarExecucao(sem('2026-10-05', '2026-W41', 1));
    await db.salvarExecucao(sem('2026-10-06', '2026-W41', 2));
    await db.salvarExecucao(sem('2026-10-12', '2026-W42', 3));
    await db.salvarExecucao(sem('2026-10-14', '2026-W42', 4));
    await db.salvarExecucao(sem('2026-10-16', '2026-W42', 5));
    await db.salvarExecucao(sem('2026-10-19', '2026-W43', 6));
    expect((await db.listar('29')).map((r) => [r.dia, r.total]))
      .toEqual([['2026-10-06', 2], ['2026-10-16', 5], ['2026-10-19', 6]]);
    expect((await db.listar('29', true)).map((r) => r.dia))
      .toEqual(['2026-10-05', '2026-10-06', '2026-10-12', '2026-10-14', '2026-10-16', '2026-10-19']);
  });

  test('the two latest days are kept even when they share a week with older runs', async () => {
    const sem = (dia, total) => rec('29', dia, { semana: '2026-W42', total });
    await db.salvarExecucao(sem('2026-10-12', 1));
    await db.salvarExecucao(sem('2026-10-14', 2));
    await db.salvarExecucao(sem('2026-10-15', 3));
    expect((await db.listar('29')).map((r) => r.dia)).toEqual(['2026-10-14', '2026-10-15']);
  });

  test('a record without a week is its own week', async () => {
    await db.salvarExecucao(rec('29', '2026-10-14'));
    await db.salvarExecucao(rec('29', '2026-10-15'));
    expect(await db.listar('29')).toHaveLength(2);
  });

  test('getResumo is light (no counts) and ordered by day', async () => {
    await db.salvarExecucao(rec('29', '2026-10-16', { contagens: [['A', 'x', 'S', 1]] }));
    await db.salvarExecucao(rec('29', '2026-10-15', { contagens: [['A', 'x', 'S', 1]] }));
    const r = await db.getResumo('29');
    expect(r.map((x) => x.dia)).toEqual(['2026-10-15', '2026-10-16']);
    expect(Object.keys(r[0]).sort()).toEqual(['chave', 'dia', 'run_ts', 'total']);
  });

  test('stores the counts verbatim', async () => {
    const contagens = [['290490200', 'Não iniciada', 'N', 12], ['290490200', '25B (coleta Bio) realizada', 'S', 3]];
    await db.salvarExecucao(rec('29', '2026-10-15', { contagens, agencias: { 290490200: 'CACHOEIRA' } }));
    const [r] = await db.listar('29');
    expect(r.contagens).toEqual(contagens);
    expect(r.agencias).toEqual({ 290490200: 'CACHOEIRA' });
  });

  test('rejects a record without uf or dia', async () => {
    await expect(db.salvarExecucao({ dia: '2026-10-15' })).rejects.toThrow('sem uf/dia');
    await expect(db.salvarExecucao(null)).rejects.toThrow('sem uf/dia');
  });
});

describe('contar / limpar', () => {
  test('counts runs and the UFs they cover', async () => {
    expect(await db.contar()).toEqual({ execucoes: 0, ufs: [] });
    await db.salvarExecucao(rec('31', '2026-10-15'));
    await db.salvarExecucao(rec('29', '2026-10-14'));
    await db.salvarExecucao(rec('29', '2026-10-15'));
    expect(await db.contar()).toEqual({ execucoes: 3, ufs: ['29', '31'] });
  });

  test('limpar removes every run of every UF but keeps the preferences', async () => {
    await db.salvarExecucao(rec('29', '2026-10-15'));
    await db.salvarExecucao(rec('31', '2026-10-15'));
    await db.setPref('metrica', 'concluido');
    await db.limpar();
    expect(await db.contar()).toEqual({ execucoes: 0, ufs: [] });
    expect(await db.getPref('metrica')).toBe('concluido');
  });
});

describe('prefs', () => {
  test('round trip, null when never set, overwrite', async () => {
    expect(await db.getPref('semanas')).toBeNull();
    await db.setPref('semanas', 8);
    expect(await db.getPref('semanas')).toBe(8);
    await db.setPref('semanas', 'todas');
    expect(await db.getPref('semanas')).toBe('todas');
  });
});

describe('two factories are two databases', () => {
  test('what one origin stores the other does not see', async () => {
    const outra = criarDb(new IDBFactory());
    await db.salvarExecucao(rec('29', '2026-10-15'));
    expect(await outra.listar('29')).toEqual([]);
  });
});
