import { vi } from 'vitest';
import { act } from 'react';

// React 19 removed react-dom/test-utils; @testing-library/react@16 still
// imports it. Provide a mock so the import doesn't throw.
vi.mock('react-dom/test-utils', () => ({ act }));

import '@testing-library/jest-dom/vitest';

// Node 24+ ships a native `localStorage` global that is non-functional
// unless `--localstorage-file=PATH` is passed. In the jsdom test env it
// shadows JSDOM's working `window.localStorage`, breaking any code that
// touches the bare `localStorage` global. Force the global to point at
// JSDOM's Storage so tests behave like a real browser.
// Capture JSDOM's Storage objects first: in jsdom `globalThis === window`, so a
// getter that reads `window.xStorage` would call itself forever.
for (const key of ['localStorage', 'sessionStorage'] as const) {
    if (typeof window === 'undefined') break;
    let store: Storage | undefined;
    try { store = window[key]; } catch { store = undefined; }
    if (!store) continue;
    Object.defineProperty(globalThis, key, {
        configurable: true,
        enumerable: true,
        get: () => store,
        set: (v: Storage) => { store = v; },
    });
}
