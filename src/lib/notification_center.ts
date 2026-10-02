/**
 * Notification center — types for `POST /v1/notification_center/get|check`
 * (BFF composition) plus pure helpers shared by the page and its tests.
 */
export type Notif_scope_kind = 'org' | 'realm' | 'team';

export interface Notif_scope {
	kind: Notif_scope_kind;
	org_id: string;
	org_slug: string;
	realm_id: string | null;
	realm_slug: string | null;
	team_slug: string | null;
}

export interface Notif_channel {
	id: string;
	name: string;
	owner: { kind: 'org' | 'realm' | 'personal'; org_id: string; org_slug: string; realm_id: string | null; realm_slug: string | null };
	destinations: Array<{ type: string; label: string }>;
	enabled: boolean;
	rule_count: number;
	/** Seeded built-in channel (e.g. `org.email`); null for channels people created. */
	system_key: string | null;
	/** Built in: it can't be changed or removed. */
	locked: boolean;
	/** Why the channel is locked; null when it isn't. */
	lock_reason: string | null;
}

export interface Notif_rule {
	id: string;
	event: string;
	scope: Notif_scope;
	channel_id: string;
	channel_name: string | null;
	priority: number;
	replaces: string[];
	/** Who it reaches besides the channel's own destinations: `invitee`, `org_owners`, `inviter` or user ids. */
	recipients: string[];
	/** Seeded default rule (e.g. `invite.sent.invitee`); null for rules people created. */
	system_key: string | null;
	/** Built in: it always fires and can't be changed or removed. */
	locked: boolean;
	lock_reason: string | null;
}

export interface Notification_center_data {
	/** `can_edit`: org-wide rules (owners and site admins); `can_edit_channels`: org channels. */
	orgs: Array<{ id: string; slug: string; display_name: string; role: string; status: 'ok' | 'error'; error: string | null; can_edit: boolean; can_edit_channels: boolean }>;
	/** `can_edit`: realm + team rules and realm channels. */
	realms: Array<{ id: string; slug: string; name: string; org_id: string; org_slug: string; status: 'ok' | 'error'; error: string | null; can_edit: boolean }>;
	channels: Notif_channel[];
	rules: Notif_rule[];
	event_types: string[];
	/** Which realms this response covers (their rules + channels). */
	realm_page: { offset: number; limit: number; total: number; q: string | null; status: 'ok' | 'error'; error: string | null };
	partial: boolean;
}

export interface Notif_check_hit {
	rule_id: string;
	selector: string;
	tier: Notif_scope_kind;
	channel_id: string;
	channel_name: string | null;
}

export interface Notification_check_data {
	realm: { id: string; slug: string; name: string; org_id: string; org_slug: string };
	team_slug: string | null;
	teams: string[];
	rows: Array<{ event: string; winners: Notif_check_hit[]; replaced: Notif_check_hit[] }>;
	partial: boolean;
}

const LABELS: Record<string, string> = {
	'run.started': 'Run started', 'run.resumed': 'Run resumed', 'run.completed': 'Run completed', 'run.failed': 'Run failed',
	'run.crashed': 'Run crashed', 'run.cancelled': 'Run cancelled',
	'phase.started': 'Phase started', 'phase.completed': 'Phase completed', 'phase.failed': 'Phase failed', 'phase.skipped': 'Phase skipped',
	'phase.escalated': 'Gate escalated', 'phase.input_required': 'Input needed', 'phase.inputs_supplied': 'Input supplied',
	'phase.timed_out': 'Phase timed out', 'phase.idle': 'Phase idle',
	'hug.review_requested': 'Review requested', 'hug.review_reminded': 'Review reminder', 'hug.review_responded': 'Review answered',
	'hug.routing_requested': 'Routing requested', 'hug.review_resolved': 'Review resolved', 'hug.review_expired': 'Review expired',
	'team.published': 'Team published', 'team.visibility_changed': 'Team visibility changed',
	'daemon.enrolled': 'Daemon enrolled', 'daemon.removed': 'Daemon removed', 'daemon.online': 'Daemon online', 'daemon.offline': 'Daemon offline',
	'daemon.outbox.dead': 'Daemon outbox stuck', 'daemon.outbox.recovered': 'Daemon outbox recovered',
	'realm.created': 'Realm created', 'realm.deleted': 'Realm deleted', 'realm.member_added': 'Member added', 'realm.member_removed': 'Member removed',
	'realm.member_role_changed': 'Member role changed', 'realm.token_created': 'Token created', 'realm.token_revoked': 'Token revoked',
	'realm.key_rotated': 'Key rotated', 'auth.api_key_created': 'API key created', 'auth.api_key_revoked': 'API key revoked',
	'notification.test': 'Test notification', 'notification.failed': 'Notification failed',
	'invite.org.sent': 'Invite sent', 'invite.realm.sent': 'Realm invite sent', 'invite.owner.sent': 'Owner invite sent',
	'invite.org.reminder': 'Invite reminder', 'invite.realm.reminder': 'Realm invite reminder', 'invite.owner.reminder': 'Owner invite reminder',
	'invite.org.accepted': 'Invite accepted', 'invite.realm.accepted': 'Realm invite accepted', 'invite.owner.accepted': 'Owner invite accepted',
	'invite.org.declined': 'Invite declined', 'invite.realm.declined': 'Realm invite declined', 'invite.owner.declined': 'Owner invite declined',
	'invite.org.expired': 'Invite expired', 'invite.realm.expired': 'Realm invite expired', 'invite.owner.expired': 'Owner invite expired',
	'invite.org.revoked': 'Invite revoked', 'invite.realm.revoked': 'Realm invite revoked', 'invite.owner.revoked': 'Owner invite revoked',
	'org.abandoned': 'Org abandoned',
	'user.setup.sent': 'Set-password email sent', 'user.password_reset.sent': 'Password reset sent', 'user.password.changed': 'Password changed',
	'*': 'Every event',
};

const FAMILY: Record<string, string> = {
	run: 'Runs', phase: 'Phases', hug: 'Reviews', team: 'Teams', daemon: 'Daemons', realm: 'Realm', auth: 'Access', notification: 'Notifications', custom: 'Custom events',
	invite: 'Invites', org: 'Org', user: 'Accounts',
};

export function event_label(selector: string): string {
	if (LABELS[selector]) return LABELS[selector];
	if (selector.endsWith('.*')) {
		const fam = selector.slice(0, -2);
		return `Any ${(FAMILY[fam] ?? fam).toLowerCase().replace(/s$/, '')} event`;
	}
	if (selector.startsWith('custom.')) return `Custom: ${selector.slice(7)}`;
	return selector;
}

export function event_family(selector: string): string {
	if (selector === '*') return 'Everything';
	return FAMILY[selector.split('.')[0]] ?? 'Other';
}

/** Event picker options grouped by family, each family offering its wildcard first. */
export function event_options(types: string[], rules: Notif_rule[]): Array<{ family: string; options: string[] }> {
	const all = new Set([...types, ...rules.map((r) => r.event).filter((e) => e !== '*')]);
	const by: Map<string, string[]> = new Map();
	for (const t of [...all].sort()) {
		const fam = t.split('.')[0];
		if (t.endsWith('.*')) continue;
		const list = by.get(fam) ?? [`${fam}.*`];
		list.push(t);
		by.set(fam, list);
	}
	return [{ family: 'Everything', options: ['*'] }, ...[...by.entries()].map(([fam, options]) => ({ family: FAMILY[fam] ?? fam, options }))];
}

/** Same overlap rule the BFF uses: do two selectors share at least one event? */
export function selectors_overlap(a: string, b: string): boolean {
	if (a === b || a === '*' || b === '*') return true;
	const fam = (s: string) => (s.endsWith('.*') ? s.slice(0, -1) : null);
	const fa = fam(a);
	const fb = fam(b);
	if (fa && fb) return fa === fb;
	if (fa) return b.startsWith(fa);
	if (fb) return a.startsWith(fb);
	return false;
}

const RANK: Record<Notif_scope_kind, number> = { org: 1, realm: 2, team: 3 };

/** What a new rule would replace, and what would still take precedence over it. */
export function rule_effect(draft: { event: string; scope: Notif_scope }, rules: Notif_rule[]) {
	const same_ctx = (r: Notif_rule) => r.scope.org_id === draft.scope.org_id
		&& (r.scope.kind === 'org' || draft.scope.kind === 'org' || r.scope.realm_id === draft.scope.realm_id)
		&& (r.scope.kind !== 'team' || draft.scope.kind !== 'team' || r.scope.team_slug === draft.scope.team_slug);
	const overlapping = rules.filter((r) => same_ctx(r) && selectors_overlap(r.event, draft.event));
	return {
		replaces: overlapping.filter((r) => RANK[r.scope.kind] < RANK[draft.scope.kind]),
		overridden_by: overlapping.filter((r) => RANK[r.scope.kind] > RANK[draft.scope.kind]),
		alongside: overlapping.filter((r) => RANK[r.scope.kind] === RANK[draft.scope.kind]),
	};
}

const RECIPIENT_LABELS: Record<string, string> = { invitee: 'Invited person', org_owners: 'Owners', inviter: 'Inviter' };

/** Chip text for one rule recipient; anything else is a user id. */
export function recipient_label(r: string): string {
	return RECIPIENT_LABELS[r] ?? `User ${r.slice(0, 8)}`;
}

export function scope_text(s: Notif_scope): string {
	if (s.kind === 'org') return s.org_slug;
	if (s.kind === 'realm') return s.realm_slug ?? '';
	return `${s.team_slug} · ${s.realm_slug}`;
}

/** Can the viewer add or change org-wide rules? */
export function can_edit_org(data: Notification_center_data, org_id: string): boolean {
	return data.orgs.find((o) => o.id === org_id)?.can_edit === true;
}

/** Can the viewer add or change org channels? */
export function can_edit_org_channels(data: Notification_center_data, org_id: string): boolean {
	return data.orgs.find((o) => o.id === org_id)?.can_edit_channels === true;
}

/**
 * Can the viewer add or change this realm's rules, its teams' rules and its
 * channels? A realm outside the current realm page (picked by search) is
 * left to Core to decide.
 */
export function can_edit_realm(data: Notification_center_data, realm_id: string | null): boolean {
	if (!realm_id) return false;
	return data.realms.find((r) => r.id === realm_id)?.can_edit !== false;
}

/** Can the viewer change or remove this rule? Never for a built-in (locked) rule. */
export function can_edit_rule(data: Notification_center_data, r: Notif_rule): boolean {
	if (r.locked) return false;
	return r.scope.kind === 'org' ? can_edit_org(data, r.scope.org_id) : can_edit_realm(data, r.scope.realm_id);
}

/** Can the viewer change or remove this channel? Never for a built-in (locked) channel. */
export function can_edit_channel(data: Notification_center_data, c: Notif_channel): boolean {
	if (c.locked) return false;
	if (c.owner.kind === 'personal') return true;
	return c.owner.kind === 'org' ? can_edit_org_channels(data, c.owner.org_id) : can_edit_realm(data, c.owner.realm_id);
}

/** Orgs where the viewer can't change any rule (org-wide or in a realm) — shown as view-only. */
export function view_only_orgs(data: Notification_center_data): Array<{ id: string; display_name: string; role: string }> {
	return data.orgs.filter((o) => o.status === 'ok' && !can_edit_org(data, o.id)
		&& !data.realms.some((r) => r.org_id === o.id && can_edit_realm(data, r.id)));
}
