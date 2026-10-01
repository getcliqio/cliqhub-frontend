/** Graphite realm Runs — one BFF call per page, filters in the URL, paging. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { overview_for_realm } from './fixtures_realm';
import { gs_response } from './fixtures_overview';
import type { Realm_runs_data } from '@/lib/realm_runs';
import { duration } from '@/lib/realm_runs';

const auth = { user: { id: 'u1', username: 'sapan', display_name: 'Sapan Shah', email: 's@x.com', role: 'user' as const, preferences: {} }, loading: false, logout: vi.fn(), acting_as: null, stop_act_as: vi.fn() };
const stable_fetch = (url: string, init?: RequestInit) => fetch(url, init);
vi.mock('@/lib/auth_context', () => ({ useAuth: () => auth, useAuthFetch: () => stable_fetch }));

import { Component as RunsPage } from '@/pages/realm/realm_runs_page';

const now = Date.now();
function runs(over: Partial<Realm_runs_data> = {}): Realm_runs_data {
	return {
		realm: { id: 'r-prod', slug: 'prod-us', name: 'prod-us', org_slug: 'measureone' },
		items: [
			{ run_id: 'run-1', run_name: 'PROJ-491 · Webhook signing', team: '@cliq/feature-dev-js', state: 'running', current_phase: 'implement', daemon_id: 'mbp-1', started_at: now - 14 * 60_000, completed_at: null, updated_at: now, error: null },
			{ run_id: 'run-2', run_name: 'Nightly reconcile', team: '@measureone/recon', state: 'crashed', current_phase: 'match', daemon_id: 'ci-2', started_at: now - 3_600_000, completed_at: now - 1_800_000, updated_at: now - 1_800_000, error: 'LedgerTimeout' },
		],
		total: 60, offset: 0, limit: 25,
		counts: { all: 1284, running: 3, awaiting_input: 2, failed_7d: 4 },
		partial: false,
		...over,
	};
}

function Where() { const l = useLocation(); return <div data-testid="where">{l.pathname}{l.search}</div>; }

function route_fetch(reply: (b: Record<string, unknown>) => { status?: number; body: unknown } = (b) => ({ body: { ok: true, data: runs({ offset: Number(b.offset) || 0 }) } })) {
	const calls: Array<Record<string, unknown>> = [];
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
		const u = String(url);
		if (u === '/v1/overview/get') return new Response(JSON.stringify({ ok: true, data: overview_for_realm() }));
		if (u === '/v1/getting_started/get') return gs_response(u)!;
		if (u === '/v1/realm_runs/get') {
			const b = JSON.parse(String(init?.body));
			calls.push(b);
			const r = reply(b);
			return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
		}
		throw new Error(`unexpected ${u}`);
	});
	return calls;
}

function render_page(path = '/o/measureone/realms/prod-us/runs') {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<Routes>
				<Route path="/o/:org/realms/:slug/runs" element={<><RunsPage /><Where /></>} />
				<Route path="*" element={<Where />} />
			</Routes>
		</MemoryRouter>,
	);
}

describe('Realm runs page', () => {
	afterEach(() => vi.restoreAllMocks());

	it('one call with realm + page; rows, counts, links', async () => {
		const calls = route_fetch();
		render_page();
		await screen.findByTestId('run-run-1');
		expect(calls).toEqual([{ org_slug: 'measureone', slug: 'prod-us', limit: 25, offset: 0 }]);
		expect(screen.getByRole('button', { name: /Running\s*3/ })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /All\s*1,284/ })).toHaveAttribute('aria-pressed', 'true');
		expect(within(screen.getByTestId('run-run-1')).getByRole('link', { name: 'PROJ-491 · Webhook signing' })).toHaveAttribute('href', '/o/measureone/realms/prod-us/runs/run-1');
		expect(within(screen.getByTestId('run-run-2')).getByText('LedgerTimeout')).toBeInTheDocument();
		expect(screen.getByTestId('runs-range')).toHaveTextContent('1–25 of 60');
		const nav = screen.getByRole('navigation', { name: 'Realm sections' });
		expect(within(nav).getByRole('link', { name: 'Runs' })).toHaveAttribute('aria-current', 'page');
	});

	it('state chip, range, search and paging go to the BFF and the URL', async () => {
		const calls = route_fetch();
		render_page();
		await screen.findByTestId('run-run-1');
		fireEvent.click(screen.getByRole('button', { name: /Failed · 7d/ }));
		await waitFor(() => expect(calls.at(-1)).toMatchObject({ state: 'failed', offset: 0 }));
		// Failed defaults to the last 7 days, like its count.
		expect(calls.at(-1)!.since_ms).toEqual(expect.any(Number));
		expect(screen.getByTestId('where')).toHaveTextContent('state=failed');
		fireEvent.change(screen.getByLabelText('Search runs'), { target: { value: 'PROJ' } });
		await waitFor(() => expect(calls.at(-1)).toMatchObject({ q: 'PROJ', state: 'failed' }));
		fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
		await waitFor(() => expect(calls.at(-1)).toMatchObject({ offset: 25 }));
		expect(screen.getByTestId('where')).toHaveTextContent('page=1');
	});

	it('?team= from team pages becomes the search', async () => {
		const calls = route_fetch();
		render_page('/o/measureone/realms/prod-us/runs?team=cliq%2Ffeature-dev-js');
		await screen.findByTestId('run-run-1');
		expect(calls[0]).toMatchObject({ q: 'cliq/feature-dev-js' });
		expect(screen.getByLabelText('Search runs')).toHaveValue('cliq/feature-dev-js');
	});

	it('empty and 403 states', async () => {
		route_fetch(() => ({ body: { ok: true, data: runs({ items: [], total: 0 }) } }));
		const { unmount } = render_page('/o/measureone/realms/prod-us/runs?q=zzz');
		expect(await screen.findByText('No runs match these filters.')).toBeInTheDocument();
		unmount();
		vi.restoreAllMocks();
		route_fetch(() => ({ status: 403, body: { ok: false, error: { code: 'forbidden', message: 'No' } } }));
		render_page();
		expect(await screen.findByText('You don’t have access to this realm')).toBeInTheDocument();
	});

	it('duration formats', () => {
		expect(duration(0, 1)).toBe('—');
		expect(duration(1000, 1000 + 45_000)).toBe('45s');
		expect(duration(1000, 1000 + 65 * 60_000)).toBe('1h 05m');
	});
});
