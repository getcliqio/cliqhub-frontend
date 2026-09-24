/** Display name for a run row — prefer run_name, else shortened run_id (slug-like id). */
export function display_run_name(run: {
	run_id: string;
	run_name?: string | null;
}): string {
	const name = (run.run_name ?? '').trim();
	if (name) return name;
	const id = run.run_id;
	if (id.length <= 12) return id;
	return `${id.slice(0, 8)}…`;
}

/** True if run belongs to team filter `scope/slug` (with or without leading @). */
export function run_matches_team_filter(
	team_label: string | null | undefined,
	team_filter: string,
): boolean {
	const filter = team_filter.trim().replace(/^@/, '').toLowerCase();
	if (!filter) return true;
	const label = (team_label ?? '').trim().replace(/^@/, '').toLowerCase();
	if (!label) return false;
	return label === filter || label.endsWith(`/${filter}`) || label.includes(filter);
}

export type Runs_sort_by =
	| 'run_name'
	| 'state'
	| 'team'
	| 'started_at'
	| 'last_updated_at';
export type Runs_sort_dir = 'asc' | 'desc';

export interface Runs_url_state {
	team?: string;
	state?: string;
	daemon?: string;
	q?: string;
	offset?: number;
	sort_by?: Runs_sort_by;
	sort_dir?: Runs_sort_dir;
}

export function build_runs_search_params(opts: Runs_url_state): URLSearchParams {
	const next = new URLSearchParams();
	const team = opts.team?.trim() ?? '';
	const state = opts.state?.trim() ?? '';
	const daemon = opts.daemon?.trim() ?? '';
	const q = opts.q?.trim() ?? '';
	if (team) next.set('team', team);
	if (state) next.set('state', state);
	if (daemon) next.set('daemon', daemon);
	if (q) next.set('q', q);
	if (opts.offset && opts.offset > 0) next.set('offset', String(opts.offset));
	// Only persist sort in URL when it deviates from the default.
	if (opts.sort_by && opts.sort_by !== 'last_updated_at') next.set('sort_by', opts.sort_by);
	if (opts.sort_dir && opts.sort_dir !== 'desc') next.set('sort_dir', opts.sort_dir);
	return next;
}

export function parse_runs_sort(params: URLSearchParams): {
	sort_by: Runs_sort_by;
	sort_dir: Runs_sort_dir;
} {
	const raw_by = params.get('sort_by') ?? '';
	const raw_dir = (params.get('sort_dir') ?? '').toLowerCase();
	const valid_by: Runs_sort_by[] = [
		'run_name', 'state', 'team', 'started_at', 'last_updated_at',
	];
	const sort_by: Runs_sort_by = (valid_by as string[]).includes(raw_by)
		? (raw_by as Runs_sort_by)
		: 'last_updated_at';
	const sort_dir: Runs_sort_dir = raw_dir === 'asc' ? 'asc' : 'desc';
	return { sort_by, sort_dir };
}
