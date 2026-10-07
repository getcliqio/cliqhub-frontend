/**
 * Colour theme — dark by default; Light / Dark / System from the account
 * menu, applied at once (`data-g-theme` on <html>), remembered in this
 * browser and saved on the profile; a profile choice from another browser wins.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { multi_org_overview, gs_response } from './fixtures_overview';
import { apply_theme, read_theme, resolve_theme } from '@/lib/theme';

const auth = {
	user: { id: 'u1', username: 'sapan', display_name: 'Sapan Shah', email: 's@x.com', role: 'user' as const, preferences: {} as Record<string, unknown> },
	loading: false, logout: vi.fn(), acting_as: null, stop_act_as: vi.fn(),
};
const stable_fetch = (url: string, init?: RequestInit) => fetch(url, init);
vi.mock('@/lib/auth_context', () => ({ useAuth: () => auth, useAuthFetch: () => stable_fetch }));

import { Component as HugsPage } from '@/pages/hugs_page';

function route_fetch() {
	const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
		const u = String(url);
		const body = init?.body ? JSON.parse(String(init.body)) : {};
		calls.push({ url: u, body });
		if (u === '/v1/overview/get') return new Response(JSON.stringify({ ok: true, data: multi_org_overview() }));
		if (u === '/v1/getting_started/get') return gs_response(u)!;
		if (u === '/v1/users/update_profile') return new Response(JSON.stringify({ ok: true, data: {} }));
		throw new Error(`unexpected ${u}`);
	});
	return calls;
}

function render_page() {
	return render(<MemoryRouter initialEntries={['/hugs']}><Routes><Route path="/hugs" element={<HugsPage />} /></Routes></MemoryRouter>);
}

describe('theme', () => {
	beforeEach(() => { window.localStorage.removeItem('cliqhub.theme'); delete document.documentElement.dataset.gTheme; auth.user.preferences = {}; });
	afterEach(() => vi.restoreAllMocks());

	it('dark by default; apply_theme paints and remembers; system follows the OS', () => {
		expect(read_theme()).toBe('dark');
		document.documentElement.classList.add('dark');
		apply_theme('light');
		expect(document.documentElement.dataset.gTheme).toBe('light');
		// The older pages' global `html.dark` rules must switch too (table headers, inputs).
		expect(document.documentElement.classList.contains('dark')).toBe(false);
		apply_theme('dark');
		expect(document.documentElement.classList.contains('dark')).toBe(true);
		apply_theme('light');
		expect(read_theme()).toBe('light');
		vi.stubGlobal('matchMedia', () => ({ matches: true }));
		expect(resolve_theme('system')).toBe('light');
		vi.unstubAllGlobals();
	});

	it('account menu: picking Light switches now and saves it on the profile', async () => {
		const calls = route_fetch();
		render_page();
		fireEvent.click(await screen.findByTestId('account-button'));
		const group = screen.getByRole('radiogroup', { name: 'Theme' });
		expect(within(group).getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');
		fireEvent.click(within(group).getByRole('radio', { name: 'Light' }));
		expect(document.documentElement.dataset.gTheme).toBe('light');
		expect(within(group).getByRole('radio', { name: 'Light' })).toHaveAttribute('aria-checked', 'true');
		await waitFor(() => expect(calls.find((c) => c.url === '/v1/users/update_profile')?.body).toEqual({ preferences: { theme: 'light' } }));
	});

	it('a theme saved on the profile (another browser) is applied here', async () => {
		auth.user.preferences = { theme: 'light' };
		route_fetch();
		render_page();
		await waitFor(() => expect(document.documentElement.dataset.gTheme).toBe('light'));
		expect(read_theme()).toBe('light');
	});
});
