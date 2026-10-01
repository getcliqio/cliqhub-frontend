/** Graphite realm Daemons — one BFF read; remove is a single Core write. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { overview_for_realm } from './fixtures_realm';
import { gs_response } from './fixtures_overview';
import type { Realm_daemons_data } from '@/lib/realm_daemons';

const auth = { user: { id: 'u1', username: 'sapan', display_name: 'Sapan Shah', email: 's@x.com', role: 'user' as const, preferences: {} }, loading: false, logout: vi.fn(), acting_as: null, stop_act_as: vi.fn() };
const stable_fetch = (url: string, init?: RequestInit) => fetch(url, init);
vi.mock('@/lib/auth_context', () => ({ useAuth: () => auth, useAuthFetch: () => stable_fetch }));

import { Component as DaemonsPage } from '@/pages/realm/realm_daemons_graphite_page';

const now = Date.now();
function daemons(): Realm_daemons_data {
	return {
		realm: { id: 'r-prod', slug: 'prod-us', name: 'prod-us', org_slug: 'measureone' },
		items: [
			{ id: 'd-mbp', name: 'mbp-sapan-01', hostname: 'mbp.local', owner_email: 's@x.com', status: 'online', last_heartbeat: now - 12_000, capacity: 4, running: 2, teams_ready: 3 },
			{ id: 'd-gpu', name: null, hostname: 'gpu-box', owner_email: 'ops@x.com', status: 'stale', last_heartbeat: now - 180_000, capacity: 2, running: 0, teams_ready: 1 },
		],
		counts: { all: 3, online: 1, stale: 1, offline: 1 },
		teams_total: 3,
		truncated: false,
		partial: false,
	};
}

type Call = { url: string; body: Record<string, unknown> };
function route_fetch() {
	const calls: Call[] = [];
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
		const u = String(url);
		if (u === '/v1/overview/get') return new Response(JSON.stringify({ ok: true, data: overview_for_realm() }));
		if (u === '/v1/getting_started/get') return gs_response(u)!;
		calls.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : {} });
		if (u === '/v1/realm_daemons/get') return new Response(JSON.stringify({ ok: true, data: daemons() }));
		return new Response(JSON.stringify({ ok: true, data: true }));
	});
	return calls;
}

function render_page(path = '/o/measureone/realms/prod-us/daemons') {
	return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/o/:org/realms/:slug/daemons" element={<DaemonsPage />} /></Routes></MemoryRouter>);
}

describe('Realm daemons page', () => {
	afterEach(() => vi.restoreAllMocks());

	it('one read; status counts, running/capacity, teams ready', async () => {
		const calls = route_fetch();
		render_page();
		const mbp = await screen.findByTestId('daemon-d-mbp');
		expect(calls).toEqual([{ url: '/v1/realm_daemons/get', body: { org_slug: 'measureone', slug: 'prod-us' } }]);
		expect(within(mbp).getByRole('link', { name: 'mbp-sapan-01' })).toHaveAttribute('href', '/o/measureone/realms/prod-us/daemons/d-mbp');
		expect(within(mbp).getByText('3/3')).toBeInTheDocument();
		expect(within(screen.getByTestId('daemon-d-gpu')).getByText('1/3')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Stale\s*1/ })).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'Settings › Access tokens' })).toHaveAttribute('href', '/o/measureone/realms/prod-us/settings?section=tokens');
		expect(within(screen.getByRole('navigation', { name: 'Realm sections' })).getByRole('link', { name: 'Daemons' })).toHaveAttribute('aria-current', 'page');
	});

	it('status chip and search go to the BFF; remove is confirmed and one Core call', async () => {
		const calls = route_fetch();
		render_page();
		await screen.findByTestId('daemon-d-mbp');
		fireEvent.click(screen.getByRole('button', { name: /Online/ }));
		await waitFor(() => expect(calls.at(-1)!.body).toMatchObject({ status: 'online' }));
		fireEvent.change(screen.getByLabelText('Search daemons'), { target: { value: 'gpu' } });
		await waitFor(() => expect(calls.at(-1)!.body).toMatchObject({ q: 'gpu', status: 'online' }));
		fireEvent.click(screen.getByRole('button', { name: 'Remove d-gpu' }));
		fireEvent.click(within(screen.getByTestId('daemon-d-gpu')).getByRole('button', { name: 'Remove' }));
		await waitFor(() => expect(calls).toContainEqual({ url: '/v1/daemons/remove', body: { daemon_id: 'd-gpu' } }));
	});
});
