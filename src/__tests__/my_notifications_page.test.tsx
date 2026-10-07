/**
 * My notifications — the read-only "what reaches me" report: how each rule
 * reaches you (recipients, your email, the in-app inbox, shared places),
 * one BFF read for the org you're in, and the page itself.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { multi_org_overview, gs_response, ORG_A, ORG_B } from './fixtures_overview';
import type { Notif_channel, Notif_rule, Notification_center_data } from '@/lib/notification_center';
import { rule_reach, my_rule_rows, type Me } from '@/lib/my_notifications';

const auth = {
	user: { id: 'u1', username: 'sapan', display_name: 'Sapan Shah', email: 'S@x.com', role: 'user' as const, preferences: {} },
	loading: false, logout: vi.fn(), acting_as: null, stop_act_as: vi.fn(),
};
const stable_fetch = (url: string, init?: RequestInit) => fetch(url, init);
vi.mock('@/lib/auth_context', () => ({ useAuth: () => auth, useAuthFetch: () => stable_fetch }));

import { Component as MyNotificationsPage } from '@/pages/my_notifications_page';

const org_scope = { kind: 'org' as const, org_id: ORG_A, org_slug: 'measureone', realm_id: null, realm_slug: null, team_slug: null };
const realm_scope = { kind: 'realm' as const, org_id: ORG_A, org_slug: 'measureone', realm_id: 'r-prod', realm_slug: 'prod-us', team_slug: null };

function channel(id: string, destinations: Array<{ type: string; label: string }>, kind: 'org' | 'realm' | 'personal' = 'org', org_id = ORG_A): Notif_channel {
	return { id, name: id, owner: { kind, org_id, org_slug: 'measureone', realm_id: null, realm_slug: null }, destinations, enabled: true, rule_count: 1, system_key: null, locked: false, lock_reason: null };
}
function rule(id: string, event: string, channel_id: string, over: Partial<Notif_rule> = {}): Notif_rule {
	return { id, event, scope: org_scope, channel_id, channel_name: channel_id, priority: 0, replaces: [], recipients: [], system_key: null, locked: false, lock_reason: null, ...over };
}

const me: Me = { id: 'u1', email: 's@x.com', is_owner: true };

describe('rule_reach', () => {
	const slack = channel('slack', [{ type: 'slack', label: 'Slack webhook …/abcd' }]);
	const inapp = channel('inapp', [{ type: 'cliqhub', label: 'In-app (CliqHub)' }]);

	it('recipients naming you, or org owners when you are one → you, directly', () => {
		expect(rule_reach(rule('a', 'run.failed', 'inapp', { recipients: ['u1'] }), inapp, me).reach).toBe('direct');
		expect(rule_reach(rule('b', 'run.failed', 'inapp', { recipients: ['org_owners'] }), inapp, me).reach).toBe('direct');
		// Owners only: a member is not reached by `org_owners` (and an in-app channel with recipients doesn't broadcast).
		expect(rule_reach(rule('c', 'run.failed', 'inapp', { recipients: ['org_owners'] }), inapp, { ...me, is_owner: false }).reach).toBe('none');
	});

	it('invitee / inviter / user → only when the event is about you', () => {
		expect(rule_reach(rule('a', 'invite.org.sent', 'inapp', { recipients: ['invitee'] }), inapp, me).reach).toBe('about_you');
	});

	it('an email to your address (any case) → your email; someone else’s email is shared', () => {
		const mine = channel('m', [{ type: 'email', label: 's@x.com' }, { type: 'email', label: 'ops@m1.com' }]);
		const r = rule_reach(rule('a', 'run.failed', 'm'), mine, { ...me, email: 'S@X.com' });
		expect(r.reach).toBe('email');
		expect(r.shared).toEqual(['ops@m1.com']);
	});

	it('in-app with no recipients → the inbox; Slack alone → not to you, posted to Slack', () => {
		expect(rule_reach(rule('a', 'run.failed', 'inapp'), inapp, me).reach).toBe('inbox');
		expect(rule_reach(rule('b', 'run.failed', 'slack'), slack, me)).toMatchObject({ reach: 'none', shared: ['Slack webhook …/abcd'] });
	});

	it('a personal channel is yours: you, directly, nothing shared', () => {
		const own = channel('own', [{ type: 'email', label: 'other@x.com' }], 'personal');
		expect(rule_reach(rule('a', 'run.failed', 'own'), own, me)).toMatchObject({ reach: 'direct', shared: [] });
	});

	it('my_rule_rows: this org only, by event then org → realm → team', () => {
		const rows = my_rule_rows(
			[rule('r2', 'run.failed', 'slack', { scope: realm_scope }), rule('r1', 'run.failed', 'inapp'), rule('x', 'run.failed', 'inapp', { scope: { ...org_scope, org_id: ORG_B } }), rule('d', 'daemon.offline', 'slack')],
			[slack, inapp], me, ORG_A,
		);
		expect(rows.map((r) => r.rule.id)).toEqual(['d', 'r1', 'r2']);
	});
});

function center(): Notification_center_data {
	return {
		orgs: [{ id: ORG_A, slug: 'measureone', display_name: 'MeasureOne', role: 'owner', status: 'ok', error: null, can_edit: true, can_edit_channels: true }],
		realms: [{ id: 'r-prod', slug: 'prod-us', name: 'prod-us', org_id: ORG_A, org_slug: 'measureone', status: 'ok', error: null, can_edit: true }],
		channels: [
			channel('ch-inapp', [{ type: 'cliqhub', label: 'In-app (CliqHub)' }]),
			channel('ch-slack', [{ type: 'slack', label: 'Slack webhook …/abcd' }]),
		],
		rules: [
			rule('fail', 'run.failed', 'ch-inapp'),
			rule('prod-slack', 'run.completed', 'ch-slack', { scope: realm_scope }),
		],
		event_types: ['run.failed', 'run.completed'],
		realm_page: { offset: 0, limit: 50, total: 1, q: null, status: 'ok', error: null },
		partial: false,
	};
}

function route_fetch() {
	const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
		const u = String(url);
		const body = init?.body ? JSON.parse(String(init.body)) : {};
		calls.push({ url: u, body });
		if (u === '/v1/overview/get') return new Response(JSON.stringify({ ok: true, data: multi_org_overview() }));
		if (u === '/v1/getting_started/get') return gs_response(u)!;
		if (u === '/v1/notification_center/get') return new Response(JSON.stringify({ ok: true, data: center() }));
		throw new Error(`unexpected ${u}`);
	});
	return calls;
}

describe('My notifications page', () => {
	afterEach(() => vi.restoreAllMocks());

	it('one read for the org; what reaches me by default, everything on request; links to Events and Check', async () => {
		const calls = route_fetch();
		render(<MemoryRouter initialEntries={['/my-notifications']}><Routes><Route path="/my-notifications" element={<MyNotificationsPage />} /></Routes></MemoryRouter>);
		const row = await screen.findByTestId('my-rule-fail');
		expect(within(row).getByText('Your inbox')).toBeInTheDocument();
		expect(within(row).getByText('every realm')).toBeInTheDocument();
		expect(screen.queryByTestId('my-rule-prod-slack')).toBeNull();
		expect(screen.getByTestId('my-summary')).toHaveTextContent(/1 event reaches you.*1 only go to shared places/);
		const reads = calls.filter((c) => c.url === '/v1/notification_center/get');
		expect(reads).toHaveLength(1);
		expect(reads[0]!.body).toEqual({ org_id: ORG_A, realm_limit: 50 });

		fireEvent.click(screen.getByRole('button', { name: 'Everything' }));
		const slack = screen.getByTestId('my-rule-prod-slack');
		expect(within(slack).getByText('Not to you')).toBeInTheDocument();
		expect(within(slack).getByText('Slack webhook …/abcd')).toBeInTheDocument();
		expect(within(slack).getByText('prod-us')).toBeInTheDocument();

		expect(within(screen.getByRole('main')).getByRole('link', { name: 'Events' })).toHaveAttribute('href', '/notifications?org=measureone');
		expect(screen.getByRole('link', { name: 'check a realm' })).toHaveAttribute('href', '/notifications?tab=check&org=measureone');
	});
});
