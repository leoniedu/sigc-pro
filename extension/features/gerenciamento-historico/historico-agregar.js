// SIGC-PRO feature: GEREN-PRO history — building a run, the guard against a
// short response, ISO weeks and the metrics. Pure functions: no DOM, no
// storage, no network (the storage calls are historico-client.js's).
// Spec: docs/superpowers/specs/2026-10-15-gerenciamento-historico-design.md
(function () {
  'use strict';

  const G = () => window.__sigcProGerenciamento;

  // A run smaller than this share of the LARGEST run of the last
  // JANELA_BASE_DIAS days is a partial page, not a collection that lost
  // households (the portal has answered 180 rows for a 1,185-row scope when
  // a POST did not look like it came from the report). The largest, not the
  // latest: against the latest the threshold ratchets down (100 -> 71 -> 51),
  // and a partial page repeated twice would be accepted. The cost is that a
  // sample that really shrinks by more than 30% is only accepted again once
  // the big runs are 14 days old; the warning says so.
  const MIN_PROPORCAO = 0.7;
  const JANELA_BASE_DIAS = 14;
  const SEM_AGENCIA = '(sem agência)';

  // --- days and weeks (America/Sao_Paulo, as munic-pro) --------------------

  const FORMATO_DIA = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  });

  // "2026-10-15" for the local date of an epoch-ms timestamp.
  function diaLocal(ts) {
    return FORMATO_DIA.format(new Date(ts));
  }

  const utc = (dia) => {
    const [y, m, d] = dia.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  };
  const iso = (d) => d.toISOString().slice(0, 10);

  function somarDias(dia, n) {
    const d = utc(dia);
    d.setUTCDate(d.getUTCDate() + n);
    return iso(d);
  }

  // { id: "2026-W42", segunda: "2026-10-12" } of an ISO week containing `dia`.
  function semanaIso(dia) {
    const d = utc(dia);
    const dow = (d.getUTCDay() + 6) % 7;          // Monday = 0
    const segunda = new Date(d); segunda.setUTCDate(d.getUTCDate() - dow);
    const quinta = new Date(d); quinta.setUTCDate(d.getUTCDate() - dow + 3);
    const ano = quinta.getUTCFullYear();
    const jan4 = new Date(Date.UTC(ano, 0, 4));
    const dowJan4 = (jan4.getUTCDay() + 6) % 7;
    const n = 1 + Math.round(((quinta - jan4) / 86400000 - 3 + dowJan4) / 7);
    return { id: `${ano}-W${String(n).padStart(2, '0')}`, segunda: iso(segunda) };
  }

  const dm = (dia) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;

  // The columns, as in munic-pro: the two most recent days with a run, shown
  // one by one (this morning against yesterday), and before them the last run
  // of each ISO week, all of them (no window: the table scrolls sideways). A week nobody
  // consulted gets no column: runs are saved when someone opens the panel,
  // not on a schedule, so a blank week says nothing about the agências. The
  // header is just the run's date (dd/mm), so a skipped week shows as a gap
  // between dates.
  function colunasSemanas(execs) {
    if (!execs.length) return [];
    const ordenadas = [...execs].sort((a, b) => a.dia.localeCompare(b.dia));
    const recentes = ordenadas.slice(-2);
    const corte = recentes[0].dia;
    const porSemana = new Map();
    ordenadas.filter((e) => e.dia < corte)
      .forEach((e) => porSemana.set(semanaIso(e.dia).id, e));          // last wins
    const todas = [...porSemana.values(), ...recentes].map((exec) => {
      const s = semanaIso(exec.dia);
      return { id: s.id, segunda: s.segunda, exec, rotulo: dm(exec.dia) };
    });
    return todas;
  }

  // --- a run -----------------------------------------------------------------

  // "Não iniciada" is two opposite populations: households still to be worked
  // (distribuído, baixado no DMC, agendado) and households already closed out
  // without an interview (fechado, vago, recusa, fora de âmbito, outro
  // motivo). The situação da entrevista tells them apart. Anything not known
  // to be closed out counts as still to be worked.
  const SITUACOES_ENCERRADAS = [
    'domicilio fechado', 'domicilio vago', 'recusa do domicilio',
    'domicilio fora de ambito', 'outro motivo',
  ];
  const encerrada = (situacao) => {
    const f = G().fold(situacao);
    return SITUACOES_ENCERRADAS.some((p) => f.startsWith(p));
  };

  // The record stored for one fetch: counts per agência x portal label x
  // Amostra Bio, the household refusals per agência x Bio, and "Não iniciada"
  // split into still-to-work / closed-out. Nothing that identifies a
  // household survives this function.
  function construirExecucao(uf, rows, runTs) {
    const gg = G();
    const agencias = {};
    const contagens = new Map();
    const recusas = new Map();
    const semEntrevista = new Map();
    rows.forEach((r) => {
      // A row without an agência id still counts, under a name of its own:
      // an empty id would read as "no agência chosen" (the whole UF).
      const ag = r.idAgencia || SEM_AGENCIA;
      if (r.agenciaNome || !agencias[ag]) agencias[ag] = r.agenciaNome || agencias[ag] || '';
      const b = gg.ehBio(r) ? 'S' : 'N';
      const k = JSON.stringify([ag, r.andamento, b]);
      contagens.set(k, (contagens.get(k) || 0) + 1);
      if (gg.ehRecusaDomicilio(r)) {
        const kr = JSON.stringify([ag, b]);
        recusas.set(kr, (recusas.get(kr) || 0) + 1);
      }
      if (gg.regra(r.andamento) === 0) {
        const ks = JSON.stringify([ag, encerrada(r.situacaoEntrevista) ? 'E' : 'P', b]);
        semEntrevista.set(ks, (semEntrevista.get(ks) || 0) + 1);
      }
    });
    const dia = diaLocal(runTs);
    const lista = (m) => [...m].map(([k, n]) => [...JSON.parse(k), n]);
    return {
      uf: String(uf),
      dia,
      semana: semanaIso(dia).id,
      run_ts: runTs,
      total: rows.length,
      agencias,
      contagens: lista(contagens),
      recusaDomicilio: lista(recusas),
      semEntrevista: lista(semEntrevista),
    };
  }

  // { salvar, motivo, silencioso }. `resumo` is getResumo(): [{dia, total}].
  //  - an empty run is never saved;
  //  - a run under 70% of the LARGEST run of the last 14 days is skipped as a
  //    probable partial page, with a warning;
  //  - a run smaller than one already saved for the SAME day is skipped
  //    silently: the last run of a day wins, but not with a worse one.
  function avaliarGravacao(rec, resumo) {
    if (!rec.total) return { salvar: false, motivo: 'o relatório veio vazio' };
    const lista = resumo || [];
    const desde = somarDias(rec.dia, -JANELA_BASE_DIAS);
    const maior = lista.filter((r) => r.dia >= desde && r.dia !== rec.dia)
      .reduce((m, r) => (r.total > m ? r.total : m), 0);
    if (maior && rec.total < MIN_PROPORCAO * maior) {
      return {
        salvar: false,
        motivo: `o relatório veio com ${rec.total} domicílios, e a maior consulta dos últimos ${JANELA_BASE_DIAS} dias tem ${maior} ` +
          `(resposta incompleta?). Se a amostra realmente diminuiu, o histórico volta a gravar quando essa consulta tiver mais de ${JANELA_BASE_DIAS} dias`,
      };
    }
    const hoje = lista.find((r) => r.dia === rec.dia);
    if (hoje && hoje.total > rec.total) return { salvar: false, motivo: 'já há uma consulta maior hoje', silencioso: true };
    return { salvar: true, motivo: '' };
  }

  // --- metrics ---------------------------------------------------------------

  // By position in the portal's funnel (aggregate's `regra`):
  // 0 Não iniciada · 1 Todos em andamento · 2/3 selecionado a realizar / em
  // andamento · 4/5 recusa no questionário · 6 finalizada sem Bio · 7
  // finalizada, não elegível · 8/9 Bio 25A agendada / não agendada · 10 25A
  // recusa · 11 25A outro motivo · 12/13 Bio 25B realizada / não realizada ·
  // 14 indefinido.
  //
  // Two populations end differently: a household without a biomarker sample
  // ends at "Finalizada sem Bio"; one with it goes on through 25A/25B. So
  // "Questionário concluído" (everything past the questionnaire) says nothing
  // about Bio work still open, and "Ciclo encerrado" is the real end of each:
  // finalizada sem Bio, não elegível, and 25A/25B once the Bio step is closed
  // (25B either way, or 25A refused / other reason). "Bio a coletar" is what
  // is still open (25A agendada / não agendada).
  // The three refusals stay apart, and "Total" is the only metric that
  // contains every label.
  const METRICAS = [
    { id: 'concluido', nome: 'Questionário concluído', regras: [6, 7, 8, 9, 10, 11, 12, 13] },
    { id: 'ciclo_encerrado', nome: 'Ciclo encerrado (sem Bio ou Bio resolvida)', regras: [6, 7, 10, 11, 12, 13] },
    { id: 'sem_inicio', nome: 'Sem entrevista iniciada', regras: [0] },
    { id: 'sem_inicio_pendente', nome: 'Sem entrevista — ainda a trabalhar', semEntrevista: 'P' },
    { id: 'sem_inicio_encerrado', nome: 'Sem entrevista — encerrado (fechado, vago, recusa, fora de âmbito)', semEntrevista: 'E' },
    { id: 'em_andamento', nome: 'Em andamento', regras: [1, 2, 3] },
    { id: 'recusa_questionario', nome: 'Recusa no questionário', regras: [4, 5] },
    { id: 'recusa_bio', nome: 'Recusa Bio (25A)', regras: [10] },
    { id: 'recusa_domicilio', nome: 'Recusa do domicílio', especial: true },
    { id: 'bio_a_coletar', nome: 'Bio a coletar (25A agendada / não agendada)', regras: [8, 9] },
    { id: 'bio_25a_outro', nome: 'Bio 25A: outro motivo', regras: [11] },
    { id: 'bio_25b_realizada', nome: 'Bio 25B realizada', regras: [12] },
    { id: 'bio_25b_nao_realizada', nome: 'Bio 25B não realizada', regras: [13] },
    { id: 'nao_elegivel', nome: 'Finalizada, selecionado não elegível', regras: [7] },
    { id: 'indefinido', nome: 'Indefinido', regras: [14] },
    { id: 'total', nome: 'Total', todas: true },
  ];

  const ROTULO = 'rotulo:';

  const bioOk = (b, filtro) => !filtro || (filtro === 'sim') === (b === 'S');

  // { n, total } of one run for a metric, scoped to an agência (null = the
  // whole UF) and an Amostra Bio filter. null — an empty cell, never a zero —
  // when there is nothing to count: the agência is absent from that run, has
  // no household on that side of the Bio filter, or the run predates the
  // field the metric needs.
  function valorMetrica(exec, metricaId, agencia, bio) {
    if (agencia && !(agencia in exec.agencias)) return null;
    const gg = G();
    const m = metricaId.startsWith(ROTULO) ? null : METRICAS.find((x) => x.id === metricaId);
    if (m && m.semEntrevista && !exec.semEntrevista) return null;
    let n = 0;
    let total = 0;
    exec.contagens.forEach(([ag, label, b, c]) => {
      if ((agencia && ag !== agencia) || !bioOk(b, bio)) return;
      total += c;
      if (!m) {
        if (label === metricaId.slice(ROTULO.length)) n += c;
        return;
      }
      if (m.especial || m.semEntrevista) return;
      if (m.todas || m.regras.includes(gg.regra(label))) n += c;
    });
    if (m && (m.especial || m.semEntrevista)) {
      const fonte = m.especial ? exec.recusaDomicilio : exec.semEntrevista;
      fonte.forEach((t) => {
        const ag = t[0];
        const grupo = m.especial ? null : t[1];
        const b = m.especial ? t[1] : t[2];
        const c = t[t.length - 1];
        if ((!agencia || ag === agencia) && bioOk(b, bio) && (m.especial || grupo === m.semEntrevista)) n += c;
      });
    }
    return total ? { n, total } : null;
  }

  const nomeDaMetrica = (id) => (id.startsWith(ROTULO)
    ? id.slice(ROTULO.length) : (METRICAS.find((m) => m.id === id) || { nome: id }).nome);

  // Every portal label seen in any run: where a label the panel has never
  // met becomes reachable as a metric of its own.
  function rotulosVistos(execs) {
    const s = new Set();
    execs.forEach((e) => e.contagens.forEach(([, label]) => s.add(label)));
    const gg = G();
    return [...s].sort((a, b) => (gg.classificar(a).ordem - gg.classificar(b).ordem) || a.localeCompare(b, 'pt-BR'));
  }

  // The agências of the shown weeks, named from the latest run that has them.
  function agenciasVistas(colunas) {
    const nomes = new Map();
    colunas.forEach((c) => {
      Object.entries(c.exec.agencias).forEach(([id, nome]) => { nomes.set(id, nome || nomes.get(id) || id); });
    });
    return [...nomes].map(([id, nome]) => ({ id, nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }

  // View 1: one row per agência (+ the UF), one column per week, one metric.
  function tabelaAgencias(execs, { metrica, bio = '' }) {
    const colunas = colunasSemanas(execs);
    const celula = (ag) => colunas.map((c) => valorMetrica(c.exec, metrica, ag, bio));
    return {
      colunas,
      linhas: agenciasVistas(colunas).map((a) => ({ id: a.id, nome: a.nome, celulas: celula(a.id) })),
      uf: { id: '', nome: 'UF inteira', celulas: celula(null) },
    };
  }

  // View 2: one agência (or the UF), the metrics as rows.
  function tabelaUmaAgencia(execs, { agencia = '', bio = '' }) {
    const colunas = colunasSemanas(execs);
    return {
      colunas,
      linhas: METRICAS.map((m) => ({
        id: m.id, nome: m.nome,
        celulas: colunas.map((c) => valorMetrica(c.exec, m.id, agencia || null, bio)),
      })),
    };
  }

  // Long format for analysis outside the extension (and as the only backup
  // of the history): one line per uf, day, agência, label, Bio.
  function linhasCsvLongo(execs) {
    const header = ['uf', 'dia', 'idAgencia', 'agencia', 'andamento', 'amostraBio', 'n'];
    const rows = [];
    const sn = (b) => (b === 'S' ? 'Sim' : 'Não');
    execs.forEach((e) => {
      e.contagens.forEach(([ag, label, b, n]) =>
        rows.push([e.uf, e.dia, ag, e.agencias[ag] || '', label, sn(b), n]));
      e.recusaDomicilio.forEach(([ag, b, n]) =>
        rows.push([e.uf, e.dia, ag, e.agencias[ag] || '', '(situação) Recusa do domicílio', sn(b), n]));
      (e.semEntrevista || []).forEach(([ag, grupo, b, n]) =>
        rows.push([e.uf, e.dia, ag, e.agencias[ag] || '',
          `(situação) Não iniciada — ${grupo === 'E' ? 'encerrado' : 'ainda a trabalhar'}`, sn(b), n]));
    });
    return { header, rows };
  }

  window.__sigcProHistoricoAgregar = {
    MIN_PROPORCAO, JANELA_BASE_DIAS, SEM_AGENCIA, METRICAS, ROTULO,
    diaLocal, semanaIso, somarDias, colunasSemanas,
    construirExecucao, avaliarGravacao,
    valorMetrica, nomeDaMetrica, rotulosVistos, agenciasVistas,
    tabelaAgencias, tabelaUmaAgencia, linhasCsvLongo,
  };
})();
