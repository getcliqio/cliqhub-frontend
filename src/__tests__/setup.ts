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
if (typeof window !== 'undefined' && window.localStorage) {
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        enumerable: true,
        get: () => window.localStorage,
        set: (v) => {
            (window as unknown as { localStorage: Storage }).localStorage = v;
        },
    });
}
if (typeof window !== 'undefined' && window.sessionStorage) {
    Object.defineProperty(globalThis, 'sessionStorage', {
        configurable: true,
        enumerable: true,
        get: () => window.sessionStorage,
        set: (v) => {
            (window as unknown as { sessionStorage: Storage }).sessionStorage = v;
        },
    });
}
