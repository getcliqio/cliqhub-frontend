/**
 * Build › Teams › one team (Graphite). One page, no tabs. Opened inside a realm
 * (/o/:org/realms/:slug/teams/:scope/:name?v=…) it can only be run and viewed: the version
 * installed there, a small title under "All teams ›", Run… and one card — Phases (the graph,
 * starting at its Run inputs, over a table of the inputs and phases, linked both ways) or YAML;
 * no version picker, history, Agents/Inputs cards or other actions; its danger zone is Uninstall
 * from this realm (`realms/remove_team`).
 *   header   — name · status, description, then version · @scope · author · tags; actions right:
 *              Fork · Download · Edit (the Builder — everything about the team changes there) · Install
 *   left     — Workflow in two modes, Diagram (horizontal) or YAML (team.yml and role briefs), with
 *              the selected phase described under it; Versions (5 a page, full notes on "more");
 *              the Danger zone, folded (Unpublish, Delete a version, Delete team), for editors
 *   right    — Agents (needed on the daemon, incl. ones the team defines), then Inputs (asked on
 *              Run); always listed, the selected phase's highlighted
 * Read: one `POST /v1/team_page/get` (view `overview`, which carries team.yml too). Writes are
 * single existing routes (realms/add_team via the Install dialog, teams/create with `forked_from`,
 * teams/unpublish, teams/delete_version, teams/delete).
 */
import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { Code, Download, FileDown, GitFork, Pencil, Play, Route } from 'lucide-react';
import { useAuth, useAuthFetch } from '@/lib/auth_context';
import { relative_time, use_overview } from '@/lib/overview';
import { api_message, use_bff_read } from '@/lib/use_bff_read';
import { use_view_scope } from '@/lib/view_scope';
import { phase_kind, phase_subtitle, team_href, type Team_input, type Team_page_data, type Team_phase } from '@/lib/team_page';
import { Yaml_view, find_item, yaml_outline } from '@/components/graphite/g_yaml_view';
import { Graphite_shell } from '@/components/graphite/graphite_shell';
import { Realm_nav } from '@/components/graphite/realm_nav';
import { use_access } from '@/lib/access';
import { ROW_ACTION_CLS } from '@/components/graphite/g_kinds';
import { Workflow_graph, Workflow_legend } from '@/components/graphite/g_workflow_graph';
import { Blocking_error } from '@/pages/realm/realm_inbox_page';
import { Run_in_realm_dialog } from '@/components/run_in_realm_dialog';
import { Install_popover, Status_badge, Team_avatar } from '@/pages/teams/teams_graphite_page';

const PRIMARY = 'inline-flex items-center gap-1.5 rounded-md bg-[var(--g-acc)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--g-on-acc)] hover:bg-[var(--g-acc-hover)] disabled:opacity-50';
const INPUT = 'h-8 rounded-md border border-[var(--g-line)] bg-[var(--g-bg)] px-2.5 text-[12.5px] text-[var(--g-ink)] outline-none focus:border-[var(--g-acc-line)]';
const CARD = 'rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)]';
const H3 = 'flex items-center gap-2.5 border-b border-[var(--g-line)] px-4 py-3 text-[14px] font-semibold';
const DANGER_BTN = 'rounded-md bg-[var(--g-bad)] px-2.5 py-1 text-[12px] font-semibold text-[var(--g-on-color)] disabled:opacity-50';

type Workflow_mode = 'diagram' | 'yaml';
/** Remembers Diagram / YAML across teams (per browser). */
export const WORKFLOW_MODE_KEY = 'cliqhub.team_workflow_mode';
/** A team name: lowercase letters, numbers and hyphens, starting with a letter. */
/** Versions shown per page in the Versions card. */
export const VERSIONS_PAGE_SIZE = 5;
/** Names tried for a fork, in order. */
const FORK_SUFFIXES = ['-fork', '-fork-2', '-fork-3', '-fork-4', '-fork-5'];

/** `?phase=` value for the Run inputs (the graph's start node / the table's first row). */
export const INPUTS_SEL = '@inputs';

function read_mode(): Workflow_mode {
	try { return localStorage.getItem(WORKFLOW_MODE_KEY) === 'yaml' ? 'yaml' : 'diagram'; } catch { return 'diagram'; }
}

/** `{{inputs.NAME}}` references in a piece of team.yml or a role brief. */
const INPUT_REF = /\{\{\s*inputs\.([A-Za-z0-9_-]+)\s*\}\}/g;

/**
 * The inputs a phase uses: `{{inputs.NAME}}` in its block of team.yml or in its role brief,
 * limited to the team's declared inputs (in their order).
 */
export function inputs_used(phase: Team_phase, team_yml: string | null, inputs: Team_input[]): string[] {
	let text = phase.role ?? '';
	if (team_yml) {
		const item = find_item(yaml_outline(team_yml), phase.name);
		if (item) text += `\n${team_yml.split('\n').slice(item.start, item.end + 1).join('\n')}`;
	}
	const found = new Set<string>();
	for (const m of text.matchAll(INPUT_REF)) found.add(m[1]);
	return inputs.map((i) => i.name).filter((n) => found.has(n));
}

/** `{{inputs.NAME}}` said in words ("from input NAME"). */
function readable_refs(text: string): string {
	return text.replace(new RegExp(INPUT_REF.source, 'g'), 'from input $1');
}

/** First line of a phase's role brief, else what kind of step it is. */
function phase_line(p: Team_phase): string {
	const brief = (p.role ?? '').split('\n').map((l) => l.replace(/^#+\s*/, '').trim()).find(Boolean);
	return readable_refs(brief ?? phase_subtitle(p));
}

function Kind_tile({ phase, size = 18 }: { phase: Team_phase; size?: number }) {
	const k = phase_kind(phase);
	return <span aria-hidden className="grid shrink-0 place-items-center rounded-[5px] font-bold" style={{ width: size, height: size, fontSize: size * 0.6, color: k.color, background: `${k.color}26` }}>{k.glyph}</span>;
}

function use_post() {
	const auth_fetch = useAuthFetch();
	return async (path: string, body: Record<string, unknown>): Promise<{ ok: true; data: unknown } | { ok: false; error: string; status: number }> => {
		try {
			const res = await auth_fetch(path, { method: 'POST', body: JSON.stringify(body) });
			const payload = await res.json().catch(() => null);
			if (!res.ok || !payload?.ok) return { ok: false, error: api_message(payload, 'Request failed'), status: res.status };
			return { ok: true, data: payload.data ?? payload };
		} catch {
			return { ok: false, error: 'Network error — check your connection.', status: 0 };
		}
	};
}

const ROW = 'grid grid-cols-[minmax(0,1.1fr)_110px_96px_minmax(0,1.7fr)_14px] items-start gap-3 px-4 py-2.5';

/**
 * The team in a realm: its Run inputs, then its phases (support ones last), one row each. The
 * picked row (also picked on the graph) opens — inputs: each one's description, default and the
 * phases that use it; a phase: what it runs after, its agent's brief, commands, review.
 */
function Phase_table({ phases, support, inputs, team_yml, selected, on_pick }: {
	phases: Team_phase[]; support: Team_phase[]; inputs: Team_input[]; team_yml: string | null;
	selected: string | null; on_pick: (name: string) => void;
}) {
	const all = [...phases, ...support];
	const users = new Map(inputs.map((i) => [i.name, all.filter((p) => inputs_used(p, team_yml, inputs).includes(i.name)).map((p) => p.name)]));
	const row_cls = (on: boolean) => `${ROW} cursor-pointer border-b border-[var(--g-line-2)] last:border-b-0 ${on ? 'bg-[var(--g-soft)] shadow-[inset_2px_0_0_var(--g-acc)]' : 'hover:bg-[var(--g-soft)]'}`;
	const open_cls = 'col-span-full mt-1 cursor-default rounded-lg border border-[var(--g-line-2)] bg-[var(--g-bg)] px-3 py-2.5 text-[12.5px]';
	const key = (n: string) => (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); on_pick(n); } };
	const ins_on = selected === INPUTS_SEL;
	const required = inputs.filter((i) => i.required).length;
	return (
		<div role="table" aria-label="Inputs and phases" data-testid="phase-table">
			<div role="row" className={`${ROW} border-b border-[var(--g-line)] py-2 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[var(--g-ink-3)]`}>
				<span role="columnheader">Phase</span><span role="columnheader">Kind</span><span role="columnheader">Agent</span><span role="columnheader">What it does</span><span />
			</div>
			<div role="row" tabIndex={0} aria-expanded={ins_on} onClick={() => on_pick(INPUTS_SEL)} onKeyDown={key(INPUTS_SEL)} className={row_cls(ins_on)} data-team-row={INPUTS_SEL} data-testid="inputs-row">
				<span><b className="text-[13px]">Run inputs</b> <span className="text-[12px] text-[var(--g-ink-3)]">· asked on Run…</span></span>
				<span className="text-[12.5px] text-[var(--g-ink-2)]">start</span>
				<span className="text-[var(--g-ink-3)]">—</span>
				<span className="text-[12.5px] text-[var(--g-ink-3)]">{inputs.length ? `${inputs.length} input${inputs.length === 1 ? '' : 's'}${required ? ` · ${required} required` : ''}` : 'None — runs start straight away.'}</span>
				<span aria-hidden className="text-[var(--g-ink-3)]">{ins_on ? '⌄' : '›'}</span>
				{ins_on && inputs.length ? (
					<div className={open_cls} onClick={(e) => e.stopPropagation()} data-testid="inputs-open">
						<table className="w-full text-left">
							<thead><tr className="text-[10.5px] uppercase tracking-[0.06em] text-[var(--g-ink-3)]"><th className="pb-1 font-semibold">Input</th><th className="pb-1 font-semibold">Required</th><th className="pb-1 font-semibold">Default</th><th className="pb-1 font-semibold">Used by</th></tr></thead>
							<tbody>
								{inputs.map((i) => (
									<tr key={i.name} className="border-t border-[var(--g-line-2)] align-top" data-testid={`input-${i.name}`}>
										<td className="py-1.5 pr-3"><span className="g-mono">{i.name}</span>{i.description ? <p className="text-[12px] text-[var(--g-ink-3)]">{i.description}</p> : null}</td>
										<td className="py-1.5 pr-3">{i.required ? 'yes' : 'no'}</td>
										<td className="g-mono py-1.5 pr-3 text-[var(--g-ink-2)]">{i.default ?? '—'}</td>
										<td className="g-mono py-1.5 text-[var(--g-ink-2)]">{users.get(i.name)?.join(', ') || <span className="font-sans text-[var(--g-ink-3)]">not referenced</span>}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				) : null}
			</div>
			{all.map((p) => {
				const on = selected === p.name;
				const k = phase_kind(p);
				const used = inputs_used(p, team_yml, inputs);
				return (
					<div key={p.name} role="row" tabIndex={0} aria-expanded={on} onClick={() => on_pick(p.name)} onKeyDown={key(p.name)} className={row_cls(on)} data-team-row={p.name} data-testid="team-phase-row">
						<span className="min-w-0"><b className="g-mono text-[13px]">{p.name}</b>{p.support ? <span className="ml-1.5 text-[11.5px] text-[var(--g-ink-3)]">support</span> : null}{p.team ? <span className="ml-1.5 text-[12px] text-[var(--g-ink-3)]">↳ <span className="g-mono">{p.team}</span></span> : null}</span>
						<span className="flex items-center gap-1.5 text-[12.5px]"><Kind_tile phase={p} size={16} /><span style={{ color: k.color }}>{k.label}</span></span>
						<span className="g-mono truncate text-[12.5px] text-[var(--g-ink-2)]">{p.agent ?? '—'}</span>
						<span className="min-w-0 truncate text-[12.5px] text-[var(--g-ink-3)]" title={phase_line(p)}>{phase_line(p)}</span>
						<span aria-hidden className="text-[var(--g-ink-3)]">{on ? '⌄' : '›'}</span>
						{on ? (
							<div className={open_cls} onClick={(e) => e.stopPropagation()} data-testid="phase-open">
								<dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1">
									<dt className="text-[var(--g-ink-3)]">Runs after</dt><dd>{p.depends_on.length ? <span className="g-mono">{p.depends_on.join(', ')}</span> : 'the run inputs'}</dd>
									{p.team ? <><dt className="text-[var(--g-ink-3)]">Runs team</dt><dd className="g-mono">{p.team}</dd></> : null}
									{p.review || p.reviewers ? <><dt className="text-[var(--g-ink-3)]">Reviewed by</dt><dd>{p.reviewers ? readable_refs(p.reviewers) : 'a person'}</dd></> : null}
									{p.max_iterations ? <><dt className="text-[var(--g-ink-3)]">Rounds</dt><dd>up to {p.max_iterations}</dd></> : null}
									{used.length ? <><dt className="text-[var(--g-ink-3)]">Uses inputs</dt><dd className="g-mono">{used.join(', ')}</dd></> : null}
									{p.commands.length ? <><dt className="text-[var(--g-ink-3)]">Commands</dt><dd><pre className="g-mono whitespace-pre-wrap text-[12px] text-[var(--g-ink-2)]">{p.commands.join('\n')}</pre></dd></> : null}
								</dl>
								{p.role ? <pre className="mt-2 max-h-[240px] overflow-auto whitespace-pre-wrap border-t border-[var(--g-line-2)] pt-2 font-[inherit] text-[12.5px] leading-relaxed text-[var(--g-ink-2)]" data-testid="phase-brief">{p.role}</pre> : null}
							</div>
						) : null}
					</div>
				);
			})}
		</div>
	);
}

// ── page ─────────────────────────────────────────────────────────────────

export function Component() {
	// Opened from a realm (/o/:org/realms/:slug/teams/:scope/:name): the realm header stays on top.
	const { scope: scope_param = '', name = '', org: realm_org = '', slug: realm_slug = '' } = useParams();
	const in_realm = Boolean(realm_org && realm_slug);
	const team_scope = scope_param === '_' ? '' : scope_param;
	const navigate = useNavigate();
	const { pathname } = useLocation();
	const { user, scopes } = useAuth();
	const overview = use_overview();
	const access = use_access(overview.data);
	const sidebar_realm = in_realm ? overview.data?.orgs.find((o) => o.slug === realm_org)?.realms.find((r) => r.slug === realm_slug) ?? null : null;
	const runnable = access.realm(sidebar_realm?.id, 'operate', 'teams.run');
	const view_scope = use_view_scope(overview.data);
	const view_org = view_scope.kind === 'all' ? null : view_scope.org;
	const post = use_post();
	const [search, set_search] = useSearchParams();
	const version = search.get('v');
	const phase_sel = search.get('phase') ?? search.get('at');
	const file_sel = search.get('file');
	// Old links (?tab=files) open the YAML.
	const [mode, set_mode_state] = useState<Workflow_mode>(() => (search.get('tab') === 'files' ? 'yaml' : read_mode()));
	const [install_open, set_install_open] = useState(false);
	const [run_open, set_run_open] = useState(false);
	const [busy, set_busy] = useState<string | null>(null);
	const [edit_choice, set_edit_choice] = useState(false);
	const [msg, set_msg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
	const [confirm, set_confirm] = useState<string | null>(null);
	const [del_version, set_del_version] = useState('');
	/** Versions card page; null = the page holding the version being viewed. */
	const [ver_page_pick, set_ver_page] = useState<number | null>(null);
	/** Versions whose full release notes are shown. */
	const [notes_open, set_notes_open] = useState<Set<string>>(new Set());

	const set_params = (patch: Record<string, string | null>, replace = true) => set_search((prev) => {
		const p = new URLSearchParams(prev);
		for (const [k, v] of Object.entries(patch)) { if (v === null || v === '') p.delete(k); else p.set(k, v); }
		p.delete('tab');
		return p;
	}, { replace });
	function set_mode(m: Workflow_mode) {
		set_mode_state(m);
		try { localStorage.setItem(WORKFLOW_MODE_KEY, m); } catch { /* storage unavailable */ }
	}

	const body: Record<string, unknown> | null = team_scope && name && (overview.data || overview.status === 'error') ? {
		scope: team_scope, name, view: 'overview',
		...(version ? { version } : {}),
		...(view_org ? { org_id: view_org.id } : {}),
	} : null;
	const read = use_bff_read<Team_page_data>('/v1/team_page/get', body, { refresh_ms: 120_000, fallback_error: 'Could not load this team.' });
	const data = read.data;
	const team = data?.team ?? null;
	const o = data?.overview ?? null;
	const files = data?.files?.files ?? [];
	const team_yml = files.find((f) => f.path === 'team.yml')?.content ?? null;
	const label = team?.label ?? (team_scope ? `@${team_scope}/${name}` : name);
	const is_latest = !team || team.version === team.latest_version;
	const realms = useMemo(() => (overview.data?.orgs ?? []).filter((x) => !view_org || x.id === view_org.id).flatMap((x) => x.realms.map((r) => ({ id: r.id, slug: r.slug, name: r.name, org_slug: r.org_slug }))), [overview.data, view_org]);
	const phases = o?.phases ?? [];
	const all_phases = useMemo(() => [...phases, ...(o?.support ?? [])], [phases, o?.support]);
	const sel = all_phases.find((p) => p.name === phase_sel) ?? (in_realm ? null : phases[0] ?? null);
	const inputs_sel = in_realm && phase_sel === INPUTS_SEL;
	const used = useMemo(() => (sel && o ? inputs_used(sel, team_yml, o.inputs) : []), [sel, team_yml, o]);
	// A different version: any open confirmation was about the old one.
	useEffect(() => { set_confirm(null); }, [version]);

	/** Edit opens the team itself (`?draft=<id>`): autosave goes to its working copy, never a version. */
	function edit_href(fresh: boolean): string {
		return `/builder?draft=${encodeURIComponent(team?.id ?? '')}${fresh ? '&fresh=1' : ''}&from=${encodeURIComponent(pathname)}`;
	}
	function edit() {
		if (!team) return;
		if (team.draft_saved_at) set_edit_choice((v) => !v);
		else navigate(edit_href(false));
	}

	/** Fork: a copy of this version in your scope (`<name>-fork`, or the next free name), then open it. */
	async function fork() {
		if (!team) return;
		const scope = scopes?.[0]?.slug ?? user?.username ?? '';
		if (!scope) { set_msg({ tone: 'bad', text: 'You need a scope to fork into.' }); return; }
		set_busy('fork'); set_msg(null);
		try {
			for (const suffix of FORK_SUFFIXES) {
				const fork_name = `${team.name}${suffix}`.slice(0, 64);
				const res = await post('/v1/teams/create', { name: fork_name, scope, forked_from: { team_id: team.id, ...(team.version ? { version: team.version } : {}) } });
				if (res.ok) { navigate(team_href(scope, fork_name)); return; }
				if (res.status !== 409) { set_msg({ tone: 'bad', text: res.error }); return; }
			}
			set_msg({ tone: 'bad', text: `@${scope}/${team.name}-fork and the next few names are taken. Rename one of them, then fork again.` });
		} finally {
			set_busy(null);
		}
	}

	/**
	 * Download the version being viewed: its package (team.yml and role briefs) from the registry;
	 * team.yml alone when there's no package (a version made in the Builder or by a fork).
	 */
	async function download() {
		if (!team) return;
		set_busy('download'); set_msg(null);
		const save = (blob: Blob, filename: string) => {
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url; a.download = filename; a.click();
			setTimeout(() => URL.revokeObjectURL(url), 1000);
		};
		try {
			const res = await post('/v1/teams/download', { name: team.name, scope: team.scope ?? '', ...(team.version ? { version: team.version } : {}) });
			const pkg = res.ok ? res.data as { filename?: string; data_base64?: string } : null;
			if (pkg?.data_base64) {
				const bytes = Uint8Array.from(atob(pkg.data_base64), (c) => c.charCodeAt(0));
				save(new Blob([bytes], { type: 'application/zip' }), pkg.filename || `${team.name}-${team.version ?? 'latest'}.zip`);
				return;
			}
			if (team_yml) { save(new Blob([team_yml], { type: 'text/yaml' }), `${team.name}${team.version ? `-${team.version}` : ''}.team.yml`); return; }
			set_msg({ tone: 'bad', text: res.ok ? 'Nothing to download for this version.' : res.error });
		} finally {
			set_busy(null);
		}
	}

	/** Unpublish (Core removes it from every realm first, or refuses and changes nothing). */
	async function unpublish() {
		if (!team) return;
		set_busy('unpublish'); set_msg(null);
		const res = await post('/v1/teams/unpublish', { name: team.name, scope: team.scope });
		set_busy(null); set_confirm(null);
		if (!res.ok) { set_msg({ tone: 'bad', text: res.error }); return; }
		const from = (res.data as { uninstalled_from?: Array<{ realm_slug: string }> }).uninstalled_from ?? [];
		set_msg({ tone: 'ok', text: from.length ? `${label} is a draft again; removed from ${from.map((r) => r.realm_slug).join(', ')}.` : `${label} is a draft again.` });
		await read.reload();
	}

	async function act(key: string, path: string, payload: Record<string, unknown>, ok_text: string, after?: () => void) {
		set_busy(key); set_msg(null);
		const res = await post(path, payload);
		set_busy(null); set_confirm(null);
		if (!res.ok) { set_msg({ tone: 'bad', text: res.error }); return; }
		set_msg({ tone: 'ok', text: ok_text });
		if (after) after(); else await read.reload();
	}


	// ── header ──
	const header = (
		<div className="flex items-start gap-4">
			{in_realm ? null : <Team_avatar name={name} size={48} />}
			<div className="min-w-0 flex-1">
				{in_realm ? <nav aria-label="Back to teams" className="mb-0.5 text-[12.5px] text-[var(--g-ink-3)]"><Link to={`/o/${realm_org}/realms/${realm_slug}/teams`} className="hover:text-[var(--g-ink)]">All teams</Link> ›</nav> : null}
				<div className="flex flex-wrap items-center gap-2.5">
					{/* In a realm the realm's name is the page title; the team gets a small one under "All teams". */}
					{in_realm ? <h2 className="g-mono text-[16px] font-semibold" data-testid="team-title">{team?.name ?? name}</h2> : <h1 className="text-[22px] font-semibold tracking-tight">{team?.name ?? name}</h1>}
					{team && !in_realm ? <Status_badge status={team.status} /> : null}
					{team?.draft_saved_at && !in_realm ? <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-[var(--g-warn-soft)] px-2 py-0.5 text-[11.5px] font-semibold text-[var(--g-warn-text)]" title="Saved in the Builder, not published yet" data-testid="unpublished-pill"><i aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />Unpublished changes · {relative_time(Date.parse(team.draft_saved_at))}</span> : null}
				</div>
				{team?.description ? <p className="mt-1 max-w-[780px] text-[13px] text-[var(--g-ink-2)]">{team.description}</p> : null}
				<div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-[var(--g-ink-3)]" data-testid="team-meta">
					{in_realm && team ? (
						<span className="g-mono text-[var(--g-ink-2)]" data-testid="installed-version">{team.version ? `v${team.version} installed here` : 'installed here'}</span>
					) : team && team.versions.length ? (
						<select aria-label="Version" value={team.version ?? ''} onChange={(e) => set_params({ v: e.target.value === team.latest_version ? null : e.target.value }, false)} className={`${INPUT} h-6 w-[140px] text-[12px]`}>
							{team.versions.map((v) => <option key={v.version} value={v.version}>v{v.version}{v.is_latest ? ' · latest' : ''}</option>)}
						</select>
					) : null}
					<span className="g-mono text-[var(--g-ink-2)]">{label}</span>
					{team?.author ? <span>· by {team.author}</span> : null}
					{team?.tags.length ? <span>· {team.tags.join(' · ')}</span> : null}
				</div>
			</div>
			{/* In a realm a team can only be run (and viewed): no Fork, Download, Edit or Install. */}
			{in_realm && team?.scope && sidebar_realm ? (
				<button type="button" disabled={!runnable.ok} title={runnable.reason ?? undefined} onClick={() => set_run_open(true)} className={PRIMARY}><Play aria-hidden className="h-3.5 w-3.5" />Run…</button>
			) : null}
			{in_realm ? null : <div className="relative flex shrink-0 items-center gap-1.5">
				{team ? <button type="button" disabled={busy !== null} onClick={() => void fork()} className={`${ROW_ACTION_CLS} inline-flex items-center gap-1.5`} title="Copy this version into your scope and open the copy"><GitFork aria-hidden className="h-3.5 w-3.5" />{busy === 'fork' ? 'Forking…' : 'Fork'}</button> : null}
				{team && team.versions.length ? <button type="button" disabled={busy !== null} onClick={() => void download()} className={`${ROW_ACTION_CLS} inline-flex items-center gap-1.5`} title={`Download v${team.version} (team.yml and role briefs)`}><FileDown aria-hidden className="h-3.5 w-3.5" />{busy === 'download' ? 'Downloading…' : 'Download'}</button> : null}
				{team?.can_edit && is_latest ? <button type="button" disabled={busy !== null} onClick={edit} className={`${ROW_ACTION_CLS} inline-flex items-center gap-1.5`}><Pencil aria-hidden className="h-3.5 w-3.5" />Edit</button> : null}
				{team?.status === 'published' && team.scope ? <button type="button" aria-expanded={install_open} onClick={() => set_install_open((v) => !v)} className={PRIMARY}><Download aria-hidden className="h-3.5 w-3.5" />Install ▾</button> : null}
				{edit_choice && team?.draft_saved_at ? (
					<div role="dialog" aria-label="Edit" className="absolute right-0 top-full z-40 mt-1.5 w-[300px] rounded-[10px] border border-[var(--g-line-strong)] bg-[var(--g-pop)] p-3.5 text-left shadow-[var(--g-pop-shadow)]">
						<p className="text-[13px] font-semibold">You have unpublished changes</p>
						<p className="mt-0.5 text-[12px] text-[var(--g-ink-3)]">Saved {relative_time(Date.parse(team.draft_saved_at))}. Pick up where you left off, or start again from {team.latest_version ? `v${team.latest_version}` : 'the published team'}.</p>
						<div className="mt-3 flex flex-col gap-1.5">
							<button type="button" onClick={() => navigate(edit_href(false))} className={`${PRIMARY} justify-center`}>Resume my changes</button>
							<button type="button" onClick={() => navigate(edit_href(true))} className={`${ROW_ACTION_CLS} justify-center`}>Start from {team.latest_version ? `v${team.latest_version}` : 'published'}</button>
							{confirm === 'drop' ? (
								<span className="flex gap-1.5">
									<button type="button" disabled={busy !== null} onClick={() => void act('drop', '/v1/teams/update', { team_id: team.id, save_as: 'discard' }, 'Unpublished changes thrown away.', () => { set_edit_choice(false); void read.reload(); })} className={`${DANGER_BTN} flex-1`}>{busy === 'drop' ? 'Throwing away…' : 'Throw them away'}</button>
									<button type="button" onClick={() => set_confirm(null)} className={ROW_ACTION_CLS}>Keep</button>
								</span>
							) : (
								<button type="button" onClick={() => set_confirm('drop')} className="rounded-md px-2.5 py-1 text-[12px] text-[var(--g-bad)] hover:bg-[var(--g-bad-soft)]">Throw away my changes…</button>
							)}
						</div>
						<p className="mt-2 text-[11px] text-[var(--g-ink-3)]">Starting again replaces the unpublished changes once you edit; Discard in the Builder puts them back. Throwing them away can’t be undone.</p>
					</div>
				) : null}
				{install_open && team?.scope ? (
					<Install_popover label={label} scope={team.scope} name={team.name} realms={realms} installed={new Set((o?.installs ?? []).map((i) => i.realm_id))} on_close={() => set_install_open(false)} on_done={(m) => { set_install_open(false); set_msg({ tone: 'ok', text: m }); void read.reload(); }} />
				) : null}
			</div>}
		</div>
	);

	/** Pick a phase (or the Run inputs) — again to let go. The table scrolls to it. */
	function pick(n: string) {
		const next = phase_sel === n ? null : n;
		set_params({ phase: next });
		if (next) requestAnimationFrame(() => document.querySelector(`[data-team-row="${CSS.escape(next)}"]`)?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }));
	}

	// ── workflow (two modes) ──
	const mode_btn = (m: Workflow_mode, text: string, Icon: typeof Route) => (
		<button type="button" role="tab" aria-selected={mode === m} onClick={() => set_mode(m)} className={`inline-flex h-7 items-center gap-1.5 px-2.5 text-[12px] ${mode === m ? 'bg-[var(--g-soft)] font-semibold text-[var(--g-ink)]' : 'text-[var(--g-ink-3)] hover:text-[var(--g-ink)]'}`}>
			<Icon aria-hidden className="h-3.5 w-3.5" />{text}
		</button>
	);
	const workflow = o ? (
		<section className={CARD} data-testid="workflow">
			<div className={H3}>
				{in_realm ? 'Phases' : 'Workflow'} <span className="text-[12px] font-normal text-[var(--g-ink-3)]">{in_realm ? `${o.inputs.length} input${o.inputs.length === 1 ? '' : 's'} · ` : ''}{phases.length} phase{phases.length === 1 ? '' : 's'}{team?.version ? ` · v${team.version}` : ''}</span>
				<div role="tablist" aria-label="Workflow view" className="ml-auto flex overflow-hidden rounded-md border border-[var(--g-line-strong)]">
					{mode_btn('diagram', in_realm ? 'Phases' : 'Diagram', Route)}
					{mode_btn('yaml', 'YAML', Code)}
				</div>
			</div>
			{mode === 'diagram' && in_realm ? (
				<>
					<div className="border-b border-[var(--g-line)] bg-[var(--g-input)]" data-testid="team-graph">
						<Workflow_graph
							phases={phases}
							height={220}
							selected={sel?.name ?? null}
							on_select={(p) => pick(p)}
							start={{ inputs: o.inputs, selected: inputs_sel, on_select: () => pick(INPUTS_SEL) }}
						/>
					</div>
					<Phase_table phases={phases} support={o.support} inputs={o.inputs} team_yml={team_yml} selected={inputs_sel ? INPUTS_SEL : sel?.name ?? null} on_pick={pick} />
				</>
			) : mode === 'diagram' ? (
				<div className="bg-[var(--g-input)]">
					<Workflow_graph phases={phases} height={220} selected={sel?.name ?? null} on_select={(p) => set_params({ phase: p })} />
					<div className="flex flex-wrap items-center gap-3 px-3.5 pb-2.5">
						<Workflow_legend phases={phases} />
						{o.support.length ? <span className="ml-auto flex items-center gap-1.5 text-[11.5px] text-[var(--g-ink-3)]">support: {o.support.map((s) => <button key={s.name} type="button" aria-pressed={sel?.name === s.name} onClick={() => set_params({ phase: s.name })} className={`g-mono rounded border px-1.5 text-[11px] ${sel?.name === s.name ? 'border-[var(--g-acc-line)] text-[var(--g-ink)]' : 'border-[var(--g-line-2)] bg-[var(--g-soft)] text-[var(--g-ink-2)]'}`}>{s.name}</button>)}</span> : null}
					</div>
				</div>
			) : (
				<div className="p-3">
					<Yaml_view
						files={files}
						selected={file_sel}
						on_select={(f) => set_params({ file: f })}
						focus={sel?.name ?? null}
						on_focus={(n) => set_params({ phase: n })}
						version={team?.version ?? null}
						on_copied={(path) => set_msg({ tone: 'ok', text: `Copied ${path}.` })}
					/>
				</div>
			)}
			{sel && !in_realm ? (
				<div className="border-t border-[var(--g-line)] px-4 py-2.5" data-testid="selected-phase">
					<div className="flex flex-wrap items-center gap-2">
						<Kind_tile phase={sel} />
						<b className="g-mono text-[13px]">{sel.name}</b>
						<span className="text-[12px] text-[var(--g-ink-3)]">{phase_kind(sel).label}{sel.agent ? ` · ${sel.agent}` : ''}{sel.depends_on.length ? ` · after ${sel.depends_on.join(', ')}` : ''}</span>
					</div>
					<p className="mt-1 text-[12.5px] leading-relaxed text-[var(--g-ink-2)]">{phase_line(sel)}</p>
				</div>
			) : null}
		</section>
	) : null;

	// Agents the team uses (phases and support phases), with how many phases use each.
	const agent_rows = useMemo(() => {
		const n = new Map<string, number>();
		for (const p of all_phases) if (p.agent) n.set(p.agent, (n.get(p.agent) ?? 0) + 1);
		return [...n.entries()].map(([agent, count]) => ({ agent, count }));
	}, [all_phases]);
	const defs = o?.agent_defs ?? [];
	const RAIL_ROW = (on: boolean) => `border-b border-[var(--g-line-2)] px-4 py-2 last:border-b-0 ${on ? 'bg-[var(--g-acc-soft)] shadow-[inset_2px_0_0_var(--g-acc)]' : ''}`;
	const agent_def_lines = (d: { entry: string | null; env: string[] }) => (
		<>
			{d.entry ? <p className="g-mono mt-0.5 truncate text-[11.5px] text-[var(--g-ink-3)]" title={d.entry}>{d.entry}</p> : null}
			{d.env.length ? <p className="mt-0.5 text-[11.5px] text-[var(--g-ink-3)]">needs <span className="g-mono">{d.env.join(', ')}</span></p> : null}
		</>
	);
	/**
	 * Right 30%: what the team needs to run — Agents first (on the daemon, including ones the team
	 * defines), then Inputs (asked on Run); always listed, the selected phase's highlighted.
	 */
	const needs = o ? (
		<div className="flex flex-col gap-3.5 self-start xl:sticky xl:top-4" data-testid="needs">
			<section className={`${CARD} overflow-hidden`}>
				<div data-testid="agents">
					<h3 className={H3}>Agents <span className="text-[12px] font-normal text-[var(--g-ink-3)]">needed on the daemon to run{sel?.agent ? ` · ${sel.name} uses ${sel.agent}` : ''}</span></h3>
					{agent_rows.length === 0 && defs.length === 0 ? <p className="px-4 pb-3 text-[12.5px] text-[var(--g-ink-3)]">This team’s phases don’t name an agent.</p> : null}
					{agent_rows.map(({ agent, count }) => {
						const here = sel?.agent === agent;
						const def = defs.find((x) => x.name === agent);
						return (
							<div key={agent} data-testid={`agent-${agent}`} data-selected={here ? 'true' : undefined} className={RAIL_ROW(here)}>
								<div className="flex items-center gap-2">
									<span className="g-mono min-w-0 flex-1 truncate text-[12.5px]">{agent}</span>
									{def ? <span className="rounded bg-[var(--g-soft)] px-1.5 text-[11px] text-[var(--g-ink-2)]" title="Defined in this team’s team.yml">this team’s</span> : null}
									<span className="text-[11px] text-[var(--g-ink-3)]">{count} phase{count === 1 ? '' : 's'}</span>
								</div>
								{def ? agent_def_lines(def) : null}
							</div>
						);
					})}
					{defs.filter((x) => !agent_rows.some((r) => r.agent === x.name)).map((x) => (
						<div key={x.name} data-testid={`agent-${x.name}`} className={RAIL_ROW(false)}>
							<div className="flex items-center gap-2">
								<span className="g-mono min-w-0 flex-1 truncate text-[12.5px] text-[var(--g-ink-2)]">{x.name}</span>
								<span className="rounded bg-[var(--g-soft)] px-1.5 text-[11px] text-[var(--g-ink-2)]">this team’s</span>
								<span className="text-[11px] text-[var(--g-ink-3)]">no phase</span>
							</div>
							{agent_def_lines(x)}
						</div>
					))}
				</div>
			</section>
			<section className={`${CARD} overflow-hidden`}>
				<div data-testid="inputs">
					<h3 className={H3}>Inputs <span className="text-[12px] font-normal text-[var(--g-ink-3)]">asked on Run{sel ? ` · ${sel.name} uses ${used.length || 'none'}` : ''}</span></h3>
					{o.inputs.length === 0 ? <p className="px-4 pb-3 text-[12.5px] text-[var(--g-ink-3)]">No inputs — runs start straight away.</p> : null}
					{o.inputs.map((i) => {
						const on = used.includes(i.name);
						return (
							<div key={i.name} data-testid={`input-${i.name}`} data-used={on ? 'true' : undefined} className={RAIL_ROW(on)}>
								<div className="flex items-center gap-2">
									<span className={`g-mono min-w-0 flex-1 truncate text-[12.5px] ${on ? '' : 'text-[var(--g-ink-2)]'}`}>{i.name}</span>
									<span className={`g-mono rounded border border-[var(--g-line-2)] bg-[var(--g-soft)] px-1.5 text-[11px] ${i.required ? 'text-[var(--g-acc)]' : 'text-[var(--g-ink-2)]'}`}>{i.required ? 'required' : 'optional'}</span>
								</div>
								{i.description || i.default ? <p className="mt-0.5 truncate text-[12px] text-[var(--g-ink-3)]">{i.description ?? `default: ${i.default}`}</p> : null}
							</div>
						);
					})}
				</div>
			</section>
		</div>
	) : null;

	const ver_total = team?.versions.length ?? 0;
	const ver_pages = Math.max(1, Math.ceil(ver_total / VERSIONS_PAGE_SIZE));
	const viewing_at = Math.max(0, team?.versions.findIndex((v) => v.version === team.version) ?? 0);
	const ver_page = Math.min(ver_page_pick ?? Math.floor(viewing_at / VERSIONS_PAGE_SIZE), ver_pages - 1);
	const ver_from = ver_page * VERSIONS_PAGE_SIZE;
	const versions_card = team ? (
		<section className={CARD} data-testid="versions">
			<h3 className={H3}>Versions <span className="text-[12px] font-normal text-[var(--g-ink-3)]">{team.versions.length}</span></h3>
			{team.versions.length === 0 ? <p className="px-4 py-4 text-[12.5px] text-[var(--g-ink-3)]">Not published yet.</p> : (
				<ul>
					{team.versions.slice(ver_from, ver_from + VERSIONS_PAGE_SIZE).map((v) => {
						const viewing = v.version === team.version;
						return (
							<li key={v.version} data-testid={`version-${v.version}`} className="border-b border-[var(--g-line-2)] last:border-b-0">
								{(() => {
									const lines = (v.changelog ?? '').split('\n').filter((l) => l.trim());
									const open = notes_open.has(v.version);
									return (
										<div className={`flex items-start gap-2.5 px-4 py-2.5 ${viewing ? 'bg-[var(--g-soft)]' : ''}`}>
											<button type="button" disabled={viewing} onClick={() => set_params({ v: v.is_latest ? null : v.version, phase: null }, false)} className="g-mono w-[56px] shrink-0 text-left text-[12.5px] font-bold hover:underline disabled:no-underline" title={viewing ? 'Viewing' : `View v${v.version}`}>{v.version}</button>
											<span className="min-w-0 flex-1">
												<span className="flex flex-wrap items-center gap-2">
													{v.is_latest ? <span className="rounded-full bg-[var(--g-acc-soft)] px-2 py-px text-[11px] font-semibold text-[var(--g-acc)]">latest</span> : null}
													{viewing ? <span className="rounded-full bg-[var(--g-panel)] px-2 py-px text-[11px] text-[var(--g-ink-2)]">viewing</span> : null}
													<span className="text-[12px] text-[var(--g-ink-3)]">{v.published_at ? relative_time(v.published_at) : ''}</span>
												</span>
												{!lines.length ? <span className="mt-0.5 block text-[12.5px] text-[var(--g-ink-3)]">No release notes.</span>
													: open ? <pre className="mt-0.5 whitespace-pre-wrap font-[inherit] text-[12.5px] leading-relaxed text-[var(--g-ink-2)]" data-testid={`notes-${v.version}`}>{v.changelog}</pre>
														: <span className="mt-0.5 block truncate text-[12.5px] text-[var(--g-ink-2)]">{lines[0]}</span>}
												{lines.length > 1 || (lines[0]?.length ?? 0) > 90 ? (
													<button type="button" onClick={() => set_notes_open((prev) => { const n = new Set(prev); if (n.has(v.version)) n.delete(v.version); else n.add(v.version); return n; })} className="mt-0.5 text-[12px] text-[var(--g-acc)] hover:underline" aria-expanded={open}>{open ? 'less' : 'more'}</button>
												) : null}
											</span>
										</div>
									);
								})()}
							</li>
						);
					})}
				</ul>
			)}
			{ver_total > VERSIONS_PAGE_SIZE ? (
				<div className="flex items-center justify-end gap-2 border-t border-[var(--g-line)] px-4 py-2 text-[12px] text-[var(--g-ink-3)]" data-testid="versions-pager">
					<span>{ver_from + 1}–{Math.min(ver_from + VERSIONS_PAGE_SIZE, ver_total)} of {ver_total}</span>
					<button type="button" aria-label="Newer versions" disabled={ver_page === 0} onClick={() => set_ver_page(ver_page - 1)} className="grid h-7 w-7 place-items-center rounded-md border border-[var(--g-line)] disabled:opacity-40">‹</button>
					<button type="button" aria-label="Older versions" disabled={ver_page >= ver_pages - 1} onClick={() => set_ver_page(ver_page + 1)} className="grid h-7 w-7 place-items-center rounded-md border border-[var(--g-line)] disabled:opacity-40">›</button>
				</div>
			) : null}
		</section>
	) : null;

	const row = (title: string, text: string, control: ReactNode, last = false) => (
		<div className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-3.5 ${last ? '' : 'border-b border-[var(--g-line-2)]'}`}>
			<div><b className="text-[13px]">{title}</b><p className="mt-0.5 text-[12px] text-[var(--g-ink-3)]">{text}</p></div>
			<div className="flex items-center gap-1.5">{control}</div>
		</div>
	);
	const can_unpublish = Boolean(team?.can_edit && team.status === 'published');
	const can_delete_version = Boolean(team?.can_edit && team.status === 'published' && team.versions.length > 1);
	// In a realm the one thing to do with an installed team: take it off this realm.
	const realm_manage = access.realm(sidebar_realm?.id, 'operate', 'realms.teams.manage');
	const realm_danger = in_realm && team?.scope && sidebar_realm ? (
		<details className="rounded-[10px] border border-[var(--g-bad-line)] bg-[var(--g-panel)]" data-testid="realm-danger-zone">
			<summary className="cursor-pointer list-none px-4 py-3 text-[14px] font-semibold text-[var(--g-bad)]">Danger zone <span className="text-[12px] font-normal text-[var(--g-ink-3)]">· uninstall from {sidebar_realm.name || realm_slug}</span></summary>
			<div className="border-t border-[var(--g-line)]">
				{row(`Uninstall from ${sidebar_realm.name || realm_slug}`, 'Takes the team off this realm’s team list; its daemons uninstall it. Runs already finished stay. Other realms keep it.',
					confirm === 'uninstall'
						? <><button type="button" disabled={busy !== null} onClick={() => void act('uninstall', '/v1/realms/remove_team', { realm_id: sidebar_realm.id, scope: team.scope, slug: team.name }, `${label} uninstalled from ${sidebar_realm.name || realm_slug}.`, () => navigate(`/o/${realm_org}/realms/${realm_slug}/teams`, { replace: true }))} className={DANGER_BTN}>{busy === 'uninstall' ? 'Uninstalling…' : `Uninstall ${team.name}`}</button><button type="button" onClick={() => set_confirm(null)} className={ROW_ACTION_CLS}>Cancel</button></>
						: <button type="button" disabled={!realm_manage.ok} title={realm_manage.reason ?? undefined} onClick={() => set_confirm('uninstall')} className="rounded-md border border-[var(--g-bad-line)] px-3 py-1.5 text-[12px] font-semibold text-[var(--g-bad)] disabled:opacity-45">Uninstall…</button>,
					true)}
			</div>
		</details>
	) : null;
	const danger = team && (can_unpublish || can_delete_version || team.can_delete) ? (
		<details className="rounded-[10px] border border-[var(--g-bad-line)] bg-[var(--g-panel)]" data-testid="danger-zone">
			<summary className="cursor-pointer list-none px-4 py-3 text-[14px] font-semibold text-[var(--g-bad)]">Danger zone <span className="text-[12px] font-normal text-[var(--g-ink-3)]">· {[can_unpublish ? 'unpublish' : null, can_delete_version ? 'delete a version' : null, team.can_delete ? 'delete team' : null].filter(Boolean).join(', ')}</span></summary>
			<div className="border-t border-[var(--g-line)]">
			{can_unpublish ? row('Unpublish', 'Removes it from every realm that has it, then makes it a draft. If you can’t remove it from any one of those realms, nothing changes.',
				confirm === 'unpublish'
					? <><button type="button" disabled={busy !== null} onClick={() => void unpublish()} className={DANGER_BTN}>{busy === 'unpublish' ? 'Unpublishing…' : 'Uninstall everywhere and unpublish'}</button><button type="button" onClick={() => set_confirm(null)} className={ROW_ACTION_CLS}>Cancel</button></>
					: <button type="button" onClick={() => set_confirm('unpublish')} className={ROW_ACTION_CLS}>Unpublish…</button>,
				!can_delete_version && !team.can_delete) : null}
			{can_delete_version ? row('Delete a version', 'Removes one older version from the registry.', (
				<>
					<select aria-label="Version to delete" value={del_version} onChange={(e) => { set_del_version(e.target.value); set_confirm(null); }} className={`${INPUT} w-[120px]`}>
						<option value="">Pick…</option>
						{team.versions.filter((v) => !v.is_latest).map((v) => <option key={v.version} value={v.version}>{v.version}</option>)}
					</select>
					{confirm === 'delver'
						? <><button type="button" disabled={busy !== null} onClick={() => void act('delver', '/v1/teams/delete_version', { name: team.name, scope: team.scope, version: del_version }, `Deleted ${del_version}.`)} className={DANGER_BTN}>Delete {del_version}</button><button type="button" onClick={() => set_confirm(null)} className={ROW_ACTION_CLS}>Cancel</button></>
						: <button type="button" disabled={!del_version} onClick={() => set_confirm('delver')} className={ROW_ACTION_CLS}>Delete version…</button>}
				</>
			), !team.can_delete) : null}
			{team.can_delete ? row('Delete team', 'Removes it and every version from the registry and from every realm’s team list. Can’t be undone.',
				confirm === 'delete'
					? <><button type="button" disabled={busy !== null} onClick={() => void act('delete', '/v1/teams/delete', { name: team.name, scope: team.scope }, `Deleted ${label}.`, () => navigate('/teams', { replace: true }))} className={DANGER_BTN}>{busy === 'delete' ? 'Deleting…' : `Delete ${team.name}`}</button><button type="button" onClick={() => set_confirm(null)} className={ROW_ACTION_CLS}>Cancel</button></>
					: <button type="button" onClick={() => set_confirm('delete')} className="rounded-md border border-[var(--g-bad-line)] px-3 py-1.5 text-[12px] font-semibold text-[var(--g-bad)]">Delete team…</button>,
				true) : null}
			</div>
		</details>
	) : null;

	return (
		<Graphite_shell data={overview.data} title={team?.name ?? name} current_realm_id={sidebar_realm?.id ?? null}>
			<Realm_nav off={!in_realm} org_slug={realm_org} slug={realm_slug} realm={sidebar_realm} item={team?.name ?? name}>
			<div className={`flex flex-col gap-3.5 ${in_realm ? '' : 'px-7 py-6'}`}>
				{/* In a realm the realm header's Teams button leads back; no second breadcrumb. */}
				{in_realm ? null : <nav aria-label="Breadcrumb" className="text-[12.5px] text-[var(--g-ink-3)]"><Link to={view_org ? `/teams?org=${encodeURIComponent(view_org.slug)}` : '/teams'} className="hover:text-[var(--g-ink)]">Teams</Link> › <span className="text-[var(--g-ink-2)]">{label}</span></nav>}
				{read.status === 'error' && !data ? (
					<Blocking_error http_status={read.http_status} code={read.code} error={read.error} on_retry={() => void read.reload()} what="team" />
				) : (
					<>
						{header}
						{msg ? <p role={msg.tone === 'bad' ? 'alert' : 'status'} className={`text-[12.5px] ${msg.tone === 'bad' ? 'text-[var(--g-bad)]' : 'text-[var(--g-ok)]'}`}>{msg.text}</p> : null}
						{data?.partial ? <p className="text-[11.5px] text-[var(--g-ink-3)]">Some of this couldn’t be loaded — what’s shown may be incomplete.</p> : null}
						{!o ? <div className="h-[420px] animate-pulse rounded-xl border border-[var(--g-line)] bg-[var(--g-panel)]" aria-busy="true" aria-label="Loading" /> : (
							<>
								<div className={`grid grid-cols-1 items-start gap-3.5 ${in_realm ? '' : 'xl:grid-cols-[minmax(0,7fr)_minmax(260px,3fr)]'}`}>
									{/* In a realm: only the installed version — no version history; its danger zone is uninstalling from the realm. */}
								<div className="flex min-w-0 flex-col gap-3.5">{workflow}{in_realm ? null : versions_card}{in_realm ? realm_danger : danger}</div>
									{in_realm ? null : needs}
								</div>
								{run_open && team?.scope && sidebar_realm ? <Run_in_realm_dialog scope={team.scope} slug={team.name} fixed_realm={{ id: sidebar_realm.id, slug: sidebar_realm.slug, name: sidebar_realm.name }} on_close={() => set_run_open(false)} /> : null}
							</>
						)}
					</>
				)}
			</div>
			</Realm_nav>
		</Graphite_shell>
	);
}
