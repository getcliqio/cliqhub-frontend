/**
 * Graphite realm Inbox — one BFF composition call, filters, links,
 * partial data, access errors.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { inbox, overview_for_realm } from './fixtures_realm';
import { gs_response } from './fixtures_overview';

const auth = {
	user: { id: 'u1', username: 'sapan', display_name: 'Sapan Shah', email: 's@x.com', role: 'user' as const, preferences: {} },
	loading: false,
	logout: vi.fn(),
	acting_as: null,
	stop_act_as: vi.fn(),
};
const stable_fetch = (url: string, init?: RequestInit) => fetch(url, init);
vi.mock('@/lib/auth_context', () => ({ useAuth: () => auth, useAuthFetch: () => stable_fetch }));

import { Component as InboxPage } from '@/pages/realm/realm_inbox_page';

function Where() {
	const loc = useLocation();
	return <div data-testid="where">{loc.pathname}</div>;
}

type Reply = { status?: number; body: unknown };

function route_fetch(inbox_reply: Reply | (() => Reply)) {
	return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
		const u = String(url);
		if (u === '/v1/overview/get') return new Response(JSON.stringify({ ok: true, data: overview_for_realm() }));
		if (u === '/v1/getting_started/get') return gs_response(u)!;
		if (u === '/v1/realm_inbox/get') {
			const r = typeof inbox_reply === 'function' ? inbox_reply() : inbox_reply;
			return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
		}
		throw new Error(`unexpected ${u}`);
	});
}

function render_page(path = '/o/measureone/realms/prod-us/inbox') {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<Routes>
				<Route path="/o/:org/realms/:slug/inbox" element={<InboxPage />} />
				<Route path="*" element={<Where />} />
			</Routes>
		</MemoryRouter>,
	);
}

describe('Realm inbox page', () => {
	afterEach(() => vi.restoreAllMocks());

	it('makes one inbox call with org + realm slug from the URL (plus the shared sidebar read)', async () => {
		const spy = route_fetch({ body: { ok: true, data: inbox() } });
		render_page();
		await screen.findByRole('heading', { name: 'Inbox' });
		const inbox_calls = spy.mock.calls.filter(([u]) => u === '/v1/realm_inbox/get');
		expect(inbox_calls).toHaveLength(1);
		expect(JSON.parse(String((inbox_calls[0][1] as RequestInit).body))).toEqual({ org_slug: 'measureone', slug: 'prod-us' });
		// No direct Core fan-out from the browser.
		const others = spy.mock.calls.map(([u]) => String(u)).filter((u) => u !== '/v1/realm_inbox/get' && u !== '/v1/overview/get' && u !== '/v1/getting_started/get');
		expect(others).toEqual([]);
	});

	it('shows counts, rows with the right actions and links', async () => {
		route_fetch({ body: { ok: true, data: inbox() } });
		render_page();
		await screen.findByRole('heading', { name: 'Inbox' });
		expect(screen.getByTestId('inbox-stat-Reviews')).toHaveTextContent('1');
		expect(screen.getByTestId('inbox-stat-Needs input')).toHaveTextContent('1');
		expect(screen.getByTestId('inbox-stat-Failed · 24h')).toHaveTextContent('1');
		expect(screen.getByTestId('inbox-stat-Running')).toHaveTextContent('1');
		expect(screen.getByRole('link', { name: 'Review' })).toHaveAttribute('href', '/reviews/rev-1');
		expect(screen.getByRole('link', { name: 'Provide input' })).toHaveAttribute('href', '/o/measureone/realms/prod-us/runs/run-88');
		expect(screen.getByRole('link', { name: 'Investigate' })).toHaveAttribute('href', '/o/measureone/realms/prod-us/runs/run-77');
		expect(screen.getByText('Timeout talking to ledger')).toBeInTheDocument();
		expect(screen.getByText('Please check the retry budget')).toBeInTheDocument();
		expect(screen.getByRole('link', { name: /PROJ-491/ })).toHaveAttribute('href', '/o/measureone/realms/prod-us/runs/run-1843');
	});

	it('filters by tab and by clicking a stat (toggle)', async () => {
		route_fetch({ body: { ok: true, data: inbox() } });
		render_page();
		await screen.findByRole('heading', { name: 'Inbox' });
		fireEvent.click(screen.getByRole('tab', { name: /Failed 1/ }));
		expect(screen.getAllByTestId(/inbox-row-/).map((r) => r.dataset.testid)).toEqual(['inbox-row-failed']);
		fireEvent.click(screen.getByTestId('inbox-stat-Reviews'));
		expect(screen.getByTestId('inbox-stat-Reviews')).toHaveAttribute('aria-pressed', 'true');
		expect(screen.getAllByTestId(/inbox-row-/).map((r) => r.dataset.testid)).toEqual(['inbox-row-review']);
		fireEvent.click(screen.getByTestId('inbox-stat-Reviews'));
		expect(screen.getAllByTestId(/inbox-row-/)).toHaveLength(3);
	});

	it('shows inbox zero', async () => {
		route_fetch({ body: { ok: true, data: inbox({ items: [], live: [], counts: { reviews: 0, awaiting_input: 0, failed_24h: 0, running: 0 } }) } });
		render_page();
		expect(await screen.findByText('Inbox zero')).toBeInTheDocument();
		expect(screen.getByText('Nothing is running right now.')).toBeInTheDocument();
	});

	it('names the sections that failed to load and still renders the rest', async () => {
		const d = inbox({ partial: true });
		d.sections.reviews = { status: 'error', error: 'reviews down' };
		route_fetch({ body: { ok: true, data: d } });
		render_page();
		expect(await screen.findByText(/Some of this inbox couldn’t be loaded/)).toBeInTheDocument();
		expect(screen.getByText('Reviews — reviews down')).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'Investigate' })).toBeInTheDocument();
	});

	it('403 → no-access state (no retry loop)', async () => {
		route_fetch({ status: 403, body: { ok: false, error: { code: 'forbidden', message: 'Not a realm member' } } });
		render_page();
		expect(await screen.findByText('You don’t have access to this realm')).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
	});

	it('404 → not-found state', async () => {
		route_fetch({ status: 404, body: { ok: false, error: { code: 'not_found', message: "Realm 'nope' not found" } } });
		render_page('/o/measureone/realms/nope/inbox');
		expect(await screen.findByText('This realm doesn’t exist')).toBeInTheDocument();
	});

	it('5xx → retry recovers', async () => {
		let n = 0;
		route_fetch(() => (n++ === 0 ? { status: 502, body: { ok: false, error: { code: 'upstream', message: 'Core unreachable' } } } : { body: { ok: true, data: inbox() } }));
		render_page();
		expect(await screen.findByRole('alert')).toHaveTextContent('Core unreachable');
		fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
		expect(await screen.findByRole('heading', { name: 'Inbox' })).toBeInTheDocument();
	});

	it('realm nav: all sections; sidebar highlights the realm health', async () => {
		route_fetch({ body: { ok: true, data: inbox() } });
		render_page();
		await screen.findByRole('heading', { name: 'Inbox' });
		const nav = screen.getByRole('navigation', { name: 'Realm sections' });
		expect(within(nav).getByRole('link', { name: 'Inbox' })).toHaveAttribute('href', '/o/measureone/realms/prod-us/inbox');
		expect(within(nav).getByRole('link', { name: 'Runs' })).toHaveAttribute('href', '/o/measureone/realms/prod-us/runs');
		expect(within(nav).getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/o/measureone/realms/prod-us/settings');
		expect(await screen.findByTestId('realm-health')).toHaveTextContent('5/6 daemons');
		const crumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
		expect(within(crumb).getByRole('link', { name: /All my work/ })).toHaveAttribute('href', '/home');
		expect(within(crumb).getByRole('link', { name: 'prod-us' })).toHaveAttribute('href', '/o/measureone/realms/prod-us/inbox');
		expect(within(crumb).getByText('Inbox')).toHaveAttribute('aria-current', 'page');
		// Same for one org or many: the breadcrumb names the org, × steps up to it.
		expect(within(crumb).getByRole('link', { name: /MeasureOne/ })).toHaveAttribute('href', '/home?org=measureone');
		expect(screen.getByTestId('view-step-up')).toHaveAttribute('href', '/home?org=measureone');
	});
});

describe('Colour by kind', () => {
	afterEach(() => vi.restoreAllMocks());
	it('uses the shared kind colours (review pink, input amber, failed red) and outlined row actions', async () => {
		route_fetch({ body: { ok: true, data: inbox() } });
		render_page();
		await screen.findByRole('heading', { name: 'Inbox' });
		const icon = (k: string) => screen.getByTestId(`inbox-row-${k}`).querySelector('[data-kind]') as HTMLElement;
		expect(icon('review').style.color).toBe('var(--g-hug)');
		expect(icon('input').style.color).toBe('var(--g-warn-text)');
		expect(icon('failed').style.color).toBe('var(--g-bad)');
		expect(screen.getByRole('link', { name: 'Review' }).className).not.toContain('g-acc');
	});
});
