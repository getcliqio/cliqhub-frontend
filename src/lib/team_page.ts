import { KINDS as BUILDER_KINDS, kind_of, type Kind_id } from '@/lib/builder/kinds';

/**
 * Build › Teams — types for `POST /v1/team_list/get` and `POST /v1/team_page/get`,
 * plus the workflow-graph layout (pure, tested).
 */

export interface Team_phase {
	name: string;
	type: string;
	agent: string | null;
	depends_on: string[];
	review: boolean;
	reviewers: string | null;
	max_iterations: number | null;
	commands: string[];
	sources: string[];
	targets: string[];
	team: string | null;
	role: string | null;
	support: boolean;
}

export interface Team_input { name: string; description: string | null; required: boolean; default: string | null }

export interface Team_install {
	realm_id: string;
	realm_slug: string;
	realm_name: string;
	org_slug: string | null;
	version: string | null;
	behind: boolean;
	in_team_list: boolean;
	installed_count: number;
	online_daemon_count: number;
	last_run_at: number | null;
	missing_agents: string[];
}

export interface Team_list_row {
	id: string | null;
	name: string;
	scope: string | null;
	description: string;
	status: 'draft' | 'published';
	latest_version: string | null;
	author: string | null;
	phase_types: string[] | null;
	/** Builder kinds (agent, gate, human, …) — preferred over phase_types when present. */
	phase_kinds?: string[] | null;
	installs: Team_install[];
}

export interface Team_list_data {
	items: Team_list_row[];
	total: number;
	offset: number;
	limit: number;
	counts: { all: number; published: number; draft: number };
	realms_checked: number;
	realms_total: number;
	partial: boolean;
}

export interface Team_release { version: string; changelog: string | null; published_at: number | null; is_latest: boolean }

export interface Team_header {
	id: string;
	name: string;
	scope: string | null;
	label: string;
	description: string;
	status: 'draft' | 'published';
	latest_version: string | null;
	version: string | null;
	versions: Team_release[];
	author: string | null;
	listed: boolean;
	tags: string[];
	can_edit: boolean;
	can_delete: boolean;
	can_toggle_listing: boolean;
}

export interface Team_run_row {
	run_id: string;
	run_name: string | null;
	team: string | null;
	state: string;
	current_phase: string | null;
	daemon_id: string | null;
	started_at: number | null;
	completed_at: number | null;
	updated_at: number | null;
	error: string | null;
	realm_id: string | null;
	realm_slug: string | null;
	org_slug: string | null;
}

export interface Team_change { kind: 'added' | 'removed' | 'changed'; target: 'phase' | 'role' | 'inputs'; name: string; detail: string }

export type Team_view = 'overview' | 'workflow' | 'files' | 'runs' | 'installs' | 'versions' | 'settings';

export interface Team_page_data {
	team: Team_header;
	counts: { phases: number; versions: number; runs: number | null };
	view: Team_view;
	overview?: { phases: Team_phase[]; support: Team_phase[]; inputs: Team_input[]; agents: string[]; latest: Team_release | null; installs: Team_install[] };
	workflow?: {
		phases: Team_phase[];
		support: Team_phase[];
		recent_runs: Team_run_row[];
		overlay: { run: Team_run_row; version: string | null; phases: Team_phase[] | null; statuses: Record<string, string> } | null;
	};
	files?: { files: Array<{ path: string; kind: 'yaml' | 'md'; content: string }> };
	runs?: {
		items: Team_run_row[];
		total: number;
		offset: number;
		limit: number;
		counts: { all: number | null; running: number | null; awaiting_input: number | null; failed_7d: number | null };
		realms: Array<{ id: string; slug: string; name: string; org_slug: string | null }>;
	};
	installs?: {
		items: Team_install[];
		not_installed: Array<{ id: string; slug: string; name: string; org_slug: string | null }>;
		realms_checked: number;
		realms_total: number;
	};
	versions?: { items: Team_release[]; compare: { from: string; to: string; changes: Team_change[] } | null };
	partial: boolean;
}

// ── phase kinds ──────────────────────────────────────────────────────────

export interface Phase_kind { id: Kind_id | null; color: string; glyph: string; label: string }

/**
 * Phase kinds as the builder names them (see lib/builder/kinds): the kind
 * comes from type + agent — a gate with agent `hug` is a human review, a
 * standard phase with a connector / curl / exec agent is a connector / fetch /
 * script. Older payloads used `pull` / `push` types; those read as connector
 * (or fetch with curl).
 */
const LEGACY: Record<string, Kind_id> = { standard: 'agent', gate: 'gate', pull: 'connector', push: 'connector', team: 'team' };

export function phase_kind_id(p: string | { type: string; agent?: string | null }): Kind_id | null {
	if (typeof p === 'string') return p in BUILDER_KINDS ? (p as Kind_id) : LEGACY[p] ?? null;
	if (p.type === 'pull' || p.type === 'push') return p.agent === 'curl' ? 'fetch' : 'connector';
	if (p.type !== 'standard' && p.type !== 'gate' && p.type !== 'team') return null;
	return kind_of({ type: p.type, agent: p.agent ?? undefined });
}

export function phase_kind(p: string | { type: string; agent?: string | null }): Phase_kind {
	const id = phase_kind_id(p);
	if (!id) return { id: null, color: '#8a8c93', glyph: '•', label: typeof p === 'string' ? p : p.type };
	const k = BUILDER_KINDS[id];
	return { id, color: k.color, glyph: k.glyph, label: k.label.toLowerCase() };
}
/** Kinds shown in legends, in palette order. */
export const LEGEND_KINDS: Kind_id[] = ['agent', 'gate', 'human', 'connector', 'fetch', 'script', 'team'];
/** Review badge on non-human phases that carry a review block (older teams). */
export const REVIEW_COLOR = BUILDER_KINDS.human.color;

/** One-line subtitle for a node. */
export function phase_subtitle(p: Team_phase): string {
	const hosts = (l: string[]) => l.map(source_host).join(', ');
	switch (phase_kind_id(p)) {
		case 'gate': return p.commands.length ? `${p.commands.length} check${p.commands.length === 1 ? '' : 's'}` : p.agent ?? 'gate';
		case 'human': return p.reviewers ? `reviewer · ${p.reviewers}` : 'reviewer set at run';
		case 'connector': return p.sources.length ? hosts(p.sources) : p.targets.length ? hosts(p.targets) : p.agent ?? 'connector';
		case 'fetch': return p.sources.length ? hosts(p.sources) : p.targets.length ? hosts(p.targets) : 'fetch';
		case 'script': return `${p.commands.length} command${p.commands.length === 1 ? '' : 's'}`;
		case 'team': return p.team ?? 'sub-team';
		default: return p.agent ?? 'agent';
	}
}
function source_host(s: string): string {
	const m = /^([a-z][a-z0-9+.-]*):\/\/([^/]*)/i.exec(s);
	if (!m) return s.length > 18 ? `${s.slice(0, 17)}…` : s;
	return m[1] === 'https' || m[1] === 'http' ? m[2] : m[1];
}

/** Map a run-phase status to the overlay dot. */
export function overlay_state(status: string | undefined): 'done' | 'running' | 'waiting' | 'failed' | 'idle' {
	if (!status) return 'idle';
	const s = status.toLowerCase();
	if (['completed', 'done', 'passed', 'success', 'succeeded', 'skipped'].includes(s)) return 'done';
	if (['running', 'active', 'in_progress', 'started'].includes(s)) return 'running';
	if (['awaiting_input', 'awaiting_review', 'waiting', 'review', 'paused', 'blocked'].includes(s)) return 'waiting';
	if (['failed', 'crashed', 'error', 'escalated', 'cancelled'].includes(s)) return 'failed';
	return 'idle';
}

// ── layout ───────────────────────────────────────────────────────────────

export interface Graph_layout {
	/** Column (layer) and row per phase name. */
	pos: Record<string, { col: number; row: number }>;
	cols: number;
	/** Rows per column, centred on 0 (e.g. -0.5, 0.5 for two). */
	rows: number;
	/** Gate → phase it routes back to (the dependency drawn as a loop). */
	loops: Array<{ from: string; to: string; max: number | null }>;
}

/**
 * Layered DAG layout: step (column) = longest path from a root via depends_on;
 * within a step, phases keep their team.yml order, centred. Deterministic, so a
 * team looks the same everywhere and on every load. Unknown dependencies are
 * ignored; cycles are cut.
 */
export function layout_phases(phases: Team_phase[]): Graph_layout {
	const names = new Set(phases.map((p) => p.name));
	const deps = new Map(phases.map((p) => [p.name, p.depends_on.filter((d) => names.has(d) && d !== p.name)]));
	const col = new Map<string, number>();
	const visiting = new Set<string>();
	const depth = (n: string): number => {
		if (col.has(n)) return col.get(n)!;
		if (visiting.has(n)) return 0;
		visiting.add(n);
		const d = deps.get(n) ?? [];
		const c = d.length ? Math.max(...d.map(depth)) + 1 : 0;
		visiting.delete(n);
		col.set(n, c);
		return c;
	};
	phases.forEach((p) => depth(p.name));
	const by_col = new Map<number, string[]>();
	for (const p of phases) {
		const c = col.get(p.name) ?? 0;
		by_col.set(c, [...(by_col.get(c) ?? []), p.name]);
	}
	const cols = by_col.size ? Math.max(...by_col.keys()) + 1 : 0;
	const pos: Graph_layout['pos'] = {};
	let rows = 1;
	// Within a step, phases keep their order in team.yml — the author's order is the layout.
	const index = new Map(phases.map((p, i) => [p.name, i]));
	for (let c = 0; c < cols; c++) {
		const list = (by_col.get(c) ?? []).sort((a, b) => (index.get(a) ?? 0) - (index.get(b) ?? 0));
		rows = Math.max(rows, list.length);
		list.forEach((n, i) => { pos[n] = { col: c, row: i - (list.length - 1) / 2 }; });
	}
	const loops = phases
		.filter((p) => p.type === 'gate' && (p.max_iterations ?? 0) > 0)
		.map((p) => {
			const d = deps.get(p.name) ?? [];
			const kinds = new Map(phases.map((x) => [x.name, x.type]));
			const to = d.find((x) => kinds.get(x) === 'standard') ?? d[0];
			return to ? { from: p.name, to, max: p.max_iterations } : null;
		})
		.filter((x): x is Graph_layout['loops'][number] => Boolean(x));
	return { pos, cols, rows, loops };
}

export function team_href(scope: string | null, name: string, tab?: Team_view): string {
	const base = `/teams/${encodeURIComponent(scope ?? '_')}/${encodeURIComponent(name)}`;
	return tab && tab !== 'overview' ? `${base}?tab=${tab}` : base;
}
