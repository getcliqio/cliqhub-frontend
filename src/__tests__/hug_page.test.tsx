/**
 * Hug page (/hugs/:hug_id) and HUGs (/hugs): every Hug is asked and answered in getHugs (PLAN-gethugs-step8-cutover.md),
 * shown inside CliqHub's page — getHugs' embed, signed in by a statement (PLAN-gethugs-partner-ux.md §4) — with
 * "Open in getHugs" as the way out.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
import { hugs_address, with_theme } from '@/components/hug/gethugs_frame';

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

let assign: ReturnType<typeof vi.fn>;
beforeEach(() => {
	assign = vi.fn();
	vi.stubGlobal('location', { ...window.location, pathname: '/hugs/h-1', search: '', assign });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const EMBED = 'https://app.gethugs.test/embed/prt_cliq/sign-in/statement#x';
const hug_page = () => render(<MemoryRouter initialEntries={['/hugs/h-1']}><Routes><Route path="/hugs/:hug_id" element={<HugPage />} /></Routes></MemoryRouter>);

describe('Hug page', () => {
	it('shows the Hug’s getHugs page inside CliqHub’s, through the embed’s sign-in', async () => {
		const calls = route_fetch({
			'/v1/hugs/get_by_id': () => ({ body: { ok: true, data: HUG } }),
			'/v1/hugs/create_sign_in_link': () => ({ body: { ok: true, data: { url: EMBED } } }),
		});
		hug_page();
		const frame = await screen.findByTestId('gethugs-iframe');
		expect(frame).toHaveAttribute('src', with_theme(EMBED, 'dark')); // CliqHub's theme
		expect(calls.find((c) => c.url === '/v1/hugs/get_by_id')?.body).toEqual({ hug_id: 'h-1' });
		expect(calls.find((c) => c.url === '/v1/hugs/create_sign_in_link')?.body).toEqual({ hug_id: 'h-1', embed: true });
		expect(screen.getByTestId('open-in-gethugs')).toHaveAttribute('href', HUG.hug_url);
		expect(calls.some((c) => c.url === '/v1/hug_page/get' || c.url === '/v1/hugs/respond')).toBe(false);
	});

	it('follows the frame: its height, where the person is (the address), an answer (the badge) — from getHugs’ frame only', async () => {
		route_fetch({
			'/v1/hugs/get_by_id': () => ({ body: { ok: true, data: HUG } }),
			'/v1/hugs/create_sign_in_link': () => ({ body: { ok: true, data: { url: EMBED } } }),
		});
		hug_page();
		const frame = await screen.findByTestId('gethugs-iframe') as HTMLIFrameElement;
		const replace_state = vi.spyOn(window.history, 'replaceState');
		const changed = vi.fn();
		window.addEventListener('cliq:hugs-changed', changed);
		const from = (data: unknown, origin = 'https://app.gethugs.test', source: MessageEventSource | null = frame.contentWindow) =>
			act(() => { window.dispatchEvent(new MessageEvent('message', { data: { source: 'gethugs', ...(data as object) }, origin, source })); });
		from({ type: 'height', height: 1500 });
		expect(frame.style.height).toBe('1500px');
		from({ type: 'height', height: 9999 }, 'https://evil.test'); // another origin: ignored
		from({ type: 'height', height: 9999 }, 'https://app.gethugs.test', window); // another window: ignored
		expect(frame.style.height).toBe('1500px');
		from({ type: 'navigated', path: '/hugs/hug_2', hug_id: 'hug_2' });
		expect(replace_state).toHaveBeenLastCalledWith(window.history.state, '', '/hugs/hug_2');
		from({ type: 'answered', hug_id: 'hug_2' });
		expect(changed).toHaveBeenCalledTimes(1);
		window.removeEventListener('cliq:hugs-changed', changed);
	});

	it('no embed link (refused): says so, with getHugs’ own page; Open in getHugs signs in there with the way back', async () => {
		const calls = route_fetch({
			'/v1/hugs/get_by_id': () => ({ body: { ok: true, data: HUG } }),
			'/v1/hugs/create_sign_in_link': (b) => (b.embed
				? { status: 409, body: { ok: false, error: { code: 'not_in_gethugs' } } }
				: { body: { ok: true, data: { url: 'https://app.gethugs.test/sign-in/statement#y' } } }),
		});
		hug_page();
		await screen.findByTestId('gethugs-unavailable');
		expect(screen.queryByTestId('gethugs-iframe')).toBeNull();
		fireEvent.click(screen.getByTestId('open-in-gethugs'));
		await waitFor(() => expect(assign).toHaveBeenCalledWith('https://app.gethugs.test/sign-in/statement#y'));
		expect(calls.filter((c) => c.url === '/v1/hugs/create_sign_in_link').at(-1)!.body).toEqual({ hug_id: 'h-1', return_url: expect.any(String) });
	});

	it('a Hug that can’t be read: the error, no frame', async () => {
		route_fetch({ '/v1/hugs/get_by_id': () => ({ status: 404, body: { ok: false, error: { code: 'not_found', message: 'Hug not found' } } }) });
		hug_page();
		await screen.findByRole('alert');
		expect(screen.queryByTestId('gethugs-frame')).toBeNull();
	});
});

describe('HUGs', () => {
	it('shows getHugs’ Hugs for the org in view inside CliqHub’s page', async () => {
		const calls = route_fetch({
			'/v1/hugs/create_sign_in_link': () => ({ body: { ok: true, data: { url: EMBED } } }),
		});
		render(<MemoryRouter initialEntries={['/hugs']}><Routes><Route path="/hugs" element={<HugsPage />} /></Routes></MemoryRouter>);
		expect(await screen.findByTestId('gethugs-iframe')).toHaveAttribute('src', with_theme(EMBED, 'dark'));
		expect(Object.keys(calls.find((c) => c.url === '/v1/hugs/create_sign_in_link')!.body)).toEqual(['org_id', 'embed']);
		expect(screen.getByTestId('open-in-gethugs')).toHaveAttribute('href', 'https://app.gethugs.test/hugs');
	});
});

describe('the embed’s theme', () => {
	it('goes in the address before the statement, and follows CliqHub’s changes', async () => {
		expect(with_theme('https://g/embed/p/sign-in/statement#abc', 'light')).toBe('https://g/embed/p/sign-in/statement?theme=light#abc');
		expect(with_theme('https://g/x?a=1#s', 'dark')).toBe('https://g/x?a=1&theme=dark#s');
		route_fetch({
			'/v1/hugs/get_by_id': () => ({ body: { ok: true, data: HUG } }),
			'/v1/hugs/create_sign_in_link': () => ({ body: { ok: true, data: { url: EMBED } } }),
		});
		hug_page();
		const frame = await screen.findByTestId('gethugs-iframe') as HTMLIFrameElement;
		const post = vi.spyOn(frame.contentWindow!, 'postMessage');
		await act(async () => { document.documentElement.dataset.gTheme = 'light'; await new Promise((r) => setTimeout(r, 0)); });
		expect(post).toHaveBeenCalledWith({ source: 'gethugs-host', type: 'theme', theme: 'light' }, 'https://app.gethugs.test');
		delete document.documentElement.dataset.gTheme;
	});
});

describe('hugs_address', () => {
	it('the HUGs address for where the person is in getHugs, keeping the org scope', () => {
		expect(hugs_address('/hugs', 'hug_1')).toBe('/hugs/hug_1');
		expect(hugs_address('/hugs/h-1', null)).toBe('/hugs');
		expect(hugs_address('/o/acme/hugs/h-1', 'hug_2')).toBe('/o/acme/hugs/hug_2');
	});
});
