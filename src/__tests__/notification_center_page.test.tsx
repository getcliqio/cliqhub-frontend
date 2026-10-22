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
/** What "Send to…" finds: channels and people (each person with their personal channel). */
const targets = (u: string) => (u === '/v1/orgs/get_reviewable_targets'
	? { body: { ok: true, data: {
		channels: { items: [{ id: 'ch-eng', name: '#eng-alerts', level: 'org' }, { id: 'ch-runs', name: '#eng-runs', level: 'org' }], total: 2 },
		people: { items: [{ user_id: 'u-elan', username: 'elan', display_name: 'Elan Rao', channel_id: 'pc-elan' }], total: 3 },
	} } }
	: null);
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

	it('one read for the org; every event grouped, with the channels it goes to — or Not sent; nothing else on the page', async () => {
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
		expect(screen.queryByTestId('built-in-messages')).toBeNull();
	});

	it('✕ removes a channel from the event; the switch turns it off; + add opens Send to — channels and people, ticked, saved together', async () => {
		const calls = route_fetch(center, targets);
		render_panel(false);
		const failed = await screen.findByTestId('event-run.failed');
		fireEvent.click(within(failed).getByRole('button', { name: 'Remove #eng-alerts from Run failed' }));
		await waitFor(() => expect(writes(calls)).toContainEqual({ org_id: ORG_A, remove: ['o-failed'] }));
		fireEvent.click(within(row('event-run.failed')).getByRole('switch'));
		await waitFor(() => expect(writes(calls)).toContainEqual({ org_id: ORG_A, items: [{ event: 'run.failed', channel_id: 'ch-eng', enabled: false }] }));

		fireEvent.click(within(row('event-run.started')).getByRole('button', { name: 'Choose where Run started goes' }));
		const drawer = screen.getByRole('dialog', { name: 'Run started goes to…' });
		await waitFor(() => expect(calls.find((c) => c.url === '/v1/orgs/get_reviewable_targets')?.body).toEqual({ org_id: ORG_A, limit: 20, query: '' }));
		expect(within(drawer).getByTestId('send-changes')).toHaveTextContent('No changes');
		fireEvent.click(await within(drawer).findByRole('option', { name: /#eng-runs/ }));
		fireEvent.click(within(drawer).getByRole('option', { name: /Elan Rao/ }));
		expect(within(drawer).getByTestId('send-changes')).toHaveTextContent('2 to add');
		expect(within(within(drawer).getByTestId('send-people')).getByRole('button', { name: 'Show more (2)' })).toBeTruthy();
		fireEvent.click(within(drawer).getByRole('button', { name: 'Save' }));
		await waitFor(() => expect(writes(calls)).toContainEqual({ org_id: ORG_A, items: [{ event: 'run.started', channel_id: 'ch-runs' }, { event: 'run.started', channel_id: 'pc-elan' }], remove: [] }));
	});

	it('Edit: what an event goes to starts ticked — untick it to remove it (the seeded default too)', async () => {
		const calls = route_fetch(center, targets);
		render_panel(false);
		fireEvent.click(within(await screen.findByTestId('event-run.failed')).getByRole('button', { name: 'Edit where Run failed goes' }));
		const drawer = screen.getByRole('dialog', { name: 'Run failed goes to…' });
		const eng = await within(drawer).findByRole('option', { name: /#eng-alerts/ });
		expect(eng).toHaveAttribute('aria-selected', 'true');
		fireEvent.click(eng);
		expect(within(drawer).getByTestId('send-changes')).toHaveTextContent('1 to remove');
		fireEvent.click(within(drawer).getByRole('button', { name: 'Save' }));
		await waitFor(() => expect(writes(calls)).toContainEqual({ org_id: ORG_A, items: [], remove: ['o-failed'] }));
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

	it('the switch covers only this realm\'s own; + add saves a rule for this realm', async () => {
		const calls = route_fetch(realm_center, targets);
		render_panel(true);
		const dmn = await screen.findByTestId('event-daemon.offline');
		fireEvent.click(within(dmn).getByRole('switch'));
		await waitFor(() => expect(writes(calls)).toContainEqual({ realm_id: 'r-prod', items: [{ event: 'daemon.offline', channel_id: 'ch-prod', enabled: true }] }));
		fireEvent.click(within(row('event-run.started')).getByRole('button', { name: 'Edit where Run started goes' }));
		const drawer = screen.getByRole('dialog', { name: 'Run started goes to…' });
		await waitFor(() => expect(calls.find((c) => c.url === '/v1/orgs/get_reviewable_targets')?.body).toMatchObject({ org_id: ORG_A, realm_id: 'r-prod' }));
		fireEvent.click(await within(drawer).findByRole('option', { name: /#eng-alerts/ }));
		fireEvent.click(within(drawer).getByRole('button', { name: 'Save' }));
		await waitFor(() => expect(writes(calls)).toContainEqual({ realm_id: 'r-prod', items: [{ event: 'run.started', channel_id: 'ch-eng' }], remove: [] }));
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

	it('details panel sends a test and deletes via the single Core routes; no Enable/Disable (the row switch does that)', async () => {
		const calls = route_fetch();
		render_panel(false, 'channels');
		fireEvent.click(await screen.findByRole('button', { name: '#design' }));
		const panel = screen.getByRole('complementary', { name: 'Channel details' });
		fireEvent.click(within(panel).getByRole('button', { name: 'Send test' }));
		expect(await within(panel).findByRole('status')).toHaveTextContent('Test delivered to 1 destination.');
		expect(calls).toContainEqual({ url: '/v1/notification_channels/test', body: { id: 'ch-off' } });
		expect(within(panel).queryByRole('button', { name: /^(Enable|Disable)$/ })).toBeNull();
		fireEvent.click(within(panel).getByRole('button', { name: 'Delete…' }));
		fireEvent.click(within(panel).getByRole('button', { name: 'Delete channel' }));
		await waitFor(() => expect(calls).toContainEqual({ url: '/v1/notification_channels/remove', body: { id: 'ch-off' } }));
	});

	it('the org lists only its own channels (a realm\'s are on that realm\'s page); built-ins first; a switch on the rest', async () => {
		const calls = route_fetch(() => {
			const d = center();
			d.channels = [...d.channels, { ...ch('ch-built', 'All org members'), system_key: 'org.in_app', locked: true, lock_reason: 'Built in' }];
			return d;
		});
		render_panel(false, 'channels');
		await screen.findByTestId('channel-ch-built');
		const rows = screen.getAllByTestId(/^channel-/).map((r) => r.getAttribute('data-testid'));
		expect(rows[0]).toBe('channel-ch-built');
		expect(rows).not.toContain('channel-ch-prod');
		expect(rows).not.toContain('channel-ch-mine');
		expect(within(row('channel-ch-eng')).getByTestId('belongs-to')).toHaveTextContent('Org');
		expect(within(row('channel-ch-built')).queryByRole('switch')).toBeNull();
		fireEvent.click(within(row('channel-ch-eng')).getByRole('switch', { name: '#eng-alerts on' }));
		await waitFor(() => expect(calls).toContainEqual({ url: '/v1/notification_channels/update', body: { id: 'ch-eng', enabled: false } }));
		expect(screen.queryByText(/rules?\b/i)).toBeNull();
	});

	it('a family rule (Any run event) shows once on its group, with ✕ and a switch; each run event shows it read-only', async () => {
		const calls = route_fetch(() => {
			const d = realm_center();
			const wide = { rule_id: 'r-wide', selector: 'run.*', tier: 'realm', channel_id: 'ch-prod', channel_name: '#prod', channel_enabled: true, enabled: true, locked: false, lock_reason: null };
			d.events = (d.events ?? []).map((g) => (g.family === 'run' ? { ...g, family_rules: { org: [], realm: [wide] }, events: g.events.map((e) => ({ ...e, realm: [...e.realm, wide] })) } : g)) as typeof d.events;
			return d;
		});
		render_panel(true);
		const head = await screen.findByTestId('family-run');
		expect(head).toHaveTextContent('#prod');
		expect(within(head).getByRole('switch')).toBeTruthy();
		fireEvent.click(within(head).getByRole('button', { name: /Remove #prod/ }));
		await waitFor(() => expect(writes(calls)).toContainEqual({ realm_id: 'r-prod', remove: ['r-wide'] }));
	});

	it('a realm lists its own and the org\'s: its own as This realm', async () => {
		route_fetch();
		render_panel(true, 'channels');
		await screen.findByTestId('channel-ch-prod');
		expect(within(row('channel-ch-prod')).getByTestId('belongs-to')).toHaveTextContent('This realm');
		expect(within(row('channel-ch-eng')).getByTestId('belongs-to')).toHaveTextContent('Org');
	});

	it('New channel: a name, then destinations from "Add destination…" (each removable); it belongs to this realm', async () => {
		const calls = route_fetch(realm_center, (u) => (u.endsWith('/notification_channels/create') ? { body: { ok: true, data: { id: 'ch-new', name: 'Platform' } } } : null));
		render_panel(true, 'channels');
		fireEvent.click(await screen.findByRole('button', { name: /New channel/ }));
		const drawer = screen.getByRole('dialog', { name: 'New channel' });
		expect(within(drawer).queryByRole('radio')).toBeNull();
		expect(within(drawer).getByTestId('nc-where')).toHaveTextContent('For the prod-us realm.');
		// Letters, digits, - and _ only: a # or a space is refused before anything is sent.
		fireEvent.change(within(drawer).getByLabelText('Name'), { target: { value: '#platform team' } });
		expect(within(drawer).getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');
		expect(within(drawer).getByText('Use letters, digits, - and _ in the name.')).toBeInTheDocument();
		fireEvent.change(within(drawer).getByLabelText('Name'), { target: { value: 'Platform' } });
		expect(within(drawer).getByLabelText('Name')).toHaveAttribute('aria-invalid', 'false');
		expect(within(drawer).getByRole('button', { name: 'Create channel' })).toBeDisabled();
		expect(within(drawer).getByText('Needs a destination.')).toBeInTheDocument();
		// Email: To, Cc and Bcc; Add with no address says what's missing.
		fireEvent.change(within(drawer).getByLabelText('Add destination'), { target: { value: 'email' } });
		fireEvent.click(within(drawer).getByRole('button', { name: 'Add' }));
		expect(within(drawer).getByRole('alert')).toHaveTextContent('Enter at least one address.');
		fireEvent.change(within(drawer).getByLabelText('To'), { target: { value: 'a@x.com,b@x.com ' } });
		fireEvent.change(within(drawer).getByLabelText(/^Cc/), { target: { value: 'c@x.com' } });
		fireEvent.click(within(drawer).getByRole('button', { name: 'Add' }));
		await waitFor(() => expect(within(drawer).queryByLabelText('To')).toBeNull());
		// A second destination, then a third removed again.
		fireEvent.change(within(drawer).getByLabelText('Add destination'), { target: { value: 'slack' } });
		fireEvent.change(within(drawer).getByLabelText('Slack webhook URL'), { target: { value: 'https://hooks.slack.com/services/T/B/x' } });
		fireEvent.click(within(drawer).getByRole('button', { name: 'Add' }));
		fireEvent.change(await within(drawer).findByLabelText('Add destination'), { target: { value: 'webhook' } });
		fireEvent.change(within(drawer).getByLabelText('URL'), { target: { value: 'https://pd.example/hook' } });
		fireEvent.click(within(drawer).getByRole('button', { name: 'Add' }));
		fireEvent.click(await within(drawer).findByRole('button', { name: 'Remove Webhook destination' }));
		expect(within(within(drawer).getByTestId('destinations')).getAllByRole('listitem')).toHaveLength(2);
		fireEvent.click(within(drawer).getByRole('button', { name: 'Create channel' }));
		await waitFor(() => expect(calls).toContainEqual({ url: '/v1/notification_channels/create', body: {
			name: 'Platform', realm_id: 'r-prod', destinations: [
				{ type: 'email', address: 'a@x.com, b@x.com', cc: 'c@x.com' },
				{ type: 'slack', webhook_url: 'https://hooks.slack.com/services/T/B/x' },
			],
		} }));
	});

	it('New channel inside Send to: made in place, then ticked; Save adds it to the event', async () => {
		const calls = route_fetch(realm_center, (u) => (u.endsWith('/notification_channels/create') ? { body: { ok: true, data: { id: 'ch-new', name: 'Oncall' } } } : targets(u)));
		render_panel(true);
		fireEvent.click(within(await screen.findByTestId('event-run.started')).getByRole('button', { name: 'Edit where Run started goes' }));
		const drawer = screen.getByRole('dialog', { name: 'Run started goes to…' });
		fireEvent.click(within(drawer).getByRole('button', { name: '+ New channel' }));
		const form = within(drawer).getByTestId('new-channel-form');
		fireEvent.change(within(form).getByLabelText('Add destination'), { target: { value: 'cliqhub' } });
		expect(within(form).getByTestId('nc-in-app')).toHaveTextContent('Everyone in prod-us sees these messages in their CliqHub inbox.');
		fireEvent.click(within(form).getByRole('button', { name: 'Add' }));
		fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Oncall' } });
		fireEvent.click(await within(form).findByRole('button', { name: 'Create channel' }));
		await waitFor(() => expect(within(drawer).queryByTestId('new-channel-form')).toBeNull());
		expect(calls.find((c) => c.url === '/v1/notification_channels/create')?.body).toEqual({ name: 'Oncall', realm_id: 'r-prod', destinations: [{ type: 'cliqhub' }] });
		expect(within(drawer).getByTestId('send-changes')).toHaveTextContent('1 to add');
		fireEvent.click(within(drawer).getByRole('button', { name: 'Save' }));
		await waitFor(() => expect(writes(calls)).toContainEqual({ realm_id: 'r-prod', items: [{ event: 'run.started', channel_id: 'ch-new' }], remove: [] }));
	});

	it('a channel\'s details: add a destination and remove one, each saved (the BFF fills in the rest of the list)', async () => {
		const calls = route_fetch(() => {
			const d = center();
			d.channels = d.channels.map((c) => (c.id === 'ch-eng' ? { ...c, destinations: [{ type: 'slack', label: 'Slack ••••1234' }, { type: 'email', label: 'ops@x.com' }] } : c));
			return d;
		}, (u) => (u.endsWith('/notification_channels/update') ? { body: { ok: true, data: { id: 'ch-eng', destinations: [] } } } : null));
		render_panel(false, 'channels');
		fireEvent.click(await screen.findByRole('button', { name: '#eng-alerts' }));
		const panel = screen.getByRole('complementary', { name: 'Channel details' });
		fireEvent.change(within(panel).getByLabelText('Add destination'), { target: { value: 'webhook' } });
		fireEvent.change(within(panel).getByLabelText('URL'), { target: { value: 'https://pd.example/hook' } });
		fireEvent.click(within(panel).getByRole('button', { name: 'Add' }));
		await waitFor(() => expect(calls).toContainEqual({ url: '/v1/notification_channels/update', body: { id: 'ch-eng', org_id: ORG_A, add_destinations: [{ type: 'webhook', url: 'https://pd.example/hook' }] } }));
		fireEvent.click(within(panel).getByRole('button', { name: 'Remove Email destination' }));
		await waitFor(() => expect(calls).toContainEqual({ url: '/v1/notification_channels/update', body: { id: 'ch-eng', org_id: ORG_A, remove_destination: { index: 1, type: 'email' } } }));
	});

	it('a channel\'s details: Channels or people opens Send to — search, tick several, untick one to remove it, save', async () => {
		const calls = route_fetch(() => {
			const d = center();
			d.channels = d.channels.map((c) => (c.id === 'ch-eng' ? { ...c, destinations: [{ type: 'slack', label: 'Slack ••••1234' }, { type: 'channel_ref', label: 'oncall' }] } : c));
			return d;
		}, (u) => (u === '/v1/orgs/get_reviewable_targets'
			? { body: { ok: true, data: {
				channels: { items: [{ id: 'ch-eng', name: '#eng-alerts', level: 'org' }, { id: 'c-on', name: 'oncall', level: 'org' }, { id: 'c-rel', name: 'release', level: 'org' }], total: 3 },
				people: { items: [{ user_id: 'u-elan', username: 'elan', display_name: 'Elan Rao', channel_id: 'pc-elan' }], total: 1 },
			} } }
			: u.endsWith('/notification_channels/update') ? { body: { ok: true, data: { id: 'ch-eng', destinations: [] } } } : null));
		render_panel(false, 'channels');
		fireEvent.click(await screen.findByRole('button', { name: '#eng-alerts' }));
		const panel = screen.getByRole('complementary', { name: 'Channel details' });
		expect(within(panel).queryByText(/event/)).toBeNull();
		fireEvent.change(within(panel).getByLabelText('Add destination'), { target: { value: 'channel_ref' } });
		const drawer = screen.getByRole('dialog', { name: '#eng-alerts passes it on to…' });
		fireEvent.change(within(drawer).getByRole('searchbox', { name: 'Search channels or people' }), { target: { value: 'e' } });
		await waitFor(() => expect(calls.find((c) => c.url === '/v1/orgs/get_reviewable_targets' && c.body.query === 'e')?.body).toMatchObject({ org_id: ORG_A, limit: 20 }));
		const channels = await within(drawer).findByTestId('send-channels');
		// A channel can't pass to itself; what it passes to now starts ticked.
		expect(within(channels).queryByRole('option', { name: /#eng-alerts/ })).toBeNull();
		expect(within(channels).getByRole('option', { name: /oncall/ })).toHaveAttribute('aria-selected', 'true');
		fireEvent.click(within(channels).getByRole('option', { name: /release/ }));
		fireEvent.click(within(drawer).getByRole('option', { name: /Elan Rao/ }));
		fireEvent.click(within(channels).getByRole('option', { name: /oncall/ }));
		expect(within(drawer).getByTestId('send-changes')).toHaveTextContent('2 to add · 1 to remove');
		fireEvent.click(within(drawer).getByRole('button', { name: 'Save' }));
		await waitFor(() => expect(calls).toContainEqual({ url: '/v1/notification_channels/update', body: { id: 'ch-eng', org_id: ORG_A, add_destinations: [{ type: 'channel_ref', name: 'release' }, { type: 'channel_ref', name: 'elan' }] } }));
		await waitFor(() => expect(calls).toContainEqual({ url: '/v1/notification_channels/update', body: { id: 'ch-eng', org_id: ORG_A, remove_destination: { index: 1, type: 'channel_ref' } } }));
	});

	it('a channel\'s only destination can\'t be removed; a built-in channel has no editor', async () => {
		const calls = route_fetch(() => {
			const d = center();
			d.channels = [...d.channels, { ...ch('ch-built', 'All org members'), system_key: 'org.in_app', locked: true, lock_reason: 'Built in' }];
			return d;
		});
		render_panel(false, 'channels');
		fireEvent.click(await screen.findByRole('button', { name: '#eng-alerts' }));
		const panel = screen.getByRole('complementary', { name: 'Channel details' });
		fireEvent.click(within(panel).getByRole('button', { name: 'Remove Slack destination' }));
		expect(await within(panel).findByRole('alert')).toHaveTextContent('A channel needs at least one destination.');
		expect(calls.some((c) => c.url === '/v1/notification_channels/update')).toBe(false);
		fireEvent.click(screen.getByRole('button', { name: 'All org members' }));
		expect(within(screen.getByRole('complementary', { name: 'Channel details' })).queryByLabelText('Add destination')).toBeNull();
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
