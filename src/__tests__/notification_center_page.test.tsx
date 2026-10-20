/**
 * Graphite Notifications — Events and Channels, for the org and for a realm (Notifications_panel), the old
 * `/notifications` URL redirecting there, and the shared helpers. One BFF read per view; every action is
 * one `notification_center/set_rules` call (PLAN-notifications-v2 D1/D2).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { multi_org_overview, gs_response, ORG_A } from './fixtures_overview';
import type { Notif_event_group, Notif_event_rule, Notif_event_row, Notification_center_data } from '@/lib/notification_center';
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

import { Component as NotificationsRedirect, draft_to_destination } from '@/pages/notification_center_page';
import { Notifications_panel } from '@/components/graphite/g_notifications';

const org_a = { kind: 'org' as const, org_id: ORG_A, org_slug: 'measureone', realm_id: null, realm_slug: null };
const ch = (id: string, name: string, kind: 'org' | 'realm' | 'personal' = 'org', enabled = true) => ({
	id, name, owner: { kind, org_id: ORG_A, org_slug: 'measureone', realm_id: kind === 'realm' ? 'r-prod' : null, realm_slug: kind === 'realm' ? 'prod-us' : null, user_id: kind === 'personal' ? 'u1' : null },
	destinations: [{ type: 'slack', label: `Slack ${name}` }], enabled, rule_count: 1, system_key: null, locked: false, lock_reason: null,
});
const rule = (id: string, event: string, channel_id: string, channel_name: string, over: Record<string, unknown> = {}) => ({
	id, event, scope: org_a, channel_id, channel_name, priority: 0, replaces: [], system_key: null, locked: false, lock_reason: null, enabled: true, ...over,
});
const er = (rule_id: string, selector: string, channel_id: string, channel_name: string, tier: 'org' | 'realm', over: Partial<Notif_event_rule> = {}): Notif_event_rule => ({
	rule_id, selector, tier, channel_id, channel_name, channel_enabled: true, enabled: true, locked: false, lock_reason: null, ...over,
});
const ev = (event: string, org: Notif_event_rule[], realm: Notif_event_rule[] = [], over: Partial<Notif_event_row> = {}): Notif_event_row => ({
	event, sent: [...org, ...realm].some((r) => r.enabled && r.channel_enabled), fixed: [...org, ...realm].some((r) => r.locked), built_in: false, org, realm, ...over,
});
const groups = (...rows: Notif_event_row[]): Notif_event_group[] => {
	const by = new Map<string, Notif_event_row[]>();
	for (const r of rows) { const f = r.event.split('.')[0]; by.set(f, [...(by.get(f) ?? []), r]); }
	return [...by.entries()].map(([family, events]) => ({ family, events }));
};

function center(): Notification_center_data {
	return {
		orgs: [{ id: ORG_A, slug: 'measureone', display_name: 'MeasureOne', role: 'owner', status: 'ok', error: null, can_edit: true, can_edit_channels: true }],
		realms: [{ id: 'r-prod', slug: 'prod-us', name: 'prod-us', org_id: ORG_A, org_slug: 'measureone', status: 'ok', error: null, can_edit: true }],
		channels: [ch('ch-eng', '#eng-alerts'), ch('ch-runs', '#eng-runs'), ch('ch-off', '#design', 'org', false), ch('ch-prod', '#prod-alerts', 'realm'), ch('ch-mine', 'Mine', 'personal')],
		rules: [rule('o-failed', 'run.failed', 'ch-eng', '#eng-alerts')],
		event_types: ['run.failed', 'run.completed', 'run.started', 'run.crashed', 'notification.unknown_channel'],
		realm_events: null,
		events: groups(
			ev('run.failed', [er('o-failed', 'run.failed', 'ch-eng', '#eng-alerts', 'org')]),
			ev('run.completed', [er('o-done', 'run.completed', 'ch-runs', '#eng-runs', 'org', { enabled: false })]),
			ev('run.started', []),
			ev('run.crashed', [er('o-runs', 'run.*', 'ch-runs', '#eng-runs', 'org')]),
			ev('notification.unknown_channel', [er('o-uc', 'notification.unknown_channel', 'ch-eng', '#eng-alerts', 'org', { locked: true, lock_reason: 'Built in' })]),
		),
		realm_page: { offset: 0, limit: 1, total: 1, q: null, status: 'ok', error: null },
		partial: false,
	};
}

/** prod-us: the org's channels (read-only here) and the realm's own. */
function realm_center(): Notification_center_data {
	return {
		...center(),
		events: groups(
			ev('run.failed', [er('o-failed', 'run.failed', 'ch-eng', '#eng-alerts', 'org')], [er('r-prod', 'run.failed', 'ch-prod', '#prod-alerts', 'realm')]),
			ev('run.started', [], [er('r-start', 'run.started', 'ch-prod', '#prod-alerts', 'realm')]),
			ev('daemon.offline', [], [er('r-dmn', 'daemon.offline', 'ch-prod', '#prod-alerts', 'realm', { enabled: false })]),
		),
	};
}

type Call = { url: string; body: Record<string, unknown> };

function route_fetch(data: () => Notification_center_data = center, write: (u: string) => { status?: number; body: unknown } | null = () => null) {
	const calls: Call[] = [];
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
		const u = String(url);
		const body = init?.body ? JSON.parse(String(init.body)) : {};
		if (u === '/v1/overview/get') return new Response(JSON.stringify({ ok: true, data: multi_org_overview() }));
		if (u === '/v1/getting_started/get') return gs_response(u)!;
		calls.push({ url: u, body });
		if (u === '/v1/notification_center/get') return new Response(JSON.stringify({ ok: true, data: data() }));
		const w = write(u) ?? { body: { ok: true, data: u.endsWith('/test') ? { delivered: 1, errors: [] } : u.endsWith('/set_rules') ? { saved: [], failed: [], removed: [] } : {} } };
		return new Response(JSON.stringify(w.body), { status: w.status ?? 200 });
	});
	return calls;
}
const writes = (calls: Call[]) => calls.filter((c) => c.url === '/v1/notification_center/set_rules').map((c) => c.body);

function Where() {
	const l = useLocation();
	return <output data-testid="where">{l.pathname}{l.search}</output>;
}

function render_panel(realm: boolean, view: 'events' | 'channels' = 'events') {
	return render(
		<MemoryRouter>
			<Notifications_panel org_id={ORG_A} realm={realm ? { id: 'r-prod', slug: 'prod-us', org_slug: 'measureone' } : null} view={view} />
		</MemoryRouter>,
	);
}
const row = (id: string) => screen.getByTestId(id);

describe('/notifications (the old Events page) redirects to where notifications live', () => {
	afterEach(() => vi.restoreAllMocks());
	it.each([
		['/notifications', `/orgs/${ORG_A}?tab=events`],
		['/notifications?org=acme-labs', /^\/orgs\/[^?]+\?tab=events$/],
		['/notifications?realm=r-prod', '/o/measureone/realms/prod-us/notifications/events'],
		['/notifications?org=measureone&realm=prod-us&channel=ch-1', '/o/measureone/realms/prod-us/notifications/channels?channel=ch-1'],
	])('%s', async (from, to) => {
		route_fetch();
		render(
			<MemoryRouter initialEntries={[from]}>
				<Routes>
					<Route path="/notifications" element={<NotificationsRedirect />} />
					<Route path="*" element={<Where />} />
				</Routes>
			</MemoryRouter>,
		);
		const where = await screen.findByTestId('where');
		if (typeof to === 'string') expect(where).toHaveTextContent(to);
		else expect(where.textContent).toMatch(to);
	});
});

describe('Org › Notifications › Events', () => {
	afterEach(() => vi.restoreAllMocks());

	it('one read for the org; every event grouped, with the channels it goes to — or Not sent; built-in messages', async () => {
		const calls = route_fetch();
		render_panel(false);
		await screen.findByTestId('notif-events');
		expect(calls.filter((c) => c.url === '/v1/notification_center/get').map((c) => c.body)).toEqual([{ org_id: ORG_A, realm_limit: 1 }]);
		expect(within(row('event-run.failed')).getAllByTestId('event-chip').map((c) => c.textContent)).toEqual(['#eng-alerts']);
		expect(row('event-run.started')).toHaveTextContent('Not sent');
		// A channel set for the whole family shows with its selector, and can't be removed from one event.
		expect(within(row('event-run.crashed')).getByTestId('event-chip')).toHaveTextContent('run.*');
		expect(within(row('event-run.crashed')).queryByRole('button', { name: /^Remove/ })).toBeNull();
		expect(screen.getByRole('heading', { name: 'Events' })).toBeInTheDocument();
		expect(screen.getByTestId('built-in-messages')).toBeInTheDocument();
	});

	it('✕ removes a channel from the event; the switch turns it off; + channel adds one', async () => {
		const calls = route_fetch();
		render_panel(false);
		const failed = await screen.findByTestId('event-run.failed');
		fireEvent.click(within(failed).getByRole('button', { name: 'Remove #eng-alerts from Run failed' }));
		await waitFor(() => expect(writes(calls)).toContainEqual({ org_id: ORG_A, remove: ['o-failed'] }));
		fireEvent.click(within(row('event-run.failed')).getByRole('switch'));
		await waitFor(() => expect(writes(calls)).toContainEqual({ org_id: ORG_A, items: [{ event: 'run.failed', channel_id: 'ch-eng', enabled: false }] }));
		fireEvent.click(within(row('event-run.started')).getByRole('button', { name: '+ channel' }));
		fireEvent.click(within(row('event-run.started')).getByRole('button', { name: /Add a channel/ }));
		fireEvent.mouseDown(await screen.findByRole('option', { name: /#eng-runs/ }));
		fireEvent.click(within(row('event-run.started')).getByRole('button', { name: 'Add' }));
		await waitFor(() => expect(writes(calls)).toContainEqual({ org_id: ORG_A, items: [{ event: 'run.started', channel_id: 'ch-runs' }] }));
	});

	it('a fixed event is locked: no ✕, no switch to change, no + channel', async () => {
		route_fetch();
		render_panel(false);
		const uc = await screen.findByTestId('event-notification.unknown_channel');
		expect(uc).toHaveTextContent('fixed');
		expect(within(uc).queryByRole('button', { name: /^Remove/ })).toBeNull();
		expect(within(uc).getByRole('switch')).toBeDisabled();
		expect(within(uc).queryByRole('button', { name: '+ channel' })).toBeNull();
	});

	it('view only: no + channel, no ✕, switches greyed', async () => {
		route_fetch(() => { const d = center(); d.orgs[0].can_edit = false; return d; });
		render_panel(false);
		const failed = await screen.findByTestId('event-run.failed');
		expect(within(failed).getByRole('switch')).toBeDisabled();
		expect(screen.queryByRole('button', { name: '+ channel' })).toBeNull();
		expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull();
	});
});

describe('Realm › Notifications › Events — the org\'s channels and the realm\'s own both get it', () => {
	afterEach(() => vi.restoreAllMocks());

	it('one read with the realm; the org\'s channels read-only (org); the realm\'s own removable', async () => {
		const calls = route_fetch(realm_center);
		render_panel(true);
		const failed = await screen.findByTestId('event-run.failed');
		expect(calls.find((c) => c.url === '/v1/notification_center/get')?.body).toEqual({ org_id: ORG_A, realm_id: 'r-prod' });
		const [org_chip, own_chip] = within(failed).getAllByTestId('event-chip');
		expect(org_chip).toHaveTextContent('#eng-alertsorg');
		expect(within(org_chip).queryByRole('button')).toBeNull();
		fireEvent.click(within(own_chip).getByRole('button', { name: 'Remove #prod-alerts from Run failed' }));
		await waitFor(() => expect(writes(calls)).toContainEqual({ realm_id: 'r-prod', remove: ['r-prod'] }));
	});

	it('the switch covers only this realm\'s own; + channel adds this realm\'s', async () => {
		const calls = route_fetch(realm_center);
		render_panel(true);
		const dmn = await screen.findByTestId('event-daemon.offline');
		fireEvent.click(within(dmn).getByRole('switch'));
		await waitFor(() => expect(writes(calls)).toContainEqual({ realm_id: 'r-prod', items: [{ event: 'daemon.offline', channel_id: 'ch-prod', enabled: true }] }));
		fireEvent.click(within(row('event-run.started')).getByRole('button', { name: '+ channel' }));
		fireEvent.click(within(row('event-run.started')).getByRole('button', { name: /Add a channel/ }));
		fireEvent.mouseDown(await screen.findByRole('option', { name: /#eng-alerts/ }));
		fireEvent.click(within(row('event-run.started')).getByRole('button', { name: 'Add' }));
		await waitFor(() => expect(writes(calls)).toContainEqual({ realm_id: 'r-prod', items: [{ event: 'run.started', channel_id: 'ch-eng' }] }));
	});

	it('a failed write says why and keeps the list', async () => {
		route_fetch(realm_center, (u) => (u.endsWith('/set_rules') ? { status: 409, body: { ok: false, error: { code: 'locked', message: 'This rule is locked' } } } : null));
		render_panel(true);
		fireEvent.click(within(await screen.findByTestId('event-run.started')).getByRole('switch'));
		expect(await screen.findByRole('alert')).toHaveTextContent('is locked');
		expect(screen.getByTestId('event-run.started')).toBeInTheDocument();
	});
});

describe('Notifications — channels', () => {
	afterEach(() => vi.restoreAllMocks());

	it('details panel sends a test, switches a channel on/off and deletes it via the single Core routes', async () => {
		const calls = route_fetch();
		render_panel(false, 'channels');
		fireEvent.click(await screen.findByRole('button', { name: '#design' }));
		const panel = screen.getByRole('complementary', { name: 'Channel details' });
		fireEvent.click(within(panel).getByRole('button', { name: 'Send test' }));
		expect(await within(panel).findByRole('status')).toHaveTextContent('Test delivered to 1 destination.');
		expect(calls).toContainEqual({ url: '/v1/notification_channels/test', body: { id: 'ch-off' } });
		fireEvent.click(within(panel).getByRole('button', { name: 'Enable' }));
		await waitFor(() => expect(calls).toContainEqual({ url: '/v1/notification_channels/update', body: { id: 'ch-off', enabled: true } }));
		fireEvent.click(within(panel).getByRole('button', { name: 'Delete…' }));
		fireEvent.click(within(panel).getByRole('button', { name: 'Delete channel' }));
		await waitFor(() => expect(calls).toContainEqual({ url: '/v1/notification_channels/remove', body: { id: 'ch-off' } }));
	});

	it('maps destination drafts to Core shapes', () => {
		expect(draft_to_destination({ type: 'email', value: ' a@b.c ' })).toEqual({ type: 'email', address: 'a@b.c' });
		expect(draft_to_destination({ type: 'webhook', value: 'https://x' })).toEqual({ type: 'webhook', url: 'https://x' });
		expect(draft_to_destination({ type: 'cliqhub', value: 'ignored' })).toEqual({ type: 'cliqhub' });
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
		const realm_rule = { ...rule('rl-realm', 'run.failed', 'ch-prod', '#prod-alerts'), scope: { ...org_a, kind: 'realm' as const, realm_id: 'r-prod', realm_slug: 'prod-us' } };
		const rules = [rule('rl-org', 'run.*', 'ch-eng', '#eng-alerts'), realm_rule];
		const e = rule_effect({ event: 'run.failed', scope: realm_rule.scope }, rules);
		expect(e.replaces.map((r) => r.id)).toEqual(['rl-org']);
		expect(e.alongside.map((r) => r.id)).toEqual(['rl-realm']);
	});

	it('labels events', () => {
		expect(event_label('run.failed')).toBe('Run failed');
		expect(event_label('run.*')).toBe('Any run event');
		expect(event_label('custom.deploy')).toBe('Custom: deploy');
	});
});
