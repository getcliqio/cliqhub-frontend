/**
 * Phase kinds as people think about them, mapped onto the team model
 * (type + agent), which is what team.yml and Core understand.
 *
 *   agent      type standard + an LLM agent        role brief required
 *   script     type standard + agent exec          commands, no role
 *   connector  type standard + connector agent     action + sources/targets, no role
 *   fetch      type standard + agent curl          URLs in/out, no role
 *   gate       type gate + LLM agent               checks (commands), role optional
 *   human      type gate + agent hug               review.reviewer, role optional (guidance)
 *   team       type team                           sub-team ref + inputs, role optional (spec)
 *
 * Mirrors Core's validate_team and the builder's agent_schema.
 */
import type { GeneratedPhase, GeneratedTeam } from '@/lib/builder/store';

export type Kind_id = 'agent' | 'script' | 'connector' | 'fetch' | 'gate' | 'human' | 'team';

/** Keep in sync with Core BUILTIN_AGENT_NAMES. */
export const BUILTIN_AGENTS = new Set([
	'claude-api', 'claude-code', 'codex', 'confluence', 'curl', 'cursor', 'datadog', 'exec',
	'gdrive', 'gemini', 'gemini-api', 'hubspot', 'hug', 'jira', 'mesh', 'openai-api', 's3', 'team', 'zendesk',
]);
export const CONNECTOR_AGENTS = ['jira', 'confluence', 'zendesk', 'datadog', 'hubspot', 'gdrive', 's3', 'mesh'] as const;
const CONNECTOR_SET = new Set<string>(CONNECTOR_AGENTS);
export const LLM_AGENTS = ['claude-code', 'cursor', 'codex', 'gemini', 'claude-api', 'gemini-api', 'openai-api'] as const;
const NON_LLM = new Set(['exec', 'curl', 'hug', 'team', ...CONNECTOR_AGENTS]);

export interface Kind_meta {
	id: Kind_id;
	label: string;
	blurb: string;
	color: string;
	glyph: string;
	/** Whether this kind has a role brief. */
	role: 'required' | 'optional' | 'none';
	role_label: string;
}

export const KINDS: Record<Kind_id, Kind_meta> = {
	agent: { id: 'agent', label: 'Agent', blurb: 'an AI agent with a role brief', color: '#9b8cff', glyph: '✦', role: 'required', role_label: 'Role brief' },
	script: { id: 'script', label: 'Script', blurb: 'runs shell commands', color: '#8b93a1', glyph: '$', role: 'none', role_label: '' },
	connector: { id: 'connector', label: 'Connector', blurb: 'Jira, Drive, S3, Zendesk…', color: '#2dd4bf', glyph: '⇅', role: 'none', role_label: '' },
	fetch: { id: 'fetch', label: 'Fetch', blurb: 'download or post to URLs', color: '#2dd4bf', glyph: '↓', role: 'none', role_label: '' },
	gate: { id: 'gate', label: 'Gate', blurb: 'checks · pass or route back', color: '#f5a524', glyph: '◆', role: 'optional', role_label: 'Verdict criteria' },
	human: { id: 'human', label: 'Human review', blurb: 'a person signs off', color: '#ff7ad9', glyph: '◉', role: 'optional', role_label: 'What good looks like' },
	team: { id: 'team', label: 'Sub-team', blurb: 'calls another team', color: '#5b9dff', glyph: '▣', role: 'optional', role_label: 'What the sub-team should do' },
};
export const PALETTE: Kind_id[] = ['agent', 'gate', 'human', 'connector', 'script', 'fetch', 'team'];

export function is_llm_agent(agent: string | undefined, team?: Pick<GeneratedTeam, 'agents'>): boolean {
	if (!agent) return true; // unset → the agent's default LLM
	if (NON_LLM.has(agent)) return false;
	return (LLM_AGENTS as readonly string[]).includes(agent) || Boolean(team?.agents.some((a) => a.name === agent)) || !BUILTIN_AGENTS.has(agent);
}

export function kind_of(p: Pick<GeneratedPhase, 'type' | 'agent'>): Kind_id {
	if (p.type === 'team') return 'team';
	if (p.type === 'gate') return p.agent === 'hug' ? 'human' : 'gate';
	if (p.agent === 'exec') return 'script';
	if (p.agent === 'curl') return 'fetch';
	if (p.agent && CONNECTOR_SET.has(p.agent)) return 'connector';
	return 'agent';
}

export function kind_meta(p: Pick<GeneratedPhase, 'type' | 'agent'>): Kind_meta {
	return KINDS[kind_of(p)];
}

/** Does this phase (as configured) use a role brief, and is it required? */
export function role_need(p: GeneratedPhase): 'required' | 'optional' | 'none' {
	return KINDS[kind_of(p)].role;
}

const BASE: Record<Kind_id, string> = { agent: 'agent', script: 'script', connector: 'connector', fetch: 'fetch', gate: 'check', human: 'review', team: 'sub-team' };

export function unique_name(base: string, taken: Iterable<string>): string {
	const set = new Set(taken);
	const clean = base.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'phase';
	if (!set.has(clean)) return clean;
	for (let i = 2; ; i++) if (!set.has(`${clean}-${i}`)) return `${clean}-${i}`;
}

/** The first LLM agent the team already uses, else claude-code. */
export function default_llm_agent(team: GeneratedTeam): string {
	for (const p of team.phases) if (p.agent && kind_of(p) === 'agent') return p.agent;
	return 'claude-code';
}

/** A new phase of `kind` with sensible defaults (never pending). */
export function new_phase(kind: Kind_id, team: GeneratedTeam, depends_on: string[] = []): GeneratedPhase {
	const name = unique_name(BASE[kind], team.phases.map((p) => p.name));
	const base: GeneratedPhase = { name, type: 'standard', depends_on };
	switch (kind) {
		case 'agent': return { ...base, agent: default_llm_agent(team) };
		case 'script': return { ...base, agent: 'exec', commands: [{ name: 'run', run: '' }] };
		case 'connector': return { ...base, agent: 'jira', action: '', sources: [{ name: 'source', url: '' }] };
		case 'fetch': return { ...base, agent: 'curl', sources: [{ name: 'source', url: '' }] };
		case 'gate': return { ...base, type: 'gate', agent: default_llm_agent(team), commands: [{ name: 'test', run: 'npm test' }], max_iterations: 3 };
		case 'human': return { ...base, type: 'gate', agent: 'hug', review: { reviewer: '' } };
		case 'team': return { ...base, type: 'team', team: '' };
	}
}

/** Starter role text for kinds that have one. */
export function starter_role(kind: Kind_id, name: string): string {
	if (kind === 'agent') return `# ${name}\n\nYou are the ${name}. Describe what this phase should produce, what it reads, and what it must not do.\n`;
	return '';
}
