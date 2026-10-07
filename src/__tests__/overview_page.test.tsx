/**
 * Overview page + Graphite shell. You work in one org at a time: the org
 * comes from ?org=, the last org used in this browser (tests start in
 * measureone, see setup.ts), the default realm's org, or your only org;
 * with several orgs and none of those, an org picker. Also: empty, partial,
 * errors, site-admin visibility, the org switcher, breadcrumb, footer.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import type { Overview_data } from '@/lib/overview';
import type { Inbox_item } from '@/lib/inbox';
import { multi_org_overview, single_org_overview, org, realm, counts, gs_response, ORG_A, ORG_B } from './fixtures_overview';

const auth = {
	user: { id: 'u1', username: 'sapan', display_name: 'Sapan Shah', email: 's@x.com', role: 'user' as 'user' | 'admin', preferences: {} },
	loading: false,
	logout: vi.fn(),
	acting_as: null as null | { actor_id: string; actor_username: string },
	stop_act_as: vi.fn(),
};

// Stable like the real hook (useCallback) so effects don't re-run each render.
const stable_fetch = (url: string, init?: RequestInit) => fetch(url, init);
vi.mock('@/lib/auth_context', () => ({
	useAuth: () => auth,
	useAuthFetch: () => stable_fetch,
}));

import { Component as OverviewPage } from '@/pages/overview_page';

function Where() {
	const loc = useLocation();
	return <div data-testid="where">{loc.pathname}{loc.search}</div>;
}

function respond(data: Overview_data | null, init: { status?: number; body?: unknown } = {}) {
	return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
		gs_response(url) ?? new Response(JSON.stringify(init.body ?? { ok: true, data }), { status: init.status ?? 200 }));
}

/** Calls to the overview route only (the shell also reads getting-started). */
function overview_calls(spy: { mock: { calls: unknown[][] } }) {
	return spy.mock.calls.filter(([u]) => u === '/v1/overview/get');
}

function render_page(path = '/home') {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<Routes>
				<Route path="/home" element={<><OverviewPage /><Where /></>} />
				<Route path="*" element={<Where />} />
			</Routes>
		</MemoryRouter>,
	);
}

describe('Overview page', () => {
	beforeEach(() => {
		auth.user.role = 'user';
		auth.acting_as = null;
	});
	afterEach(() => vi.restoreAllMocks());

	it('makes exactly one BFF call and no direct Core fan-out', async () => {
		const spy = respond(multi_org_overview());
		render_page();
		await screen.findByRole('heading', { level: 1, name: /MeasureOne/ });
		expect(overview_calls(spy)).toHaveLength(1);
		const [url, init] = overview_calls(spy)[0] as [string, RequestInit];
		expect(url).toBe('/v1/overview/get');
		expect(init.method).toBe('POST');
		expect(JSON.parse(String(init.body))).toEqual({});
	});

	it('opens in the remembered org: its counts, items and realms only', async () => {
		respond(multi_org_overview());
		render_page();
		expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('MeasureOne');
		expect(screen.getByText(/you’re an owner/)).toBeInTheDocument();
		expect(screen.queryByText(/All my work/)).toBeNull();
		expect(screen.getByTestId('stat-Waiting on you')).toHaveTextContent('5');
		expect(screen.getByText('Approve architecture · PROJ-482')).toBeInTheDocument();
		expect(screen.queryByText('Review docs page')).toBeNull();
		const panel = screen.getByRole('region', { name: 'Realms' });
		expect(within(panel).getByTestId('realm-measureone-prod-us')).toHaveAttribute('href', '/o/measureone/realms/prod-us/inbox');
		expect(within(panel).queryByTestId('realm-acme-labs-sandbox')).toBeNull();
	});

	it('?org= wins over the remembered org, re-scopes everything without another request, and is remembered', async () => {
		const spy = respond(multi_org_overview());
		render_page('/home?org=acme-labs');
		expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Acme Labs');
		expect(screen.getByText(/you’re a member/)).toBeInTheDocument();
		expect(screen.getByTestId('stat-Waiting on you')).toHaveTextContent('1');
		expect(screen.queryByText('Approve architecture · PROJ-482')).toBeNull();
		expect(screen.getByText('Review docs page')).toBeInTheDocument();
		expect(screen.getByRole('region', { name: 'Realms' })).toHaveTextContent('sandbox');
		expect(screen.getByRole('region', { name: 'Realms' })).not.toHaveTextContent('prod-us');
		expect(screen.getByText('Nothing is running right now.')).toBeInTheDocument();
		expect(overview_calls(spy)).toHaveLength(1);
		await waitFor(() => expect(window.localStorage.getItem('cliqhub.last_org')).toBe('acme-labs'));
	});

	it('an unknown ?org= falls back to the remembered org (never leaks or blanks)', async () => {
		respond(multi_org_overview());
		render_page('/home?org=not-mine');
		expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('MeasureOne');
		expect(screen.getByTestId('view-switcher')).toHaveTextContent('MeasureOne');
	});

	it('several orgs and none remembered: pick one first; the pick is remembered', async () => {
		window.localStorage.clear();
		respond(multi_org_overview());
		render_page();
		const picker = await screen.findByTestId('org-picker');
		expect(within(picker).getByRole('heading', { name: 'Choose an organization' })).toBeInTheDocument();
		expect(screen.getByTestId('view-switcher')).toHaveTextContent('Choose one');
		// No realms in the sidebar until an org is chosen.
		expect(within(screen.getByTestId('sidebar-realms')).queryAllByRole('link')).toHaveLength(0);
		fireEvent.click(within(picker).getByTestId('pick-org-acme-labs'));
		expect(await screen.findByTestId('where')).toHaveTextContent('/home?org=acme-labs');
		expect(window.localStorage.getItem('cliqhub.last_org')).toBe('acme-labs');
	});

	it('a single-org user is always in their org (no picker)', async () => {
		window.localStorage.clear();
		respond(single_org_overview());
		render_page();
		expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('MeasureOne');
		expect(screen.queryByTestId('org-picker')).toBeNull();
	});

	it('realms are labelled by name (slug as secondary) in the sidebar', async () => {
		const data = multi_org_overview();
		data.orgs[0].realms[1] = { ...data.orgs[0].realms[1], slug: 'measureone', name: 'measureone-sdlc' };
		respond(data);
		render_page();
		const side = await screen.findByTestId('sidebar-realms');
		const link = await within(side).findByRole('link', { name: /measureone-sdlc/ });
		expect(link.getAttribute('href')).toBe('/o/measureone/realms/measureone/inbox');
	});

	it('single org, org view: realms panel sorted waiting-on-you first', async () => {
		respond(single_org_overview());
		render_page('/home?org=measureone');
		expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('MeasureOne');
		const names = within(screen.getByRole('region', { name: 'Realms' })).getAllByRole('link').map((a) => a.textContent ?? '');
		expect(names[0]).toBe('All 2 realms →');
		expect(names.slice(1).map((n) => n.match(/prod-us|staging/)?.[0])).toEqual(['prod-us', 'staging']);
	});

	it('needs-you tabs filter by kind and link to the right place', async () => {
		respond(multi_org_overview());
		render_page();
		await screen.findByRole('heading', { level: 1, name: /MeasureOne/ });
		fireEvent.click(screen.getByRole('tab', { name: /Input 1/ }));
		expect(screen.getByRole('tab', { name: /Input 1/ })).toHaveAttribute('aria-selected', 'true');
		expect(screen.queryByText('Approve architecture · PROJ-482')).toBeNull();
		expect(screen.getByRole('link', { name: 'Provide input' })).toHaveAttribute('href', '/o/measureone/realms/prod-us/runs/run-88');
		fireEvent.click(screen.getByRole('tab', { name: /Reviews 1/ }));
		expect(screen.getAllByRole('link', { name: 'Review' })[0]).toHaveAttribute('href', '/reviews/rev-1');
	});

	it('Needs attention: only problems for this org from the latest events, with a way into the inbox', async () => {
		const ev = (id: string, event: string, org_id: string | null = ORG_A): Inbox_item => ({
			id, event, title: `T ${id}`, message: null, severity: null, org_id, org_slug: org_id === ORG_B ? 'acme-labs' : 'measureone',
			realm_id: 'r-prod', realm_slug: 'prod-us', team: 'recon', run_id: 'run-1', phase: null, review_id: null, channel_id: null, original_event: null, at: Date.now() - 60_000,
		});
		const d = multi_org_overview();
		d.inbox = { new_count: 0, capped: false, status: 'ok', latest: [
			ev('fail', 'run.failed'), ev('done', 'run.completed'), ev('hug', 'hug.review_requested'),
			ev('off', 'daemon.offline'), ev('on', 'daemon.online'), ev('other-org', 'run.crashed', ORG_B),
		] };
		respond(d);
		render_page();
		const panel = await screen.findByTestId('needs-attention');
		expect(within(panel).getAllByTestId(/^inbox-item-/).map((e) => e.dataset.testid)).toEqual(['inbox-item-fail', 'inbox-item-off']);
		expect(within(panel).getByRole('link', { name: 'Open inbox →' })).toHaveAttribute('href', '/inbox?org=measureone');
	});

	it('Needs attention: says so when nothing went wrong', async () => {
		respond(multi_org_overview());
		render_page();
		expect(within(await screen.findByTestId('needs-attention')).getByText('Nothing has gone wrong recently.')).toBeInTheDocument();
	});

	it('shows the caught-up empty state', async () => {
		respond({ ...single_org_overview(), needs_you: [] });
		render_page();
		expect(await screen.findByText('You’re all caught up')).toBeInTheDocument();
	});

	it('shows onboarding when the user has no realms', async () => {
		respond({ orgs: [], totals: { needs_you: 0, pending_reviews: 0, awaiting_input: 0, active_runs: 0, failed_24h: 0, completed_24h: 0, daemons_online: 0, daemons_total: 0, orgs: 0, realms: 0 }, needs_you: [], live_runs: [], partial: false });
		render_page();
		expect(await screen.findByText('You don’t have any realms yet')).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'Create a realm' })).toHaveAttribute('href', '/realms');
	});

	it('partial data: the org that failed to load says so', async () => {
		const d = multi_org_overview();
		d.orgs[1] = { ...d.orgs[1], status: 'error', error: 'No access to org', realms: [] };
		d.partial = true;
		respond(d);
		render_page('/home?org=acme-labs');
		expect(await screen.findByTestId('org-error-acme-labs')).toHaveTextContent('No access to org');
		expect(within(screen.getByTestId('sidebar-realms')).getByText('Couldn’t load Acme Labs')).toBeInTheDocument();
	});

	it('shows an error with retry when the BFF fails, and recovers', async () => {
		let n = 0;
		const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => gs_response(url) ?? (n++ === 0
			? new Response(JSON.stringify({ ok: false, error: { code: 'upstream', message: 'Core unreachable' } }), { status: 502 })
			: new Response(JSON.stringify({ ok: true, data: single_org_overview() }))));
		render_page();
		expect(await screen.findByRole('alert')).toHaveTextContent('Core unreachable');
		fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
		expect(await screen.findByRole('heading', { level: 1, name: /MeasureOne/ })).toBeInTheDocument();
		expect(overview_calls(spy)).toHaveLength(2);
	});

	it('network failure keeps the page usable', async () => {
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => { const g = gs_response(url); if (g) return g; throw new Error('offline'); });
		render_page();
		expect(await screen.findByRole('alert')).toHaveTextContent('Network error');
	});

	it('Admin entry only for site admins, and it opens admin mode', async () => {
		respond(single_org_overview());
		const { unmount } = render_page('/home?x=1');
		await screen.findByRole('heading', { level: 1 });
		fireEvent.click(screen.getByTestId('account-button'));
		expect(within(screen.getByRole('menu', { name: 'Account' })).queryByRole('menuitem', { name: /Site admin/ })).toBeNull();
		unmount();
		auth.user.role = 'admin';
		respond(single_org_overview());
		render_page('/home?x=1');
		await screen.findByRole('heading', { level: 1 });
		fireEvent.click(screen.getByTestId('account-button'));
		const menu = screen.getByRole('menu', { name: 'Account' });
		expect(within(menu).getByText(/site admin/)).toBeInTheDocument();
		fireEvent.click(within(menu).getByRole('menuitem', { name: /Site admin.*SITE/ }));
		expect(await screen.findByTestId('where')).toHaveTextContent(/^\/admin$/);
	});
});

describe('Sidebar realms', () => {
	afterEach(() => vi.restoreAllMocks());

	it('realm shortcuts under Realms: the org’s realms only, no org badges, linking to the realm inbox', async () => {
		respond(multi_org_overview());
		render_page();
		await screen.findByRole('heading', { level: 1 });
		const side = screen.getByTestId('sidebar-realms');
		const links = within(side).getAllByRole('link');
		expect(links.map((a) => a.getAttribute('href'))).toEqual(['/o/measureone/realms/prod-us/inbox', '/o/measureone/realms/staging/inbox']);
		expect(links.map((a) => a.textContent)).toEqual([expect.stringMatching(/^prod-us/), expect.stringMatching(/^staging/)]);
		expect(within(side).getByLabelText('4 waiting on you')).toBeInTheDocument();
		// Nav links carry the org.
		expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/home?org=measureone');
	});

	it('caps at 5 (waiting on you first, then latest activity) with an "All N realms" link', async () => {
		const many = Array.from({ length: 14 }, (_, i) => realm({ id: `r${i}`, slug: `realm-${String(i).padStart(2, '0')}`, org_id: ORG_A, org_slug: 'measureone', last_activity_at: i, needs_you: i === 3 ? 2 : 0 }));
		const d = single_org_overview();
		d.orgs = [org({ id: ORG_A, slug: 'measureone', display_name: 'MeasureOne', role: 'owner', counts: counts(), realms: many })];
		d.totals = { ...d.totals, realms: 14 };
		respond(d);
		render_page();
		await screen.findByRole('heading', { level: 1 });
		const side = screen.getByTestId('sidebar-realms');
		const links = within(side).getAllByRole('link');
		expect(links).toHaveLength(6);
		expect(links[0]).toHaveTextContent('realm-03');
		expect(links[1]).toHaveTextContent('realm-13');
		expect(links[5]).toHaveTextContent('All 14 realms →');
		expect(links[5]).toHaveAttribute('href', '/realms?org=measureone');
	});
});

describe('Org switcher', () => {
	afterEach(() => vi.restoreAllMocks());

	async function open(path = '/home') {
		respond(multi_org_overview());
		render_page(path);
		await screen.findByRole('heading', { level: 1 });
		fireEvent.click(screen.getByTestId('view-switcher'));
		return screen.getByRole('dialog', { name: 'Switch organization' });
	}

	it('lists organizations only (role, realm count, waiting), the current one marked', async () => {
		const dlg = await open();
		const options = within(dlg).getAllByRole('option');
		expect(options.map((o) => o.textContent)).toEqual([expect.stringMatching(/MeasureOne.*owner · 2 realms/), expect.stringMatching(/Acme Labs.*member · 1 realm/)]);
		expect(within(dlg).getByRole('option', { name: /MeasureOne/ })).toHaveAttribute('aria-current', 'true');
		expect(within(dlg).queryByText(/All my work/)).toBeNull();
		expect(within(dlg).queryByRole('option', { name: /prod-us/ })).toBeNull();
	});

	it('picking an org switches the whole app and remembers it', async () => {
		const dlg = await open();
		fireEvent.click(within(dlg).getByRole('option', { name: /Acme Labs/ }));
		expect(await screen.findByTestId('where')).toHaveTextContent('/home?org=acme-labs');
		expect(screen.getByTestId('view-switcher')).toHaveTextContent('Acme Labs');
		expect(screen.getByTestId('view-switcher')).toHaveTextContent('Organization · member');
		expect(window.localStorage.getItem('cliqhub.last_org')).toBe('acme-labs');
	});

	it('search narrows the orgs and Enter switches to the first hit', async () => {
		const dlg = await open();
		fireEvent.change(within(dlg).getByPlaceholderText('Switch organization…'), { target: { value: 'acme' } });
		expect(within(dlg).getAllByRole('option')).toHaveLength(1);
		fireEvent.keyDown(dlg, { key: 'Enter' });
		expect(await screen.findByTestId('where')).toHaveTextContent('/home?org=acme-labs');
	});

	it('arrow keys move the selection', async () => {
		const dlg = await open();
		fireEvent.keyDown(dlg, { key: 'ArrowDown' });
		expect(within(dlg).getByRole('option', { name: /Acme Labs/ })).toHaveAttribute('aria-selected', 'true');
		fireEvent.keyDown(dlg, { key: 'Enter' });
		expect(await screen.findByTestId('where')).toHaveTextContent('/home?org=acme-labs');
	});

	it('shows a no-match message', async () => {
		const dlg = await open();
		fireEvent.change(within(dlg).getByPlaceholderText('Switch organization…'), { target: { value: 'zzz' } });
		expect(within(dlg).getByText(/No organization matches/)).toBeInTheDocument();
	});

	it('closes on Escape and toggles with ⌘J', async () => {
		const dlg = await open();
		fireEvent.keyDown(dlg, { key: 'Escape' });
		await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Switch organization' })).toBeNull());
		fireEvent.keyDown(document, { key: 'j', metaKey: true });
		expect(screen.getByRole('dialog', { name: 'Switch organization' })).toBeInTheDocument();
		void ORG_B;
	});
});

describe('Breadcrumb, account menu', () => {
	afterEach(() => vi.restoreAllMocks());

	it('the breadcrumb starts at the org; there is no step-up to “all”', async () => {
		respond(multi_org_overview());
		render_page('/home?org=acme-labs');
		await screen.findByRole('heading', { level: 1 });
		expect(screen.queryByTestId('view-step-up')).toBeNull();
		const crumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
		expect(within(crumb).queryByRole('link', { name: /All my work/ })).toBeNull();
		expect(within(crumb).getByRole('link', { name: /Acme Labs/ })).toHaveAttribute('href', '/home?org=acme-labs');
		expect(within(crumb).getByText('Dashboard')).toHaveAttribute('aria-current', 'page');
	});

	it('account menu (top right): profile, tokens, Getting started progress, Docs, sign out', async () => {
		respond(single_org_overview());
		render_page();
		await screen.findByRole('heading', { level: 1 });
		expect(screen.queryByTestId('sidebar-footer')).toBeNull();
		await waitFor(() => { fireEvent.click(screen.getByTestId('account-button')); expect(screen.getByRole('menu', { name: 'Account' })).toBeInTheDocument(); });
		const menu = screen.getByRole('menu', { name: 'Account' });
		expect(await within(menu).findByLabelText('2 of 4 done')).toHaveTextContent('2 / 4');
		expect(within(menu).getByRole('menuitem', { name: /Getting started/ })).toHaveAttribute('href', '/getting-started');
		expect(within(menu).getByRole('menuitem', { name: /Docs/ })).toHaveAttribute('target', '_blank');
		expect(within(menu).getByRole('menuitem', { name: 'API tokens' })).toHaveAttribute('href', '/settings?tab=tokens');
		fireEvent.click(within(menu).getByRole('menuitem', { name: 'Sign out' }));
		expect(auth.logout).toHaveBeenCalled();
	});
});

describe('Colour by kind (overview)', () => {
	afterEach(() => vi.restoreAllMocks());
	it('input rows are amber like everywhere else, reviews pink', async () => {
		respond(multi_org_overview());
		render_page();
		await screen.findByRole('heading', { level: 1 });
		const kinds = Array.from(document.querySelectorAll('[data-kind]')) as HTMLElement[];
		expect(kinds.find((k) => k.dataset.kind === 'input')!.style.color).toBe('var(--g-warn-text)');
		expect(kinds.find((k) => k.dataset.kind === 'review')!.style.color).toBe('var(--g-hug)');
	});
});

describe('Stat strips', () => {
	afterEach(() => vi.restoreAllMocks());
	it('every tile has a colour strip, daemons reflect health', async () => {
		respond(multi_org_overview());
		render_page();
		await screen.findByRole('heading', { level: 1 });
		expect(screen.getByTestId('stat-Waiting on you')).toHaveAttribute('data-tone', 'attention');
		expect(screen.getByTestId('stat-Running now')).toHaveAttribute('data-tone', 'run');
		expect(screen.getByTestId('stat-Failed · 24h')).toHaveAttribute('data-tone', 'failed');
		expect(screen.getByTestId('stat-Daemons')).toHaveAttribute('data-tone', 'warn'); // 5/6 online
	});
});
