/**
 * Signed-out pages follow the same theme as the app: dark by default, a
 * light/dark switch on every page, and the older ThemeProvider never
 * disagrees with it (one source: lib/theme).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

import { Theme_switch } from '@/components/graphite/theme_switch';
import { Auth_shell } from '@/components/graphite/g_auth';
import { ThemeProvider, useTheme } from '@/lib/theme_context';
import { apply_theme, read_theme } from '@/lib/theme';

function Show() {
	const { resolved, toggle } = useTheme();
	return <button type="button" onClick={toggle}>{resolved}</button>;
}

beforeEach(() => {
	window.localStorage.removeItem('cliqhub.theme');
	const root = document.documentElement;
	delete root.dataset.gTheme;
	root.classList.remove('dark');
	root.removeAttribute('data-theme');
	// A light-mode OS must not turn the default light.
	vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('light'), addEventListener() {}, removeEventListener() {} }));
});

describe('signed-out theme', () => {
	it('every auth page has the switch, and it flips dark ↔ light on the whole page', () => {
		apply_theme('dark');
		render(<MemoryRouter><Auth_shell><p>form</p></Auth_shell></MemoryRouter>);
		fireEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }));
		expect(read_theme()).toBe('light');
		expect(document.documentElement.dataset.gTheme).toBe('light');
		expect(document.documentElement.classList.contains('dark')).toBe(false);
		fireEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
		expect(document.documentElement.dataset.gTheme).toBe('dark');
		expect(document.documentElement.classList.contains('dark')).toBe(true);
	});

	it('the older ThemeProvider starts dark with nothing saved (even on a light OS) and follows the switch', () => {
		render(
			<MemoryRouter>
				<ThemeProvider><Show /><Theme_switch /></ThemeProvider>
			</MemoryRouter>,
		);
		expect(screen.getByText('dark')).toBeTruthy();
		act(() => { fireEvent.click(screen.getByRole('button', { name: 'Switch to light theme' })); });
		expect(screen.getByText('light')).toBeTruthy();
		// Its own toggle goes through the same module.
		act(() => { fireEvent.click(screen.getByText('light')); });
		expect(read_theme()).toBe('dark');
		expect(document.documentElement.dataset.gTheme).toBe('dark');
	});
});
