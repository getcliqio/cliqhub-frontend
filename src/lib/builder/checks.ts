/**
 * Instant, local checks for a team — the same rules Core's validate_team
 * applies (plus a few UX ones), run on every edit so the canvas and the YAML
 * editor can show problems where they are. Core validate still runs
 * (debounced) as the final word.
 */
import type { GeneratedTeam } from '@/lib/builder/store';
import { BUILTIN_AGENTS, CONNECTOR_AGENTS, kind_of, role_need } from '@/lib/builder/kinds';
import { PHASE_NAME_RE } from '@/lib/builder/graph_ops';

export interface Problem {
	id: string;
	level: 'error' | 'warning';
	phase: string | null;
	/** team.yml key the problem is about (for locating the line). */
	field: string | null;
	message: string;
	fix?: { label: string; apply: (t: GeneratedTeam) => GeneratedTeam };
}

function lev(a: string, b: string): number {
	const m = a.length; const n = b.length;
	const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
	for (let j = 1; j <= n; j++) d[0][j] = j;
	for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
	return d[m][n];
}
export function closest(name: string, options: string[]): string | null {
	let best: string | null = null; let score = 3;
	for (const o of options) { const s = lev(name, o); if (s < score) { score = s; best = o; } }
	return best;
}

const INPUT_REF = /\$\(inputs\.([a-zA-Z0-9_-]+)\)/g;
function refs_in(s: unknown, out: Set<string>) {
	if (typeof s === 'string') { for (const m of s.matchAll(INPUT_REF)) out.add(m[1]); return; }
	if (Array.isArray(s)) s.forEach((x) => refs_in(x, out));
	else if (s && typeof s === 'object') Object.values(s).forEach((x) => refs_in(x, out));
}

export function find_cycle(team: GeneratedTeam): string[] | null {
	const deps = new Map(team.phases.map((p) => [p.name, p.depends_on]));
	const state = new Map<string, 1 | 2>();
	const path: string[] = [];
	const visit = (n: string): string[] | null => {
		if (state.get(n) === 2) return null;
		if (state.get(n) === 1) return path.slice(path.indexOf(n));
		state.set(n, 1); path.push(n);
		for (const d of deps.get(n) ?? []) { if (!deps.has(d)) continue; const c = visit(d); if (c) return c; }
		path.pop(); state.set(n, 2);
		return null;
	};
	for (const p of team.phases) { const c = visit(p.name); if (c) return c; }
	return null;
}

export function check_team(team: GeneratedTeam): Problem[] {
	const out: Problem[] = [];
	const add = (p: Omit<Problem, 'id'>) => out.push({ ...p, id: `${p.level}:${p.phase ?? ''}:${p.field ?? ''}:${out.length}` });
	const names = team.phases.map((p) => p.name);
	const nameset = new Set(names);
	const custom_agents = new Set((team.agents ?? []).map((a) => a.name));

	if (!team.name?.trim()) add({ level: 'error', phase: null, field: 'name', message: 'Give the team a name.' });
	else if (!PHASE_NAME_RE.test(team.name.replace(/^@[^/]+\//, ''))) add({ level: 'error', phase: null, field: 'name', message: 'Team name: lowercase letters, numbers and hyphens, starting with a letter.' });
	if (!team.description?.trim()) add({ level: 'warning', phase: null, field: 'description', message: 'Add a short description so people know what this team does.' });
	if (!team.phases.length) { add({ level: 'error', phase: null, field: 'phases', message: 'Add a phase to get started.' }); return out; }

	const seen = new Set<string>();
	for (const p of team.phases) {
		if (!p.name) { add({ level: 'error', phase: null, field: 'name', message: 'A phase has no name.' }); continue; }
		if (seen.has(p.name)) add({ level: 'error', phase: p.name, field: 'name', message: `Two phases are called “${p.name}”.` });
		seen.add(p.name);
		if (!PHASE_NAME_RE.test(p.name)) add({ level: 'error', phase: p.name, field: 'name', message: `“${p.name}”: use lowercase letters, numbers and hyphens.` });
		if (!['standard', 'gate', 'team'].includes(p.type)) add({ level: 'error', phase: p.name, field: 'type', message: `${p.name}: type must be standard, gate or team.` });

		for (const d of p.depends_on) {
			if (d === p.name) { add({ level: 'error', phase: p.name, field: 'depends_on', message: `${p.name} can’t run after itself.`, fix: { label: 'Remove', apply: (t) => ({ ...t, phases: t.phases.map((x) => (x.name === p.name ? { ...x, depends_on: x.depends_on.filter((y) => y !== d) } : x)) }) } }); continue; }
			if (!nameset.has(d)) {
				const guess = closest(d, names.filter((n) => n !== p.name));
				add({
					level: 'error', phase: p.name, field: 'depends_on',
					message: `${p.name} runs after “${d}”, but there’s no such phase${guess ? ` — did you mean ${guess}?` : '.'}`,
					fix: guess
						? { label: `Use ${guess}`, apply: (t) => ({ ...t, phases: t.phases.map((x) => (x.name === p.name ? { ...x, depends_on: x.depends_on.map((y) => (y === d ? guess : y)) } : x)) }) }
						: { label: 'Remove', apply: (t) => ({ ...t, phases: t.phases.map((x) => (x.name === p.name ? { ...x, depends_on: x.depends_on.filter((y) => y !== d) } : x)) }) },
				});
			}
		}

		const k = kind_of(p);
		if (p.agent && !BUILTIN_AGENTS.has(p.agent) && !custom_agents.has(p.agent)) add({ level: 'error', phase: p.name, field: 'agent', message: `${p.name} uses an unknown agent “${p.agent}”.` });
		if (k === 'script' && !p.commands?.some((c) => c.run?.trim())) add({ level: 'error', phase: p.name, field: 'commands', message: `${p.name} needs at least one command.` });
		if (k === 'gate' && !p.commands?.length) add({ level: 'error', phase: p.name, field: 'commands', message: `${p.name} (gate) needs at least one check.` });
		if (k === 'human') {
			if (!p.review?.reviewer?.trim()) add({ level: 'error', phase: p.name, field: 'review', message: `${p.name} needs a reviewer.` });
		}
		if ((k === 'gate' || k === 'human') && p.commands?.some((c) => c.escalate_on_fail !== undefined)) add({ level: 'error', phase: p.name, field: 'commands', message: `${p.name}: gate checks can’t set escalate_on_fail.` });
		if (k === 'team' && !p.team?.trim()) add({ level: 'error', phase: p.name, field: 'team', message: `${p.name} needs a sub-team.` });
		if (k === 'connector') {
			if (!p.action?.trim()) add({ level: 'error', phase: p.name, field: 'action', message: `${p.name} (${p.agent}) needs an action.` });
			if (!p.sources?.length) add({ level: 'warning', phase: p.name, field: 'sources', message: `${p.name} has no sources — it won’t fetch anything.` });
		}
		if (k === 'fetch' && !p.sources?.length && !p.target_entries?.length) add({ level: 'error', phase: p.name, field: 'sources', message: `${p.name} needs at least one URL to fetch or post to.` });
		for (const s of p.sources ?? []) if (!s.name?.trim()) add({ level: 'error', phase: p.name, field: 'sources', message: `${p.name} has a source with no name.` });
		for (const t of p.target_entries ?? []) {
			if (!t.file?.trim() || !t.name?.trim()) add({ level: 'error', phase: p.name, field: 'target_entries', message: `${p.name} has a target missing a name or file.` });
			if (t.mode && !['create', 'append', 'replace'].includes(t.mode)) add({ level: 'error', phase: p.name, field: 'target_entries', message: `${p.name}: target mode must be create, append or replace.` });
		}
		if (p.max_iterations !== undefined && (!Number.isInteger(p.max_iterations) || p.max_iterations < 1 || p.max_iterations > 5)) add({ level: 'error', phase: p.name, field: 'max_iterations', message: `${p.name}: max tries must be a whole number from 1 to 5.` });

		const need = role_need(p);
		const role = team.roles.find((r) => r.name === p.name);
		if (need === 'required' && !role?.content.trim()) add({ level: 'warning', phase: p.name, field: 'role', message: `${p.name} has no role brief.` });
		else if (role && need !== 'none' && role.content.trim().length > 0 && role.content.trim().length < 50) add({ level: 'warning', phase: p.name, field: 'role', message: `${p.name}’s brief is very short — add more detail.` });
	}

	if (!team.phases.some((p) => !p.is_support && p.depends_on.length === 0)) add({ level: 'error', phase: null, field: 'depends_on', message: 'Nothing can start: every phase waits on another.' });
	const cyc = find_cycle(team);
	if (cyc) add({ level: 'error', phase: cyc[0], field: 'depends_on', message: `Loop: ${[...cyc, cyc[0]].join(' → ')} would never finish.` });

	// inputs
	const declared = new Set((team.inputs ?? []).map((i) => i.name));
	const used = new Set<string>();
	refs_in(team.phases, used); refs_in(team.roles.map((r) => r.content), used);
	for (const u of used) if (!declared.has(u)) {
		const phase = team.phases.find((p) => { const s = new Set<string>(); refs_in(p, s); refs_in(team.roles.find((r) => r.name === p.name)?.content, s); return s.has(u); })?.name ?? null;
		add({ level: 'error', phase, field: null, message: `$(inputs.${u}) is used but there’s no input called ${u}.`, fix: { label: `Add input ${u}`, apply: (t) => ({ ...t, inputs: [...(t.inputs ?? []), { name: u }] }) } });
	}
	for (const d of declared) if (!used.has(d)) add({ level: 'warning', phase: null, field: 'inputs', message: `Input “${d}” isn’t used by any phase.` });
	return out;
}

export const CONNECTORS = CONNECTOR_AGENTS;
