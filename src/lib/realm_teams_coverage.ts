export interface Realm_daemon_for_coverage {
	id: string;
	status: 'online' | 'stale' | 'offline' | string;
	name?: string | null;
}

export interface Realm_team_row_raw {
	scope: string;
	slug: string;
	daemon_id?: string | null;
	version?: string | null;
	id?: string;
}

export type Team_origin = 'published' | 'local';

export interface Realm_team_coverage {
	scope: string;
	slug: string;
	label: string;
	/** Distinct daemons in the realm that have this team installed. */
	installed_daemon_ids: string[];
	installed_count: number;
	online_daemon_count: number;
	coverage_label: string;
	version: string | null;
	/** Prefer a Hub team row id when present (any daemon copy). */
	sample_team_id: string | null;
	/** Whether this team exists in the published registry. */
	origin: Team_origin;
	/** Whether this team is on the realm's declarative team list. */
	in_team_list?: boolean;
	/** Unix-ms timestamp of the most recent run, or null if never run. */
	last_run_at?: number | null;
	/** Agent names referenced by this team that are not registered in the org. */
	missing_agents?: string[];
}

/**
 * Collapse per-daemon team rows into realm coverage rows.
 * Only counts installs on daemons that belong to the realm set.
 *
 * @param published_set  Set of `scope/slug` keys that exist in the
 *                       published registry (used to tag origin).
 */
export function aggregate_realm_teams(
	daemons: Realm_daemon_for_coverage[],
	teams: Realm_team_row_raw[],
	published_set: Set<string> = new Set(),
): Realm_team_coverage[] {
	const daemon_ids = new Set(daemons.map((d) => d.id));
	const online_count = daemons.filter((d) => d.status === 'online').length;

	const by_key = new Map<string, {
		scope: string;
		slug: string;
		daemon_ids: Set<string>;
		version: string | null;
		sample_team_id: string | null;
	}>();

	for (const team of teams) {
		const scope = (team.scope ?? '').trim();
		const slug = (team.slug ?? '').trim();
		if (!scope || !slug) continue;
		const daemon_id = team.daemon_id?.trim() || '';
		if (!daemon_id || !daemon_ids.has(daemon_id)) continue;

		const key = `${scope}/${slug}`;
		let row = by_key.get(key);
		if (!row) {
			row = {
				scope,
				slug,
				daemon_ids: new Set(),
				version: team.version ?? null,
				sample_team_id: team.id ?? null,
			};
			by_key.set(key, row);
		}
		row.daemon_ids.add(daemon_id);
		if (!row.version && team.version) row.version = team.version;
		if (!row.sample_team_id && team.id) row.sample_team_id = team.id;
	}

	return [...by_key.values()]
		.map((row) => {
			const installed_count = row.daemon_ids.size;
			const key = `${row.scope}/${row.slug}`;
			const coverage_label = online_count === 0
				? `${installed_count}/0`
				: `${installed_count}/${online_count} online`;
			return {
				scope: row.scope,
				slug: row.slug,
				label: `@${row.scope}/${row.slug}`,
				installed_daemon_ids: [...row.daemon_ids],
				installed_count,
				online_daemon_count: online_count,
				coverage_label,
				version: row.version,
				sample_team_id: row.sample_team_id,
				origin: published_set.has(key) ? 'published' as const : 'local' as const,
			};
		})
		.sort((a, b) => a.label.localeCompare(b.label));
}

/** Parse `key=value` lines into a flat inputs object. Blank lines skipped. */
export function parse_run_inputs_text(raw: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const line of raw.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const eq = trimmed.indexOf('=');
		if (eq <= 0) continue;
		const key = trimmed.slice(0, eq).trim();
		const value = trimmed.slice(eq + 1).trim();
		if (!key) continue;
		out[key] = value;
	}
	return out;
}

/** Query value for Runs `?team=` filter. */
export function team_filter_param(scope: string, slug: string): string {
	return `${scope}/${slug}`;
}
