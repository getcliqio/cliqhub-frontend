/**
 * Overview page + Graphite shell (multi-org, single-org, empty, partial,
 * errors, take-over and site-admin visibility, switcher behaviour).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import type { Overview_data } from '@/lib/overview';
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
		await screen.findByText(/Good (morning|afternoon|evening), Sapan/);
		expect(overview_calls(spy)).toHaveLength(1);
		const [url, init] = overview_calls(spy)[0] as [string, RequestInit];
		expect(url).toBe('/v1/overview/get');
		expect(init.method).toBe('POST');
		expect(JSON.parse(String(init.body))).toEqual({});
	});

	it('all-orgs view: counts, org badges on items, and a Realms panel with the org as subtext', async () => {
		respond(multi_org_overview());
		render_page();
		expect(await screen.findByText(/Across/)).toHaveTextContent('Across 2 orgs and 3 realms you can access.');
		expect(screen.queryByRole('group', { name: 'Filter by org' })).toBeNull();
		expect(screen.getByTestId('stat-Waiting on you')).toHaveTextContent('6');
		expect(screen.getByTestId('stat-Waiting on you')).toHaveTextContent('5 reviews · 1 input');
		expect(screen.getAllByTitle('measureone › prod-us').length).toBeGreaterThan(0);
		expect(screen.queryByRole('region', { name: 'By organization' })).toBeNull();
		const panel = screen.getByRole('region', { name: 'Realms' });
		// Realms, each with its org as subtext; links open the realm (no view switch).
		expect(within(panel).getByTestId('realm-measureone-prod-us')).toHaveAttribute('href', '/o/measureone/realms/prod-us/inbox');
		expect(within(panel).getByTestId('realm-measureone-prod-us')).toHaveTextContent('MeasureOne');
		expect(within(panel).getByTestId('realm-acme-labs-sandbox')).toHaveTextContent('Acme Labs');
		expect(within(panel).getByTestId('realm-measureone-prod-us')).toHaveTextContent('4 need you');
		expect(within(panel).getByRole('link', { name: 'All 3 realms →' })).toHaveAttribute('href', '/realms');
	});

	it('org view comes from ?org= and re-scopes everything — without another request', async () => {
		const spy = respond(multi_org_overview());
		render_page('/home?org=acme-labs');
		expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Acme Labs');
		expect(screen.getByText(/you’re a member/)).toBeInTheDocument();
		expect(screen.getByRole('link', { name: '← All my work' })).toHaveAttribute('href', '/home');
		expect(screen.getByTestId('stat-Waiting on you')).toHaveTextContent('1');
		expect(screen.queryByText('Approve architecture · PROJ-482')).toBeNull();
		expect(screen.getByText('Review docs page')).toBeInTheDocument();
		expect(screen.getByRole('region', { name: 'Realms' })).toHaveTextContent('sandbox');
		expect(screen.getByRole('region', { name: 'Realms' })).not.toHaveTextContent('prod-us');
		expect(screen.queryByText('PROJ-491 · Webhook signing')).toBeNull();
		expect(screen.getByText('Nothing is running right now.')).toBeInTheDocument();
		expect(overview_calls(spy)).toHaveLength(1);
	});

	it('an unknown ?org= falls back to all orgs (never leaks or blanks)', async () => {
		respond(multi_org_overview());
		render_page('/home?org=not-mine');
		expect(await screen.findByText(/Across/)).toHaveTextContent('Across 2 orgs and 3 realms');
		expect(screen.getByTestId('view-switcher')).toHaveTextContent('All my work');
	});

	it('single org looks the same as many: org count, Realms panel with org subtext, org badges', async () => {
		respond(single_org_overview());
		render_page();
		expect(await screen.findByText(/Across/)).toHaveTextContent('Across 1 org and 2 realms you can access.');
		const panel = screen.getByRole('region', { name: 'Realms' });
		expect(within(panel).getByTestId('realm-measureone-staging')).toHaveTextContent('MeasureOne');
		expect(screen.getByTestId('view-switcher')).toHaveTextContent('All my work');
		expect(within(screen.getByTestId('sidebar-realms')).getAllByRole('link')[0].textContent).toMatch(/^ME/);
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
		await screen.findByText(/Across/);
		fireEvent.click(screen.getByRole('tab', { name: /Input 1/ }));
		expect(screen.getByRole('tab', { name: /Input 1/ })).toHaveAttribute('aria-selected', 'true');
		expect(screen.queryByText('Approve architecture · PROJ-482')).toBeNull();
		expect(screen.getByRole('link', { name: 'Provide input' })).toHaveAttribute('href', '/o/measureone/realms/prod-us/runs/run-88');
		fireEvent.click(screen.getByRole('tab', { name: /Reviews 2/ }));
		const review_links = screen.getAllByRole('link', { name: 'Review' });
		expect(review_links[0]).toHaveAttribute('href', '/reviews/rev-1');
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

	it('partial data: warns, and shows the failed org with its error', async () => {
		const d = multi_org_overview();
		d.orgs[1] = { ...d.orgs[1], status: 'error', error: 'No access to org', realms: [] };
		d.partial = true;
		respond(d);
		render_page();
		expect(await screen.findByText(/Some data couldn’t be loaded/)).toBeInTheDocument();
		expect(screen.getByTestId('org-error-acme-labs')).toHaveTextContent('No access to org');
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
		expect(await screen.findByText(/Across/)).toBeInTheDocument();
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
		await screen.findByText(/Across/);
		expect(screen.queryByRole('button', { name: /Admin/ })).toBeNull();
		unmount();
		auth.user.role = 'admin';
		respond(single_org_overview());
		render_page('/home?x=1');
		await screen.findByText(/Across/);
		expect(screen.getByText(/site admin/)).toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: /Admin.*SITE/ }));
		expect(await screen.findByTestId('where')).toHaveTextContent(/^\/admin$/);
	});
});

describe('Sidebar realms', () => {
	afterEach(() => vi.restoreAllMocks());

	it('is always titled "Realms"; in the all view each row carries its org badge and links to the realm inbox', async () => {
		respond(multi_org_overview());
		render_page();
		await screen.findByText(/Across/);
		const side = screen.getByTestId('sidebar-realms');
		expect(within(side).getByText('Realms')).toBeInTheDocument();
		expect(within(side).queryByText('Organizations')).toBeNull();
		const links = within(side).getAllByRole('link');
		expect(links.map((a) => a.getAttribute('href'))).toEqual([
			// needs_you 4, then two ties at 1 broken by activity, then name.
			'/o/measureone/realms/prod-us/inbox', '/o/acme-labs/realms/sandbox/inbox', '/o/measureone/realms/staging/inbox',
		]);
		// Org initials badge on every row (MeasureOne → ME, Acme Labs → AL).
		expect(links.map((a) => a.textContent)).toEqual([expect.stringMatching(/^ME.*prod-us/), expect.stringMatching(/^AL.*sandbox/), expect.stringMatching(/^ME.*staging/)]);
		expect(within(side).getByLabelText('4 waiting on you')).toBeInTheDocument();
	});

	it('in an org view it lists only that org’s realms, without badges', async () => {
		respond(multi_org_overview());
		render_page('/home?org=measureone');
		await screen.findByRole('heading', { level: 1 });
		const side = screen.getByTestId('sidebar-realms');
		expect(within(side).getAllByRole('link').map((a) => a.textContent)).toEqual([expect.stringMatching(/^prod-us/), expect.stringMatching(/^staging/)]);
		// Nav links carry the view.
		expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('href', '/home?org=measureone');
	});

	it('caps at 10 (waiting on you first, then latest activity) with an "All N realms" link', async () => {
		const many = Array.from({ length: 14 }, (_, i) => realm({ id: `r${i}`, slug: `realm-${String(i).padStart(2, '0')}`, org_id: ORG_A, org_slug: 'measureone', last_activity_at: i, needs_you: i === 3 ? 2 : 0 }));
		const d = single_org_overview();
		d.orgs = [org({ id: ORG_A, slug: 'measureone', display_name: 'MeasureOne', role: 'owner', counts: counts(), realms: many })];
		d.totals = { ...d.totals, realms: 14 };
		respond(d);
		render_page();
		await screen.findByText(/Across/);
		const side = screen.getByTestId('sidebar-realms');
		const links = within(side).getAllByRole('link');
		expect(links).toHaveLength(11);
		expect(links[0]).toHaveTextContent('realm-03');
		expect(links[1]).toHaveTextContent('realm-13');
		expect(links[10]).toHaveTextContent('All 14 realms →');
		expect(links[10]).toHaveAttribute('href', '/realms');
		expect(within(side).getByText('14')).toBeInTheDocument();
	});
});

describe('View switcher', () => {
	afterEach(() => vi.restoreAllMocks());

	async function open(path = '/home') {
		respond(multi_org_overview());
		render_page(path);
		await screen.findByRole('heading', { level: 1 });
		fireEvent.click(screen.getByTestId('view-switcher'));
		return screen.getByRole('dialog', { name: 'Switch view' });
	}

	it('lists views (all + each org with role, realm count, waiting) then realms grouped by org', async () => {
		const dlg = await open();
		const views = within(dlg).getByTestId('switcher-views');
		expect(within(views).getByRole('option', { name: /All my work/ })).toHaveAttribute('aria-current', 'true');
		expect(within(views).getByRole('option', { name: /MeasureOne.*owner · 2 realms/ })).toBeInTheDocument();
		expect(within(views).getByRole('option', { name: /Acme Labs.*member · 1 realm/ })).toBeInTheDocument();
		expect(within(within(dlg).getByTestId('switcher-group-measureone')).getAllByRole('option').map((o) => o.textContent)).toEqual([
			expect.stringContaining('prod-us'), expect.stringContaining('staging'),
		]);
	});

	it('picking an org sets the view for the whole app', async () => {
		const dlg = await open();
		fireEvent.click(within(dlg).getByRole('option', { name: /Acme Labs/ }));
		expect(await screen.findByTestId('where')).toHaveTextContent('/home?org=acme-labs');
		expect(screen.getByTestId('view-switcher')).toHaveTextContent('Acme Labs');
		expect(screen.getByTestId('view-switcher')).toHaveTextContent('Viewing org · member');
	});

	it('picking a realm opens that realm’s inbox', async () => {
		const dlg = await open();
		fireEvent.click(within(dlg).getByRole('option', { name: /sandbox/ }));
		expect(await screen.findByTestId('where')).toHaveTextContent('/o/acme-labs/realms/sandbox/inbox');
	});

	it('⌘-click (or ⌘Enter) on a realm views its org instead', async () => {
		const dlg = await open();
		fireEvent.click(within(dlg).getByRole('option', { name: /sandbox/ }), { metaKey: true });
		expect(await screen.findByTestId('where')).toHaveTextContent('/home?org=acme-labs');
	});

	it('search matches realms and orgs, shows match counts, highlights, and keyboard-opens the first hit', async () => {
		const dlg = await open();
		fireEvent.change(within(dlg).getByPlaceholderText('Find an org or realm…'), { target: { value: 'stag' } });
		expect(within(dlg).queryByTestId('switcher-views')).toBeNull();
		expect(within(dlg).getByTestId('switcher-group-measureone')).toHaveTextContent('1 of 2 match');
		expect(within(dlg).queryByTestId('switcher-group-acme-labs')).toBeNull();
		fireEvent.keyDown(dlg, { key: 'Enter' });
		expect(await screen.findByTestId('where')).toHaveTextContent('/o/measureone/realms/staging/inbox');
	});

	it('arrow keys move the selection', async () => {
		const dlg = await open();
		fireEvent.keyDown(dlg, { key: 'ArrowDown' });
		expect(within(dlg).getByRole('option', { name: /MeasureOne/ })).toHaveAttribute('aria-selected', 'true');
		fireEvent.keyDown(dlg, { key: 'Enter' });
		expect(await screen.findByTestId('where')).toHaveTextContent('/home?org=measureone');
	});

	it('shows a no-match message', async () => {
		const dlg = await open();
		fireEvent.change(within(dlg).getByPlaceholderText('Find an org or realm…'), { target: { value: 'zzz' } });
		expect(within(dlg).getByText(/Nothing matches/)).toBeInTheDocument();
	});

	it('closes on Escape and toggles with ⌘J', async () => {
		const dlg = await open();
		fireEvent.keyDown(dlg, { key: 'Escape' });
		await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Switch view' })).toBeNull());
		fireEvent.keyDown(document, { key: 'j', metaKey: true });
		expect(screen.getByRole('dialog', { name: 'Switch view' })).toBeInTheDocument();
	});

	it('single-org users get the same switcher: views (all + their org) and realms under an org header', async () => {
		respond(single_org_overview());
		render_page();
		await screen.findByText(/Across/);
		fireEvent.click(screen.getByTestId('view-switcher'));
		const dlg = screen.getByRole('dialog', { name: 'Switch view' });
		const views = within(dlg).getByTestId('switcher-views');
		expect(within(views).getByText('Views')).toBeInTheDocument();
		expect(within(views).getAllByRole('option').map((o) => o.textContent)).toEqual([expect.stringContaining('All my work'), expect.stringContaining('MeasureOne')]);
		expect(within(views).getByRole('option', { name: /All my work/ })).toHaveAttribute('aria-current', 'true');
		expect(within(dlg).getByPlaceholderText('Find an org or realm…')).toBeInTheDocument();
		const group = within(dlg).getByTestId('switcher-group-measureone');
		expect(group).toHaveTextContent('MeasureOne');
		expect(within(group).getByRole('option', { name: /prod-us/ })).toBeInTheDocument();
		void ORG_B;
	});
});

describe('Way back, breadcrumb, footer', () => {
	afterEach(() => vi.restoreAllMocks());

	it('all view: no step-up; breadcrumb is All my work › Overview', async () => {
		respond(multi_org_overview());
		render_page();
		await screen.findByText(/Across/);
		expect(screen.queryByTestId('view-step-up')).toBeNull();
		const crumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
		expect(within(crumb).getByRole('link', { name: /All my work/ })).toHaveAttribute('href', '/home');
		expect(within(crumb).getByText('Overview')).toHaveAttribute('aria-current', 'page');
	});

	it('org view: × steps up to all, breadcrumb links the org', async () => {
		respond(multi_org_overview());
		render_page('/home?org=acme-labs');
		await screen.findByRole('heading', { level: 1 });
		expect(screen.getByTestId('view-step-up')).toHaveAttribute('href', '/home');
		const crumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
		expect(within(crumb).getByRole('link', { name: /Acme Labs/ })).toHaveAttribute('href', '/home?org=acme-labs');
		fireEvent.click(screen.getByTestId('view-step-up'));
		expect(await screen.findByTestId('where')).toHaveTextContent(/^\/home$/);
	});

	it('the switcher always lets you get back to everything', async () => {
		respond(multi_org_overview());
		render_page('/home?org=acme-labs');
		await screen.findByRole('heading', { level: 1 });
		fireEvent.click(screen.getByTestId('view-switcher'));
		fireEvent.click(within(screen.getByRole('dialog', { name: 'Switch view' })).getByRole('option', { name: /All my work/ }));
		expect(await screen.findByTestId('where')).toHaveTextContent(/^\/home$/);
	});

	it('footer shows Getting started progress, Docs, and an account menu with settings and sign out', async () => {
		respond(single_org_overview());
		render_page();
		await screen.findByText(/Across/);
		const foot = screen.getByTestId('sidebar-footer');
		expect(await within(foot).findByLabelText('2 of 4 done')).toHaveTextContent('2 / 4');
		expect(within(foot).getByRole('link', { name: /Getting started/ })).toHaveAttribute('href', '/getting-started');
		expect(within(foot).getByRole('link', { name: /Docs/ })).toHaveAttribute('target', '_blank');
		fireEvent.click(screen.getByTestId('account-button'));
		const menu = screen.getByRole('menu', { name: 'Account' });
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
		await screen.findByText(/Across/);
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
		await screen.findByText(/Across/);
		expect(screen.getByTestId('stat-Waiting on you')).toHaveAttribute('data-tone', 'attention');
		expect(screen.getByTestId('stat-Running now')).toHaveAttribute('data-tone', 'run');
		expect(screen.getByTestId('stat-Failed · 24h')).toHaveAttribute('data-tone', 'failed');
		expect(screen.getByTestId('stat-Daemons')).toHaveAttribute('data-tone', 'warn'); // 6/7 online
	});
});
