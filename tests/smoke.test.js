import { test, expect } from 'bun:test';

await import('../extension/common/sigc-common.js');

test('sigc-common loads against happy-dom and exposes __sigcPro', () => {
  expect(typeof window.__sigcPro).toBe('object');
  expect(typeof window.__sigcPro.whenReady).toBe('function');
  expect(typeof window.__sigcPro.readAgendaSlots).toBe('function');
});
