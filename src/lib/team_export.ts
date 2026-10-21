import JSZip from 'jszip';
import yaml from 'js-yaml';
import { map_phase, team_fields_of } from '@/lib/team_yml_parse';
import type { SourceEntry, TargetEntry } from '@/lib/types';

/** HUG review configuration for export. */
export interface ExportReviewBlock {
	reviewer?: string | string[];
	artifacts?: string[];
	timeout?: string;
	remind_every?: string;
}

export interface ExportPhase {
	name: string;
	type: string;
	depends_on: string[];
	commands?: { name: string; run: string; scope?: string; escalate_on_fail?: boolean }[];
	max_iterations?: number;
	agent?: string;
	sources?: SourceEntry[];
	target_entries?: TargetEntry[];
	action?: string;
	model?: string;
	review?: ExportReviewBlock;
	team?: string;
	inputs?: Record<string, string>;
	is_support?: boolean;
	/** The phase as written in team.yml when opened (kept on save). */
	source?: Record<string, unknown>;
}

export interface ExportAgent {
	name: string;
	entry?: string;
	env?: string[];
}

export interface ExportRole {
	name: string;
	content: string;
}

export interface ExportTeamData {
	name: string;
	description: string;
	tags?: string[];
	inputs?: { name: string; description?: string }[];
	use_when?: string[];
	not_for?: string[];
	phases: ExportPhase[];
	roles: ExportRole[];
	agents?: ExportAgent[];
	/** team.yml as opened (parsed), and its text. */
	source?: Record<string, unknown>;
	source_text?: string;
}

type Rec = Record<string, unknown>;

/** Same value, whatever the key order. */
function same(a: unknown, b: unknown): boolean {
	const norm = (v: unknown): unknown => {
		if (Array.isArray(v)) return v.map(norm);
		if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v as Rec).sort().filter((k) => (v as Rec)[k] !== undefined).map((k) => [k, norm((v as Rec)[k])]));
		return v ?? null;
	};
	return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

/** Sets `key`, or removes it when the value is empty. */
function put(out: Rec, key: string, value: unknown): void {
	if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) delete out[key];
	else out[key] = value;
}

/**
 * One field: what team.yml had (`raw`) when the builder's value (`now`) still equals what the builder read
 * from it (`was`); otherwise the builder's value, written by `write` (which may keep parts of `raw`).
 */
function field<T>(raw: unknown, now: T, was: T, write: (v: T, raw: unknown) => unknown = (v) => v): unknown {
	return same(now, was) ? raw : write(now, raw);
}

/** A list of named rows: each row keeps what team.yml had for it, plus the builder's changes. */
function rows<T extends { name?: string }>(now: T[] | undefined, was: T[] | undefined, raw: unknown, write: (v: T) => Rec, key: (v: T, i: number) => string = (v) => v.name ?? ''): Rec[] | undefined {
	if (!now?.length) return undefined;
	const raw_list = Array.isArray(raw) ? raw as Rec[] : [];
	return now.map((item, i) => {
		const k = key(item, i);
		const at = (was ?? []).findIndex((w, j) => key(w, j) === k);
		const raw_item = at >= 0 && raw_list[at] && typeof raw_list[at] === 'object' ? raw_list[at] : null;
		if (raw_item && same(item, was![at])) return raw_item;
		const out: Rec = { ...(raw_item ?? {}) };
		for (const [f, v] of Object.entries(write(item))) put(out, f, v);
		return out;
	});
}

const review_yaml = (r: ExportReviewBlock, raw: unknown): Rec => {
	const src = raw && typeof raw === 'object' ? raw as Rec : {};
	const out: Rec = { ...src };
	const reviewers = (Array.isArray(r.reviewer) ? r.reviewer : r.reviewer ? [r.reviewer] : [])
		.flatMap((x) => x.split(',')).map((x) => x.trim()).filter(Boolean);
	// The HUG gate reads reviewer groups: any one of these channels may decide.
	delete out.reviewer;
	put(out, 'reviewers', reviewers.length ? [{ policy: 'any', channels: reviewers }] : undefined);
	put(out, 'artifacts', r.artifacts);
	put(out, 'timeout', r.timeout);
	put(out, 'remind_every', r.remind_every);
	return out;
};

/** The usual order of team.yml keys; anything else follows, as written. */
const TEAM_KEYS = ['name', 'version', 'description', 'tags', 'inputs', 'outputs', 'use_when', 'not_for', 'tools', 'cliq_version', 'agents', 'phases', 'support'];
const PHASE_KEYS = ['name', 'description', 'type', 'agent', 'depends_on', 'when', 'commands', 'max_iterations', 'timeout', 'action', 'model', 'sources', 'target_entries', 'review', 'hug', 'team', 'args', 'output', 'route_targets', 'over', 'over_file', 'over_field', 'key', 'concurrency'];

function ordered(out: Rec, keys: string[]): Rec {
	const first = keys.filter((k) => k in out).map((k) => [k, out[k]] as const);
	const rest = Object.entries(out).filter(([k]) => !keys.includes(k));
	return Object.fromEntries([...first, ...rest]);
}

/** One phase as team.yml: what it had when opened, plus what was changed in the builder. */
function phase_doc(p: ExportPhase): Rec {
	const raw = p.source ?? {};
	const was = (p.source ? map_phase(p.source, Boolean(p.is_support)) : null) ?? ({ depends_on: [] } as Partial<ExportPhase>);
	const out: Rec = p.source ? { ...raw } : {};
	out.name = p.name;
	put(out, 'type', field(raw.type, p.type, was.type));
	put(out, 'agent', field(raw.agent, p.agent, was.agent));
	put(out, 'depends_on', field(raw.depends_on, p.depends_on, was.depends_on));
	put(out, 'commands', field(raw.commands, p.commands, was.commands, (v, r) => rows(v, was.commands, r, (c) => ({ name: c.name || undefined, run: c.run, scope: c.scope, escalate_on_fail: c.escalate_on_fail }), (_c, i) => String(i))));
	put(out, 'max_iterations', field(raw.max_iterations, p.max_iterations, was.max_iterations));
	put(out, 'action', field(raw.action, p.action, was.action));
	put(out, 'model', field(raw.model, p.model, was.model));
	put(out, 'sources', field(raw.sources, p.sources, was.sources, (v, r) => rows(v, was.sources, r, (e) => ({ name: e.name, url: e.url, ref: e.ref }))));
	put(out, 'target_entries', field(raw.target_entries, p.target_entries, was.target_entries, (v, r) => rows(v, was.target_entries, r, (e) => ({ name: e.name, file: e.file, url: e.url, ref: e.ref, mode: e.mode && e.mode !== 'create' ? e.mode : undefined }))));
	put(out, 'review', field(raw.review, p.review, was.review, (v, r) => (v ? review_yaml(v, r) : undefined)));
	put(out, 'team', field(raw.team, p.team, was.team));
	// A team phase's values for its sub-team go in `args`; values the builder can't show (not text) stay.
	put(out, 'args', field(raw.args, p.inputs, was.inputs, (v, r) => {
		const keep = r && typeof r === 'object' ? Object.fromEntries(Object.entries(r as Rec).filter(([, x]) => typeof x !== 'string')) : {};
		const merged = { ...keep, ...(v ?? {}) };
		return Object.keys(merged).length ? merged : undefined;
	}));
	return ordered(out, PHASE_KEYS);
}

/** The team as a team.yml mapping: what it had when opened, plus what was changed in the builder. */
export function team_doc(team: ExportTeamData): Rec {
	const raw = team.source ?? {};
	const was = team.source ? team_fields_of(team.source) : { description: '', agents: [] as ExportAgent[] } as ReturnType<typeof team_fields_of>;
	const clean_name = team.name.replace(/^@[^/]+\//, '');
	const out: Rec = team.source ? { ...raw } : {};
	// The name stays as written (e.g. `@scope/name`) unless the team was renamed.
	out.name = typeof raw.name === 'string' && raw.name.replace(/^@[^/]+\//, '') === clean_name ? raw.name : clean_name;
	put(out, 'description', field(raw.description, team.description, was.description));
	put(out, 'tags', field(raw.tags, team.tags, was.tags));
	put(out, 'inputs', field(raw.inputs, team.inputs, was.inputs, (v, r) => rows(v, was.inputs, r, (i) => ({ name: i.name, description: i.description }))));
	put(out, 'use_when', field(raw.use_when, team.use_when, was.use_when));
	put(out, 'not_for', field(raw.not_for, team.not_for, was.not_for));
	put(out, 'agents', field(raw.agents, team.agents ?? [], was.agents, (v, r) => {
		const src = r && typeof r === 'object' && !Array.isArray(r) ? r as Rec : {};
		if (!v.length) return undefined;
		return Object.fromEntries(v.map((a) => {
			const o: Rec = { ...(src[a.name] && typeof src[a.name] === 'object' ? src[a.name] as Rec : {}) };
			put(o, 'entry', a.entry);
			put(o, 'env', a.env);
			return [a.name, o];
		}));
	}));
	out.phases = team.phases.filter((p) => !p.is_support).map(phase_doc);
	put(out, 'support', team.phases.filter((p) => p.is_support).map(phase_doc));
	return ordered(out, TEAM_KEYS);
}

/**
 * team.yml for a team. A team opened from team.yml and not changed is returned exactly as it was
 * (comments too); otherwise it is the opened file with the builder's changes, nothing else dropped.
 */
export function build_team_yml(team: ExportTeamData): string {
	const doc = team_doc(team);
	if (team.source_text) {
		try { if (same(doc, yaml.load(team.source_text))) return team.source_text; } catch { /* written below */ }
	}
	return yaml.dump(doc, { lineWidth: -1, noRefs: true });
}

export async function generate_team_zip(team: ExportTeamData): Promise<Blob> {
	const zip = new JSZip();

	zip.file('team.yml', build_team_yml(team));

	const roles_folder = zip.folder('roles')!;
	for (const role of team.roles) {
		roles_folder.file(`${role.name}.md`, role.content);
	}

	if (team.agents?.length) {
		const agents_obj: Record<string, Record<string, unknown>> = {};
		for (const a of team.agents) {
			const def: Record<string, unknown> = {};
			if (a.entry) def.entry = a.entry;
			if (a.env?.length) def.env = a.env;
			agents_obj[a.name] = def;
		}
		zip.file('agents.json', JSON.stringify(agents_obj, null, 2));
	}

	return zip.generateAsync({ type: 'blob' });
}
