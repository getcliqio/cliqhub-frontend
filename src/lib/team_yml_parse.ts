import yaml from 'js-yaml';
import type { GeneratedAgent, GeneratedPhase, GeneratedTeam } from '@/lib/builder/store';
import type { SourceEntry, TargetEntry } from '@/lib/types';

function as_string(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;
	const trimmed = value.trim();
	if (!trimmed) return undefined;
	return trimmed;
}

function as_string_list(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean);
}

function map_commands(raw: unknown): GeneratedPhase['commands'] {
	if (!Array.isArray(raw)) return undefined;
	const commands: NonNullable<GeneratedPhase['commands']> = [];
	for (const item of raw) {
		if (!item || typeof item !== 'object') continue;
		const row = item as Record<string, unknown>;
		const name = as_string(row.name);
		const run = typeof row.run === 'string' ? row.run : '';
		if (!name) continue;
		const command: NonNullable<GeneratedPhase['commands']>[number] = { name, run };
		const scope = as_string(row.scope);
		if (scope) command.scope = scope;
		if (row.escalate_on_fail === false) command.escalate_on_fail = false;
		commands.push(command);
	}
	if (commands.length === 0) return undefined;
	return commands;
}

function map_sources(raw: unknown): SourceEntry[] | undefined {
	if (!Array.isArray(raw)) return undefined;
	const sources: SourceEntry[] = [];
	for (const item of raw) {
		if (!item || typeof item !== 'object') continue;
		const row = item as Record<string, unknown>;
		const name = as_string(row.name);
		if (!name) continue;
		const entry: SourceEntry = { name };
		const url = as_string(row.url);
		const ref = as_string(row.ref);
		if (url) entry.url = url;
		if (ref) entry.ref = ref;
		sources.push(entry);
	}
	if (sources.length === 0) return undefined;
	return sources;
}

function map_targets(raw: unknown): TargetEntry[] | undefined {
	if (!Array.isArray(raw)) return undefined;
	const targets: TargetEntry[] = [];
	for (const item of raw) {
		if (!item || typeof item !== 'object') continue;
		const row = item as Record<string, unknown>;
		const name = as_string(row.name);
		if (!name) continue;
		const entry: TargetEntry = {
			name,
			file: as_string(row.file) ?? '',
		};
		const url = as_string(row.url);
		const ref = as_string(row.ref);
		const mode = as_string(row.mode);
		if (url) entry.url = url;
		if (ref) entry.ref = ref;
		if (mode === 'create' || mode === 'append' || mode === 'replace') entry.mode = mode;
		targets.push(entry);
	}
	if (targets.length === 0) return undefined;
	return targets;
}

function map_review(raw: unknown): GeneratedPhase['review'] {
	if (!raw || typeof raw !== 'object') return undefined;
	const row = raw as Record<string, unknown>;
	const review: NonNullable<GeneratedPhase['review']> = {};
	const reviewer = as_string(row.reviewer);
	if (reviewer) review.reviewer = reviewer;
	const artifacts = as_string_list(row.artifacts);
	if (artifacts.length > 0) review.artifacts = artifacts;
	const timeout = as_string(row.timeout);
	if (timeout) review.timeout = timeout;
	const remind_every = as_string(row.remind_every);
	if (remind_every) review.remind_every = remind_every;
	if (Object.keys(review).length === 0) return undefined;
	return review;
}

function map_phase(raw: unknown, is_support: boolean): GeneratedPhase | null {
	if (!raw || typeof raw !== 'object') return null;
	const row = raw as Record<string, unknown>;
	const name = as_string(row.name);
	if (!name) return null;

	const type_raw = as_string(row.type) ?? 'standard';
	const type = (['standard', 'gate', 'team'].includes(type_raw)
		? type_raw
		: 'standard') as GeneratedPhase['type'];

	const depends_on = Array.isArray(row.depends_on)
		? as_string_list(row.depends_on)
		: typeof row.depends_on === 'string'
			? row.depends_on.split(',').map((d) => d.trim()).filter(Boolean)
			: [];

	const phase: GeneratedPhase = {
		name,
		type,
		depends_on,
		...(is_support ? { is_support: true } : {}),
	};

	const agent = as_string(row.agent);
	if (agent) phase.agent = agent;

	const commands = map_commands(row.commands);
	if (commands) phase.commands = commands;

	if (typeof row.max_iterations === 'number' && Number.isFinite(row.max_iterations)) {
		phase.max_iterations = row.max_iterations;
	}

	const sources = map_sources(row.sources);
	if (sources) phase.sources = sources;

	const target_entries = map_targets(row.target_entries);
	if (target_entries) phase.target_entries = target_entries;

	const action = as_string(row.action);
	if (action) phase.action = action;

	const model = as_string(row.model);
	if (model) phase.model = model;

	const review = map_review(row.review);
	if (review) phase.review = review;

	const team = as_string(row.team);
	if (team) phase.team = team;

	if (row.inputs && typeof row.inputs === 'object' && !Array.isArray(row.inputs)) {
		const inputs: Record<string, string> = {};
		for (const [key, value] of Object.entries(row.inputs as Record<string, unknown>)) {
			if (typeof value === 'string') inputs[key] = value;
		}
		if (Object.keys(inputs).length > 0) phase.inputs = inputs;
	}

	return phase;
}

function map_agents(raw: unknown): GeneratedAgent[] {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
	const agents: GeneratedAgent[] = [];
	for (const [name, def] of Object.entries(raw as Record<string, unknown>)) {
		if (!def || typeof def !== 'object') {
			agents.push({ name });
			continue;
		}
		const row = def as Record<string, unknown>;
		agents.push({
			name,
			entry: as_string(row.entry),
			env: as_string_list(row.env),
		});
	}
	return agents;
}

function map_inputs(raw: unknown): GeneratedTeam['inputs'] {
	if (!Array.isArray(raw)) return undefined;
	const inputs: NonNullable<GeneratedTeam['inputs']> = [];
	for (const item of raw) {
		if (!item || typeof item !== 'object') continue;
		const row = item as Record<string, unknown>;
		const name = as_string(row.name);
		if (!name) continue;
		inputs.push({
			name,
			description: as_string(row.description),
		});
	}
	if (inputs.length === 0) return undefined;
	return inputs;
}

export interface Parse_team_yml_result {
	team: GeneratedTeam;
	error: string | null;
}

/**
 * Parse team.yml text into a GeneratedTeam.
 * Workflow is the top-level ordered `phases` array (plus optional `support`).
 * Nested `workflow:` is rejected.
 * Name/version stay locked to the existing team identity.
 */
export function parse_team_yml_text(
	text: string,
	existing_team: GeneratedTeam,
): Parse_team_yml_result {
	let doc: unknown;
	try {
		doc = yaml.load(text);
	} catch (err) {
		return {
			team: existing_team,
			error: err instanceof Error ? err.message : 'Invalid YAML',
		};
	}

	if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
		return { team: existing_team, error: 'team.yml must be a YAML mapping' };
	}

	const root = doc as Record<string, unknown>;

	if (root.workflow != null && !Array.isArray(root.phases)) {
		return {
			team: existing_team,
			error: 'Use top-level phases: as an ordered list. Nested workflow: is not supported.',
		};
	}

	if (!Array.isArray(root.phases)) {
		return {
			team: existing_team,
			error: 'phases: is required — it is the ordered workflow.',
		};
	}

	const main_phases: GeneratedPhase[] = [];
	for (const item of root.phases) {
		const phase = map_phase(item, false);
		if (phase) main_phases.push(phase);
	}

	const support_phases: GeneratedPhase[] = [];
	if (Array.isArray(root.support)) {
		for (const item of root.support) {
			const phase = map_phase(item, true);
			if (phase) support_phases.push(phase);
		}
	}

	const phases = [...main_phases, ...support_phases];
	if (phases.length === 0) {
		return {
			team: existing_team,
			error: 'phases: must contain at least one phase',
		};
	}

	const description = as_string(root.description) ?? existing_team.description;
	const tags = Array.isArray(root.tags) ? as_string_list(root.tags) : existing_team.tags;
	const inputs = map_inputs(root.inputs) ?? existing_team.inputs;
	const use_when = Array.isArray(root.use_when) ? as_string_list(root.use_when) : existing_team.use_when;
	const not_for = Array.isArray(root.not_for) ? as_string_list(root.not_for) : existing_team.not_for;
	const agents = root.agents != null ? map_agents(root.agents) : existing_team.agents;

	const roles = existing_team.roles.filter((role) =>
		phases.some((phase) => phase.name === role.name),
	);

	return {
		team: {
			name: existing_team.name,
			description,
			version: existing_team.version,
			tags,
			inputs,
			use_when,
			not_for,
			phases,
			roles,
			agents,
		},
		error: null,
	};
}
