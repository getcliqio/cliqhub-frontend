/**
 * My notifications — what reaches *you* in an org, worked out from the org's
 * rules and channels (`POST /v1/notification_center/get`). Read-only.
 *
 * How a rule reaches you (Core's fan-out):
 *   - its recipients name you, or `org_owners` and you're an owner → you, directly;
 *   - `invitee` / `inviter` / `user` → only when the event is about you;
 *   - an email destination with your address → your email;
 *   - the built-in in-app destination with no recipients → the inbox
 *     everyone in that realm (or org) sees;
 *   - a personal channel (only its owner can see it) → you, directly;
 *   - anything else (Slack, webhooks, Jira, someone else's email) is posted
 *     somewhere shared, not addressed to you.
 */
import type { Notif_channel, Notif_rule } from '@/lib/notification_center';

export type Reach = 'direct' | 'email' | 'inbox' | 'about_you' | 'none';

export interface Me {
	id: string;
	email: string | null;
	is_owner: boolean;
}

export interface My_rule_row {
	rule: Notif_rule;
	reach: Reach;
	/** Where it is posted besides you: Slack, webhooks, other addresses. */
	shared: string[];
}

const ABOUT_YOU = new Set(['invitee', 'inviter', 'user']);
/** Strongest first. */
const ORDER: Reach[] = ['direct', 'email', 'inbox', 'about_you', 'none'];

export const REACH_LABEL: Record<Reach, string> = {
	direct: 'You, directly',
	email: 'Your email',
	inbox: 'Your inbox',
	about_you: 'When it’s about you',
	none: 'Not to you',
};

function best(a: Reach, b: Reach): Reach {
	return ORDER.indexOf(a) <= ORDER.indexOf(b) ? a : b;
}

export function rule_reach(rule: Notif_rule, channel: Notif_channel | undefined, me: Me): My_rule_row {
	let reach: Reach = 'none';
	const shared: string[] = [];
	if (rule.recipients.includes(me.id) || (me.is_owner && rule.recipients.includes('org_owners'))) reach = 'direct';
	else if (rule.recipients.some((r) => ABOUT_YOU.has(r))) reach = 'about_you';
	if (channel?.owner.kind === 'personal') reach = 'direct';
	const my_email = me.email?.trim().toLowerCase() ?? null;
	for (const d of channel?.destinations ?? []) {
		if (d.type === 'email' && my_email && d.label.trim().toLowerCase() === my_email) reach = best(reach, 'email');
		else if (d.type === 'cliqhub') { if (!rule.recipients.length) reach = best(reach, 'inbox'); }
		else if (channel?.owner.kind !== 'personal') shared.push(d.label);
	}
	return { rule, reach, shared };
}

/** Every rule in the org with how it reaches you; the org's own rules first, then realm, then team. */
export function my_rule_rows(rules: Notif_rule[], channels: Notif_channel[], me: Me, org_id: string): My_rule_row[] {
	const by_id = new Map(channels.map((c) => [c.id, c]));
	const tier = { org: 0, realm: 1, team: 2 } as const;
	return rules
		.filter((r) => r.scope.org_id === org_id)
		.map((r) => rule_reach(r, by_id.get(r.channel_id), me))
		.sort((a, b) => a.rule.event.localeCompare(b.rule.event) || tier[a.rule.scope.kind] - tier[b.rule.scope.kind]);
}
