/**
 * Graphite Notifications — one BFF read per view, filters, the view switcher,
 * and writes that go to single existing Core routes.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { multi_org_overview, gs_response, ORG_A, ORG_B } from './fixtures_overview';
import type { Notification_center_data, Notification_check_data } from '@/lib/notification_center';
import { rule_effect, selectors_overlap, event_label } from '@/lib/notification_center';

const auth = {
	user: { id: 'u1', username: 'sapan', display_name: 'Sapan Shah', email: 's@x.com', role: 'user' as const, preferences: {} },
	loading: false,
	logout: vi.fn(),
	acting_as: null,
	stop_act_as: vi.fn(),
};
const stable_fetch = (url: string, init?: RequestInit) => fetch(url, init);
vi.mock('@/lib/auth_context', () => ({ useAuth: () => auth, useAuthFetch: () => stable_fetch }));

import { Component as NotificationsPage, draft_to_destination } from '@/pages/notification_center_page';

function center(): Notification_center_data {
	const org_a = { kind: 'org' as const, org_id: ORG_A, org_slug: 'measureone', realm_id: null, realm_slug: null, team_slug: null };
	return {
		orgs: [
			{ id: ORG_A, slug: 'measureone', display_name: 'MeasureOne', role: 'owner', status: 'ok', error: null },
			{ id: ORG_B, slug: 'acme-labs', display_name: 'Acme Labs', role: 'member', status: 'ok', error: null },
		],
		realms: [
			{ id: 'r-prod', slug: 'prod-us', name: 'prod-us', org_id: ORG_A, org_slug: 'measureone', status: 'ok', error: null },
			{ id: 'r-stage', slug: 'staging', name: 'staging', org_id: ORG_A, org_slug: 'measureone', status: 'ok', error: null },
			{ id: 'r-sand', slug: 'sandbox', name: 'sandbox', org_id: ORG_B, org_slug: 'acme-labs', status: 'ok', error: null },
		],
		channels: [
			{ id: 'ch-oncall', name: 'oncall', owner: { kind: 'org', org_id: ORG_A, org_slug: 'measureone', realm_id: null, realm_slug: null }, destinations: [{ type: 'slack', label: 'Slack webhook …/abcd' }], enabled: true, rule_count: 1 },
			{ id: 'ch-prod', name: 'prod-alerts', owner: { kind: 'realm', org_id: ORG_A, org_slug: 'measureone', realm_id: 'r-prod', realm_slug: 'prod-us' }, destinations: [{ type: 'email', label: 'ops@m1.com' }], enabled: false, rule_count: 1 },
			{ id: 'ch-acme', name: 'acme-feed', owner: { kind: 'org', org_id: ORG_B, org_slug: 'acme-labs', realm_id: null, realm_slug: null }, destinations: [{ type: 'cliqhub', label: 'CliqHub' }], enabled: true, rule_count: 1 },
		],
		rules: [
			{ id: 'rl-org', event: 'run.*', scope: org_a, channel_id: 'ch-oncall', channel_name: 'oncall', priority: 0, replaces: [] },
			{ id: 'rl-realm', event: 'run.failed', scope: { ...org_a, kind: 'realm', realm_id: 'r-prod', realm_slug: 'prod-us' }, channel_id: 'ch-prod', channel_name: 'prod-alerts', priority: 0, replaces: ['rl-org'] },
			{ id: 'rl-acme', event: 'hug.review_requested', scope: { kind: 'org', org_id: ORG_B, org_slug: 'acme-labs', realm_id: null, realm_slug: null, team_slug: null }, channel_id: 'ch-acme', channel_name: 'acme-feed', priority: 0, replaces: [] },
		],
		event_types: ['run.failed', 'run.completed', 'hug.review_requested'],
		partial: false,
	};
}

function check(): Notification_check_data {
	return {
		realm: { id: 'r-prod', slug: 'prod-us', name: 'prod-us', org_id: ORG_A, org_slug: 'measureone' },
		team_slug: null,
		teams: ['feature-dev-js'],
		rows: [
			{ event: 'run.failed', winners: [{ rule_id: 'rl-realm', selector: 'run.failed', tier: 'realm', channel_id: 'ch-prod', channel_name: 'prod-alerts' }], replaced: [{ rule_id: 'rl-org', selector: 'run.*', tier: 'org', channel_id: 'ch-oncall', channel_name: 'oncall' }] },
			{ event: 'hug.review_requested', winners: [], replaced: [] },
		],
		partial: false,
	};
}

type Call = { url: string; body: Record<string, unknown> };

function route_fetch(opts: { center?: () => Notification_center_data; write?: (url: string) => { status?: number; body: unknown } } = {}) {
	const calls: Call[] = [];
	const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
		const u = String(url);
		const body = init?.body ? JSON.parse(String(init.body)) : {};
		if (u === '/v1/overview/get') return new Response(JSON.stringify({ ok: true, data: multi_org_overview() }));
		if (u === '/v1/getting_started/get') return gs_response(u)!;
		calls.push({ url: u, body });
		if (u === '/v1/notification_center/get') return new Response(JSON.stringify({ ok: true, data: (opts.center ?? center)() }));
		if (u === '/v1/notification_center/check') return new Response(JSON.stringify({ ok: true, data: check() }));
		const w = opts.write?.(u) ?? { body: { ok: true, data: u.endsWith('/test') ? { delivered: 1, errors: [] } : {} } };
		return new Response(JSON.stringify(w.body), { status: w.status ?? 200 });
	});
	return { spy, calls };
}

function render_page(path = '/notifications') {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<Routes>
				<Route path="/notifications" element={<NotificationsPage />} />
			</Routes>
		</MemoryRouter>,
	);
}

const rule_ids = () => screen.queryAllByTestId(/^rule-/).map((r) => r.dataset.testid);

describe('Notifications page', () => {
	afterEach(() => vi.restoreAllMocks());

	it('loads with one notification_center call and no Core fan-out from the browser', async () => {
		const { calls } = route_fetch();
		render_page();
		await screen.findByTestId('rule-rl-org');
		expect(calls).toEqual([{ url: '/v1/notification_center/get', body: { realm_limit: 10, realm_offset: 0 } }]);
	});

	it('lists every rule in the All view, shows the replaces chip, and filters by level and search', async () => {
		route_fetch();
		render_page();
		await screen.findByTestId('rule-rl-org');
		expect(rule_ids()).toEqual(['rule-rl-org', 'rule-rl-realm', 'rule-rl-acme']);
		expect(within(screen.getByTestId('rule-rl-realm')).getByTestId('replaces')).toHaveTextContent('replaces the org rule');
		expect(within(screen.getByTestId('rule-rl-realm')).getByText('disabled')).toBeInTheDocument();

		fireEvent.click(screen.getByRole('button', { name: 'Realm' }));
		expect(rule_ids()).toEqual(['rule-rl-realm']);
		fireEvent.click(screen.getByRole('button', { name: 'All levels' }));
		fireEvent.change(screen.getByLabelText('Search rules'), { target: { value: 'review' } });
		expect(rule_ids()).toEqual(['rule-rl-acme']);
	});

	it('follows the view switcher (?org=)', async () => {
		route_fetch();
		render_page('/notifications?org=acme-labs');
		await waitFor(() => expect(rule_ids()).toEqual(['rule-rl-acme']));
		// Sidebar: Work (Overview, Inbox) · Build (Teams, Marketplace) · Manage (Notifications); links keep the view.
		const labels = screen.getAllByRole('link').map((a) => a.textContent?.trim() ?? '');
		const at = (l: string) => labels.findIndex((x) => x.startsWith(l));
		expect(at('Overview')).toBeLessThan(at('Inbox'));
		expect(at('Marketplace')).toBeLessThan(at('Notifications'));
		expect(screen.getByRole('link', { name: /^Inbox/ })).toHaveAttribute('href', '/inbox?org=acme-labs');
		expect(screen.getByRole('link', { name: /^Notifications/ })).toHaveAttribute('href', '/notifications?org=acme-labs');
	});

	it('deletes a rule after inline confirmation via the org or realm route, then reloads', async () => {
		const { calls } = route_fetch();
		render_page();
		await screen.findByTestId('rule-rl-realm');
		fireEvent.click(screen.getByRole('button', { name: /Delete rule Run failed for prod-us/ }));
		fireEvent.click(within(screen.getByTestId('rule-rl-realm')).getByRole('button', { name: 'Delete' }));
		await waitFor(() => expect(calls.filter((c) => c.url === '/v1/notification_center/get')).toHaveLength(2));
		expect(calls).toContainEqual({ url: '/v1/realms/remove_notification_rules', body: { id: 'rl-realm' } });

		fireEvent.click(screen.getByRole('button', { name: /Delete rule Any run event for measureone/ }));
		fireEvent.click(within(screen.getByTestId('rule-rl-org')).getByRole('button', { name: 'Delete' }));
		await waitFor(() => expect(calls).toContainEqual({ url: '/v1/orgs/remove_notification_rules', body: { id: 'rl-org' } }));
	});

	it('shows a delete error without dropping the list', async () => {
		route_fetch({ write: () => ({ status: 403, body: { ok: false, error: { code: 'forbidden', message: 'Admins only' } } }) });
		render_page();
		await screen.findByTestId('rule-rl-org');
		fireEvent.click(screen.getByRole('button', { name: /Delete rule Any run event/ }));
		fireEvent.click(within(screen.getByTestId('rule-rl-org')).getByRole('button', { name: 'Delete' }));
		expect(await screen.findByRole('alert')).toHaveTextContent('Admins only');
		expect(rule_ids()).toHaveLength(3);
	});

	it('new org-wide rule posts to orgs/set_notification_rules', async () => {
		const { calls } = route_fetch();
		render_page('/notifications?org=measureone');
		await screen.findByTestId('rule-rl-org');
		fireEvent.click(screen.getByRole('button', { name: 'New rule' }));
		const dlg = screen.getByRole('dialog', { name: 'New rule' });
		fireEvent.change(within(dlg).getByLabelText('3 · Send to'), { target: { value: 'ch-oncall' } });
		// run.failed at org level sits under the realm rule for prod-us.
		expect(within(dlg).getByTestId('rule-effect')).toHaveTextContent('that rule still wins');
		// Several events in one go → one BFF request, one rule per event.
		fireEvent.click(within(dlg).getByRole('checkbox', { name: 'Run completed' }));
		expect(within(dlg).getByLabelText('Chosen events')).toHaveTextContent('Run failed');
		fireEvent.click(within(dlg).getByRole('button', { name: 'Save 2 rules' }));
		await waitFor(() => expect(calls).toContainEqual({ url: '/v1/notification_center/set_rules', body: { org_id: ORG_A, events: ['run.failed', 'run.completed'], channel_id: 'ch-oncall' } }));
		await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
	});

	it('new team rule posts to realms/set_notification_rules with team_slug, and says what it replaces', async () => {
		const { calls } = route_fetch();
		render_page('/notifications?org=measureone');
		await screen.findByTestId('rule-rl-org');
		fireEvent.click(screen.getByRole('button', { name: 'New rule' }));
		const dlg = screen.getByRole('dialog', { name: 'New rule' });
		fireEvent.click(within(dlg).getByRole('radio', { name: 'A team in a realm' }));
		// Realm defaults to the first one you can edit (prod-us).
		expect(within(dlg).getByRole('button', { name: 'Realm' })).toHaveTextContent('prod-us');
		fireEvent.change(within(dlg).getByLabelText('Team'), { target: { value: 'feature-dev-js' } });
		// Realm-owned channels are offered for realm/team rules.
		fireEvent.change(within(dlg).getByLabelText('3 · Send to'), { target: { value: 'ch-prod' } });
		expect(within(dlg).getByTestId('rule-effect')).toHaveTextContent(/instead of prod-alerts \(realm rule\)\./);
		fireEvent.click(within(dlg).getByRole('button', { name: 'Save rule' }));
		await waitFor(() => expect(calls).toContainEqual({ url: '/v1/notification_center/set_rules', body: { realm_id: 'r-prod', events: ['run.failed'], channel_id: 'ch-prod', team_slug: 'feature-dev-js' } }));
	});

	it('Save stays disabled until a channel (and a team for team rules) is chosen', async () => {
		route_fetch();
		render_page('/notifications?org=measureone');
		await screen.findByTestId('rule-rl-org');
		fireEvent.click(screen.getByRole('button', { name: 'New rule' }));
		const dlg = screen.getByRole('dialog', { name: 'New rule' });
		expect(within(dlg).getByRole('button', { name: 'Save rule' })).toBeDisabled();
		fireEvent.click(within(dlg).getByRole('radio', { name: 'A team in a realm' }));
		fireEvent.change(within(dlg).getByLabelText('3 · Send to'), { target: { value: 'ch-oncall' } });
		expect(within(dlg).getByRole('button', { name: 'Save rule' })).toBeDisabled();
	});
});

describe('Notifications — channels', () => {
	afterEach(() => vi.restoreAllMocks());

	it('lists channels in view; details panel sends test, toggles, deletes via single routes', async () => {
		const { calls } = route_fetch();
		render_page('/notifications?tab=channels&org=measureone');
		await screen.findByTestId('channel-ch-oncall');
		expect(screen.queryByTestId('channel-ch-acme')).toBeNull();
		fireEvent.click(screen.getByRole('button', { name: 'prod-alerts' }));
		const panel = screen.getByRole('complementary', { name: 'Channel details' });
		expect(within(panel).getByText('ops@m1.com')).toBeInTheDocument();
		expect(within(panel).getByText(/Run failed · prod-us/)).toBeInTheDocument();

		fireEvent.click(within(panel).getByRole('button', { name: 'Send test' }));
		expect(await within(panel).findByRole('status')).toHaveTextContent('Test delivered to 1 destination.');
		expect(calls).toContainEqual({ url: '/v1/notification_channels/test', body: { id: 'ch-prod' } });

		fireEvent.click(within(panel).getByRole('button', { name: 'Enable' }));
		await waitFor(() => expect(calls).toContainEqual({ url: '/v1/notification_channels/update', body: { id: 'ch-prod', enabled: true } }));

		fireEvent.click(within(panel).getByRole('button', { name: 'Delete…' }));
		expect(within(panel).getByText(/1 rule send to this channel/)).toBeInTheDocument();
		fireEvent.click(within(panel).getByRole('button', { name: 'Delete channel' }));
		await waitFor(() => expect(calls).toContainEqual({ url: '/v1/notification_channels/remove', body: { id: 'ch-prod' } }));
	});

	it('creates a channel with mapped destinations', async () => {
		const { calls } = route_fetch();
		render_page('/notifications?tab=channels&org=measureone');
		await screen.findByTestId('channel-ch-oncall');
		fireEvent.click(screen.getByRole('button', { name: 'New channel' }));
		const dlg = screen.getByRole('dialog', { name: 'New channel' });
		fireEvent.change(within(dlg).getByLabelText(/Name/), { target: { value: 'eng-alerts' } });
		fireEvent.click(within(dlg).getByRole('button', { name: '+ Add destination' }));
		fireEvent.change(within(dlg).getByLabelText('Destination 2 value'), { target: { value: 'https://hooks.slack.com/x' } });
		fireEvent.click(within(dlg).getByRole('button', { name: 'Create channel' }));
		await waitFor(() => expect(calls).toContainEqual({
			url: '/v1/notification_channels/create',
			body: { name: 'eng-alerts', org_id: ORG_A, destinations: [{ type: 'cliqhub' }, { type: 'slack', webhook_url: 'https://hooks.slack.com/x' }] },
		}));
	});

	it('maps destination drafts to Core shapes', () => {
		expect(draft_to_destination({ type: 'email', value: ' a@b.c ' })).toEqual({ type: 'email', address: 'a@b.c' });
		expect(draft_to_destination({ type: 'webhook', value: 'https://x' })).toEqual({ type: 'webhook', url: 'https://x' });
		expect(draft_to_destination({ type: 'cliqhub', value: 'ignored' })).toEqual({ type: 'cliqhub' });
	});
});

describe('Notifications — check a realm', () => {
	afterEach(() => vi.restoreAllMocks());

	it('makes one check call for the realm and shows winners, replaced and gaps', async () => {
		const { calls } = route_fetch();
		render_page('/notifications?tab=check&org=measureone');
		const row = await screen.findByTestId('check-run.failed');
		expect(calls.filter((c) => c.url === '/v1/notification_center/check')[0].body).toEqual({ realm_id: 'r-prod' });
		expect(within(row).getByText('prod-alerts')).toBeInTheDocument();
		expect(within(row).getByText('org → oncall')).toBeInTheDocument();
		expect(within(screen.getByTestId('check-hug.review_requested')).getByText('— Nobody is told')).toBeInTheDocument();
		fireEvent.click(screen.getByLabelText(/Show events nobody is told about/));
		expect(screen.queryByTestId('check-hug.review_requested')).toBeNull();

		fireEvent.change(screen.getByLabelText('Team'), { target: { value: 'feature-dev-js' } });
		await waitFor(() => expect(calls.map((c) => c.body)).toContainEqual({ realm_id: 'r-prod', team_slug: 'feature-dev-js' }));
	});
});

describe('notification_center helpers', () => {
	it('selectors overlap like the BFF', () => {
		expect(selectors_overlap('run.*', 'run.failed')).toBe(true);
		expect(selectors_overlap('*', 'phase.failed')).toBe(true);
		expect(selectors_overlap('run.*', 'phase.failed')).toBe(false);
		expect(selectors_overlap('run.failed', 'run.completed')).toBe(false);
	});

	it('rule_effect splits replaced / overridden / alongside', () => {
		const d = center();
		const e = rule_effect({ event: 'run.failed', scope: { kind: 'realm', org_id: ORG_A, org_slug: 'measureone', realm_id: 'r-prod', realm_slug: 'prod-us', team_slug: null } }, d.rules);
		expect(e.replaces.map((r) => r.id)).toEqual(['rl-org']);
		expect(e.alongside.map((r) => r.id)).toEqual(['rl-realm']);
		expect(e.overridden_by).toEqual([]);
		// A different realm in the same org is not affected by prod-us's realm rule.
		const s = rule_effect({ event: 'run.failed', scope: { kind: 'realm', org_id: ORG_A, org_slug: 'measureone', realm_id: 'r-stage', realm_slug: 'staging', team_slug: null } }, d.rules);
		expect(s.alongside).toEqual([]);
	});

	it('labels events', () => {
		expect(event_label('run.failed')).toBe('Run failed');
		expect(event_label('run.*')).toBe('Any run event');
		expect(event_label('custom.deploy')).toBe('Custom: deploy');
	});
});

describe('Notifications — edit only where you can', () => {
	afterEach(() => vi.restoreAllMocks());

	// Owner of MeasureOne, plain member of Acme Labs.
	function limited() {
		const d = center();
		d.orgs = d.orgs.map((o) => ({ ...o, role: o.id === ORG_B ? 'member' : 'owner', can_edit: o.id !== ORG_B }));
		d.realms = d.realms.map((r) => ({ ...r, can_edit: r.org_id !== ORG_B }));
		return d;
	}

	it('rules you can’t change are view only; filter shows only yours', async () => {
		route_fetch({ center: limited });
		render_page();
		await screen.findByTestId('rule-rl-acme');
		expect(within(screen.getByTestId('rule-rl-acme')).getByTestId('view-only')).toBeInTheDocument();
		expect(within(screen.getByTestId('rule-rl-acme')).queryByRole('button', { name: /Delete rule/ })).toBeNull();
		expect(within(screen.getByTestId('rule-rl-org')).getByRole('button', { name: /Delete rule/ })).toBeInTheDocument();
		expect(screen.getByTestId('view-only-note')).toHaveTextContent('View only in Acme Labs (member)');
		fireEvent.click(screen.getByRole('button', { name: 'Only ones I can edit' }));
		expect(rule_ids()).toEqual(['rule-rl-org', 'rule-rl-realm']);
	});

	it('new rule: orgs you can’t change are listed but locked', async () => {
		route_fetch({ center: limited });
		render_page();
		await screen.findByTestId('rule-rl-org');
		fireEvent.click(screen.getByRole('button', { name: 'New rule' }));
		const dlg = screen.getByRole('dialog', { name: 'New rule' });
		const acme = within(dlg).getByRole('option', { name: /Acme Labs — member, can’t add rules/ }) as HTMLOptionElement;
		expect(acme.disabled).toBe(true);
	});

	it('channel details are view only where you can’t change them', async () => {
		route_fetch({ center: limited });
		render_page('/notifications?tab=channels');
		await screen.findByTestId('channel-ch-acme');
		fireEvent.click(screen.getByRole('button', { name: 'acme-feed' }));
		expect(screen.getByTestId('channel-view-only')).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Send test' })).toBeNull();
	});

	it('no New rule / New channel when you can’t change anything', async () => {
		route_fetch({ center: () => { const d = limited(); d.orgs = d.orgs.map((o) => ({ ...o, can_edit: false })); d.realms = d.realms.map((r) => ({ ...r, can_edit: false })); return d; } });
		render_page();
		await screen.findByTestId('rule-rl-org');
		expect(screen.queryByRole('button', { name: 'New rule' })).toBeNull();
	});

	it('deep links: ?channel= opens that channel, ?realm=&event= highlights the check row', async () => {
		route_fetch();
		const { unmount } = render_page('/notifications?tab=channels&channel=ch-prod');
		expect(await screen.findByRole('complementary', { name: 'Channel details' })).toHaveTextContent('prod-alerts');
		unmount();
		route_fetch();
		render_page('/notifications?tab=check&realm=r-prod&event=run.failed');
		expect(await screen.findByTestId('check-run.failed')).toHaveAttribute('aria-current', 'true');
	});
});

describe('Notifications — create a channel from the rule panel', () => {
	afterEach(() => vi.restoreAllMocks());

	it('creates it at the rule’s level and selects it', async () => {
		let created = false;
		const { calls } = route_fetch({
			center: () => {
				const d = center();
				if (created) d.channels.push({ id: 'ch-new', name: 'eng-new', owner: { kind: 'org', org_id: ORG_A, org_slug: 'measureone', realm_id: null, realm_slug: null }, destinations: [{ type: 'cliqhub', label: 'CliqHub' }], enabled: true, rule_count: 0 });
				return d;
			},
			write: (u) => {
				if (u === '/v1/notification_channels/create') { created = true; return { body: { ok: true, data: { id: 'ch-new', name: 'eng-new' } } }; }
				return { body: { ok: true, data: {} } };
			},
		});
		render_page('/notifications?org=measureone');
		await screen.findByTestId('rule-rl-org');
		fireEvent.click(screen.getByRole('button', { name: 'New rule' }));
		fireEvent.click(screen.getByRole('button', { name: '+ create a channel' }));
		const ch = screen.getByRole('dialog', { name: 'New channel' });
		fireEvent.change(within(ch).getByLabelText(/Name/), { target: { value: 'eng-new' } });
		fireEvent.click(within(ch).getByRole('button', { name: 'Create channel' }));
		await waitFor(() => expect(calls).toContainEqual({ url: '/v1/notification_channels/create', body: { name: 'eng-new', org_id: ORG_A, destinations: [{ type: 'cliqhub' }] } }));
		await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New channel' })).toBeNull());
		const rule = screen.getByRole('dialog', { name: 'New rule' });
		await waitFor(() => expect((within(rule).getByLabelText('3 · Send to') as HTMLSelectElement).value).toBe('ch-new'));
	});
});

describe('Notifications — pickers', () => {
	afterEach(() => vi.restoreAllMocks());

	it('a family wildcard covers its events; partial save keeps the failed ones', async () => {
		const { calls } = route_fetch({ write: (u) => (u === '/v1/notification_center/set_rules'
			? { body: { ok: true, data: { saved: [{ event: 'run.*', rule_id: 'x' }], failed: [{ event: 'hug.review_requested', error: 'Nope' }] } } }
			: { body: { ok: true, data: {} } }) });
		render_page('/notifications?org=measureone');
		await screen.findByTestId('rule-rl-org');
		fireEvent.click(screen.getByRole('button', { name: 'New rule' }));
		const dlg = screen.getByRole('dialog', { name: 'New rule' });
		fireEvent.click(within(dlg).getByRole('checkbox', { name: 'Any run event' }));
		// run.failed is now covered by run.* → dropped from the chosen list, shown as covered.
		expect((within(dlg).getByRole('checkbox', { name: 'Run failed' }) as HTMLInputElement).disabled).toBe(true);
		expect(within(dlg).getByLabelText('Chosen events')).not.toHaveTextContent('Run failed');
		fireEvent.click(within(dlg).getByRole('checkbox', { name: 'Review requested' }));
		fireEvent.change(within(dlg).getByLabelText('3 · Send to'), { target: { value: 'ch-oncall' } });
		fireEvent.click(within(dlg).getByRole('button', { name: 'Save 2 rules' }));
		expect(await within(dlg).findByRole('alert')).toHaveTextContent('Saved 1. Couldn’t save: Review requested (Nope)');
		expect(calls.filter((c) => c.url === '/v1/notification_center/set_rules')[0].body).toMatchObject({ events: ['run.*', 'hug.review_requested'] });
		expect(within(dlg).getByLabelText('Chosen events')).toHaveTextContent('Review requested');
	});

	it('realm picker searches Core 20 at a time, pages, and locks view-only realms', async () => {
		const page = (offset: number, q?: string) => ({
			items: Array.from({ length: offset ? 5 : 20 }, (_, i) => ({ id: i === 0 && !offset ? 'r-sand' : `rx-${offset + i}`, slug: i === 0 && !offset ? 'sandbox' : `realm-${offset + i}${q ? `-${q}` : ''}`, name: '', org_slug: 'measureone' })),
			total: 25, offset, limit: 20,
		});
		const center_limited = () => { const d = center(); d.realms = d.realms.map((r) => ({ ...r, can_edit: r.id !== 'r-sand' })); return d; };
		const { calls } = route_fetch({ center: center_limited });
		const base = (globalThis.fetch as unknown as { getMockImplementation: () => (u: unknown, i?: RequestInit) => Promise<Response> }).getMockImplementation();
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
			if (String(url) === '/v1/realms/get') {
				const b = JSON.parse(String(init?.body));
				calls.push({ url: '/v1/realms/get', body: b });
				return new Response(JSON.stringify({ ok: true, data: page(b.offset, b.query) }));
			}
			return base(url, init);
		});
		render_page('/notifications?org=measureone');
		await screen.findByTestId('rule-rl-org');
		fireEvent.click(screen.getByRole('button', { name: 'New rule' }));
		const dlg = screen.getByRole('dialog', { name: 'New rule' });
		fireEvent.click(within(dlg).getByRole('radio', { name: 'One realm' }));
		fireEvent.click(within(dlg).getByRole('button', { name: 'Realm' }));
		const list = await within(dlg).findByRole('listbox', { name: 'Realm' });
		await waitFor(() => expect(within(list).getAllByRole('option')).toHaveLength(20));
		expect(within(list).getByRole('option', { name: /sandbox/ })).toHaveAttribute('aria-disabled', 'true');
		expect(calls.find((c) => c.url === '/v1/realms/get')!.body).toEqual({ limit: 20, offset: 0, sort_by: 'slug', sort_dir: 'asc', org_id: ORG_A });
		fireEvent.mouseDown(within(dlg).getByRole('button', { name: 'Show more (5 left)' }));
		await waitFor(() => expect(within(list).getAllByRole('option')).toHaveLength(25));
		fireEvent.change(within(dlg).getByLabelText('Search realm'), { target: { value: 'pay' } });
		await waitFor(() => expect(calls.filter((c) => c.url === '/v1/realms/get').at(-1)!.body).toMatchObject({ query: 'pay', offset: 0 }));
		fireEvent.mouseDown(await within(dlg).findByRole('option', { name: /realm-1-pay/ }));
		expect(within(dlg).getByRole('button', { name: 'Realm' })).toHaveTextContent('realm-1-pay');
	});
});

describe('Notifications — realm paging', () => {
	afterEach(() => vi.restoreAllMocks());

	it('org view asks for that org; pages and searches realms through the BFF', async () => {
		const { calls } = route_fetch({ center: () => ({ ...center(), realm_page: { offset: 0, limit: 10, total: 25, q: null, status: 'ok', error: null } }) });
		render_page('/notifications?org=measureone');
		await screen.findByTestId('rule-rl-org');
		const reads = () => calls.filter((c) => c.url === '/v1/notification_center/get').map((c) => c.body);
		expect(reads()[0]).toEqual({ org_id: ORG_A, realm_limit: 10, realm_offset: 0 });
		expect(screen.getByTestId('realm-range')).toHaveTextContent('Realms 1–10 of 25');
		// Realms on this page with their own rules show a count.
		expect(within(screen.getByLabelText('Realms on this page')).getByText('prod-us').parentElement).toHaveTextContent('prod-us1');
		fireEvent.click(screen.getByRole('button', { name: 'Next realms' }));
		await waitFor(() => expect(reads().at(-1)).toEqual({ org_id: ORG_A, realm_limit: 10, realm_offset: 10 }));
		fireEvent.change(screen.getByLabelText('Search realms'), { target: { value: 'pay' } });
		await waitFor(() => expect(reads().at(-1)).toEqual({ org_id: ORG_A, realm_limit: 10, realm_offset: 0, realm_q: 'pay' }));
	});
});
