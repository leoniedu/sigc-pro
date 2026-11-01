// SIGC-PRO feature: Gerenciamento da Coleta — aggregation. Pure functions
// over the rows gerenciamento-parse.js produces; no DOM, no network.
// Spec: docs/superpowers/specs/2026-10-15-gerenciamento-coleta-design.md
//
// Invariant every table here keeps: the cells of a row add up to its
// total, and the rows add up to the scope. The columns are the portal's own
// `andamento` labels, one each; a label this file does not know gets its
// column all the same (counted under its raw text, flagged `novo`) — never
// dropped and never folded into a neighbour.
(function () {
  'use strict';

  // Shared with the parser (loaded first): one comparison form for both.
  const fold = (s) => window.__sigcProGerenciamento.fold(s);

  // Portal order of the funnel: the position of the first matching rule
  // orders the columns, Mulher right after Homem within a rule. Matched on
  // the folded label, so a cosmetic change in the portal's text (accent,
  // dash, spacing) does not turn a known stage into a "new" one.
  const RULES = [
    /^nao iniciada$/,
    /^todos os moradores em andamento$/,
    /^(homem|mulher) selecionad[oa] a realizar$/,
    /^(homem|mulher) selecionad[oa] em andamento/,
    /^todos os moradores iniciada e interrompida por recusa$/,
    /^(homem|mulher) selecionad[oa] com recusa/,
    /^finalizada completa .*upa sem bio$/,
    /^finalizada completa .*nao elegivel$/,
    /^25a \(bio\) agendada$/,
    /^25a \(bio\) nao agendada$/,
    /^25a \(bio\) nao iniciada por recusa$/,
    /^25a \(bio\) nao iniciada por outro motivo$/,
    /^25b \(coleta bio\) realizada$/,
    /^25b \(coleta bio\) nao realizada$/,
    /^indefinido$/,
  ];

  // Labels shown under a clearer name. "Não iniciada" is not "not yet
  // visited": it is every household with no part of the questionnaire
  // started, which includes those already closed out without an interview
  // (fechado, vago, recusa, fora de âmbito) — see `dica`.
  const EXIBIDOS = {
    'nao iniciada': {
      nome: 'Sem entrevista iniciada',
      dica: 'Rótulo do portal: "Não iniciada". Nenhuma parte do questionário foi iniciada: ' +
        'inclui os domicílios ainda não visitados e os já encerrados sem entrevista ' +
        '(fechado, vago/uso ocasional, recusa do domicílio, fora de âmbito). ' +
        'Veja a situação da entrevista na aba Domicílios.',
    },
  };

  // { conhecido, ordem } for a raw andamento label.
  function classificar(andamento) {
    const f = fold(andamento);
    const i = RULES.findIndex((re) => re.test(f));
    if (i < 0) return { conhecido: false, ordem: Infinity };
    // Mulher right after Homem within a rule, so the pair reads together.
    return { conhecido: true, ordem: i * 10 + (f.startsWith('mulher') ? 1 : 0) };
  }

  const ehBio = (r) => fold(r.bio) === 'sim';
  const ehRecusaDomicilio = (r) => fold(r.situacaoEntrevista) === 'recusa do domicilio';

  // Scope: bio 'sim' | 'nao'; empty / absent = no restriction.
  function filtrar(rows, escopo) {
    const { bio } = escopo || {};
    return rows.filter((r) => !bio || (bio === 'sim') === ehBio(r));
  }

  // Position of the label in the portal's funnel (0-14), -1 for a label this
  // file does not know. The history groups labels into metrics by it.
  const regra = (andamento) => {
    const o = classificar(andamento).ordem;
    return Number.isFinite(o) ? Math.floor(o / 10) : -1;
  };

  function nomeMunicipio(codigo) {
    const f = window.__sigcPro && window.__sigcPro.municipioFromControle;
    return (f && f(codigo)) || codigo;
  }

  // Visible warnings for the scope: new labels, odd Bio values, and the
  // one invariant the data is known to keep (UPA sem Bio never carries a
  // biomarker sample).
  function avisos(rows) {
    const out = [];
    const novos = [...new Set(rows.map((r) => r.andamento))].filter((a) => !classificar(a).conhecido);
    if (novos.length) out.push(`${novos.length} rótulo(s) novo(s) de andamento: ${novos.join('; ')}.`);
    const bioEstranho = rows.filter((r) => !['sim', 'nao'].includes(fold(r.bio))).length;
    if (bioEstranho) out.push(`${bioEstranho} linha(s) com Amostra Biomarcadores diferente de Sim/Não (contadas como Não).`);
    const semBioComAmostra = rows.filter((r) => ehBio(r) && /upa sem bio$/.test(fold(r.andamento))).length;
    if (semBioComAmostra) out.push(`${semBioComAmostra} domicílio(s) "UPA sem Bio" com amostra de biomarcadores = Sim.`);
    return out;
  }

  // One row per município / agência, one column per andamento label present
  // (known ones in portal order, new ones after, flagged). The household
  // refusal rides beside the cells, not inside them: it comes from the
  // situação da entrevista, overlaps `andamento`, and must not be summed.
  function tabelaPor(rows, grupo) {
    const chaveDe = grupo === 'agencia' ? (r) => r.idAgencia : (r) => r.municipio;
    const nomeDe = grupo === 'agencia'
      ? (r) => r.agenciaNome || r.idAgencia
      : (r) => nomeMunicipio(r.municipio);

    const colMap = new Map();
    rows.forEach((r) => {
      if (colMap.has(r.andamento)) return;
      const c = classificar(r.andamento);
      const ex = EXIBIDOS[fold(r.andamento)];
      colMap.set(r.andamento, {
        id: r.andamento, nome: ex ? ex.nome : r.andamento, dica: ex ? ex.dica : '',
        novo: !c.conhecido, ordem: c.ordem,
      });
    });
    const colunas = [...colMap.values()]
      .sort((a, b) => (a.ordem - b.ordem) || a.id.localeCompare(b.id, 'pt-BR'));

    const grupos = new Map();
    rows.forEach((r) => {
      const k = chaveDe(r);
      const g = grupos.get(k) || { chave: k, nome: nomeDe(r), total: 0, sim: 0, nao: 0, recusaDomicilio: 0, celulas: {} };
      g.total += 1;
      if (ehBio(r)) g.sim += 1; else g.nao += 1;
      if (ehRecusaDomicilio(r)) g.recusaDomicilio += 1;
      g.celulas[r.andamento] = (g.celulas[r.andamento] || 0) + 1;
      grupos.set(k, g);
    });
    const linhas = [...grupos.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    const totais = { total: 0, sim: 0, nao: 0, recusaDomicilio: 0, celulas: {} };
    linhas.forEach((g) => {
      totais.total += g.total; totais.sim += g.sim; totais.nao += g.nao;
      totais.recusaDomicilio += g.recusaDomicilio;
      Object.entries(g.celulas).forEach(([c, n]) => { totais.celulas[c] = (totais.celulas[c] || 0) + n; });
    });
    return { colunas, linhas, totais };
  }

  window.__sigcProGerenciamento = Object.assign(window.__sigcProGerenciamento || {}, {
    classificar,
    regra,
    ehBio,
    ehRecusaDomicilio,
    filtrar,
    nomeMunicipio,
    avisos,
    tabelaPor,
  });
})();
