/**
 * HUGs — Waiting (reviews + input requests from the overview, no extra call,
 * oldest first, the org you're in) and Done (settled HUG events from one
 * inbox read, scoped to the org).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { multi_org_overview, gs_response, ORG_A } from './fixtures_overview';
import type { Inbox_data, Inbox_item } from '@/lib/inbox';

const auth = {
	user: { id: 'u1', username: 'sapan', display_name: 'Sapan Shah', email: 's@x.com', role: 'user' as const, preferences: {} },
	loading: false, logout: vi.fn(), acting_as: null, stop_act_as: vi.fn(),
};
const stable_fetch = (url: string, init?: RequestInit) => fetch(url, init);
vi.mock('@/lib/auth_context', () => ({ useAuth: () => auth, useAuthFetch: () => stable_fetch }));

import { Component as HugsPage, HUG_DONE_TYPES } from '@/pages/hugs_page';

const done: Inbox_item = {
	id: 'd1', event: 'hug.review_responded', title: 'Approved design · PROJ-1', message: 'approved', severity: null, org_id: ORG_A, org_slug: 'measureone',
	realm_id: 'r-prod', realm_slug: 'prod-us', team: 'feature-dev', run_id: 'run-1', phase: 'design-review', review_id: 'rev-0', channel_id: null,
	original_event: null, at: Date.now() - 3_600_000,
};

function route_fetch() {
	const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
		const u = String(url);
		const body = init?.body ? JSON.parse(String(init.body)) : {};
		calls.push({ url: u, body });
		if (u === '/v1/overview/get') return new Response(JSON.stringify({ ok: true, data: multi_org_overview() }));
		if (u === '/v1/getting_started/get') return gs_response(u)!;
		if (u === '/v1/inbox/get') return new Response(JSON.stringify({ ok: true, data: { items: [done], next_until_ms: null, orgs: [], partial: false } satisfies Inbox_data }));
		throw new Error(`unexpected ${u}`);
	});
	return calls;
}

function render_page(path = '/hugs') {
	return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/hugs" element={<HugsPage />} /></Routes></MemoryRouter>);
}

describe('HUGs', () => {
	afterEach(() => vi.restoreAllMocks());

	it('Waiting: reviews + input from the overview, oldest first, no extra request', async () => {
		const calls = route_fetch();
		render_page();
		await screen.findByTestId('inbox-item-review-rev-1');
		// This org only (rev-2 is Acme's): run-88 (38m), rev-1 (12m) → oldest waiting first.
		expect(screen.getAllByTestId(/^inbox-item-/).map((e) => e.dataset.testid)).toEqual(['inbox-item-input-run-88', 'inbox-item-review-rev-1']);
		expect(calls.filter((c) => c.url === '/v1/inbox/get')).toHaveLength(0);
		expect(within(screen.getByTestId('inbox-item-review-rev-1')).getByRole('link', { name: 'Review' })).toHaveAttribute('href', '/reviews/rev-1');
		expect(within(screen.getByTestId('inbox-item-input-run-88')).getByRole('link', { name: 'Provide input' })).toHaveAttribute('href', '/o/measureone/realms/prod-us/runs/run-88');
		expect(screen.getByRole('tab', { name: /Waiting/ })).toHaveTextContent('5');
		fireEvent.click(screen.getByRole('button', { name: /^Input/ }));
		expect(screen.getAllByTestId(/^inbox-item-/)).toHaveLength(1);
	});

	it('follows the org (?org=)', async () => {
		route_fetch();
		render_page('/hugs?org=acme-labs');
		await waitFor(() => expect(screen.getAllByTestId(/^inbox-item-/).map((e) => e.dataset.testid)).toEqual(['inbox-item-review-rev-2']));
	});

	it('Done: settled HUG events for the org, one inbox read', async () => {
		const calls = route_fetch();
		render_page('/hugs?tab=done');
		expect(await screen.findByTestId('inbox-item-d1')).toHaveTextContent('Approved design · PROJ-1');
		const reads = calls.filter((c) => c.url === '/v1/inbox/get');
		expect(reads).toHaveLength(1);
		expect(reads[0]!.body).toEqual({ limit: 50, types: HUG_DONE_TYPES, org_id: ORG_A });
	});
});
