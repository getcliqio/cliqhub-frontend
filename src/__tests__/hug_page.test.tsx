/**
 * Hug page (/hugs/:hug_id) and HUGs (/hugs): every Hug is asked and answered in getHugs (PLAN-gethugs-step8-cutover.md).
 * The Hug page reads the Hug (`hugs/get_by_id`) and opens its getHugs page through a sign-in link
 * (PLAN-gethugs-step7-sign-in.md), or the plain page when Core gives none; HUGs opens getHugs' inbox.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { single_org_overview, gs_response } from './fixtures_overview';

const auth = {
	user: { id: 'u1', username: 'ann', display_name: 'Ann', email: 'a@x.com', role: 'user' as const, preferences: {} },
	loading: false, logout: vi.fn(), acting_as: null, stop_act_as: vi.fn(), gethugs_app_url: 'https://app.gethugs.test',
};
const stable_fetch = (url: string, init?: RequestInit) => fetch(url, init);
vi.mock('@/lib/auth_context', () => ({ useAuth: () => auth, useAuthFetch: () => stable_fetch }));

import { Component as HugPage } from '@/pages/hugs/hug_page';
import { Component as HugsPage } from '@/pages/hugs_page';

const HUG = { id: 'h-1', hug_url: 'https://app.gethugs.test/hugs/hug_9', run_id: 'run-1', phase: 'approve', realm_id: 'r-prod', org_slug: 'measureone', title: 'Ship?', status: 'open', outcome: null };

type Handler = (body: Record<string, unknown>) => { status?: number; body: unknown };

function route_fetch(extra: Record<string, Handler>) {
	const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
		const u = String(url);
		const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : {};
		calls.push({ url: u, body });
		if (extra[u]) { const r = extra[u](body); return new Response(JSON.stringify(r.body), { status: r.status ?? 200 }); }
		if (u === '/v1/overview/get') return new Response(JSON.stringify({ ok: true, data: single_org_overview() }));
		if (u === '/v1/getting_started/get') return gs_response(u)!;
		throw new Error(`unexpected ${u}`);
	});
	return calls;
}

let replace: ReturnType<typeof vi.fn>;
beforeEach(() => {
	replace = vi.fn();
	vi.stubGlobal('location', { ...window.location, replace });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Hug page', () => {
	it('reads the Hug and opens its getHugs page through a sign-in link', async () => {
		const calls = route_fetch({
			'/v1/hugs/get_by_id': () => ({ body: { ok: true, data: HUG } }),
			'/v1/hugs/create_sign_in_link': () => ({ body: { ok: true, data: { url: 'https://app.gethugs.test/sign-in/statement#x' } } }),
		});
		render(<MemoryRouter initialEntries={['/hugs/h-1']}><Routes><Route path="/hugs/:hug_id" element={<HugPage />} /></Routes></MemoryRouter>);
		await waitFor(() => expect(replace).toHaveBeenCalledWith('https://app.gethugs.test/sign-in/statement#x'));
		expect(calls.find((c) => c.url === '/v1/hugs/get_by_id')?.body).toEqual({ hug_id: 'h-1' });
		expect(calls.find((c) => c.url === '/v1/hugs/create_sign_in_link')?.body).toEqual({ hug_id: 'h-1' });
		expect(screen.getByTestId('hug-elsewhere').querySelector('a')?.getAttribute('href')).toBe(HUG.hug_url);
		expect(calls.some((c) => c.url === '/v1/hug_page/get' || c.url === '/v1/hugs/respond')).toBe(false);
	});

	it('no sign-in link (refused): the plain getHugs page', async () => {
		route_fetch({
			'/v1/hugs/get_by_id': () => ({ body: { ok: true, data: HUG } }),
			'/v1/hugs/create_sign_in_link': () => ({ status: 409, body: { ok: false, error: { code: 'not_in_gethugs' } } }),
		});
		render(<MemoryRouter initialEntries={['/hugs/h-1']}><Routes><Route path="/hugs/:hug_id" element={<HugPage />} /></Routes></MemoryRouter>);
		await waitFor(() => expect(replace).toHaveBeenCalledWith(HUG.hug_url));
	});

	it('a Hug that can’t be read: the error, nothing opened', async () => {
		route_fetch({ '/v1/hugs/get_by_id': () => ({ status: 404, body: { ok: false, error: { code: 'not_found', message: 'Hug not found' } } }) });
		render(<MemoryRouter initialEntries={['/hugs/h-1']}><Routes><Route path="/hugs/:hug_id" element={<HugPage />} /></Routes></MemoryRouter>);
		await screen.findByRole('alert');
		expect(replace).not.toHaveBeenCalled();
	});
});

describe('HUGs', () => {
	it('opens getHugs’ inbox, signed in to the org in view', async () => {
		const calls = route_fetch({
			'/v1/hugs/create_sign_in_link': () => ({ body: { ok: true, data: { url: 'https://app.gethugs.test/sign-in/statement#y' } } }),
		});
		render(<MemoryRouter initialEntries={['/hugs']}><Routes><Route path="/hugs" element={<HugsPage />} /></Routes></MemoryRouter>);
		await waitFor(() => expect(replace).toHaveBeenCalledWith('https://app.gethugs.test/sign-in/statement#y'));
		expect(Object.keys(calls.find((c) => c.url === '/v1/hugs/create_sign_in_link')!.body)).toEqual(['org_id']);
		expect(screen.getByTestId('hugs-elsewhere').querySelector('a')?.getAttribute('href')).toBe('https://app.gethugs.test/hugs');
	});
});
