/**
 * Pure edits on a team's workflow graph. Every function returns a new team
 * (or an error) — the store records it for undo via UPDATE_TEAM.
 *
 * Layout rule (shared with the team page): a phase's step is the longest
 * depends_on path from a root; within a step, phases keep team.yml order.
 */
import type { GeneratedPhase, GeneratedRole, GeneratedTeam } from '@/lib/builder/store';
import { kind_of, new_phase, starter_role, unique_name, type Kind_id } from '@/lib/builder/kinds';

export type Op_result = { ok: true; team: GeneratedTeam; name?: string } | { ok: false; error: string };

const main = (t: GeneratedTeam) => t.phases.filter((p) => !p.is_support);

/** Step per main phase (support phases are not in the flow). Cycles are cut. */
export function steps_of(team: GeneratedTeam): Map<string, number> {
	const phases = main(team);
	const names = new Set(phases.map((p) => p.name));
	const deps = new Map(phases.map((p) => [p.name, p.depends_on.filter((d) => names.has(d) && d !== p.name)]));
	const out = new Map<string, number>();
	const visiting = new Set<string>();
	const depth = (n: string): number => {
		if (out.has(n)) return out.get(n)!;
		if (visiting.has(n)) return 0;
		visiting.add(n);
		const d = deps.get(n) ?? [];
		const v = d.length ? Math.max(...d.map(depth)) + 1 : 0;
		visiting.delete(n);
		out.set(n, v);
		return v;
	};
	phases.forEach((p) => depth(p.name));
	return out;
}

export interface Builder_layout {
	/** step (row, top→bottom) and slot within the step, centred on 0. */
	pos: Map<string, { step: number; slot: number; count: number }>;
	steps: number;
	widest: number;
	support: string[];
}

export function builder_layout(team: GeneratedTeam): Builder_layout {
	const steps = steps_of(team);
	const by = new Map<number, string[]>();
	for (const p of main(team)) {
		const s = steps.get(p.name) ?? 0;
		by.set(s, [...(by.get(s) ?? []), p.name]); // file order preserved
	}
	const pos = new Map<string, { step: number; slot: number; count: number }>();
	let widest = 0;
	for (const [s, list] of by) {
		widest = Math.max(widest, list.length);
		list.forEach((n, i) => pos.set(n, { step: s, slot: i - (list.length - 1) / 2, count: list.length }));
	}
	return { pos, steps: by.size ? Math.max(...by.keys()) + 1 : 0, widest, support: team.phases.filter((p) => p.is_support).map((p) => p.name) };
}

/** True if `to` depending on `from` would close a loop (from already waits on to). */
export function would_cycle(team: GeneratedTeam, from: string, to: string): boolean {
	if (from === to) return true;
	const deps = new Map(team.phases.map((p) => [p.name, p.depends_on]));
	const seen = new Set<string>();
	const stack = [from];
	while (stack.length) {
		const n = stack.pop()!;
		if (n === to) return true;
		if (seen.has(n)) continue;
		seen.add(n);
		stack.push(...(deps.get(n) ?? []));
	}
	return false;
}

function with_phases(team: GeneratedTeam, phases: GeneratedPhase[], roles: GeneratedRole[] = team.roles): GeneratedTeam {
	return { ...team, phases, roles };
}
const find = (team: GeneratedTeam, name: string) => team.phases.find((p) => p.name === name);

/** `to` runs after `from`. */
export function connect(team: GeneratedTeam, from: string, to: string): Op_result {
	const a = find(team, from); const b = find(team, to);
	if (!a || !b) return { ok: false, error: 'Unknown phase.' };
	if (from === to) return { ok: false, error: 'A phase can’t run after itself.' };
	if (b.depends_on.includes(from)) return { ok: false, error: `${to} already runs after ${from}.` };
	if (would_cycle(team, from, to)) return { ok: false, error: `That would make a loop: ${from} already waits on ${to}.` };
	if (a.is_support || b.is_support) return { ok: false, error: 'Support phases aren’t part of the flow.' };
	return { ok: true, team: with_phases(team, team.phases.map((p) => (p.name === to ? { ...p, depends_on: [...p.depends_on, from] } : p))) };
}

export function disconnect(team: GeneratedTeam, from: string, to: string): Op_result {
	const b = find(team, to);
	if (!b || !b.depends_on.includes(from)) return { ok: false, error: 'No such link.' };
	return { ok: true, team: with_phases(team, team.phases.map((p) => (p.name === to ? { ...p, depends_on: p.depends_on.filter((d) => d !== from) } : p))) };
}

function add_with_role(team: GeneratedTeam, kind: Kind_id, phase: GeneratedPhase, index: number): GeneratedTeam {
	const phases = [...team.phases];
	phases.splice(Math.max(0, Math.min(index, phases.length)), 0, phase);
	const role = starter_role(kind, phase.name);
	const roles = role && !team.roles.some((r) => r.name === phase.name) ? [...team.roles, { name: phase.name, content: role }] : team.roles;
	return with_phases(team, phases, roles);
}

/** New phase with no dependencies (a new branch), at the end of the file. */
export function add_root(team: GeneratedTeam, kind: Kind_id): Op_result {
	const p = new_phase(kind, team, []);
	return { ok: true, team: add_with_role(team, kind, p, team.phases.length), name: p.name };
}

/** New phase that runs after `parent`; placed right after it in the file. */
export function add_after(team: GeneratedTeam, kind: Kind_id, parent: string): Op_result {
	const i = team.phases.findIndex((p) => p.name === parent);
	if (i < 0) return { ok: false, error: 'Unknown phase.' };
	if (team.phases[i].is_support) return { ok: false, error: 'Support phases aren’t part of the flow.' };
	const p = new_phase(kind, team, [parent]);
	return { ok: true, team: add_with_role(team, kind, p, i + 1), name: p.name };
}

/** New phase on the arrow from → to: runs after `from`, and `to` now runs after it. */
export function insert_between(team: GeneratedTeam, kind: Kind_id, from: string, to: string): Op_result {
	const b = find(team, to);
	if (!b || !b.depends_on.includes(from)) return { ok: false, error: 'No such link.' };
	const p = new_phase(kind, team, [from]);
	const ti = team.phases.findIndex((x) => x.name === to);
	const next = add_with_role(team, kind, p, ti);
	return { ok: true, team: with_phases(next, next.phases.map((x) => (x.name === to ? { ...x, depends_on: x.depends_on.map((d) => (d === from ? p.name : d)) } : x)), next.roles), name: p.name };
}

/** Remove a phase; its children inherit its dependencies so the flow stays connected. */
export function remove_bridged(team: GeneratedTeam, name: string): Op_result {
	const gone = find(team, name);
	if (!gone) return { ok: false, error: 'Unknown phase.' };
	const phases = team.phases.filter((p) => p.name !== name).map((p) => {
		if (!p.depends_on.includes(name)) return p;
		const deps = [...p.depends_on.filter((d) => d !== name), ...gone.depends_on.filter((d) => !p.depends_on.includes(d))];
		return { ...p, depends_on: deps };
	});
	return { ok: true, team: with_phases(team, phases, team.roles.filter((r) => r.name !== name)) };
}

/**
 * Reorder within a step: move `name` just before/after `target`. Only phases
 * on the same step can be reordered (moving across steps is re-wiring).
 */
export function move_within_step(team: GeneratedTeam, name: string, target: string, side: 'before' | 'after'): Op_result {
	if (name === target) return { ok: true, team };
	const steps = steps_of(team);
	if (steps.get(name) === undefined || steps.get(name) !== steps.get(target)) return { ok: false, error: 'Drag within a row to reorder; wire arrows to move between rows.' };
	const moving = find(team, name)!;
	const rest = team.phases.filter((p) => p.name !== name);
	const ti = rest.findIndex((p) => p.name === target);
	rest.splice(side === 'before' ? ti : ti + 1, 0, moving);
	return { ok: true, team: with_phases(team, rest) };
}

export const PHASE_NAME_RE = /^[a-z][a-z0-9-]*$/;

export function rename_phase(team: GeneratedTeam, from: string, to: string): Op_result {
	if (from === to) return { ok: true, team, name: to };
	if (!PHASE_NAME_RE.test(to)) return { ok: false, error: 'Use lowercase letters, numbers and hyphens, starting with a letter.' };
	if (find(team, to)) return { ok: false, error: `There’s already a phase called ${to}.` };
	const phases = team.phases.map((p) => ({ ...p, name: p.name === from ? to : p.name, depends_on: p.depends_on.map((d) => (d === from ? to : d)) }));
	const roles = team.roles.map((r) => (r.name === from ? { ...r, name: to } : r));
	return { ok: true, team: with_phases(team, phases, roles), name: to };
}

export function duplicate_phase(team: GeneratedTeam, name: string): Op_result {
	const i = team.phases.findIndex((p) => p.name === name);
	if (i < 0) return { ok: false, error: 'Unknown phase.' };
	const src = team.phases[i];
	const copy = { ...structuredClone(src), name: unique_name(`${name}-copy`, team.phases.map((p) => p.name)) };
	delete (copy as { pending?: boolean }).pending;
	const phases = [...team.phases];
	phases.splice(i + 1, 0, copy);
	const role = team.roles.find((r) => r.name === name);
	return { ok: true, team: with_phases(team, phases, role ? [...team.roles, { name: copy.name, content: role.content }] : team.roles), name: copy.name };
}

/** Switch a phase to another kind, keeping name and wiring. */
export function change_kind(team: GeneratedTeam, name: string, kind: Kind_id): Op_result {
	const p = find(team, name);
	if (!p) return { ok: false, error: 'Unknown phase.' };
	if (kind_of(p) === kind) return { ok: true, team, name };
	const fresh = new_phase(kind, { ...team, phases: team.phases.filter((x) => x.name !== name) }, p.depends_on);
	const next: GeneratedPhase = { ...fresh, name, depends_on: p.depends_on, ...(p.is_support ? { is_support: true } : {}) };
	const role = starter_role(kind, name);
	const has_role = team.roles.some((r) => r.name === name);
	const roles = role && !has_role ? [...team.roles, { name, content: role }] : team.roles;
	return { ok: true, team: with_phases(team, team.phases.map((x) => (x.name === name ? next : x)), roles), name };
}

// ── diff (Changes view, release notes) ──────────────────────────────────

export interface Team_change { kind: 'added' | 'removed' | 'changed'; target: 'phase' | 'role' | 'team'; name: string; detail: string }

export function diff_teams(a: GeneratedTeam | null, b: GeneratedTeam): Team_change[] {
	const out: Team_change[] = [];
	if (!a) return b.phases.map((p) => ({ kind: 'added', target: 'phase', name: p.name, detail: `new ${kind_of(p)} phase` }));
	const A = new Map(a.phases.map((p) => [p.name, p]));
	const B = new Map(b.phases.map((p) => [p.name, p]));
	for (const [n, p] of B) {
		const o = A.get(n);
		if (!o) { out.push({ kind: 'added', target: 'phase', name: n, detail: `new ${kind_of(p)} phase${p.depends_on.length ? ` after ${p.depends_on.join(', ')}` : ''}` }); continue; }
		const d: string[] = [];
		if (kind_of(o) !== kind_of(p)) d.push(`${kind_of(o)} → ${kind_of(p)}`);
		else if ((o.agent ?? '') !== (p.agent ?? '')) d.push(`agent ${o.agent ?? '—'} → ${p.agent ?? '—'}`);
		if (o.depends_on.join(',') !== p.depends_on.join(',')) d.push(`runs after [${o.depends_on.join(', ')}] → [${p.depends_on.join(', ')}]`);
		if ((o.max_iterations ?? null) !== (p.max_iterations ?? null)) d.push(`max tries ${o.max_iterations ?? '—'} → ${p.max_iterations ?? '—'}`);
		if (JSON.stringify(o.commands ?? []) !== JSON.stringify(p.commands ?? [])) d.push('checks/commands changed');
		if (JSON.stringify([o.sources ?? [], o.target_entries ?? [], o.action ?? '']) !== JSON.stringify([p.sources ?? [], p.target_entries ?? [], p.action ?? ''])) d.push('sources/targets changed');
		if (JSON.stringify(o.review ?? {}) !== JSON.stringify(p.review ?? {})) d.push('review settings changed');
		if ((o.team ?? '') !== (p.team ?? '') || JSON.stringify(o.inputs ?? {}) !== JSON.stringify(p.inputs ?? {})) d.push('sub-team changed');
		if (Boolean(o.is_support) !== Boolean(p.is_support)) d.push(p.is_support ? 'now a support phase' : 'now in the flow');
		if (d.length) out.push({ kind: 'changed', target: 'phase', name: n, detail: d.join(' · ') });
	}
	for (const n of A.keys()) if (!B.has(n)) out.push({ kind: 'removed', target: 'phase', name: n, detail: 'phase removed' });
	const RA = new Map(a.roles.map((r) => [r.name, r.content]));
	for (const r of b.roles) {
		const o = RA.get(r.name);
		if (o === undefined) { if (A.has(r.name)) out.push({ kind: 'added', target: 'role', name: `roles/${r.name}.md`, detail: 'new role brief' }); continue; }
		if (o !== r.content) {
			const lo = new Set(o.split('\n')); const lp = new Set(r.content.split('\n'));
			out.push({ kind: 'changed', target: 'role', name: `roles/${r.name}.md`, detail: `+${[...lp].filter((x) => !lo.has(x)).length} −${[...lo].filter((x) => !lp.has(x)).length} lines` });
		}
	}
	const meta: string[] = [];
	if (a.description !== b.description) meta.push('description');
	if (JSON.stringify(a.inputs ?? []) !== JSON.stringify(b.inputs ?? [])) meta.push('inputs');
	if (JSON.stringify(a.use_when ?? []) !== JSON.stringify(b.use_when ?? []) || JSON.stringify(a.not_for ?? []) !== JSON.stringify(b.not_for ?? [])) meta.push('use for / not for');
	if (JSON.stringify(a.tags ?? []) !== JSON.stringify(b.tags ?? [])) meta.push('tags');
	if (meta.length) out.push({ kind: 'changed', target: 'team', name: 'team', detail: `${meta.join(', ')} updated` });
	return out;
}

/** Release-notes draft from a change list. */
export function release_notes(changes: Team_change[]): string {
	const lines = changes.map((c) => {
		if (c.target === 'team') return `- Updated ${c.detail.replace(/ updated$/, '')}`;
		if (c.target === 'role') return `- ${c.kind === 'added' ? 'Added' : 'Revised'} the ${c.name.replace(/^roles\/|\.md$/g, '')} brief`;
		if (c.kind === 'added') return `- Added ${c.name} (${c.detail.replace(/^new /, '')})`;
		if (c.kind === 'removed') return `- Removed ${c.name}`;
		return `- ${c.name}: ${c.detail}`;
	});
	return lines.join('\n');
}
