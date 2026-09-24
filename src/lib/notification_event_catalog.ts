/** Event selectors for notification bindings (mirrors Hub catalog). */

export interface Event_leaf {
	value: string;
	label: string;
}

export interface Event_group {
	value: string;
	label: string;
	children: Event_leaf[];
}

export type Binding_scope = 'realm' | 'account' | 'all';

const REALM_GROUPS: Event_group[] = [
	{
		value: 'run.*',
		label: 'All runs',
		children: [
			{ value: 'run.started', label: 'Run started' },
			{ value: 'run.resumed', label: 'Run resumed' },
			{ value: 'run.completed', label: 'Run completed' },
			{ value: 'run.failed', label: 'Run failed' },
			{ value: 'run.crashed', label: 'Run crashed' },
			{ value: 'run.cancelled', label: 'Run cancelled' },
		],
	},
	{
		value: 'phase.*',
		label: 'All phases',
		children: [
			{ value: 'phase.started', label: 'Phase started' },
			{ value: 'phase.completed', label: 'Phase completed' },
			{ value: 'phase.failed', label: 'Phase failed' },
			{ value: 'phase.skipped', label: 'Phase skipped' },
			{ value: 'phase.escalated', label: 'Phase escalated' },
			{ value: 'phase.input_required', label: 'Input required' },
			{ value: 'phase.inputs_supplied', label: 'Inputs supplied' },
			{ value: 'phase.timed_out', label: 'Phase timed out' },
			{ value: 'phase.idle', label: 'Phase idle' },
		],
	},
	{
		value: 'hug.*',
		label: 'All HUG',
		children: [
			{ value: 'hug.review_requested', label: 'Review requested' },
			{ value: 'hug.review_reminded', label: 'Review reminded' },
			{ value: 'hug.review_responded', label: 'Review responded' },
			{ value: 'hug.routing_requested', label: 'Routing requested' },
			{ value: 'hug.review_resolved', label: 'Review resolved' },
			{ value: 'hug.review_expired', label: 'Review expired' },
		],
	},
	{
		value: 'daemon.*',
		label: 'All daemons',
		children: [
			{ value: 'daemon.enrolled', label: 'Daemon enrolled' },
			{ value: 'daemon.removed', label: 'Daemon removed' },
			{ value: 'daemon.online', label: 'Daemon online' },
			{ value: 'daemon.offline', label: 'Daemon offline' },
			{ value: 'daemon.outbox.dead', label: 'Outbox has dead entries' },
			{ value: 'daemon.outbox.recovered', label: 'Outbox recovered' },
		],
	},
	{
		value: 'realm.*',
		label: 'All realm',
		children: [
			{ value: 'realm.created', label: 'Realm created' },
			{ value: 'realm.deleted', label: 'Realm deleted' },
			{ value: 'realm.member_added', label: 'Member added' },
			{ value: 'realm.member_removed', label: 'Member removed' },
			{ value: 'realm.member_role_changed', label: 'Member role changed' },
			{ value: 'realm.token_created', label: 'Token created' },
			{ value: 'realm.token_revoked', label: 'Token revoked' },
			{ value: 'realm.key_rotated', label: 'Key rotated' },
		],
	},
];

const ACCOUNT_GROUPS: Event_group[] = [
	{
		value: 'team.*',
		label: 'All teams',
		children: [
			{ value: 'team.published', label: 'Team published' },
			{ value: 'team.visibility_changed', label: 'Visibility changed' },
		],
	},
	{
		value: 'auth.*',
		label: 'All user',
		children: [
			{ value: 'auth.api_key_created', label: 'API key created' },
			{ value: 'auth.api_key_revoked', label: 'API key revoked' },
		],
	},
];

const ACCOUNT_LEAVES: Event_leaf[] = [
	{ value: 'notification.test', label: 'Notification test' },
];

export function event_groups_for_scope(scope: Binding_scope): Event_group[] {
	if (scope === 'account') return ACCOUNT_GROUPS;
	if (scope === 'all') return [...REALM_GROUPS, ...ACCOUNT_GROUPS];
	return REALM_GROUPS;
}

/** All family wildcards for a scope — default selection when adding a channel. */
export function all_group_selectors(scope: Binding_scope): string[] {
	return event_groups_for_scope(scope).map((g) => g.value);
}

export function event_leaves_for_scope(scope: Binding_scope): Event_leaf[] {
	if (scope === 'account' || scope === 'all') return ACCOUNT_LEAVES;
	return [];
}

/** Account-scoped selectors (team/auth/test). Everything else is realm-scoped. */
export function is_account_event_selector(selector: string): boolean {
	const value = selector.trim();
	if (!value) return false;
	if (value === 'notification.test') return true;
	if (value === 'team.*' || value === 'auth.*') return true;
	if (value.startsWith('team.') || value.startsWith('auth.')) return true;
	return false;
}

export function partition_event_selectors(selected: string[]): {
	account: string[];
	realm: string[];
} {
	const account: string[] = [];
	const realm: string[] = [];
	for (const value of selected) {
		if (is_account_event_selector(value)) {
			account.push(value);
			continue;
		}
		realm.push(value);
	}
	return { account, realm };
}

export function label_for_selector(value: string, scope: Binding_scope): string {
	for (const group of event_groups_for_scope(scope)) {
		if (group.value === value) return group.label;
		const child = group.children.find((c) => c.value === value);
		if (child) return child.label;
	}
	for (const leaf of event_leaves_for_scope(scope)) {
		if (leaf.value === value) return leaf.label;
	}
	return value;
}

/** Compact summary for the closed dropdown trigger. */
export function summarize_selectors(selected: string[], scope: Binding_scope): string {
	if (selected.length === 0) return 'Select events…';
	const labels = selected.map((v) => label_for_selector(v, scope));
	if (labels.length <= 2) return labels.join(', ');
	return `${labels[0]}, ${labels[1]} +${labels.length - 2}`;
}

/**
 * Toggle a group wildcard. Parent on → store only `family.*`.
 * Parent off → remove group and any of its children.
 */
export function toggle_group(
	selected: string[],
	group: Event_group,
	checked: boolean,
): string[] {
	const child_values = new Set(group.children.map((c) => c.value));
	const without = selected.filter((v) => v !== group.value && !child_values.has(v));
	if (!checked) return without;
	return [...without, group.value];
}

/**
 * Toggle a concrete event. If parent group is selected, expand to siblings
 * minus this one. If all children end up selected, collapse to the group.
 */
export function toggle_leaf(
	selected: string[],
	group: Event_group | null,
	leaf_value: string,
	checked: boolean,
): string[] {
	if (!group) {
		if (!checked) return selected.filter((v) => v !== leaf_value);
		if (selected.includes(leaf_value)) return selected;
		return [...selected, leaf_value];
	}

	const child_values = group.children.map((c) => c.value);
	const has_group = selected.includes(group.value);
	let next: string[];

	if (has_group) {
		next = selected.filter((v) => v !== group.value);
		for (const child of child_values) {
			if (child === leaf_value) continue;
			next.push(child);
		}
		return next;
	}

	if (!checked) {
		return selected.filter((v) => v !== leaf_value);
	}

	next = selected.includes(leaf_value) ? selected : [...selected, leaf_value];
	const selected_children = child_values.filter((c) => next.includes(c));
	if (selected_children.length !== child_values.length) return next;

	return [
		...next.filter((v) => !child_values.includes(v)),
		group.value,
	];
}

export function leaf_checked(
	selected: string[],
	group: Event_group | null,
	leaf_value: string,
): boolean {
	if (selected.includes(leaf_value)) return true;
	if (group && selected.includes(group.value)) return true;
	return false;
}

export function group_check_state(
	selected: string[],
	group: Event_group,
): 'checked' | 'indeterminate' | 'unchecked' {
	if (selected.includes(group.value)) return 'checked';
	const n = group.children.filter((c) => selected.includes(c.value)).length;
	if (n === 0) return 'unchecked';
	if (n === group.children.length) return 'checked';
	return 'indeterminate';
}
