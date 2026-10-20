/**
 * Graphite Notifications — Org settings › Notifications and a realm's Settings › Notifications
 * (Notifications_panel), the old `/notifications` URL redirecting there, and the shared helpers.
 * One BFF read per view; every action is one `notification_center/set_rules` call.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { multi_org_overview, gs_response, ORG_A } from './fixtures_overview';
import type { Notif_event_rule, Notif_realm_event, Notification_center_data } from '@/lib/notification_center';
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
const er = (rule_id: string, channel_id: string, channel_name: string, tier: 'org' | 'realm', over: Partial<Notif_event_rule> = {}): Notif_event_rule => ({
	rule_id, selector: '', tier, channel_id, channel_name, channel_enabled: true, enabled: true, locked: false, lock_reason: null, ...over,
});

function center(): Notification_center_data {
	return {
		orgs: [{ id: ORG_A, slug: 'measureone', display_name: 'MeasureOne', role: 'owner', status: 'ok', error: null, can_edit: true, can_edit_channels: true }],
		realms: [{ id: 'r-prod', slug: 'prod-us', name: 'prod-us', org_id: ORG_A, org_slug: 'measureone', status: 'ok', error: null, can_edit: true }],
		channels: [ch('ch-eng', '#eng-alerts'), ch('ch-runs', '#eng-runs'), ch('ch-off', '#design', 'org', false), ch('ch-prod', '#prod-alerts', 'realm'), ch('ch-mine', 'Mine', 'personal')],
		rules: [
			rule('o-failed', 'run.failed', 'ch-eng', '#eng-alerts'),
			rule('o-done', 'run.completed', 'ch-runs', '#eng-runs', { enabled: false }),
			rule('o-hug', 'hug.review_requested', 'ch-eng', '#eng-alerts', { locked: true, lock_reason: 'Reviewers must hear' }),
			rule('o-timeout', 'hug.review_timed_out', 'ch-off', '#design'),
			rule('o-two-a', 'daemon.offline', 'ch-eng', '#eng-alerts'),
			rule('o-two-b', 'daemon.offline', 'ch-runs', '#eng-runs'),
		],
		event_types: ['run.failed', 'run.completed', 'run.started', 'hug.review_requested'],
		realm_events: null,
		realm_page: { offset: 0, limit: 1, total: 1, q: null, status: 'ok', error: null },
		partial: false,
	};
}

/** prod-us: each status once (the org's rules and the realm's own both apply). */
function realm_center(): Notification_center_data {
	const ev = (event: string, status: Notif_realm_event['status'], org: Notif_event_rule[], realm: Notif_event_rule[], over: Partial<Notif_realm_event> = {}): Notif_realm_event => ({ event, status, locked: false, via: null, org, realm, ...over });
	return {
		...center(),
		realm_events: [
			ev('daemon.offline', 'off', [], [er('r-dmn', 'ch-prod', '#prod-alerts', 'realm', { enabled: false })]),
			ev('hug.review_requested', 'default', [er('o-hug', 'ch-eng', '#eng-alerts', 'org', { locked: true })], [], { locked: true }),
			ev('run.awaiting_input', 'default', [er('o-input', 'ch-eng', '#eng-alerts', 'org')], []),
			ev('run.completed', 'paused', [er('o-done', 'ch-runs', '#eng-runs', 'org', { enabled: false })], []),
			ev('run.failed', 'both', [er('o-failed', 'ch-eng', '#eng-alerts', 'org')], [er('r-prod', 'ch-prod', '#prod-alerts', 'realm')]),
			ev('run.started', 'realm_only', [], [er('r-start', 'ch-prod', '#prod-alerts', 'realm')]),
			ev('run.crashed', 'both', [er('o-crash', 'ch-eng', '#eng-alerts', 'org')], [er('r-all', 'ch-prod', '#prod-alerts', 'realm')], { via: 'run.*' }),
		],
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

function render_panel(realm: boolean) {
	return render(
		<MemoryRouter>
			<Notifications_panel org_id={ORG_A} realm={realm ? { id: 'r-prod', slug: 'prod-us', org_slug: 'measureone' } : null} />
		</MemoryRouter>,
	);
}
const row = (id: string) => screen.getByTestId(id);

describe('/notifications (the old Events page) redirects to where notifications live', () => {
	afterEach(() => vi.restoreAllMocks());
	it.each([
		['/notifications', `/orgs/${ORG_A}?tab=notifications`],
		['/notifications?org=acme-labs', /^\/orgs\/[^?]+\?tab=notifications$/],
		['/notifications?realm=r-prod', '/o/measureone/realms/prod-us/notifications'],
		['/notifications?org=measureone&realm=prod-us&channel=ch-1', '/o/measureone/realms/prod-us/notifications?channel=ch-1'],
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

describe('Org settings › Notifications', () => {
	afterEach(() => vi.restoreAllMocks());

	it('one read for the org; rules grouped by area with Sends to · Status · On; only org channels; built-in messages', async () => {
		const calls = route_fetch();
		render_panel(false);
		await screen.findByTestId('org-event-run.failed');
		expect(calls.filter((c) => c.url === '/v1/notification_center/get').map((c) => c.body)).toEqual([{ org_id: ORG_A, realm_limit: 1 }]);
		expect(within(screen.getByTestId('notif-rules')).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Event', 'Sends to', 'Status', 'On']);
		expect(row('org-event-run.failed')).toHaveTextContent('Run failedrun.failed#eng-alerts');
		// Paused: its switch is off and it says so.
		expect(row('org-event-run.completed')).toHaveTextContent('Paused');
		expect(within(row('org-event-run.completed')).getByRole('switch')).toHaveAttribute('aria-checked', 'false');
		// A rule on a switched-off channel says it sends nothing.
		expect(row('org-event-hug.review_timed_out')).toHaveTextContent('a channel is off — it sends nothing');
		// Locked: a lock, a greyed switch, no Remove.
		expect(within(row('org-event-hug.review_requested')).getByRole('switch')).toBeDisabled();
		expect(within(row('org-event-hug.review_requested')).queryByRole('button', { name: 'Remove' })).toBeNull();
		// Channels: the org's only (no realm or personal ones).
		const chs = screen.getByTestId('notif-channels');
		expect(within(chs).getByTestId('channel-ch-eng')).toBeInTheDocument();
		expect(within(chs).queryByTestId('channel-ch-prod')).toBeNull();
		expect(within(chs).queryByTestId('channel-ch-mine')).toBeNull();
		expect(screen.getByTestId('built-in-messages')).toBeInTheDocument();
		expect(screen.queryByTestId('notif-custom')).toBeNull();
	});

	it('the switch pauses (or resumes) every rule for the event; Remove deletes them; a channel line has its own switch', async () => {
		const calls = route_fetch();
		render_panel(false);
		fireEvent.click(within(await screen.findByTestId('org-event-run.failed')).getByRole('switch'));
		await waitFor(() => expect(writes(calls)).toContainEqual({ org_id: ORG_A, items: [{ event: 'run.failed', channel_id: 'ch-eng', enabled: false }] }));
		fireEvent.click(within(row('org-event-run.completed')).getByRole('switch'));
		await waitFor(() => expect(writes(calls)).toContainEqual({ org_id: ORG_A, items: [{ event: 'run.completed', channel_id: 'ch-runs', enabled: true }] }));
		fireEvent.click(within(row('org-rule-o-two-b')).getByRole('switch'));
		await waitFor(() => expect(writes(calls)).toContainEqual({ org_id: ORG_A, items: [{ event: 'daemon.offline', channel_id: 'ch-runs', enabled: false }] }));
		fireEvent.click(within(row('org-event-run.failed')).getByRole('button', { name: 'Remove' }));
		await waitFor(() => expect(writes(calls)).toContainEqual({ org_id: ORG_A, remove: ['o-failed'] }));
	});

	it('view only: no Add rule, switches greyed, no Remove', async () => {
		route_fetch(() => ({ ...center(), orgs: center().orgs.map((o) => ({ ...o, can_edit: false })) }));
		render_panel(false);
		await screen.findByTestId('org-event-run.failed');
		expect(screen.queryByRole('button', { name: 'Add rule' })).toBeNull();
		expect(within(row('org-event-run.failed')).getByRole('switch')).toBeDisabled();
		expect(within(row('org-event-run.failed')).queryByRole('button', { name: 'Remove' })).toBeNull();
	});
});

describe('Realm › Notifications — the org\'s rules and the realm\'s own both apply', () => {
	afterEach(() => vi.restoreAllMocks());

	it('one read with the realm; each event as it stands here; summary; only this realm\'s own', async () => {
		const calls = route_fetch(realm_center);
		render_panel(true);
		await screen.findByTestId('realm-event-run.failed');
		expect(calls.filter((c) => c.url === '/v1/notification_center/get').map((c) => c.body)).toEqual([{ org_id: ORG_A, realm_id: 'r-prod' }]);
		const status = (e: string) => row(`realm-event-${e}`).querySelector('[data-status]')?.textContent;
		expect(status('run.awaiting_input')).toBe('Default');
		expect(status('run.completed')).toBe('Paused by org');
		expect(status('run.failed')).toBe('Org + this realm');
		expect(status('run.started')).toBe('Realm only');
		expect(status('daemon.offline')).toBe('Off');
		expect(status('run.crashed')).toBe('Org + this realm ·run.*');
		expect(row('realm-event-daemon.offline')).toHaveTextContent('Nothing is sent in this realm');
		// Both: the org's channel and the realm's own are shown.
		expect(row('realm-event-run.failed')).toHaveTextContent('#eng-alerts');
		expect(row('realm-event-run.failed')).toHaveTextContent('#prod-alerts');
		expect(screen.getByTestId('notif-rules')).toHaveTextContent('3 with this realm’s own channels · 1 off · the org’s apply everywhere');
		fireEvent.click(screen.getByLabelText(/only this realm’s own/));
		expect(screen.queryByTestId('realm-event-run.awaiting_input')).toBeNull();
		expect(screen.getByTestId('realm-event-run.failed')).toBeInTheDocument();
		expect(within(screen.getByTestId('notif-channels')).getByTestId('channel-ch-prod')).toBeInTheDocument();
		expect(screen.getByTestId('notif-custom')).toBeInTheDocument();
	});

	it('a Default row: the org\'s can\'t be changed here (no switch, no Replace) — "+ channel" adds this realm\'s own', async () => {
		route_fetch(realm_center);
		render_panel(true);
		const r = await screen.findByTestId('realm-event-run.awaiting_input');
		expect(within(r).queryByRole('switch')).toBeNull();
		expect(within(r).queryByRole('button', { name: 'Replace' })).toBeNull();
		fireEvent.click(within(r).getByRole('button', { name: '+ channel' }));
		const adding = await screen.findByTestId('realm-lines-run.awaiting_input');
		expect(within(adding).getByRole('button', { name: 'Add' })).toBeDisabled();
		expect(within(adding).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
	});

	it('Both: this realm\'s lines switch and remove on their own; the row switch covers only this realm\'s; no Reset', async () => {
		const calls = route_fetch(realm_center);
		render_panel(true);
		const lines = await screen.findByTestId('realm-lines-run.failed');
		expect(lines).toHaveTextContent('#prod-alertsrealm channel');
		expect(lines).not.toHaveTextContent('#eng-alerts');
		fireEvent.click(within(lines).getByRole('switch', { name: '#prod-alerts on' }));
		await waitFor(() => expect(writes(calls)).toContainEqual({ realm_id: 'r-prod', items: [{ event: 'run.failed', channel_id: 'ch-prod', enabled: false }] }));
		fireEvent.click(within(row('realm-event-run.failed')).getAllByRole('switch')[0]);
		await waitFor(() => expect(writes(calls)).toContainEqual({ realm_id: 'r-prod', items: [{ event: 'run.failed', channel_id: 'ch-prod', enabled: false }] }));
		expect(within(row('realm-event-run.failed')).queryByRole('button', { name: 'Reset' })).toBeNull();
		fireEvent.click(within(lines).getByRole('button', { name: 'Remove' }));
		await waitFor(() => expect(writes(calls)).toContainEqual({ realm_id: 'r-prod', remove: ['r-prod'] }));
	});

	it('locked / paused by org / set by a broader realm rule: nothing to switch here', async () => {
		route_fetch(realm_center);
		render_panel(true);
		const locked = await screen.findByTestId('realm-event-hug.review_requested');
		expect(within(locked).queryByRole('switch')).toBeNull();
		expect(within(locked).getByText('locked')).toBeInTheDocument();
		expect(within(row('realm-event-run.completed')).queryByRole('switch')).toBeNull();
		expect(within(row('realm-event-run.crashed')).queryByRole('switch')).toBeNull();
		expect(within(row('realm-event-run.crashed')).queryByRole('button', { name: '+ channel' })).toBeNull();
	});

	it('Realm only: Remove deletes its rule', async () => {
		const calls = route_fetch(realm_center);
		render_panel(true);
		fireEvent.click(within(await screen.findByTestId('realm-lines-run.started')).getByRole('button', { name: 'Remove' }));
		await waitFor(() => expect(writes(calls)).toContainEqual({ realm_id: 'r-prod', remove: ['r-start'] }));
	});

	it('a failed write says why and keeps the list', async () => {
		route_fetch(realm_center, (u) => (u.endsWith('/set_rules') ? { status: 409, body: { ok: false, error: { code: 'locked', message: 'That rule is locked' } } } : null));
		render_panel(true);
		fireEvent.click(within(await screen.findByTestId('realm-lines-run.failed')).getByRole('switch', { name: '#prod-alerts on' }));
		expect(await screen.findByRole('alert')).toHaveTextContent('is locked');
		expect(screen.getByTestId('realm-event-run.failed')).toBeInTheDocument();
	});
});

describe('Notifications — channels', () => {
	afterEach(() => vi.restoreAllMocks());

	it('details panel sends a test, switches a channel on/off and deletes it via the single Core routes', async () => {
		const calls = route_fetch();
		render_panel(false);
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
