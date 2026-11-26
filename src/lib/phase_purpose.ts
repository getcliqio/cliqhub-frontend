/**
 * "What this phase does" — one sentence per phase on the run page (PLAN-run-page S1).
 *
 * The team's own `description` when it has one. Otherwise a sentence built only from what team.yml
 * declares (type, agent, what it checks, where it sends work back and how often, its commands, its hug),
 * marked `derived` so the page can say so. Never the first line of a role brief (usually a heading).
 */
import type { Run_phase_def } from '@/lib/realm_inbox';

export interface Phase_purpose {
	text: string;
	/** True when built from the team's structure, not the team's own words. */
	derived: boolean;
}

const CONNECTORS: Record<string, string> = {
	git: 'Works with git', jira: 'Reads or writes Jira', confluence: 'Reads or writes Confluence', slack: 'Posts to Slack',
	email: 'Sends email', s3: 'Moves files in S3', gdrive: 'Moves files in Google Drive', curl: 'Calls an HTTP API',
	hubspot: 'Reads or writes HubSpot', datadog: 'Reads from Datadog',
};
const LLM = new Set(['claude-code', 'cursor', 'codex', 'gemini', 'claude-api', 'openai-api', 'gemini-api']);

function list(xs: string[], max = 2): string {
	if (xs.length <= max) return xs.join(' and ');
	return `${xs.slice(0, max).join(', ')} and ${xs.length - max} more`;
}

/** The first word or two of a command ("pytest tests/x" → "pytest"). */
function command_head(c: string): string {
	const words = c.trim().split(/\s+/);
	const skip = new Set(['npx', 'npm', 'python', 'python3', 'node', 'uv', 'poetry', 'bash', 'sh']);
	return skip.has(words[0]) && words[1] ? `${words[0]} ${words[1]}` : words[0] ?? c;
}

/**
 * The sentence for one phase. `def` may be missing (an older BFF, or a phase outside the version):
 * then only the agent name is known.
 */
export function phase_purpose(def: Run_phase_def | null | undefined, agent?: string | null): Phase_purpose {
	if (def?.description) return { text: def.description, derived: false };
	const a = def?.agent ?? agent ?? null;
	if (!def) return { text: a ? `Runs ${a}` : 'No description', derived: true };
	if (def.type === 'gate' || def.route_targets.length) {
		const checks = def.depends_on.length ? list(def.depends_on) : 'the work before it';
		const back = def.route_targets.length
			? `; sends it back to ${list(def.route_targets)} with the problems${def.max_iterations ? `, up to ${def.max_iterations} times` : ''}`
			: '';
		const who = def.hug || a === 'hug' ? 'A person checks' : 'Checks';
		return { text: `Gate. ${who} ${checks}${back}`, derived: true };
	}
	if (def.hug || a === 'hug') return { text: def.hug && def.hug !== 'approval' ? `Asks a person (${def.hug})` : 'Asks a person to approve before it goes on', derived: true };
	if (def.type === 'team' || def.team) return { text: `Runs the sub-team ${def.team ?? ''}`.trim(), derived: true };
	if (def.commands.length) return { text: `Runs ${list(def.commands.map(command_head))}`, derived: true };
	if (a && CONNECTORS[a]) return { text: CONNECTORS[a], derived: true };
	if (a && LLM.has(a)) return { text: `AI agent (${a})${def.depends_on.length ? `, working from ${list(def.depends_on)}` : ''}`, derived: true };
	return { text: a ? `Runs ${a}` : 'No description', derived: true };
}
