/** Realm › Teams — types for `POST /v1/realm_teams/get`. */
import type { Team_tree_node } from '@/lib/team_page';
export interface Realm_team_row {
	/** Catalog team id (published teams; null for local installs): what realms/add_team and remove_team take. */
	team_id: string | null;
	/** The id of the version this realm runs (null when not on its list). */
	version_id: string | null;
	scope: string | null;
	slug: string;
	label: string;
	version: string | null;
	latest_version: string | null;
	update_available: boolean;
	origin: 'hub' | 'cli';
	in_team_list: boolean;
	installed_count: number;
	online_daemon_count: number;
	/** Online daemons not on the realm's version (older, or not installed); null when not on the realm's list. */
	online_stale: number | null;
	/** The teams it calls directly, as installed; the listed teams calling it (flat view, S9). */
	uses?: string[];
	used_by?: string[];
	/** Unpinned sub-teams with a newer published version than the realm installed (PLAN-team-bundle S8); null off the list. */
	sub_team_updates?: number | null;
	last_run_at: number | null;
	missing_agents: string[];
	/** What the team does (catalog); null for local installs. */
	description: string | null;
	/** When to start this team, and when to start another one instead (team.yml, the realm's version). */
	use_when: string[];
	not_for: string[];
	/** The inputs a run must be given. */
	required_inputs: Array<{ name: string; description: string | null }>;
}

export interface Realm_teams_data {
	/** Columns the BFF can sort this list by. */
	sortable?: string[];
	realm: { id: string; slug: string; name: string; org_slug: string | null };
	items: Realm_team_row[];
	total: number;
	offset: number;
	limit: number;
	/** The realm's teams as their installed tree (S9); null/absent when the BFF couldn't build it. */
	tree?: Team_tree_node[] | null;
}

/** "3/3", "1/3", "0/3" — or "no daemons online". */
export function coverage_text(r: Pick<Realm_team_row, 'installed_count' | 'online_daemon_count'>): string {
	if (!r.online_daemon_count) return 'no daemons online';
	return `${Math.min(r.installed_count, r.online_daemon_count)}/${r.online_daemon_count}`;
}
