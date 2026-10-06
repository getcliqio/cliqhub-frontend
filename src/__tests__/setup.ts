import { vi } from 'vitest';
import { act } from 'react';

// React 19 removed react-dom/test-utils; @testing-library/react@16 still
// imports it. Provide a mock so the import doesn't throw.
vi.mock('react-dom/test-utils', () => ({ act }));

import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';

// CI runners are slower than a laptop: findBy*/waitFor get 5s (default 1s),
// so a busy runner doesn't fail a test whose UI is merely late.
configure({ asyncUtilTimeout: 5000 });

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

// Some Node / jsdom combinations leave `localStorage` undefined: give the
// tests a simple in-memory Storage so code that remembers things works.
class Memory_storage implements Storage {
    private m = new Map<string, string>();
    get length() { return this.m.size; }
    clear() { this.m.clear(); }
    getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
    key(i: number) { return [...this.m.keys()][i] ?? null; }
    removeItem(k: string) { this.m.delete(k); }
    setItem(k: string, v: string) { this.m.set(k, String(v)); }
}
if (typeof window !== 'undefined') {
    for (const key of ['localStorage', 'sessionStorage'] as const) {
        let ok = false;
        try { ok = Boolean(window[key]); } catch { ok = false; }
        if (ok) continue;
        const store = new Memory_storage();
        Object.defineProperty(window, key, { configurable: true, get: () => store });
        Object.defineProperty(globalThis, key, { configurable: true, get: () => store });
    }
}

// You work in one org at a time: tests start in the fixtures' first org
// (measureone), as if the user had picked it before. Tests about choosing
// an org clear this themselves.
import { beforeEach } from 'vitest';
beforeEach(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.clear();
    window.localStorage.setItem('cliqhub.last_org', 'measureone');
});
