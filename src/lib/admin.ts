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

export interface Admin_account_row {
	id: string; username: string; display_name: string; email: string;
	role: 'user' | 'admin'; suspended_at: string | null; created_at: string | null;
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
}

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
	/** Daemons, hub-wide: every org for the picker. */
	org_options?: Array<{ id: string; slug: string; display_name: string }>;
}

export interface Admin_realm_ref { id: string; slug: string; org_slug: string | null }
export interface Admin_realm_row { id: string; slug: string; name: string; org_slug: string | null; created_by_username: string | null; created_at: number | null }
export interface Admin_workspace_row {
	id: string; name: string | null; path: string; daemon_id: string | null; daemon_name: string | null;
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

/** `users/get_by_id` (site admin). */
export interface Admin_user_detail {
	id: string; username: string; display_name: string; email: string; role: 'user' | 'admin';
	suspended_at: string | null; suspended_reason?: string; created_at: string | null;
	scope_count?: number; team_count?: number; token_count?: number; draft_count?: number;
	orgs?: Array<{ id: string; slug: string; display_name: string; role: string }>;
}

/** `orgs/get_by_id` (site admin view). */
export interface Admin_org_detail {
	id: string; slug: string; display_name: string; created_at: string;
	members: Array<{ user_id: string; username: string; display_name: string; email?: string; role: string; role_id: string | null }>;
	scopes: Array<{ id: string; slug: string; display_name: string; visibility: string; member_count: number | string; team_count?: number | string }>;
	roles: Array<{ id: string; slug: string; name: string; is_system?: boolean; member_count?: number }>;
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
 * Org owners: members holding the `owner` role (by id). Rows Core hasn't
 * backfilled yet (role_id null) count when the legacy role is owner/admin —
 * Core promotes the first admin to owner on its next boot (same rule as Core's owner_count).
 */
export function owners_of(org: Admin_org_detail): Admin_org_detail['members'] {
	const owner_ids = new Set(org.roles.filter((r) => r.slug === 'owner').map((r) => r.id));
	return org.members.filter((m) => (m.role_id ? owner_ids.has(m.role_id) : m.role === 'owner' || m.role === 'admin'));
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
