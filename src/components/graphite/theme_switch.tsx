/**
 * Light / dark switch for the signed-out pages (landing, sign in, sign up,
 * invites, password links). Dark is the default; the choice applies at once
 * and is remembered in this browser, so the app opens in it after sign-in
 * (a theme saved on the profile still wins — `sync_from_profile`).
 */
import { Moon, Sun } from 'lucide-react';

import { apply_theme, resolve_theme, use_theme } from '@/lib/theme';

/** Icon button that flips between the light and dark theme. */
export function Theme_switch({ class_name = '' }: { class_name?: string }) {
	const dark = resolve_theme(use_theme()) === 'dark';
	const label = dark ? 'Switch to light theme' : 'Switch to dark theme';
	return (
		<button
			type="button"
			onClick={() => apply_theme(dark ? 'light' : 'dark')}
			aria-label={label}
			title={label}
			className={`grid h-9 w-9 place-items-center rounded-lg border border-[var(--g-line)] bg-[var(--g-panel)] text-[var(--g-ink-2)] transition hover:text-[var(--g-ink)] ${class_name}`}
		>
			{dark ? <Sun aria-hidden className="h-4 w-4" /> : <Moon aria-hidden className="h-4 w-4" />}
		</button>
	);
}
