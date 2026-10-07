import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
	type ReactNode,
} from 'react';

import { apply_theme, resolve_theme, use_theme } from '@/lib/theme';

/**
 * App-wide theme (light / dark / follow-system) + colour palette.
 * The light/dark axis is owned by `lib/theme.ts` (default dark, saved under
 * `cliqhub.theme`, painted on <html> by `paint()`); this provider only exposes
 * it to the older components (`useTheme`) so the two can never disagree.
 * Palette
 * (default indigo vs. MeasureOne navy). Both persist to localStorage
 * and apply CSS classes to <html>:
 *   - `dark` for the light/dark axis (existing Tailwind `dark:*` variant)
 *   - `palette-measureone` for the palette axis; the light/dark
 *     Tailwind utilities keep the SAME class names, but `index.css`
 *     repaints them under this scope so no component needs to change.
 * This keeps the whole palette swap in one file + one class flip.
 */

export type Theme_choice = 'light' | 'dark' | 'system';
export type Palette_choice = 'default' | 'measureone';

interface Theme_context_value {
	choice: Theme_choice;
	set_choice: (next: Theme_choice) => void;
	/** Resolved effective theme after applying system preference. */
	resolved: 'light' | 'dark';
	toggle: () => void;
	palette: Palette_choice;
	set_palette: (next: Palette_choice) => void;
	toggle_palette: () => void;
}

const PALETTE_STORAGE_KEY = 'cliqhub.palette';

const Theme_context = createContext<Theme_context_value | null>(null);

function read_stored_palette(): Palette_choice {
	if (typeof window === 'undefined') return 'default';
	try {
		const raw = window.localStorage.getItem(PALETTE_STORAGE_KEY);
		if (raw === 'default' || raw === 'measureone') return raw;
	} catch {
		/* ignore storage failures */
	}
	return 'default';
}

function system_prefers_dark(): boolean {
	if (typeof window === 'undefined' || !window.matchMedia) return false;
	return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function apply_palette_class(palette: Palette_choice) {
	if (typeof document === 'undefined') return;
	const root = document.documentElement;
	if (palette === 'measureone') {
		root.classList.add('palette-measureone');
		root.setAttribute('data-palette', 'measureone');
		return;
	}
	root.classList.remove('palette-measureone');
	root.setAttribute('data-palette', 'default');
}

export function ThemeProvider({ children }: { children: ReactNode }) {
	const choice = use_theme();
	const [system_dark, set_system_dark] = useState<boolean>(() => system_prefers_dark());
	const [palette, set_palette_state] = useState<Palette_choice>(() => read_stored_palette());

	useEffect(() => {
		if (typeof window === 'undefined' || !window.matchMedia) return;
		const mq = window.matchMedia('(prefers-color-scheme: dark)');
		const on_change = (e: MediaQueryListEvent) => set_system_dark(e.matches);
		mq.addEventListener('change', on_change);
		return () => mq.removeEventListener('change', on_change);
	}, []);

	// `system_dark` re-renders on an OS switch; `resolve_theme` reads the same media query.
	const resolved: 'light' | 'dark' = choice === 'system' ? (system_dark ? 'dark' : 'light') : resolve_theme(choice);

	useEffect(() => {
		apply_palette_class(palette);
	}, [palette]);

	const set_choice = useCallback((next: Theme_choice) => apply_theme(next), []);

	// Simple two-state cycle for the top-bar button: light <-> dark ("system" stays in Settings).
	const toggle = useCallback(() => apply_theme(resolved === 'dark' ? 'light' : 'dark'), [resolved]);

	const set_palette = useCallback((next: Palette_choice) => {
		set_palette_state(next);
		try {
			window.localStorage.setItem(PALETTE_STORAGE_KEY, next);
		} catch {
			/* ignore storage failures */
		}
	}, []);

	const toggle_palette = useCallback(() => {
		set_palette_state((prev) => {
			const next: Palette_choice = prev === 'measureone' ? 'default' : 'measureone';
			try {
				window.localStorage.setItem(PALETTE_STORAGE_KEY, next);
			} catch {
				/* ignore storage failures */
			}
			return next;
		});
	}, []);

	const value = useMemo<Theme_context_value>(
		() => ({ choice, set_choice, resolved, toggle, palette, set_palette, toggle_palette }),
		[choice, set_choice, resolved, toggle, palette, set_palette, toggle_palette],
	);

	return <Theme_context.Provider value={value}>{children}</Theme_context.Provider>;
}

/**
 * Read the current theme. Falls back to a light-mode no-op value when
 * used outside a `<ThemeProvider>` (e.g. isolated component tests) so
 * downstream components never need to conditionally render.
 */
export function useTheme(): Theme_context_value {
	const ctx = useContext(Theme_context);
	if (ctx) return ctx;
	return {
		choice: 'light',
		set_choice: () => {},
		resolved: 'light',
		toggle: () => {},
		palette: 'default',
		set_palette: () => {},
		toggle_palette: () => {},
	};
}
