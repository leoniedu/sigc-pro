// Registers happy-dom globals (window, document, MutationObserver, …)
// before any test file loads sigc-common.js.
import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register();
