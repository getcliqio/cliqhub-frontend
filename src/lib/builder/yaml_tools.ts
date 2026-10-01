/**
 * team.yml helpers for the builder's YAML view: canonical formatting,
 * error positions, and phase ↔ line mapping for canvas/editor sync.
 */
import type { GeneratedTeam } from '@/lib/builder/store';
import { build_team_yml } from '@/lib/team_export';
import { parse_team_yml_text } from '@/lib/team_yml_parse';
import type { Problem } from '@/lib/builder/checks';

/** Canonical team.yml for a team (what gets saved and published). */
export function team_to_yaml(team: GeneratedTeam): string {
	return build_team_yml({ ...team, agents: team.agents ?? [] });
}

export type Parse_outcome =
	| { ok: true; team: GeneratedTeam }
	| { ok: false; error: string; line: number | null; col: number | null };

/** js-yaml puts "(line:col)" in its messages; 1-based. */
export function error_position(message: string): { line: number | null; col: number | null } {
	const m = /\((\d+):(\d+)\)/.exec(message) ?? /line (\d+), column (\d+)/.exec(message);
	return m ? { line: Number(m[1]), col: Number(m[2]) } : { line: null, col: null };
}

export function parse_yaml(text: string, base: GeneratedTeam): Parse_outcome {
	const r = parse_team_yml_text(text, base);
	if (r.error) {
		const first = r.error.split('\n')[0];
		return { ok: false, error: first, ...error_position(r.error) };
	}
	return { ok: true, team: r.team };
}

/** True when the text has YAML comments (formatting would drop them). */
export function has_comments(text: string): boolean {
	return text.split('\n').some((l) => {
		let q: string | null = null;
		for (let i = 0; i < l.length; i++) {
			const c = l[i];
			if (q) { if (c === q) q = null; continue; }
			if (c === '"' || c === '\'') { q = c; continue; }
			if (c === '#' && (i === 0 || /\s/.test(l[i - 1]))) return true;
		}
		return false;
	});
}

export type Format_outcome =
	| { ok: true; team: GeneratedTeam; text: string; changed: boolean; kept_comments: boolean }
	| { ok: false; error: string; line: number | null; col: number | null };

/**
 * Parse and, when safe, rewrite to canonical team.yml. Text with comments is
 * kept as written (canonical output can't carry comments).
 */
export function format_yaml(text: string, base: GeneratedTeam): Format_outcome {
	const r = parse_yaml(text, base);
	if (!r.ok) return r;
	if (has_comments(text)) return { ok: true, team: r.team, text, changed: false, kept_comments: true };
	const out = team_to_yaml(r.team);
	return { ok: true, team: r.team, text: out, changed: out.trim() !== text.trim(), kept_comments: false };
}

/** 1-based [from, to] line range of each phase's block in team.yml. */
export function phase_ranges(text: string): Map<string, { from: number; to: number }> {
	const lines = text.split('\n');
	const out = new Map<string, { from: number; to: number }>();
	let in_list = false;
	let item_indent: number | null = null;
	let cur: { name: string; from: number; indent: number } | null = null;
	const close = (end: number) => { if (cur) out.set(cur.name, { from: cur.from, to: end }); cur = null; };
	lines.forEach((l, i) => {
		const n = i + 1;
		if (/^(phases|support):\s*$/.test(l)) { close(n - 1); in_list = true; item_indent = null; return; }
		if (/^\S/.test(l) && !/^\s*#/.test(l)) { close(n - 1); in_list = false; return; }
		if (!in_list) return;
		const m = /^(\s*)-\s+name:\s*["']?([^"'\s#]+)/.exec(l);
		if (m && (item_indent === null || m[1].length === item_indent)) {
			item_indent = m[1].length;
			close(n - 1);
			cur = { name: m[2], from: n, indent: m[1].length };
		}
	});
	close(lines.length);
	// trim trailing blank lines from each block
	for (const [k, v] of out) { let to = v.to; while (to > v.from && !lines[to - 1].trim()) to--; out.set(k, { from: v.from, to }); }
	return out;
}

/** Which phase the 1-based line belongs to. */
export function phase_at_line(text: string, line: number): string | null {
	for (const [name, r] of phase_ranges(text)) if (line >= r.from && line <= r.to) return name;
	return null;
}

const FIELD_KEYS: Record<string, string> = { role: '', review: 'review', commands: 'commands', max_iterations: 'max_iterations', depends_on: 'depends_on', agent: 'agent', action: 'action', sources: 'sources', target_entries: 'target_entries', team: 'team', type: 'type', name: 'name' };

/** Best line for a problem: the field inside the phase block, else the block start, else a top-level key. */
export function problem_line(text: string, p: Pick<Problem, 'phase' | 'field'>): number | null {
	const lines = text.split('\n');
	if (p.phase) {
		const r = phase_ranges(text).get(p.phase);
		if (!r) return null;
		const key = p.field ? FIELD_KEYS[p.field] : '';
		if (key) for (let i = r.from; i <= r.to; i++) if (new RegExp(`^\\s*(-\\s+)?${key}:`).test(lines[i - 1])) return i;
		return r.from;
	}
	if (p.field) { const i = lines.findIndex((l) => new RegExp(`^${p.field}:`).test(l)); if (i >= 0) return i + 1; }
	return null;
}
