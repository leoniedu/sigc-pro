// Registers happy-dom globals (window, document, MutationObserver, …)
// before any test file loads sigc-common.js.
import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register();

// Instrument MutationObserver here, in the preload that bunfig.toml runs
// before EVERY test file's own module code (including each file's
// `await import(...)` of sigc-common.js and any feature module that
// calls mountWidget() at its own import-time top level). sigc-common's
// mountWidget() constructs its one process-wide `mountObserver` lazily,
// on whichever file's first mountWidget() call happens to run first — so
// wrapping the constructor inside an individual test file only counts
// correctly when that file is guaranteed to run before every other one,
// which bun does not guarantee under its default (non---isolate) mode.
// Installing the wrapper here instead, before any file's import chain
// starts, makes the count and the live-instance handle correct
// regardless of file execution order.
globalThis.__sigcProObserverTracker = { count: 0, live: null, liveObserveArgs: null };
const RealMutationObserver = globalThis.MutationObserver;
globalThis.MutationObserver = class extends RealMutationObserver {
  constructor(cb) {
    super(cb);
    globalThis.__sigcProObserverTracker.count += 1;
    globalThis.__sigcProObserverTracker.live = this;
  }
  observe(target, options) {
    globalThis.__sigcProObserverTracker.liveObserveArgs = [target, options];
    return super.observe(target, options);
  }
};
