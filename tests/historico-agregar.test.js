import { describe, test, expect } from 'bun:test';

await import('../extension/common/sigc-common.js');
await import('../extension/features/gerenciamento-coleta/gerenciamento-parse.js');
await import('../extension/features/gerenciamento-coleta/gerenciamento-aggregate.js');
await import('../extension/features/gerenciamento-historico/historico-agregar.js');
const A = window.__sigcProHistoricoAgregar;
const FIXTURE = await Bun.file(new URL('./fixtures/gerenciamento-coleta.html', import.meta.url)).text();
const ROWS = window.__sigcProGerenciamento.parseGerenciamentoHtml(FIXTURE).rows;

const ts = (iso) => Date.parse(`${iso}T15:00:00Z`);        // 12:00 in São Paulo
const exec = (dia, rows = ROWS) => A.construirExecucao('29', rows, ts(dia));
const soma = (xs) => xs.reduce((s, x) => s + x, 0);

describe('diaLocal', () => {
  test('uses the São Paulo date, not UTC', () => {
    expect(A.diaLocal(Date.parse('2026-10-15T02:30:00Z'))).toBe('2026-10-14');   // 23:30 the day before
    expect(A.diaLocal(Date.parse('2026-10-15T03:00:00Z'))).toBe('2026-10-15');
  });
});

describe('semanaIso', () => {
  test('Monday starts the week, Sunday ends it', () => {
    expect(A.semanaIso('2026-10-12')).toEqual({ id: '2026-W42', segunda: '2026-10-12' });
    expect(A.semanaIso('2026-10-18')).toEqual({ id: '2026-W42', segunda: '2026-10-12' });
    expect(A.semanaIso('2026-10-19').id).toBe('2026-W43');
  });
  test('year boundaries follow ISO 8601', () => {
    expect(A.semanaIso('2026-01-01').id).toBe('2026-W01');      // Thursday
    expect(A.semanaIso('2027-01-01').id).toBe('2026-W53');      // Friday, still last year's week
    expect(A.semanaIso('2024-12-30').id).toBe('2025-W01');      // Monday, next year's week
    expect(A.semanaIso('2021-01-03').id).toBe('2020-W53');
  });
});

describe('construirExecucao', () => {
  const e = exec('2026-10-15');
  test('keys the run by UF and local day and keeps the total', () => {
    expect(e).toMatchObject({ uf: '29', dia: '2026-10-15', run_ts: ts('2026-10-15'), total: ROWS.length });
  });
  test('the counts add up to the households', () => {
    expect(soma(e.contagens.map((t) => t[3]))).toBe(ROWS.length);
  });
  test('one tuple per agência x label x Bio, with the portal label verbatim', () => {
    const chaves = e.contagens.map((t) => t.slice(0, 3).join('|'));
    expect(new Set(chaves).size).toBe(chaves.length);
    expect(e.contagens.some((t) => t[1] === '25B (coleta Bio) realizada' && t[2] === 'S')).toBe(true);
    expect(e.contagens.every((t) => ['S', 'N'].includes(t[2]))).toBe(true);
  });
  test('names the agências', () => {
    expect(e.agencias).toEqual({ 290490200: 'CACHOEIRA', 292740800: 'SALVADOR 1' });
  });
  test('household refusals are counted apart, by agência and Bio', () => {
    expect(soma(e.recusaDomicilio.map((t) => t[2]))).toBe(1);
    expect(e.recusaDomicilio[0]).toHaveLength(3);
  });
  test('nothing that identifies a household is stored', () => {
    const json = JSON.stringify(e);
    ROWS.forEach((r) => {
      expect(json).not.toContain(r.controle);
    });
    expect(Object.keys(e).sort()).toEqual(['agencias', 'contagens', 'dia', 'recusaDomicilio', 'run_ts', 'semEntrevista', 'semana', 'total', 'uf']);
  });
  test('a row without an agência id is kept under its own name, never as an empty id', () => {
    const e = exec('2026-10-15', [{ ...ROWS[0], idAgencia: '', agenciaNome: '' }, ROWS[1]]);
    expect(e.total).toBe(2);
    expect(e.contagens.every((t) => t[0] !== '' && t[0] != null)).toBe(true);
    expect(Object.keys(e.agencias)).toContain(A.SEM_AGENCIA);
    expect(A.valorMetrica(e, 'total', A.SEM_AGENCIA, '').n).toBe(1);
  });
  test('an empty fetch builds an empty run', () => {
    expect(exec('2026-10-15', [])).toMatchObject({ total: 0, contagens: [], recusaDomicilio: [] });
  });
});

describe('avaliarGravacao (the short-response guard)', () => {
  const r = (dia, total) => ({ dia, total, run_ts: 1, chave: `29|${dia}` });
  const rec = (total, dia = '2026-10-15') => ({ total, dia });
  test('an empty run is never saved', () => {
    expect(A.avaliarGravacao(rec(0), [])).toMatchObject({ salvar: false });
  });
  test('the first run of a UF is saved', () => {
    expect(A.avaliarGravacao(rec(50), []).salvar).toBe(true);
    expect(A.avaliarGravacao(rec(50), undefined).salvar).toBe(true);
  });
  test('saved at exactly 70% of the largest recent run, skipped under it', () => {
    const base = [r('2026-10-10', 100)];
    expect(A.avaliarGravacao(rec(70), base).salvar).toBe(true);
    const curto = A.avaliarGravacao(rec(69), base);
    expect(curto.salvar).toBe(false);
    expect(curto.motivo).toContain('69');
    expect(curto.motivo).toContain('100');
  });
  test('the baseline is the LARGEST run of the last 14 days, so it cannot ratchet down', () => {
    // 100 -> 71 is accepted; the next run is judged against 100 (not 71): 51 is refused.
    const base = [r('2026-10-10', 100), r('2026-10-12', 71)];
    expect(A.avaliarGravacao(rec(51), base).salvar).toBe(false);
    expect(A.avaliarGravacao(rec(70), base).salvar).toBe(true);
  });
  test('a partial page repeated is refused every time (no repeat-confirmation)', () => {
    const base = [r('2026-10-10', 1185)];
    expect(A.avaliarGravacao(rec(180), base).salvar).toBe(false);
    expect(A.avaliarGravacao(rec(180), base).salvar).toBe(false);
  });
  test('runs older than 14 days no longer count: a real shrink is accepted afterwards', () => {
    const base = [r('2026-09-30', 1000)];
    expect(A.avaliarGravacao(rec(500, '2026-10-15'), base).salvar).toBe(true);
    expect(A.avaliarGravacao(rec(500, '2026-10-14'), base).salvar).toBe(false);   // exactly 14 days: still counted
  });
  test('the warning says when the history will accept the new size', () => {
    expect(A.avaliarGravacao(rec(40), [r('2026-10-10', 100)]).motivo).toContain('14 dias');
  });
  test('a smaller run than one already saved the same day is skipped silently', () => {
    const v = A.avaliarGravacao(rec(90), [r('2026-10-15', 100)]);
    expect(v).toMatchObject({ salvar: false, silencioso: true });
  });
  test('an equal or larger run replaces the same day', () => {
    expect(A.avaliarGravacao(rec(100), [r('2026-10-15', 100)]).salvar).toBe(true);
    expect(A.avaliarGravacao(rec(120), [r('2026-10-15', 100)]).salvar).toBe(true);
  });
  test('the same day does not count as its own baseline for the 70% test', () => {
    expect(A.avaliarGravacao(rec(60), [r('2026-10-15', 100)]).silencioso).toBe(true);   // smaller than today's, not "partial"
  });
});

describe('colunasSemanas', () => {
  test('no runs, no columns', () => {
    expect(A.colunasSemanas([])).toEqual([]);
  });
  test('the two most recent days are shown one by one, older weeks once each (their last day)', () => {
    const cols = A.colunasSemanas([
      exec('2026-10-05'), exec('2026-10-07'), exec('2026-10-13'), exec('2026-10-16'), exec('2026-10-20'),
    ]);
    // week 41 once (its last day), week 42's earlier day, then the two latest days
    expect(cols.map((c) => c.exec.dia)).toEqual(['2026-10-07', '2026-10-13', '2026-10-16', '2026-10-20']);
    expect(cols.map((c) => c.id)).toEqual(['2026-W41', '2026-W42', '2026-W42', '2026-W43']);
  });
  test('this morning against yesterday: two runs in one week are two columns', () => {
    const cols = A.colunasSemanas([exec('2026-10-14'), exec('2026-10-15')]);
    expect(cols.map((c) => c.rotulo)).toEqual(['14/10', '15/10']);
  });
  test('a single run is a single column', () => {
    expect(A.colunasSemanas([exec('2026-10-15')]).map((c) => c.rotulo)).toEqual(['15/10']);
  });
  test('headers are just the date behind them', () => {
    const cols = A.colunasSemanas([exec('2026-10-13'), exec('2026-10-16'), exec('2026-10-20')]);
    expect(cols[0].rotulo).toBe('13/10');
  });
  test('a week with no run gets NO column, and no gap marker', () => {
    const cols = A.colunasSemanas([exec('2026-10-05'), exec('2026-10-21')]);
    expect(cols.map((c) => c.id)).toEqual(['2026-W41', '2026-W43']);
    expect(cols.map((c) => c.rotulo)).toEqual(['05/10', '21/10']);
  });
  test('weeks across a year boundary', () => {
    const cols = A.colunasSemanas([exec('2026-12-28'), exec('2027-01-12')]);
    expect(cols.map((c) => c.id)).toEqual(['2026-W53', '2027-W02']);
    expect(cols.map((c) => c.rotulo)).toEqual(['28/12', '12/01']);
  });
});

describe('valorMetrica', () => {
  const e = exec('2026-10-15');
  const contar = (pred, bio) => ROWS.filter((r) => pred(r) && (!bio || (bio === 'sim') === (r.bio === 'Sim'))).length;
  const por = (re) => (r) => re.test(r.andamento);
  test('total is the household count', () => {
    expect(A.valorMetrica(e, 'total', null, '')).toEqual({ n: ROWS.length, total: ROWS.length });
  });
  test('questionário concluído = finalizada + every 25A/25B label', () => {
    const n = contar(por(/^(Finalizada|25[AB])/));
    expect(A.valorMetrica(e, 'concluido', null, '').n).toBe(n);
    expect(n).toBeGreaterThan(0);
  });
  test('sem entrevista iniciada, em andamento, recusas, Bio 25B', () => {
    expect(A.valorMetrica(e, 'sem_inicio', null, '').n).toBe(contar(por(/^Não iniciada$/)));
    expect(A.valorMetrica(e, 'em_andamento', null, '').n)
      .toBe(contar(por(/^(Todos os moradores em andamento|(Homem|Mulher) selecionad[oa] (a realizar|em andamento))/)));
    expect(A.valorMetrica(e, 'recusa_questionario', null, '').n)
      .toBe(contar(por(/^(Todos os moradores iniciada e interrompida por recusa|(Homem|Mulher) selecionad[oa] com recusa)/)));
    expect(A.valorMetrica(e, 'recusa_bio', null, '').n).toBe(contar(por(/não iniciada por recusa/)));
    expect(A.valorMetrica(e, 'bio_25b_realizada', null, '').n).toBe(contar(por(/25B \(coleta Bio\) realizada/)));
  });
  test('the three refusals are never summed into one another', () => {
    const q = A.valorMetrica(e, 'recusa_questionario', null, '').n;
    const b = A.valorMetrica(e, 'recusa_bio', null, '').n;
    const d = A.valorMetrica(e, 'recusa_domicilio', null, '').n;
    expect([q, b, d]).toEqual([6, 2, 1]);
  });
  test('Bio filter narrows numerator and denominator alike', () => {
    const sim = A.valorMetrica(e, 'concluido', null, 'sim');
    const nao = A.valorMetrica(e, 'concluido', null, 'nao');
    expect(sim.total + nao.total).toBe(ROWS.length);
    expect(sim.n + nao.n).toBe(A.valorMetrica(e, 'concluido', null, '').n);
    expect(sim.total).toBe(ROWS.filter((r) => r.bio === 'Sim').length);
  });
  test('an agência scopes the count; an absent agência is null, not zero', () => {
    const cach = A.valorMetrica(e, 'total', '290490200', '');
    expect(cach.n).toBe(ROWS.filter((r) => r.idAgencia === '290490200').length);
    expect(A.valorMetrica(e, 'total', '999999999', '')).toBeNull();
  });
  test('the household refusal respects agência and Bio too', () => {
    const todas = A.valorMetrica(e, 'recusa_domicilio', null, '').n;
    const sim = A.valorMetrica(e, 'recusa_domicilio', null, 'sim').n;
    const nao = A.valorMetrica(e, 'recusa_domicilio', null, 'nao').n;
    expect(sim + nao).toBe(todas);
  });
  test('any portal label, including one the panel has never met', () => {
    expect(A.valorMetrica(e, `${A.ROTULO}Rótulo novo de teste`, null, '').n).toBe(2);
    expect(A.valorMetrica(e, `${A.ROTULO}Não iniciada`, null, '').n).toBe(contar(por(/^Não iniciada$/)));
    expect(A.valorMetrica(e, 'concluido', null, '').n).toBe(contar(por(/^(Finalizada|25[AB])/)));   // the new label is in no group
  });
  test('Não iniciada splits into still-to-work and closed-out, and the two add up to it', () => {
    const pend = A.valorMetrica(e, 'sem_inicio_pendente', null, '').n;
    const enc = A.valorMetrica(e, 'sem_inicio_encerrado', null, '').n;
    expect(pend + enc).toBe(A.valorMetrica(e, 'sem_inicio', null, '').n);
    expect(enc).toBe(1);            // the one "Recusa do domicílio" of the fixture
  });
  test('an agência with no household on that side of the Bio filter is empty, not zero', () => {
    const soNao = exec('2026-10-15', ROWS.filter((r) => r.idAgencia === '290490200' && r.bio === 'Não'));
    expect(A.valorMetrica(soNao, 'total', '290490200', 'sim')).toBeNull();
    expect(A.valorMetrica(soNao, 'total', null, 'sim')).toBeNull();
    expect(A.valorMetrica(soNao, 'total', '290490200', 'nao')).not.toBeNull();
  });
  test('a run saved before the split existed leaves those cells empty, not zero', () => {
    const { semEntrevista, ...antiga } = e;
    expect(A.valorMetrica(antiga, 'sem_inicio_pendente', null, '')).toBeNull();
    expect(A.valorMetrica(antiga, 'concluido', null, '').n).toBeGreaterThan(0);
  });
  test('names', () => {
    expect(A.nomeDaMetrica('concluido')).toBe('Questionário concluído');
    expect(A.nomeDaMetrica(`${A.ROTULO}Indefinido`)).toBe('Indefinido');
  });
});

describe('end of cycle: the metrics that tell Bio and non-Bio households apart', () => {
  const e = exec('2026-10-15');
  const n = (id, bio = '') => A.valorMetrica(e, id, null, bio).n;
  const cont = (re, bio) => ROWS.filter((r) => re.test(r.andamento) && (!bio || (bio === 'sim') === (r.bio === 'Sim'))).length;

  test('ciclo encerrado = finalizada sem Bio + não elegível + 25B + 25A recusa/outro motivo', () => {
    expect(n('ciclo_encerrado')).toBe(cont(/^Finalizada/) + cont(/^25B/) + cont(/^25A \(Bio\) não iniciada/));
  });
  test('the gap between concluído and ciclo encerrado is exactly the Bio still to be collected', () => {
    expect(n('concluido') - n('ciclo_encerrado')).toBe(n('bio_a_coletar'));
    expect(n('bio_a_coletar')).toBe(cont(/^25A \(Bio\) (agendada|não agendada)$/));
  });
  test('Bio realizada / não realizada / outro motivo / não elegível each map to their label', () => {
    expect(n('bio_25b_realizada')).toBe(cont(/realizada$/) - cont(/não realizada$/));
    expect(n('bio_25b_nao_realizada')).toBe(cont(/não realizada$/));
    expect(n('bio_25a_outro')).toBe(cont(/outro motivo$/));
    expect(n('nao_elegivel')).toBe(cont(/não elegível$/));
  });
  test('a household without a biomarker sample ends at finalizada sem Bio; with it, never there', () => {
    expect(n('ciclo_encerrado', 'nao')).toBe(cont(/UPA sem Bio$/, 'nao'));
    expect(n('bio_a_coletar', 'nao')).toBe(0);
  });
  test('Indefinido is a metric of its own, so only Total is a superset', () => {
    expect(n('indefinido')).toBe(cont(/^Indefinido$/));
  });
  test('Total is the only metric that contains the label the panel has never met', () => {
    const grupos = A.METRICAS.filter((m) => !m.todas && !m.especial && !m.semEntrevista).flatMap((m) => m.regras);
    expect(new Set(grupos).has(-1)).toBe(false);
  });
  test('the three refusals are still three metrics', () => {
    const ids = A.METRICAS.map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining(['recusa_questionario', 'recusa_bio', 'recusa_domicilio']));
  });
});

describe('tables', () => {
  const execs = [exec('2026-10-06'), exec('2026-10-20', ROWS.filter((r) => r.idAgencia !== '290490200'))];

  test('agências x weeks: one row per agência plus the UF; empty where an agência is absent from a run', () => {
    const t = A.tabelaAgencias(execs, { metrica: 'total' });
    expect(t.colunas.map((c) => c.id)).toEqual(['2026-W41', '2026-W43']);
    expect(t.linhas.map((l) => l.nome)).toEqual(['CACHOEIRA', 'SALVADOR 1']);
    const cach = t.linhas[0].celulas;
    expect(cach[0].n).toBeGreaterThan(0);
    expect(cach[1]).toBeNull();                 // agência absent from that run
    expect(t.uf.nome).toBe('UF inteira');
    expect(t.uf.celulas[0].n).toBe(ROWS.length);
    expect(t.uf.celulas[1].n).toBe(ROWS.filter((r) => r.idAgencia !== '290490200').length);
  });

  test('one agência: the metrics are the rows', () => {
    const t = A.tabelaUmaAgencia(execs, { agencia: '292740800' });
    expect(t.linhas.map((l) => l.id)).toEqual(A.METRICAS.map((m) => m.id));
    expect(t.linhas.find((l) => l.id === 'total').celulas[0].n)
      .toBe(ROWS.filter((r) => r.idAgencia === '292740800').length);
  });

  test('the UF as a whole when no agência is chosen', () => {
    const t = A.tabelaUmaAgencia(execs, { agencia: '' });
    expect(t.linhas.find((l) => l.id === 'total').celulas[0].n).toBe(ROWS.length);
  });

  test('portal labels seen, known ones in funnel order', () => {
    const r = A.rotulosVistos(execs);
    expect(r[0]).toBe('Não iniciada');
    expect(r.at(-1)).toBe('Rótulo novo de teste');
  });

  test('long CSV: one line per uf, day, agência, label and Bio, plus the household refusal', () => {
    const { header, rows } = A.linhasCsvLongo(execs);
    expect(header).toEqual(['uf', 'dia', 'idAgencia', 'agencia', 'andamento', 'amostraBio', 'n']);
    const noPrimeiro = rows.filter((r) => r[1] === '2026-10-06' && !r[4].startsWith('(situação)'));
    expect(soma(noPrimeiro.map((r) => r[6]))).toBe(ROWS.length);
    expect(rows.some((r) => r[4] === '(situação) Recusa do domicílio')).toBe(true);
    expect(rows.every((r) => r[0] === '29')).toBe(true);
  });
});
