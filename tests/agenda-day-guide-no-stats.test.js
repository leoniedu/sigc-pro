import { describe, test, expect } from 'bun:test';

await import('../extension/common/sigc-common.js');
await import('../extension/common/municipios.js');
await import('../extension/features/agenda-day-guide/route-map.js');
await import('../extension/features/agenda-day-guide/agenda-day-guide.js');

const { buildSummaryPanel, buildTeamPanel, dayNumberMap } = window.__sigcPro.dayGuide;

function row({ horaInicio = '09:00', controle = '2927408000123', domicilio = 'D1' } = {}) {
  return {
    reservado: true, horaInicio, horaFim: '09:30', nome: 'Fulano', controle,
    domicilio, equipe: 'Equipe A', dtNascimento: '', telefone: '',
    endereco: '', sexo: '', idade: '', observacao: '',
  };
}

// Stats were removed from every tab by an explicit decision (2026-08-18):
// the guide is the day's household list, not a dashboard. These pin the
// absence so a stats table cannot quietly return.
describe('no stats on any tab', () => {
  const RETIRED = ['Primeiro agendamento', 'Último agendamento',
    'Zonas distintas', 'Média de agendamentos', 'Taxa de ocupação',
    'reservado(s)', 'ocupação', 'zona(s) distinta(s)'];

  test('Resumo, Lab and team panels carry no stat labels', () => {
    const rows = [row()];
    const nums = dayNumberMap(rows);
    const superficies = [
      buildSummaryPanel(rows, false, null, nums),
      buildSummaryPanel(rows, true, null, nums),
      buildTeamPanel({ equipe: 'Equipe A', rows }, null, 0, nums),
    ];
    superficies.forEach((html) => {
      RETIRED.forEach((s) => expect(html).not.toContain(s));
      expect(html).not.toContain('teamstats');
    });
  });
});
