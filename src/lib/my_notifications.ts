/**
 * What reaches *you* in an org, worked out from the org's rules and channels
 * (`POST /v1/notification_center/get`). Read-only. A rule sends to its
 * channel's destinations:
 *   - your personal channel → you, directly (someone else's reaches them, not you);
 *   - an email destination with your address → your email;
 *   - an in-app destination on an org or realm channel → your inbox (everyone in that
 *     org / realm sees it);
 *   - anything else (Slack, webhooks, Jira, someone else's email) is posted
 *     somewhere shared, not addressed to you.
 * Invite and account messages are built in (not rules), so they are not here.
 */
import type { Notif_channel, Notif_rule } from '@/lib/notification_center';

export type Reach = 'direct' | 'email' | 'inbox' | 'none';

export interface Me {
	id: string;
	email: string | null;
}

export interface My_rule_row {
	rule: Notif_rule;
	reach: Reach;
	/** Where it is posted besides you: Slack, webhooks, other addresses. */
	shared: string[];
}

/** Strongest first. */
const ORDER: Reach[] = ['direct', 'email', 'inbox', 'none'];

export const REACH_LABEL: Record<Reach, string> = {
	direct: 'You, directly',
	email: 'Your email',
	inbox: 'Your inbox',
	none: 'Not to you',
};

/** True for the viewer's own personal channel. */
export function is_my_channel(channel: Notif_channel | undefined, me_id: string): boolean {
	return channel?.owner.kind === 'personal' && channel.owner.user_id === me_id;
}

function best(a: Reach, b: Reach): Reach {
	return ORDER.indexOf(a) <= ORDER.indexOf(b) ? a : b;
}

export function rule_reach(rule: Notif_rule, channel: Notif_channel | undefined, me: Me): My_rule_row {
	if (!channel) return { rule, reach: 'none', shared: [] };
	// A personal channel reaches its owner only.
	if (channel.owner.kind === 'personal') return { rule, reach: is_my_channel(channel, me.id) ? 'direct' : 'none', shared: [] };
	let reach: Reach = 'none';
	const shared: string[] = [];
	const my_email = me.email?.trim().toLowerCase() ?? null;
	for (const d of channel.destinations) {
		if (d.type === 'email' && my_email && d.label.trim().toLowerCase() === my_email) reach = best(reach, 'email');
		else if (d.type === 'cliqhub') reach = best(reach, 'inbox');
		else shared.push(d.label);
	}
	return { rule, reach, shared };
}

/** Every rule in the org with how it reaches you; the org's own rules first, then realm. */
export function my_rule_rows(rules: Notif_rule[], channels: Notif_channel[], me: Me, org_id: string): My_rule_row[] {
	const by_id = new Map(channels.map((c) => [c.id, c]));
	const tier = { org: 0, realm: 1 } as const;
	return rules
		.filter((r) => r.scope.org_id === org_id)
		.map((r) => rule_reach(r, by_id.get(r.channel_id), me))
		.sort((a, b) => a.rule.event.localeCompare(b.rule.event) || tier[a.rule.scope.kind] - tier[b.rule.scope.kind]);
}
