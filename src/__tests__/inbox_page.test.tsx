/**
 * Graphite Inbox — system events for the org (HUG events live in HUGs), one
 * BFF read per filter, the bell, row actions, and the shell's flat nav.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { multi_org_overview, gs_response, ORG_A } from './fixtures_overview';
import type { Inbox_item, Inbox_data } from '@/lib/inbox';
import { inbox_action, inbox_kind } from '@/lib/inbox';

const auth = {
	user: { id: 'u1', username: 'sapan', display_name: 'Sapan Shah', email: 's@x.com', role: 'user' as const, preferences: {} },
	loading: false, logout: vi.fn(), acting_as: null, stop_act_as: vi.fn(),
};
const stable_fetch = (url: string, init?: RequestInit) => fetch(url, init);
vi.mock('@/lib/auth_context', () => ({ useAuth: () => auth, useAuthFetch: () => stable_fetch }));

import { Component as InboxPage } from '@/pages/inbox_page';

const now = Date.now();
function item(id: string, over: Partial<Inbox_item> = {}): Inbox_item {
	return {
		id, event: 'run.failed', title: `Title ${id}`, message: 'Boom', severity: 'error', org_id: ORG_A, org_slug: 'measureone',
		realm_id: 'r-prod', realm_slug: 'prod-us', team: 'recon', run_id: 'run-1', phase: null, review_id: null, channel_id: null,
		original_event: null, at: now - 60_000, ...over,
	};
}

function overview_with_inbox() {
	const d = multi_org_overview();
	return { ...d, inbox: { new_count: 3, capped: false, status: 'ok' as const, latest: [item('n1'), item('n2', { event: 'notification.failed', channel_id: 'ch-1', title: 'Delivery failed: run.failed' })] } };
}

type Call = { url: string; body: Record<string, unknown> };
function route_fetch(inbox: (body: Record<string, unknown>) => Inbox_data = () => ({ items: [item('a'), item('b', { event: 'hug.review_requested', review_id: 'rev-9' })], next_until_ms: null, orgs: [], partial: false })) {
	const calls: Call[] = [];
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
		const u = String(url);
		const body = init?.body ? JSON.parse(String(init.body)) : {};
		calls.push({ url: u, body });
		if (u === '/v1/overview/get') return new Response(JSON.stringify({ ok: true, data: overview_with_inbox() }));
		if (u === '/v1/getting_started/get') return gs_response(u)!;
		if (u === '/v1/inbox/get') return new Response(JSON.stringify({ ok: true, data: inbox(body) }));
		throw new Error(`unexpected ${u}`);
	});
	return calls;
}

function render_page(path = '/inbox') {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<Routes><Route path="/inbox" element={<InboxPage />} /></Routes>
		</MemoryRouter>,
	);
}

describe('Shell nav', () => {
	afterEach(() => vi.restoreAllMocks());

	it('one flat list of resources (no Inbox — that is the bell); realm shortcuts under Realms; Org admin group for owners; Marketplace top right', async () => {
		route_fetch();
		render_page();
		await screen.findByTestId('inbox-item-a');
		const nav = screen.getByRole('navigation', { name: 'Main' });
		const main = ['Dashboard', 'HUGs', 'Realms', 'Teams'];
		for (const label of main) expect(within(nav).getByRole('link', { name: new RegExp(`^${label}`) })).toBeInTheDocument();
		// The inbox lives behind the bell, not in the sidebar.
		expect(within(nav).queryByRole('link', { name: /^Inbox/ })).toBeNull();
		expect(within(nav).queryByText('Work')).toBeNull();
		expect(within(nav).queryByText('Manage')).toBeNull();
		expect(within(nav).getByRole('link', { name: /^HUGs/ })).toHaveAttribute('href', '/hugs?org=measureone');
		expect(within(nav).getByRole('link', { name: /^HUGs/ })).toHaveTextContent('5');
		expect(within(screen.getByTestId('sidebar-realms')).getAllByRole('link').map((a) => a.textContent)).toEqual([expect.stringMatching(/^prod-us/), expect.stringMatching(/^staging/)]);
		// measureone: you're the owner → Org admin.
		const admin = within(nav).getByTestId('nav-org-admin');
		expect(within(admin).getAllByRole('link').map((a) => a.textContent)).toEqual(['Members', 'Agents', 'Events', 'Settings']);
		expect(within(admin).getByRole('link', { name: 'Events' })).toHaveAttribute('href', '/notifications?org=measureone');
		expect(within(nav).queryByRole('link', { name: /Marketplace/ })).toBeNull();
		expect(screen.getByTestId('marketplace-link')).toHaveAttribute('href', '/browse');
	});

	it('members (not admins) see no Org admin group', async () => {
		window.localStorage.setItem('cliqhub.last_org', 'acme-labs');
		route_fetch();
		render_page();
		await screen.findByTestId('inbox-item-a');
		expect(screen.queryByTestId('nav-org-admin')).toBeNull();
		expect(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: /^Teams/ })).toBeInTheDocument();
	});
});

describe('Inbox · events', () => {
	afterEach(() => vi.restoreAllMocks());

	it('one inbox call scoped to the org; HUG events are left out; filters map to event types; row links', async () => {
		const calls = route_fetch();
		render_page('/inbox?org=measureone');
		await screen.findByTestId('inbox-item-a');
		const reads = () => calls.filter((c) => c.url === '/v1/inbox/get');
		expect(reads()).toHaveLength(1);
		expect(reads()[0].body).toEqual({ limit: 50, org_id: ORG_A });
		expect(within(screen.getByTestId('inbox-item-a')).getByRole('link', { name: 'Investigate' })).toHaveAttribute('href', '/o/measureone/realms/prod-us/runs/run-1');
		// The review request (a HUG) belongs to HUGs, not the inbox.
		expect(screen.queryByTestId('inbox-item-b')).toBeNull();
		expect(screen.queryByRole('button', { name: 'Reviews' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Input' })).toBeNull();
		const why = within(screen.getByTestId('inbox-item-a')).getByRole('link', { name: 'Why did I get this?' });
		expect(why.getAttribute('href')).toBe('/notifications?tab=check&org=measureone&realm=r-prod&event=run.failed');

		fireEvent.click(screen.getByRole('button', { name: 'Delivery problems' }));
		await waitFor(() => expect(reads().at(-1)!.body).toEqual({ limit: 50, org_id: ORG_A, types: ['notification.failed'] }));
	});

	it('shows older pages with the cursor', async () => {
		const calls = route_fetch((body) => (body.until_ms
			? { items: [item('old', { at: now - 3 * 86_400_000 })], next_until_ms: null, orgs: [], partial: false }
			: { items: [item('a')], next_until_ms: 12345, orgs: [], partial: false }));
		render_page('/inbox');
		await screen.findByTestId('inbox-item-a');
		fireEvent.click(screen.getByRole('button', { name: 'Show older' }));
		await screen.findByTestId('inbox-item-old');
		expect(calls.filter((c) => c.url === '/v1/inbox/get').at(-1)!.body).toMatchObject({ limit: 50, until_ms: 12345 });
		expect(screen.queryByRole('button', { name: 'Show older' })).toBeNull();
	});

	it('names orgs that failed to load', async () => {
		route_fetch(() => ({ items: [item('a')], next_until_ms: null, orgs: [{ id: 'x', slug: 'acme-labs', display_name: 'Acme Labs', status: 'error', error: 'down' }], partial: true }));
		render_page('/inbox');
		expect(await screen.findByText(/Couldn’t load notifications for Acme Labs/)).toBeInTheDocument();
	});
});

describe('Bell', () => {
	afterEach(() => vi.restoreAllMocks());

	it('shows the new count and the latest, with a Fix channel link for delivery problems', async () => {
		route_fetch();
		render_page();
		expect(await screen.findByTestId('bell-count')).toHaveTextContent('3');
		fireEvent.click(screen.getByTestId('bell'));
		const pop = screen.getByRole('dialog', { name: 'Latest notifications' });
		expect(within(pop).getByText('Title n1')).toBeInTheDocument();
		expect(within(pop).getByRole('link', { name: 'Fix channel' })).toHaveAttribute('href', '/notifications?tab=channels&channel=ch-1&org=measureone');
		expect(within(pop).getByRole('link', { name: 'Open inbox →' })).toHaveAttribute('href', '/inbox?tab=all&org=measureone');
	});
});

describe('inbox helpers', () => {
	it('kinds and actions', () => {
		expect(inbox_kind('run.crashed')).toBe('failed');
		expect(inbox_kind('hug.review_expired')).toBe('review');
		expect(inbox_kind('daemon.offline')).toBe('daemon');
		expect(inbox_action(item('d', { event: 'daemon.offline', run_id: null }))).toEqual({ label: 'Open realm', href: '/o/measureone/realms/prod-us/inbox' });
		expect(inbox_action(item('x', { realm_slug: null, org_slug: null, run_id: null, event: 'auth.api_key_created' }))).toBeNull();
	});
});
