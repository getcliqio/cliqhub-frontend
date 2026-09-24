import JSZip from 'jszip';
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
}

function serialize_phase(lines: string[], p: ExportPhase, indent: string): void {
	lines.push(`${indent}- name: ${p.name}`);
	lines.push(`${indent}  type: ${p.type}`);
	if (p.agent) lines.push(`${indent}  agent: ${p.agent}`);
	if (p.depends_on.length > 0) {
		lines.push(`${indent}  depends_on: [${p.depends_on.join(', ')}]`);
	}
	if (p.commands?.length) {
		lines.push(`${indent}  commands:`);
		for (const c of p.commands) {
			lines.push(`${indent}    - name: ${c.name}`);
			lines.push(`${indent}      run: ${c.run}`);
			if (c.scope) lines.push(`${indent}      scope: ${c.scope}`);
			if (c.escalate_on_fail === false) lines.push(`${indent}      escalate_on_fail: false`);
		}
	}
	if (p.max_iterations) {
		lines.push(`${indent}  max_iterations: ${p.max_iterations}`);
	}
	if (p.action) {
		lines.push(`${indent}  action: ${p.action}`);
	}
	if (p.model) {
		lines.push(`${indent}  model: ${p.model}`);
	}
	if (p.sources?.length) {
		lines.push(`${indent}  sources:`);
		for (const e of p.sources) {
			lines.push(`${indent}    - name: ${e.name}`);
			if (e.url) lines.push(`${indent}      url: "${e.url}"`);
			if (e.ref) lines.push(`${indent}      ref: ${e.ref}`);
		}
	}
	if (p.target_entries?.length) {
		lines.push(`${indent}  target_entries:`);
		for (const e of p.target_entries) {
			lines.push(`${indent}    - name: ${e.name}`);
			lines.push(`${indent}      file: ${e.file}`);
			if (e.url) lines.push(`${indent}      url: "${e.url}"`);
			if (e.ref) lines.push(`${indent}      ref: ${e.ref}`);
			if (e.mode && e.mode !== 'create') lines.push(`${indent}      mode: ${e.mode}`);
		}
	}
	if (p.review) {
		lines.push(`${indent}  review:`);
		const rev = p.review;
		if (rev.reviewer) {
			const reviewers = Array.isArray(rev.reviewer) ? rev.reviewer : [rev.reviewer];
			if (reviewers.length === 1) {
				lines.push(`${indent}    reviewer: ${reviewers[0]}`);
			}
			if (reviewers.length > 1) {
				lines.push(`${indent}    reviewer:`);
				for (const r of reviewers) lines.push(`${indent}      - ${r}`);
			}
		}
		if (rev.artifacts?.length) {
			lines.push(`${indent}    artifacts:`);
			for (const a of rev.artifacts) lines.push(`${indent}      - ${a}`);
		}
		if (rev.timeout) lines.push(`${indent}    timeout: ${rev.timeout}`);
		if (rev.remind_every) lines.push(`${indent}    remind_every: ${rev.remind_every}`);
	}
	if (p.team) lines.push(`${indent}  team: "${p.team}"`);
	if (p.inputs && Object.keys(p.inputs).length > 0) {
		lines.push(`${indent}  inputs:`);
		for (const [k, v] of Object.entries(p.inputs)) {
			lines.push(`${indent}    ${k}: "${v}"`);
		}
	}
}

export function build_team_yml(team: ExportTeamData): string {
	const clean_name = team.name.replace(/^@[^/]+\//, '');
	const lines: string[] = [
		`name: ${clean_name}`,
		`description: "${team.description.replace(/"/g, '\\"')}"`,
	];

	if (team.tags?.length) {
		lines.push(`tags: [${team.tags.join(', ')}]`);
	}
	if (team.inputs?.length) {
		lines.push('inputs:');
		for (const inp of team.inputs) {
			lines.push(`  - name: ${inp.name}`);
			if (inp.description) lines.push(`    description: "${inp.description.replace(/"/g, '\\"')}"`);
		}
	}
	if (team.use_when?.length) {
		lines.push('use_when:');
		for (const item of team.use_when) lines.push(`  - ${item}`);
	}
	if (team.not_for?.length) {
		lines.push('not_for:');
		for (const item of team.not_for) lines.push(`  - ${item}`);
	}

	if (team.agents?.length) {
		lines.push('agents:');
		for (const a of team.agents) {
			lines.push(`  ${a.name}:`);
			if (a.entry) lines.push(`    entry: ${a.entry}`);
			if (a.env?.length) {
				lines.push('    env:');
				for (const v of a.env) lines.push(`      - ${v}`);
			}
		}
	}

	const main_phases = team.phases.filter(p => !p.is_support);
	const support_phases = team.phases.filter(p => p.is_support);

	lines.push('phases:');
	for (const p of main_phases) {
		serialize_phase(lines, p, '  ');
	}
	if (support_phases.length > 0) {
		lines.push('support:');
		for (const p of support_phases) {
			serialize_phase(lines, p, '  ');
		}
	}

	return lines.join('\n');
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
