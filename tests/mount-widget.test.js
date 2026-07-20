import { test, expect } from 'bun:test';

// Count observer constructions to prove the layer creates exactly ONE no
// matter how many widgets register. sigc-common resolves the bare
// `MutationObserver` global at call time (lazy start on first
// mountWidget), so installing the wrapper here — before any mountWidget
// call — counts correctly even if another test file imported
// sigc-common first.
let observerCount = 0;
const RealMutationObserver = globalThis.MutationObserver;
globalThis.MutationObserver = class extends RealMutationObserver {
  constructor(cb) {
    super(cb);
    observerCount += 1;
  }
};

await import('../extension/common/sigc-common.js');
const P = window.__sigcPro;

// happy-dom delivers MutationObserver batches asynchronously.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// Unique ids/classes per test: the registry is append-only (like in the
// real page), so stale mounts from earlier tests must never find their
// anchors again.
let n = 0;
const uid = (name) => `t-${name}-${++n}`;

function makeButton(id) {
  const b = document.createElement('button');
  b.id = id;
  return b;
}

test('mounts immediately when the anchor already exists', () => {
  const id = uid('now');
  const anchor = document.createElement('div');
  anchor.className = id;
  document.body.appendChild(anchor);
  P.mountWidget({
    id,
    anchor: () => document.querySelector(`.${id}`),
    build: () => makeButton(id),
  });
  expect(document.getElementById(id)?.parentElement).toBe(anchor);
});

test('mounts when the anchor appears via DOM mutation', async () => {
  const id = uid('appear');
  P.mountWidget({
    id,
    anchor: () => document.querySelector(`.${id}`),
    build: () => makeButton(id),
  });
  expect(document.getElementById(id)).toBeNull();

  const anchor = document.createElement('div');
  anchor.className = id;
  document.body.appendChild(anchor);
  await flush();
  expect(document.getElementById(id)?.parentElement).toBe(anchor);
});

test('build runs once while the widget stays mounted', async () => {
  const id = uid('once');
  const anchor = document.createElement('div');
  anchor.className = id;
  document.body.appendChild(anchor);
  let builds = 0;
  P.mountWidget({
    id,
    anchor: () => document.querySelector(`.${id}`),
    build: () => {
      builds += 1;
      return makeButton(id);
    },
  });
  document.body.appendChild(document.createElement('div'));
  document.body.appendChild(document.createElement('div'));
  await flush();
  expect(builds).toBe(1);
});

test('when() gate removes and re-inserts the widget', async () => {
  const id = uid('gate');
  const anchor = document.createElement('div');
  anchor.className = id;
  document.body.appendChild(anchor);
  let visible = true;
  P.mountWidget({
    id,
    anchor: () => document.querySelector(`.${id}`),
    when: () => visible,
    build: () => makeButton(id),
  });
  expect(document.getElementById(id)).not.toBeNull();

  visible = false;
  anchor.classList.add('poke'); // class mutation → shared observer tick
  await flush();
  expect(document.getElementById(id)).toBeNull();

  visible = true;
  anchor.classList.remove('poke');
  await flush();
  expect(document.getElementById(id)).not.toBeNull();
});

test('a throwing mount does not break the others', async () => {
  const bad = uid('bad');
  const good = uid('good');
  P.mountWidget({
    id: bad,
    anchor: () => {
      throw new Error('boom');
    },
    build: () => makeButton(bad),
  });
  P.mountWidget({
    id: good,
    anchor: () => document.querySelector(`.${good}`),
    build: () => makeButton(good),
  });
  const anchor = document.createElement('div');
  anchor.className = good;
  document.body.appendChild(anchor);
  await flush();
  expect(document.getElementById(good)).not.toBeNull();
});

test('widgets sharing an anchor insert in registration order', async () => {
  const a = uid('ord-a');
  const b = uid('ord-b');
  const cls = uid('ord-anchor');
  P.mountWidget({ id: a, anchor: () => document.querySelector(`.${cls}`), build: () => makeButton(a) });
  P.mountWidget({ id: b, anchor: () => document.querySelector(`.${cls}`), build: () => makeButton(b) });
  const anchor = document.createElement('div');
  anchor.className = cls;
  document.body.appendChild(anchor);
  await flush();
  expect([...anchor.children].map((el) => el.id)).toEqual([a, b]);
});

// Declaration order matters: this must be the LAST test in the file so
// every registration above has already happened.
test('exactly one MutationObserver serves all mounts', () => {
  expect(observerCount).toBe(1);
});
