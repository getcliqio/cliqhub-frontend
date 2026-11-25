/**
 * HUGs — Waiting (open Hugs that reached you, from the overview, no extra call,
 * oldest first, the org you're in) and Done (finished Hugs read from the Hugs themselves,
 * one row per Hug, scoped to the org — not from notifications).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { multi_org_overview, gs_response, ORG_A } from './fixtures_overview';
import type { Done_hug } from '@/pages/hugs_page';

const auth = {
	user: { id: 'u1', username: 'sapan', display_name: 'Sapan Shah', email: 's@x.com', role: 'user' as const, preferences: {} },
	loading: false, logout: vi.fn(), acting_as: null, stop_act_as: vi.fn(),
};
const stable_fetch = (url: string, init?: RequestInit) => fetch(url, init);
vi.mock('@/lib/auth_context', () => ({ useAuth: () => auth, useAuthFetch: () => stable_fetch }));

import { Component as HugsPage, HUG_DONE_STATUSES, needs_to_item, done_to_item } from '@/pages/hugs_page';

const done: Done_hug = {
	hug_id: 'hug-0', title: 'Approved design · PROJ-1', summary: 'Approve the design for PROJ-1', realm_id: 'r-prod', realm_slug: 'prod-us', org_slug: 'measureone',
	run_id: 'run-1', team: 'feature-dev', phase: 'design-review', iteration: 1, status: 'closed', outcome: 'Approved by Sapan',
	created_at: Date.now() - 7_200_000, closed_at: Date.now() - 3_600_000,
};

function route_fetch() {
	const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
		const u = String(url);
		const body = init?.body ? JSON.parse(String(init.body)) : {};
		calls.push({ url: u, body });
		if (u === '/v1/overview/get') return new Response(JSON.stringify({ ok: true, data: multi_org_overview() }));
		if (u === '/v1/getting_started/get') return gs_response(u)!;
		if (u === '/v1/hugs/get') return new Response(JSON.stringify({ ok: true, data: { items: [done], total: 1, offset: 0, limit: 50 } }));
		throw new Error(`unexpected ${u}`);
	});
	return calls;
}

function render_page(path = '/hugs') {
	return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/hugs" element={<HugsPage />} /></Routes></MemoryRouter>);
}

describe('HUGs', () => {
	afterEach(() => vi.restoreAllMocks());

	it('Waiting: open Hugs from the overview, oldest first, no extra request; each answers on its Hug page', async () => {
		const calls = route_fetch();
		render_page();
		await screen.findByTestId('inbox-item-hug-hug-1');
		// This org only (hug-2 is Acme's): hug-88 (38m), hug-1 (12m) → oldest waiting first.
		expect(screen.getAllByTestId(/^inbox-item-/).map((e) => e.dataset.testid)).toEqual(['inbox-item-hug-hug-88', 'inbox-item-hug-hug-1']);
		expect(calls.filter((c) => c.url === '/v1/hugs/get' || c.url === '/v1/inbox/get')).toHaveLength(0);
		expect(within(screen.getByTestId('inbox-item-hug-hug-1')).getByRole('link', { name: 'Answer' })).toHaveAttribute('href', '/hugs/hug-1');
		expect(screen.getByRole('tab', { name: /Waiting/ })).toHaveTextContent('5');
		fireEvent.change(screen.getByRole('textbox', { name: 'Search HUGs' }), { target: { value: 'employer' } });
		expect(screen.getAllByTestId(/^inbox-item-/).map((e) => e.dataset.testid)).toEqual(['inbox-item-hug-hug-88']);
	});

	it("a waiting Hug's row says what's asked (its summary), else which phase waits", () => {
		const item = { kind: 'hug' as const, id: 'h', title: 'Review', org_id: ORG_A, org_slug: 'measureone', realm_id: null, realm_slug: null, run_id: null, team: null, phase: 'qa', state: 'open', at: 1 };
		expect(needs_to_item({ ...item, summary: 'Approve the March batch' }).message).toBe('Approve the March batch');
		expect(needs_to_item(item).message).toBe('Waiting for you · qa');
		expect(needs_to_item({ ...item, summary: '  ' }).message).toBe('Waiting for you · qa');
	});

	it('follows the org (?org=)', async () => {
		route_fetch();
		render_page('/hugs?org=acme-labs');
		await waitFor(() => expect(screen.getAllByTestId(/^inbox-item-/).map((e) => e.dataset.testid)).toEqual(['inbox-item-hug-hug-2']));
	});

	it('Done: finished Hugs for the org, read from the Hugs (not notifications), one row each', async () => {
		const calls = route_fetch();
		render_page('/hugs?tab=done');
		const row = await screen.findByTestId('inbox-item-hug-done-hug-0');
		expect(row).toHaveTextContent('Approved design · PROJ-1');
		expect(row).toHaveTextContent('Approved by Sapan · design-review, round 2 — Approve the design for PROJ-1');
		expect(within(row).getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/hugs/hug-0');
		expect(calls.filter((c) => c.url === '/v1/inbox/get')).toHaveLength(0);
		const reads = calls.filter((c) => c.url === '/v1/hugs/get');
		expect(reads).toHaveLength(1);
		expect(reads[0]!.body).toEqual({ statuses: [...HUG_DONE_STATUSES], limit: 50, org_id: ORG_A });
	});

	it('Done: an expired or cancelled Hug says so when Core gives no outcome', () => {
		expect(done_to_item({ ...done, status: 'expired', outcome: null, iteration: 0, summary: null }, ORG_A).message).toBe('Expired · design-review');
		expect(done_to_item({ ...done, status: 'cancelled', outcome: null }, ORG_A).message).toBe('Cancelled · design-review, round 2 — Approve the design for PROJ-1');
	});
});
