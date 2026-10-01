/** Realm › Teams — types for `POST /v1/realm_teams/get`. */
export interface Realm_team_row {
	scope: string | null;
	slug: string;
	label: string;
	version: string | null;
	latest_version: string | null;
	update_available: boolean;
	origin: 'published' | 'local';
	in_team_list: boolean;
	installed_count: number;
	online_daemon_count: number;
	last_run_at: number | null;
	missing_agents: string[];
}

export interface Realm_teams_data {
	realm: { id: string; slug: string; name: string; org_slug: string | null };
	items: Realm_team_row[];
	total: number;
	offset: number;
	limit: number;
	counts: { all: number | null; full: number | null; partial: number | null; none: number | null };
	partial: boolean;
}

export type Coverage_filter = 'full' | 'partial' | 'none';

/** "3/3", "1/3", "0/3" — or "no daemons online". */
export function coverage_text(r: Pick<Realm_team_row, 'installed_count' | 'online_daemon_count'>): string {
	if (!r.online_daemon_count) return 'no daemons online';
	return `${Math.min(r.installed_count, r.online_daemon_count)}/${r.online_daemon_count}`;
}
