/**
 * How a notification rule reaches you (the "Reaches you" filter on Events): recipients, your
 * email, the in-app inbox, your own personal channel, or only shared places.
 */
import { describe, it, expect } from 'vitest';
import { ORG_A, ORG_B } from './fixtures_overview';
import type { Notif_channel, Notif_rule } from '@/lib/notification_center';
import { rule_reach, my_rule_rows, type Me } from '@/lib/my_notifications';

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

	it('your personal channel: you, directly, nothing shared', () => {
		const own = { ...channel('own', [{ type: 'email', label: 'Account email' }], 'personal'), owner: { ...channel('own', [], 'personal').owner, user_id: 'u1' } };
		expect(rule_reach(rule('a', 'run.failed', 'own'), own, me)).toMatchObject({ reach: 'direct', shared: [] });
	});

	it("someone else's personal channel reaches them, not you (its in-app is their inbox)", () => {
		const elan = { ...channel('elan', [{ type: 'cliqhub', label: 'In-app (CliqHub)' }, { type: 'email', label: 'Account email' }], 'personal'), owner: { ...channel('elan', [], 'personal').owner, user_id: 'u7' } };
		expect(rule_reach(rule('a', 'run.failed', 'elan'), elan, me)).toMatchObject({ reach: 'none', shared: [] });
		// …unless the rule names you directly.
		expect(rule_reach(rule('b', 'run.failed', 'elan', { recipients: ['u1'] }), elan, me).reach).toBe('direct');
	});

	it('my_rule_rows: this org only, by event then org → realm → team', () => {
		const rows = my_rule_rows(
			[rule('r2', 'run.failed', 'slack', { scope: realm_scope }), rule('r1', 'run.failed', 'inapp'), rule('x', 'run.failed', 'inapp', { scope: { ...org_scope, org_id: ORG_B } }), rule('d', 'daemon.offline', 'slack')],
			[slack, inapp], me, ORG_A,
		);
		expect(rows.map((r) => r.rule.id)).toEqual(['d', 'r1', 'r2']);
	});
});
