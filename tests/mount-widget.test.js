import { test, expect } from 'bun:test';

// Observer-construction tracking lives in tests/setup.js, not here. bun
// preloads setup.js before ANY test file's module code runs (per
// bunfig.toml), so the wrapper it installs is in place before whichever
// file's top-level mountWidget() call happens to run first — settings.js
// and ultimo-movimento-export.js both call window.__sigcPro.mountWidget()
// at their own import-time top level, and window.__sigcPro is one object
// shared across bun's whole test process by default (no --isolate).
// mountWidget's `mountObserver` singleton is guarded by
// `if (!mountObserver)`, so only ONE file's mountWidget() call ever
// actually constructs it; a tracker installed inside an individual test
// file (rather than the shared preload) would only count correctly when
// that file happened to run first, which bun does not guarantee. Reading
// the shared, preload-installed tracker here instead makes both the count
// and the live-instance handle correct regardless of file execution
// order — this file no longer needs to "win the race" to observe
// anything accurately.
const tracker = globalThis.__sigcProObserverTracker;

await import('../extension/common/sigc-common.js');
const P = window.__sigcPro;

// happy-dom delivers MutationObserver batches asynchronously (one
// microtask) — a plain setTimeout(0) reliably runs after it.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// happy-dom 20.11.0's MutationObserver has a real delivery bug: an
// instance only ever invokes its callback ONCE, for the first mutation
// batch after observe() — later mutations on the same node are silently
// dropped (confirmed directly against happy-dom, independent of this
// file: a bare `new MutationObserver(cb).observe(body, {childList:true,
// subtree:true})` fires for the first appendChild but never for a
// second). Real Chrome has no such limitation, and mountWidget's single
// persistent observer (the whole point of this task) is spec-correct;
// only the test double is broken. `mutate()` re-arms via the SHARED
// tracker's live instance/args (not a locally-captured one — see above),
// so the re-arm works correctly whichever file's mountWidget() call
// originally constructed the observer. Applied only around the mutation
// that needs a FRESH delivery (not on every flush, which would race a
// delivery already in flight).
async function mutate(change) {
  if (tracker.live && tracker.liveObserveArgs) {
    tracker.live.disconnect();
    tracker.live.observe(...tracker.liveObserveArgs);
  }
  change();
  await flush();
}

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

test('insert: "after" places the widget as the anchor\'s next sibling, not inside it', () => {
  const id = uid('after');
  const container = document.createElement('div');
  const anchorBtn = document.createElement('button');
  anchorBtn.id = `${id}-anchor`;
  const trailing = document.createElement('span');
  trailing.id = `${id}-trailing`;
  container.appendChild(anchorBtn);
  container.appendChild(trailing);
  document.body.appendChild(container);

  P.mountWidget({
    id,
    anchor: () => document.getElementById(`${id}-anchor`),
    insert: 'after',
    build: () => makeButton(id),
  });

  const built = document.getElementById(id);
  expect(built).not.toBeNull();
  expect(built.parentElement).toBe(container);
  expect(built.previousElementSibling).toBe(anchorBtn);
  expect(built.nextElementSibling).toBe(trailing);
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
  await mutate(() => document.body.appendChild(anchor));
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
  await mutate(() => {
    document.body.appendChild(document.createElement('div'));
    document.body.appendChild(document.createElement('div'));
  });
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
  // class mutation → shared observer tick
  await mutate(() => anchor.classList.add('poke'));
  expect(document.getElementById(id)).toBeNull();

  visible = true;
  // second delivery on the same observer instance — needs re-arming, see mutate()
  await mutate(() => anchor.classList.remove('poke'));
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
  await mutate(() => document.body.appendChild(anchor));
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
  await mutate(() => document.body.appendChild(anchor));
  expect([...anchor.children].map((el) => el.id)).toEqual([a, b]);
});

test('recheckMounts re-evaluates when() immediately without waiting for a mutation', () => {
  const id = uid('recheck');
  const anchorCls = uid('recheck-anchor');
  const anchor = document.createElement('div');
  anchor.className = anchorCls;
  document.body.appendChild(anchor);
  let gate = false;
  P.mountWidget({
    id,
    anchor: () => document.querySelector(`.${anchorCls}`),
    when: () => gate,
    build: () => makeButton(id),
  });
  expect(document.getElementById(id)).toBeNull();
  gate = true;
  P.recheckMounts();
  expect(document.getElementById(id)).not.toBeNull();
});

// Declaration order matters: this must be the LAST test in the file so
// every registration above has already happened. tracker.count is
// process-wide and preload-installed (see top-of-file comment), so this
// stays a direct proof — exactly one construction ever happened, however
// many widgets registered across however many files — rather than a
// weaker structural stand-in.
test('exactly one MutationObserver serves all mounts', () => {
  expect(tracker.count).toBe(1);
});
