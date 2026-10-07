/**
 * Colour theme for the signed-in app: dark (default), light, or follow the
 * system. The choice is saved on the person's profile (`preferences.theme`,
 * via `POST /v1/users/update_profile`) and mirrored in this browser so the
 * first paint already has the right colours. Applied as `data-g-theme` on
 * <html>; `styles/graphite.css` holds the light values.
 */
import { useEffect, useState } from 'react';

export type Theme = 'dark' | 'light' | 'system';

const KEY = 'cliqhub.theme';
const EVENT = 'cliqhub:theme';

export function is_theme(v: unknown): v is Theme {
	return v === 'dark' || v === 'light' || v === 'system';
}

export function read_theme(): Theme {
	try {
		const v = window.localStorage.getItem(KEY);
		return is_theme(v) ? v : 'dark';
	} catch {
		return 'dark';
	}
}

function system_light(): boolean {
	try { return window.matchMedia('(prefers-color-scheme: light)').matches; } catch { return false; }
}

export function resolve_theme(t: Theme): 'dark' | 'light' {
	return t === 'system' ? (system_light() ? 'light' : 'dark') : t;
}

/**
 * Paint the page: Graphite's `data-g-theme`, plus the older pages' `dark` class and `data-theme`
 * (`lib/theme_context.tsx` shares the `cliqhub.theme` key but only reads it on load). Both must
 * match, or the old global `html.dark` rules (inputs, table headers) stay dark inside a light app.
 */
function paint(resolved: 'dark' | 'light'): void {
	const root = document.documentElement;
	root.dataset.gTheme = resolved;
	root.classList.toggle('dark', resolved === 'dark');
	root.setAttribute('data-theme', resolved);
}

/** Paint with `t` now and remember it in this browser. */
export function apply_theme(t: Theme): void {
	paint(resolve_theme(t));
	try { window.localStorage.setItem(KEY, t); } catch { /* storage unavailable */ }
	window.dispatchEvent(new CustomEvent(EVENT, { detail: t }));
}

/** Boot: apply the remembered choice and follow the OS while it is "system". */
export function init_theme(): void {
	paint(resolve_theme(read_theme()));
	try {
		window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
			if (read_theme() === 'system') paint(resolve_theme('system'));
		});
	} catch { /* no matchMedia */ }
}

/** The profile's theme as last seen this page load (see {@link sync_from_profile}). */
let profile_seen: string | undefined;

/**
 * Apply the theme saved on the profile — only when the profile's value CHANGES (first sight
 * on this page load, or another sign-in). The in-memory profile isn't refreshed after you pick
 * a theme here, so re-applying it on every page would flip you back (e.g. to dark on HUGs).
 */
export function sync_from_profile(saved: unknown): void {
	if (!is_theme(saved) || saved === profile_seen) return;
	profile_seen = saved;
	if (saved !== read_theme()) apply_theme(saved);
}

/** Tests only: forget what the profile said. */
export function reset_profile_sync(): void {
	profile_seen = undefined;
}

/** The current choice, kept in sync across components. */
export function use_theme(): Theme {
	const [t, set_t] = useState<Theme>(() => read_theme());
	useEffect(() => {
		const on = (e: Event) => set_t((e as CustomEvent<Theme>).detail);
		window.addEventListener(EVENT, on);
		return () => window.removeEventListener(EVENT, on);
	}, []);
	return t;
}
