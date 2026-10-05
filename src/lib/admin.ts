/**
 * Admin mode (CliqHub site admins — `users.role = 'admin'`) — wire types for
 * the BFF composition reads `/v1/admin_home/get` and `/v1/admin_list/get`.
 * Writes use the existing single routes (users/*, orgs/*, teams/*).
 */

export interface Admin_core_info {
	reachable: boolean;
	version: string | null;
	api_version: number | null;
	started_at: number | null;
	required_api_version: number;
	compatible: boolean;
	message: string | null;
}

export interface Admin_attention {
	id: string;
	severity: 'error' | 'warn' | 'info';
	title: string;
	detail: string;
	href: string;
	action: string;
}

export interface Admin_audit_row {
	id: string;
	admin_id: string;
	admin_username: string | null;
	action: string;
	target_type: string;
	target_id: string;
	details: Record<string, unknown>;
	created_at: string;
}

export interface Admin_home_data {
	core: Admin_core_info | null;
	hub_wide: boolean;
	counts: {
		accounts: number | null;
		suspended: number | null;
		admins: number | null;
		orgs: number | null;
		realms: number | null;
		daemons: { online: number; total: number; offline: number } | null;
		runs_24h: { total: number; failed: number } | null;
	};
	attention: Admin_attention[];
	recent_audit: Admin_audit_row[];
	partial: boolean;
}

/** Account state. */
export type User_status = 'invited' | 'active' | 'suspended' | 'deleted';
/** Org state: an org waits for its owner until the owner invite is accepted. */
export type Org_status = 'active' | 'waiting_for_owner' | 'deleted';
/** Membership state in an org: pending until the invite is accepted. */
export type Member_status = 'active' | 'pending' | 'deleted';

/** `admin_list/get` accounts row; `username` is null for someone invited by email who has not accepted. */
export interface Admin_account_row {
	id: string; username: string | null; display_name: string; email: string;
	role: 'user' | 'admin'; status: User_status; suspended_at: string | null; deleted_at: string | null; created_at: string | null;
}

/** What to call a person whose username may be unset (invited by email, not accepted yet). */
export function person_name(p: { display_name?: string | null; username: string | null; email?: string | null }): string {
	return p.display_name || p.username || p.email || 'Invited';
}

/** How actions and messages name a person: the username, or the email until there is one. */
export function login_name(p: { username: string | null; email?: string | null }): string {
	return p.username ?? p.email ?? 'Invited';
}

/** "@username", or "Invited" while the person has no username yet. */
export function handle(username: string | null): string {
	return username ? `@${username}` : 'Invited';
}

export interface Admin_daemon_row {
	id: string; name: string | null; hostname: string | null; status: string;
	last_heartbeat: number | null; capacity: number | null;
	realms: Array<{ id: string; slug: string; org_slug: string | null; name: string }>;
}
export interface Admin_team_row {
	id: string; name: string; scope: string | null; description: string | null;
	visibility: string; listed: boolean; install_count: number; version_count: number | null;
	author_username: string | null; updated_at: string | null; listed_without_version: boolean;
	/** Org that owns the team's scope (absent on an older BFF). */
	org_id?: string | null; org_slug?: string | null;
}
export interface Admin_org_option { id: string; slug: string; display_name: string }

export interface Admin_list_data<T> {
	kind: 'accounts' | 'daemons' | 'teams' | 'audit' | 'realms' | 'workspaces' | 'runs' | 'logs' | 'scopes';
	filter: string;
	items: T[];
	total: number;
	limit: number;
	offset: number;
	counts: Record<string, number | null>;
	hub_wide: boolean;
	needs_org: boolean;
	/** Filters this Core can't apply yet (Core API < 3). */
	unsupported: string[];
	/** Columns the BFF can sort this list by today (only what Core applies). */
	sortable?: string[];
}

export interface Admin_realm_ref { id: string; slug: string; org_slug: string | null }
export interface Admin_realm_row { id: string; slug: string; name: string; org_slug: string | null; created_by_username: string | null; created_at: number | null }
export interface Admin_workspace_row {
	id: string; name: string | null; path: string; daemon_id: string | null; daemon_name: string | null;
	/** Where it runs: its own daemon plus every run's daemon, realm and org (absent on an older BFF). */
	daemons?: Array<{ id: string; name: string | null }>;
	realms?: Admin_realm_ref[];
	orgs?: Admin_org_option[];
	teams: string[]; active_runs: number; latest_run: { run_id: string; state: string; started_at: number | null } | null; updated_at: number | null;
}
export interface Admin_run_row {
	run_id: string; run_name: string | null; state: string; team_label: string | null; daemon_id: string | null;
	workspace_name: string | null; started_at: number | null; last_updated_at: number | null; realm: Admin_realm_ref | null;
}
export interface Admin_log_row { id: string; run_id: string; run_name: string | null; created_at: number; level: string; message: string; daemon_name: string | null; team: string | null; realm: Admin_realm_ref | null }
export interface Admin_scope_row { id: string; slug: string; display_name: string; org_id: string | null; org_slug: string | null; owner_username: string | null; visibility: string; scope_type: string; team_count: number; created_at: string | null }

export function realm_href(r: Admin_realm_ref | { slug: string; org_slug: string | null } | null): string | null {
	return r?.org_slug ? `/o/${r.org_slug}/realms/${r.slug}` : null;
}
export function run_href(run_id: string, r: Admin_realm_ref | null): string | null {
	const base = realm_href(r);
	return base ? `${base}/runs/${encodeURIComponent(run_id)}` : null;
}

/** `users/get_by_id` (site admin); `orgs` are the live orgs the user is an active member of. */
export interface Admin_user_detail {
	id: string; username: string | null; display_name: string; email: string; role: string;
	status: User_status; deleted_at: string | null; suspended_at: string | null; suspended_reason: string; created_at: string;
	scope_count: number; team_count: number; token_count: number; draft_count: number;
	orgs: Array<{ id: string; slug: string; display_name: string; role: string }>;
}

/**
 * One org member as `orgs/get_by_id` sends it; `username` is null until someone
 * invited by email accepts. `email` is null unless the viewer manages members
 * (org owner/admin) or is a site admin.
 */
export interface Org_member {
	user_id: string; username: string | null; display_name: string; email: string | null; role: string; role_id: string | null;
	status: Member_status; invited_at: string | null; joined_at: string | null; deleted_at: string | null;
}

/** An org role with its permissions. */
export interface Org_role {
	id: string; org_id: string; slug: string; name: string; permissions: string[];
	is_system: boolean; is_default: boolean; member_count: number; created_at?: string;
}

/** A publishing scope of an org, with counts. */
export interface Org_scope { id: string; slug: string; display_name: string; visibility: string; member_count: number; team_count: number }

/** `orgs/get_by_id` (also `org_page/get`'s `org`). */
export interface Org_detail {
	id: string; slug: string; display_name: string; created_at: string;
	status: Org_status;
	/** `username` is null until an owner invited by email accepts. */
	owner: { user_id: string; username: string | null; status: User_status } | null;
	deleted_at: string | null;
	/** The open owner invite while the org waits for its owner; null otherwise. */
	pending_owner_invite: { invite_id: string; email: string; expires_at: string } | null;
	/** The caller's role slug. */
	my_role: string;
	members: Org_member[];
	scopes: Org_scope[];
	roles: Org_role[];
	/** Permissions a custom role can hold. */
	available_permissions: string[];
	/** Permissions only the owner role has. */
	owner_only_permissions: string[];
}

export function initials(name: string): string {
	const parts = name.replace(/[@._-]+/g, ' ').trim().split(/\s+/).filter(Boolean);
	const s = parts.length >= 2 ? parts[0][0] + parts[1][0] : (parts[0] ?? '?').slice(0, 2);
	return s.toUpperCase();
}

/** Stable avatar hue per name. */
export function avatar_color(name: string): string {
	const palette = ['#3ecf8e', '#b06cff', '#ff6b8a', '#2dd4bf', '#ffb224', '#5b9dff', '#a3c43b', '#ff8a4c'];
	let h = 0;
	for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
	return palette[h % palette.length];
}

export function ago(iso_or_ms: string | number | null, now: number = Date.now()): string {
	if (iso_or_ms == null) return '—';
	const t = typeof iso_or_ms === 'number' ? iso_or_ms : Date.parse(iso_or_ms);
	if (!Number.isFinite(t)) return '—';
	const s = Math.max(0, Math.round((now - t) / 1000));
	if (s < 60) return `${s}s`;
	const m = Math.round(s / 60);
	if (m < 60) return `${m}m`;
	const h = Math.round(m / 60);
	if (h < 48) return `${h}h`;
	const d = Math.round(h / 24);
	if (d < 60) return `${d}d`;
	return `${Math.round(d / 30)}mo`;
}

export function month_year(iso: string | null): string {
	if (!iso) return '—';
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

/**
 * Org owners: current or invited members holding the `owner` role (by id). Rows Core hasn't
 * backfilled yet (role_id null) count when the legacy role is owner/admin —
 * Core promotes the first admin to owner on its next boot (same rule as Core's owner_count).
 */
export function owners_of(org: Org_detail): Org_member[] {
	const owner_ids = new Set(org.roles.filter((r) => r.slug === 'owner').map((r) => r.id));
	return org.members.filter((m) => m.status !== 'deleted' && (m.role_id ? owner_ids.has(m.role_id) : m.role === 'owner' || m.role === 'admin'));
}

/** Human summary of audit details — secret-looking keys never show a value. */
const SECRET_KEY = /(^|_)(key|token|secret|password)$/i;
export function audit_summary(details: Record<string, unknown>): string {
	const parts: string[] = [];
	for (const [k, v] of Object.entries(details ?? {})) {
		if (v == null || v === '') continue;
		if (SECRET_KEY.test(k)) { parts.push(`${k}: set`); continue; }
		if (typeof v === 'object') { parts.push(`${k}: ${Array.isArray(v) ? v.join(', ') : '…'}`); continue; }
		parts.push(`${k}: ${String(v)}`);
	}
	return parts.slice(0, 3).join(' · ');
}

/** Actions worth highlighting (privilege changes, act-as, deletes). */
export function audit_is_sensitive(action: string): boolean {
	return /set_role|delete|act_as|force_delete|reset_password/.test(action);
}

/** One row of `orgs/get` (site-admin inventory). */
export interface Admin_org_row {
	id: string; slug: string; display_name: string; member_count: number; scope_count: number;
	created_at: string;
	status: Org_status;
	/** `username` is null until an owner invited by email accepts. */
	owner: { username: string | null; status: User_status } | null;
	deleted_at: string | null;
}

/** `orgs/new` response: the org (waiting for its owner) and the owner invite. */
export interface Org_new_data {
	org: {
		id: string; slug: string; display_name: string; status: Org_status;
		owner: { user_id: string; email: string; status: User_status };
		created_at: string; reactivated: boolean;
	};
	owner_invite: { invite_id: string; role: 'owner'; status: 'pending'; expires_at: string; email_sent: boolean; invite_url: string | null };
}

/** `users/new` response: the invited user and their set-password email. */
export interface Users_new_data {
	user: { id: string; username: string; email: string; status: User_status };
	setup: { expires_at: string; email_sent: boolean; setup_url: string | null };
}

/** `users/reset_password` response for a site admin. */
export interface Reset_email_data {
	reset_id: string; expires_at: string; email_sent: boolean; reset_url: string | null;
}

/** Core's 409 `deleted` details: the name belongs to a soft-deleted org or user. */
export interface Deleted_details {
	kind: 'org' | 'user';
	id: string;
	deleted_at: string;
	was_active: boolean;
}

/** Deleted-row details from an error's `details`, or null when they aren't. */
export function as_deleted_details(d: Record<string, unknown> | null | undefined): Deleted_details | null {
	if (!d || (d.kind !== 'org' && d.kind !== 'user') || typeof d.id !== 'string') return null;
	return d as unknown as Deleted_details;
}

/** Who holds a name (Core's 409 `details` on org / scope / user create; see Core lib/namespace.ts). */
export interface Namespace_holder {
	kind: 'org' | 'scope' | 'user';
	slug: string;
	scope_type?: string;
	org_slug?: string | null;
	owner_username?: string | null;
	personal?: boolean;
	reason?: string;
}

/** A holder from an error's `details`, or null when it isn't one. */
export function as_namespace_holder(d: Record<string, unknown> | null | undefined): Namespace_holder | null {
	if (!d || (d.kind !== 'org' && d.kind !== 'scope' && d.kind !== 'user') || typeof d.slug !== 'string') return null;
	return d as unknown as Namespace_holder;
}

/** Where an admin can look at the holder of a name. */
export function namespace_holder_link(h: Namespace_holder): { href: string; label: string } {
	const q = encodeURIComponent(h.slug);
	if (h.kind === 'scope') return { href: `/admin/scopes?q=${q}`, label: 'View scope' };
	if (h.kind === 'org') return { href: `/admin/orgs?q=${q}`, label: 'View org' };
	return { href: `/admin/accounts?q=${q}`, label: 'View account' };
}

