import { describe, test, expect } from 'bun:test';

await import('../extension/common/sigc-common.js');
await import('../extension/features/agenda-day-guide/route-map.js');
await import('../extension/features/agenda-day-guide/agenda-day-guide.js');

const { buildSlotCard } = window.__sigcPro.dayGuide;

function row({ reservado = true, horaInicio = '09:00', horaFim = '09:30', nome = 'Sileide da Silva Eufrazio',
  controle = '290570120000125', domicilio = '14', telefone = '(71)999093137' } = {}) {
  return { reservado, horaInicio, horaFim, nome, controle, domicilio, telefone, equipe: 'A' };
}

function info(extra = {}) {
  return { lat: -12.9, lon: -38.5, zona: 'Nome-da-Zona', idZona: '29Z9XU', ...extra };
}

describe('buildSlotCard — Agência / Entrevistador', () => {
  test('renders Agência and Entrevistador in the confirmed order', () => {
    const enderecos = new Map([['290570120000125|14',
      info({ agencia: '290570100', entrevistador: 'Fulano de Tal' })]]);
    const html = buildSlotCard(row(), enderecos, null, '#005a9c', 'team-0', true);
    const tel = html.indexOf('Tel:');
    const agencia = html.indexOf('Agência:');
    const controle = html.indexOf('Controle:');
    const dom = html.indexOf('Dom:');
    const zona = html.indexOf('Zona:');
    const entrevistador = html.indexOf('Entrevistador:');
    expect([tel, agencia, controle, dom, zona, entrevistador].every((i) => i !== -1)).toBe(true);
    expect(tel).toBeLessThan(agencia);
    expect(agencia).toBeLessThan(controle);
    expect(controle).toBeLessThan(dom);
    expect(dom).toBeLessThan(zona);
    expect(zona).toBeLessThan(entrevistador);
    expect(html).toContain('Agência: 290570100');
    expect(html).toContain('Entrevistador: Fulano de Tal');
    expect(html).toContain('Zona: 29Z9XU Nome-da-Zona');
  });

  test('omits Agência and Entrevistador when absent from the endereços entry', () => {
    const enderecos = new Map([['290570120000125|14', info()]]);
    const html = buildSlotCard(row(), enderecos, null, '#005a9c', 'team-0', true);
    expect(html).not.toContain('Agência:');
    expect(html).not.toContain('Entrevistador:');
  });

  test('omits both when there is no endereços map at all', () => {
    const html = buildSlotCard(row(), null, null, '#005a9c', 'team-0', true);
    expect(html).not.toContain('Agência:');
    expect(html).not.toContain('Entrevistador:');
  });

  test('escapes HTML in agencia/entrevistador values', () => {
    const enderecos = new Map([['290570120000125|14',
      info({ agencia: '<b>A1</b>', entrevistador: '<script>x</script>' })]]);
    const html = buildSlotCard(row(), enderecos, null, '#005a9c', 'team-0', true);
    expect(html).not.toContain('<script>x</script>');
    expect(html).not.toContain('<b>A1</b>');
  });
});
