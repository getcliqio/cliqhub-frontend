/**
 * Build › Teams › one team (Graphite). Tabs, grouped:
 *   Define  — Overview · Workflow · Files
 *   Operate — Runs · Installs
 *   Ship    — Versions · Settings (only for people who can edit)
 * Read: one `POST /v1/team_page/get` per tab (BFF composes Core). Writes are
 * single existing routes (orgs/add_team, realms/add_team, realms/remove_team,
 * teams/create with forked_from, teams/rename, teams/unpublish,
 * teams/delete_version, teams/delete).
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ArrowRight, Copy, Download, GitFork, Play, Plus, RefreshCw } from 'lucide-react';
import { useAuthFetch } from '@/lib/auth_context';
import { relative_time, use_overview } from '@/lib/overview';
import { api_message, use_bff_read } from '@/lib/use_bff_read';
import { use_view_scope } from '@/lib/view_scope';
import { run_href } from '@/lib/realm_inbox';
import {
	REVIEW_COLOR, phase_kind, team_href, type Team_install, type Team_page_data, type Team_phase, type Team_view,
} from '@/lib/team_page';
import { Graphite_shell } from '@/components/graphite/graphite_shell';
import { ROW_ACTION_CLS } from '@/components/graphite/g_kinds';
import { State_pill } from '@/components/graphite/g_status';
import { Workflow_graph, Workflow_legend } from '@/components/graphite/g_workflow_graph';
import { New_run_drawer } from '@/components/graphite/g_new_run';
import { Sort_th, sort_rows, use_table_sort } from '@/components/graphite/g_sort';
import { Blocking_error } from '@/pages/realm/realm_inbox_page';
import { Status_badge, Team_avatar } from '@/pages/teams/teams_graphite_page';
import { Add_team_drawer, Fork_dialog, Lineage_strip } from '@/components/graphite/g_team_get';

export const TEAM_RUNS_PAGE_SIZE = 25;
const PRIMARY = 'inline-flex items-center gap-1.5 rounded-md bg-[var(--g-acc)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--g-on-acc)] hover:bg-[var(--g-acc-hover)] disabled:opacity-50';
const INPUT = 'h-8 rounded-md border border-[var(--g-line)] bg-[var(--g-bg)] px-2.5 text-[12.5px] text-[var(--g-ink)] outline-none focus:border-[var(--g-acc-line)]';
const PILL = (on: boolean) => `inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[12.5px] ${on ? 'border-[var(--g-acc-line)] bg-[var(--g-acc-soft)] text-[var(--g-ink)]' : 'border-[var(--g-line)] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]'}`;
const CARD = 'rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)]';
const H3 = 'flex items-center gap-2.5 border-b border-[var(--g-line)] px-4 py-3 text-[14px] font-semibold';
const H5 = 'mb-2.5 flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--g-ink-3)]';

const VIEWS: Team_view[] = ['overview', 'workflow', 'files', 'runs', 'installs', 'versions', 'settings'];
const TAB_LABEL: Record<Team_view, string> = { overview: 'Overview', workflow: 'Workflow', files: 'Files', runs: 'Runs', installs: 'Installs', versions: 'Versions', settings: 'Settings' };
const GROUPS: Team_view[][] = [['overview', 'workflow', 'files'], ['runs', 'installs'], ['versions', 'settings']];

function use_post() {
	const auth_fetch = useAuthFetch();
	return async (path: string, body: Record<string, unknown>): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> => {
		try {
			const res = await auth_fetch(path, { method: 'POST', body: JSON.stringify(body) });
			const payload = await res.json().catch(() => null);
			if (!res.ok || !payload?.ok) return { ok: false, error: api_message(payload, 'Request failed') };
			return { ok: true, data: payload.data ?? payload };
		} catch {
			return { ok: false, error: 'Network error — check your connection.' };
		}
	};
}

function Kind_tile({ type, size = 18 }: { type: string | Team_phase; size?: number }) {
	const k = phase_kind(type);
	return <span aria-hidden className="grid shrink-0 place-items-center rounded-[5px] font-bold" style={{ width: size, height: size, fontSize: size * 0.6, color: k.color, background: `${k.color}26` }}>{k.glyph}</span>;
}

function Kv({ rows }: { rows: Array<[string, ReactNode]> }) {
	return (
		<dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[12.5px]">
			{rows.map(([k, v]) => [<dt key={`k-${k}`} className="text-[var(--g-ink-3)]">{k}</dt>, <dd key={`v-${k}`} className="min-w-0 break-words text-[var(--g-ink-2)]">{v}</dd>])}
		</dl>
	);
}
const mono = (s: string) => <span className="g-mono">{s}</span>;

// ── Workflow inspector (per phase type; role only when the version has one) ──

export function Phase_inspector({ phase, phases, statuses, run_name, on_open_file }: { phase: Team_phase; phases: Team_phase[]; statuses: Record<string, string> | null; run_name: string | null; on_open_file: (path: string) => void }) {
	const k = phase_kind(phase);
	const kind = k.id;
	const feeds = phases.filter((p) => p.depends_on.includes(phase.name)).map((p) => p.name);
	const config: Array<[string, ReactNode]> = [
		['kind', k.label],
		['type', mono(phase.type)],
		...(phase.agent ? [['agent', mono(phase.agent)] as [string, ReactNode]] : []),
		['depends on', phase.depends_on.length ? mono(phase.depends_on.join(', ')) : '—'],
		['feeds', feeds.length ? mono(feeds.join(', ')) : '—'],
		...(phase.max_iterations ? [['max iterations', mono(String(phase.max_iterations))] as [string, ReactNode]] : []),
		...(phase.support ? [['support', 'callable by any phase'] as [string, ReactNode]] : []),
	];
	const status = statuses?.[phase.name];
	const head = (what: string | null) => <h5 className={H5}><Kind_tile type={phase} /><b className="text-[13px] normal-case tracking-normal text-[var(--g-ink)]">{phase.name}</b>{what ? ` · ${what}` : null}</h5>;
	const cmds = phase.commands.length ? <pre className="g-mono rounded-lg border border-[var(--g-line)] bg-[#0e0f11] px-3 py-2.5 text-[12px] leading-[1.9] text-[var(--g-ink-2)]">{phase.commands.map((c) => `$ ${c}`).join('\n')}</pre> : null;
	const urls = (list: string[]) => <ul className="g-mono space-y-1 text-[12px] text-[var(--g-ink-2)]">{list.map((s) => <li key={s} className="break-all">{s}</li>)}</ul>;
	// First column: the most specific thing this kind of phase has.
	let primary: ReactNode;
	if (kind === 'human') {
		primary = (
			<>
				{head('human review')}
				<Kv rows={[['reviewers', phase.reviewers ? mono(phase.reviewers) : 'set when run'], ['waits for', 'a person to approve or send back']]} />
				{phase.role ? <pre className="mt-2.5 whitespace-pre-wrap font-[inherit] text-[12.5px] leading-relaxed text-[var(--g-ink-2)]" data-testid="role-brief">{phase.role.split('\n').slice(0, 8).join('\n')}</pre> : null}
			</>
		);
	} else if (phase.role && (kind === 'agent' || kind === 'gate' || kind === 'team')) {
		const lines = phase.role.split('\n');
		primary = (
			<>
				<h5 className={H5}><Kind_tile type={phase} /><b className="text-[13px] normal-case tracking-normal text-[var(--g-ink)]">{phase.name}</b> · {kind === 'gate' ? 'verdict criteria' : kind === 'team' ? 'what the sub-team should do' : 'role brief'}
					<button type="button" onClick={() => on_open_file(`roles/${phase.name}.md`)} className="ml-auto text-[12px] normal-case tracking-normal text-[var(--g-acc)] hover:underline">roles/{phase.name}.md →</button></h5>
				<pre className="whitespace-pre-wrap font-[inherit] text-[12.5px] leading-relaxed text-[var(--g-ink-2)]" data-testid="role-brief">{lines.slice(0, 12).join('\n')}</pre>
				{lines.length > 12 ? <p className="mt-1 text-[12px] text-[var(--g-ink-3)]">… {lines.length - 12} more lines</p> : null}
				{kind === 'gate' && cmds ? <div className="mt-2.5">{cmds}</div> : null}
			</>
		);
	} else if (kind === 'gate') {
		primary = <>{head('checks')}{cmds ?? <p className="text-[12.5px] text-[var(--g-ink-3)]">No checks listed.</p>}</>;
	} else if (kind === 'script') {
		primary = <>{head('commands')}{cmds ?? <p className="text-[12.5px] text-[var(--g-ink-3)]">No commands listed.</p>}</>;
	} else if (kind === 'connector' || kind === 'fetch') {
		primary = (
			<>
				{head(kind === 'fetch' ? 'fetch' : phase.agent ? `${phase.agent} connector` : 'connector')}
				{phase.sources.length ? <><p className="mb-1 text-[11px] uppercase tracking-[0.07em] text-[var(--g-ink-3)]">reads</p>{urls(phase.sources)}</> : null}
				{phase.targets.length ? <><p className="mb-1 mt-2 text-[11px] uppercase tracking-[0.07em] text-[var(--g-ink-3)]">writes</p>{urls(phase.targets)}</> : null}
				{!phase.sources.length && !phase.targets.length ? <p className="text-[12.5px] text-[var(--g-ink-3)]">No sources or targets listed.</p> : null}
			</>
		);
	} else if (kind === 'team') {
		const m = /^@?([^/]+)\/(.+)$/.exec(phase.team ?? '');
		primary = (
			<>
				{head('sub-team')}
				{m ? <Link to={team_href(m[1], m[2])} className="text-[13px] text-[var(--g-acc)] hover:underline">{phase.team} →</Link> : <p className="text-[12.5px] text-[var(--g-ink-3)]">{phase.team ?? 'Sub-team not named.'}</p>}
			</>
		);
	} else {
		primary = <>{head(null)}<p className="text-[12.5px] text-[var(--g-ink-3)]">This phase has no role brief in this version.</p></>;
	}
	const third = kind === 'human' ? (
		<div>
			<h5 className={H5}><i aria-hidden className="h-2 w-2 rounded-full" style={{ background: REVIEW_COLOR }} />Outcomes</h5>
			<Kv rows={[['approve', 'continue'], ['send back', phase.depends_on.length ? `to ${phase.depends_on.join(' / ')} with notes` : 'upstream with notes']]} />
		</div>
	) : phase.review ? (
		<div>
			<h5 className={H5}><i aria-hidden className="h-2 w-2 rounded-full" style={{ background: REVIEW_COLOR }} />Human review</h5>
			<Kv rows={[['reviewers', phase.reviewers ? mono(phase.reviewers) : 'set when run'], ['on approve', 'continue'], ['on changes', `back to ${phase.name} with notes`]]} />
		</div>
	) : kind === 'gate' ? (
		<div>
			<h5 className={H5}><span className="text-[#f5a524]">↺</span> Verdicts</h5>
			<Kv rows={[['pass', 'continue'], ['route', phase.depends_on.length ? `back to ${phase.depends_on.join(' / ')}` : 'back upstream'], ['budget', phase.max_iterations ? `${phase.max_iterations} tries, then escalate` : '—']]} />
		</div>
	) : null;
	return (
		<div className={`grid ${third ? 'grid-cols-[1.25fr_1fr_1fr]' : 'grid-cols-[1.25fr_1fr]'} overflow-hidden rounded-xl border border-[var(--g-line)] bg-[var(--g-panel)]`} data-testid="phase-inspector">
			<div className="min-w-0 border-r border-[var(--g-line)] px-4 py-3.5">{primary}</div>
			<div className={`min-w-0 px-4 py-3.5 ${third ? 'border-r border-[var(--g-line)]' : ''}`}>
				<h5 className={H5}>Configuration</h5>
				<Kv rows={config} />
				{run_name ? <p className="mt-3 text-[12px] text-[var(--g-ink-3)]">In {run_name}: {status ? <State_pill state={status} /> : 'not started'}</p> : null}
			</div>
			{third ? <div className="min-w-0 px-4 py-3.5">{third}</div> : null}
		</div>
	);
}

function Coverage({ i }: { i: Team_install }) {
	const n = Math.max(i.online_daemon_count, i.installed_count);
	if (!n) return <span className="text-[var(--g-ink-3)]">no daemons online</span>;
	const short = i.installed_count < i.online_daemon_count;
	return (
		<span className="inline-flex items-center gap-2.5">
			<span className="inline-flex gap-[3px]" aria-hidden>{Array.from({ length: Math.min(n, 12) }, (_, k) => <i key={k} className="block h-2.5 w-2.5 rounded-[3px]" style={{ background: k < i.installed_count ? 'var(--g-ok)' : '#2c2f35' }} />)}</span>
			<span className={`g-mono ${short ? 'text-[var(--g-warn-text)]' : 'text-[var(--g-ink-3)]'}`}>{Math.min(i.installed_count, n)}/{i.online_daemon_count || n}</span>
		</span>
	);
}

function highlight_yaml(line: string): ReactNode {
	const c = /^(\s*)(#.*)$/.exec(line);
	if (c) return <>{c[1]}<span className="text-[#5d616b]">{c[2]}</span></>;
	const m = /^(\s*-?\s*)([A-Za-z0-9_.-]+)(:)(.*)$/.exec(line);
	if (!m) return line;
	const val = m[4];
	const cls = /^\s*(true|false|\d+(\.\d+)?)\s*$/.test(val) ? 'text-[#f5a524]' : 'text-[#b5e27a]';
	return <>{m[1]}<span className="text-[#8fb4ff]">{m[2]}</span>{m[3]}<span className={cls}>{val}</span></>;
}

// ── page ─────────────────────────────────────────────────────────────────

export function Component() {
	const { scope: scope_param = '', name = '' } = useParams();
	const team_scope = scope_param === '_' ? '' : scope_param;
	const navigate = useNavigate();
	const overview = use_overview();
	const view_scope = use_view_scope(overview.data);
	const view_org = view_scope.kind === 'all' ? null : view_scope.org;
	const post = use_post();
	const [search, set_search] = useSearchParams();
	const tab = ((t) => (VIEWS.includes(t as Team_view) ? t : 'overview'))(search.get('tab') ?? '') as Team_view;
	const version = search.get('v');
	const run_sel = search.get('run') ?? 'latest';
	const phase_sel = search.get('phase');
	const file_sel = search.get('file');
	const runs_state = ((v) => (v === 'running' || v === 'awaiting_input' || v === 'failed' ? v : null))(search.get('state'));
	const runs_realm = search.get('realm');
	const runs_q = search.get('q') ?? '';
	const runs_page = Math.max(0, Number(search.get('page') ?? 0) || 0);
	const cmp_from = search.get('from');
	const cmp_to = search.get('to');
	const [q_draft, set_q_draft] = useState(runs_q);
	const [running, set_running] = useState<false | { realm_id: string | null }>(false);
	const [adding, set_adding] = useState(false);
	const [forking, set_forking] = useState(false);
	const [busy, set_busy] = useState<string | null>(null);
	const [msg, set_msg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
	const [confirm, set_confirm] = useState<string | null>(null);
	const [new_name, set_new_name] = useState(name);
	const [del_version, set_del_version] = useState('');

	const set_params = (patch: Record<string, string | null>, replace = false) => set_search((prev) => {
		const p = new URLSearchParams(prev);
		for (const [k, v] of Object.entries(patch)) { if (v === null || v === '') p.delete(k); else p.set(k, v); }
		return p;
	}, { replace });
	const go_tab = (t: Team_view, extra: Record<string, string | null> = {}) => {
		set_msg(null);
		set_params({ tab: t === 'overview' ? null : t, state: null, realm: null, q: null, page: null, from: null, to: null, ...extra });
	};
	useEffect(() => { const t = setTimeout(() => { if (tab === 'runs' && q_draft.trim() !== runs_q) set_params({ q: q_draft.trim() || null, page: null }, true); }, 300); return () => clearTimeout(t); }, [q_draft]); // eslint-disable-line react-hooks/exhaustive-deps

	// Runs tab: sorted by Core (runs/get sort_by), so it is right across pages; default = last updated first.
	// Installs tab: every realm checked is in the answer (no paging), so sorting here is exact.
	const installs_sort = use_table_sort({ keys: ['realm', 'version', 'daemons', 'last_run_at'], mode: 'client', param: 'installs', first_dir: { daemons: 'desc', last_run_at: 'desc' } });
	const runs_sort = use_table_sort({ keys: ['run_name', 'state', 'started_at', 'last_updated_at'], default_sort: { by: 'last_updated_at', dir: 'desc' }, first_dir: { started_at: 'desc', last_updated_at: 'desc' } });
	const body: Record<string, unknown> | null = team_scope && name && (overview.data || overview.status === 'error') ? {
		scope: team_scope, name, view: tab,
		...(version ? { version } : {}),
		...(view_org ? { org_id: view_org.id } : {}),
		...(tab === 'workflow' && run_sel !== 'none' ? { run_id: run_sel } : {}),
		...(tab === 'versions' && cmp_from ? { compare_from: cmp_from } : {}),
		...(tab === 'versions' && cmp_to ? { compare_to: cmp_to } : {}),
		...(tab === 'runs' ? { limit: TEAM_RUNS_PAGE_SIZE, offset: runs_page * TEAM_RUNS_PAGE_SIZE, ...(runs_state ? { state: runs_state } : {}), ...(runs_realm ? { realm_id: runs_realm } : {}), ...runs_sort.body, ...(runs_q ? { q: runs_q } : {}) } : {}),
	} : null;
	const read = use_bff_read<Team_page_data>('/v1/team_page/get', body, { refresh_ms: tab === 'runs' || tab === 'workflow' ? 30_000 : 120_000, fallback_error: 'Could not load this team.' });
	const run_cols = runs_sort.with_sortable(read.data?.runs?.sortable);
	const any_data = read.data;
	// Header survives tab switches; the body only renders data for this tab.
	const data = any_data && any_data.view === tab ? any_data : null;
	const team = any_data?.team ?? null;
	const label = team?.label ?? (team_scope ? `@${team_scope}/${name}` : name);
	const is_latest = !team || team.version === team.latest_version;
	const can_settings = Boolean(team && (team.can_edit || team.can_delete));
	// A team runs only in a realm that has it, and joins one of your orgs before any of its realms.
	const org_states = team?.orgs ?? null;
	const in_org = org_states === null || org_states.some((o) => o.in_library || o.own);
	const in_realm = org_states === null || org_states.some((o) => o.realms.length > 0);
	const can_add = Boolean(team?.status === 'published' && team.scope);
	const where = (org_states ?? []).filter((o) => o.in_library || o.own);
	const realm_by_id = useMemo(() => new Map((overview.data?.orgs ?? []).flatMap((o) => o.realms).map((r) => [r.id, r])), [overview.data]);

	/** Owners edit the team itself: the Builder saves a working copy until a version is published. */
	function open_builder() {
		if (!team) return;
		navigate(`/builder?draft=${encodeURIComponent(team.id)}&from=${encodeURIComponent(window.location.pathname)}`);
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
	const header = (full: boolean) => (
		<div className={`flex gap-4 ${full ? 'items-start' : 'items-center'}`}>
			<Team_avatar name={name} size={full ? 52 : 32} />
			<div className="min-w-0 flex-1">
				<div className="flex flex-wrap items-center gap-2.5">
					<h1 className={`${full ? 'text-[22px]' : 'text-[18px]'} font-semibold tracking-tight`}>{team?.name ?? name}</h1>
					<span className="g-mono rounded border border-[var(--g-line-2)] bg-[var(--g-soft)] px-1.5 py-px text-[11px] text-[var(--g-ink-2)]">{label}</span>
					{team ? <Status_badge status={team.status} /> : null}
					{team && team.versions.length ? (
						<select aria-label="Version" value={team.version ?? ''} onChange={(e) => set_params({ v: e.target.value === team.latest_version ? null : e.target.value, from: null, to: null })} className={`${INPUT} h-7 w-[150px]`}>
							{team.versions.map((v) => <option key={v.version} value={v.version}>v{v.version}{v.is_latest ? ' · latest' : ''}</option>)}
						</select>
					) : null}
				</div>
				{full && team?.description ? <p className="mt-1.5 max-w-[780px] text-[13px] text-[var(--g-ink-2)]">{team.description}</p> : null}
				{full && team?.author ? <p className="mt-1 text-[12px] text-[var(--g-ink-3)]">by {team.author}{team.tags.length ? ` · ${team.tags.join(' · ')}` : ''}{team.fork_count ? ` · ${team.fork_count} fork${team.fork_count === 1 ? '' : 's'}` : ''}</p> : null}
				{full && org_states !== null ? (
					<p className="mt-1 text-[12px] text-[var(--g-ink-3)]" data-testid="team-where">
						{where.length ? where.map((o, i) => <span key={o.org_id}>{i ? ' · ' : 'In '}<b className="font-medium text-[var(--g-ink-2)]">{o.org_name}</b>{o.realms.length ? ` (${o.realms.map((r) => r.slug).join(', ')})` : ' — not in a realm yet'}</span>)
							: 'Not in any of your orgs yet. Add it to your org and a realm to run it, or fork it to make your own version.'}
					</p>
				) : null}
				{full && team?.can_edit && team.draft_saved_at ? <p className="mt-1 text-[12px] text-[var(--g-warn-text)]">Unpublished changes saved {relative_time(Date.parse(team.draft_saved_at))} — <button type="button" onClick={open_builder} className="underline">continue in the Builder</button></p> : null}
			</div>
			<div className="relative flex shrink-0 items-center gap-1.5">
				{team?.can_edit && is_latest ? <button type="button" onClick={open_builder} className={ROW_ACTION_CLS}>Open in Builder</button> : null}
				{team && team.versions.length ? <button type="button" onClick={() => set_forking(true)} className={`${ROW_ACTION_CLS} inline-flex items-center gap-1.5`}><GitFork aria-hidden className="h-3.5 w-3.5" />{team.can_edit ? 'Fork' : 'Fork to edit'}</button> : null}
				{can_add && in_realm ? <button type="button" onClick={() => set_adding(true)} className={`${ROW_ACTION_CLS} inline-flex items-center gap-1.5`}><Plus aria-hidden className="h-3.5 w-3.5" />Add to a realm</button> : null}
				{can_add && !in_realm ? (
					<button type="button" onClick={() => set_adding(true)} className={`${PRIMARY} px-4 py-2 text-[13px]`}><Plus aria-hidden className="h-3.5 w-3.5" />{in_org ? 'Add to a realm' : 'Add to your org'}</button>
				) : null}
				{team?.status === 'published' && team.scope && in_realm ? <button type="button" onClick={() => set_running({ realm_id: null })} className={`${PRIMARY} px-4 py-2 text-[13px]`}><Play aria-hidden className="h-3.5 w-3.5" />Run…</button> : null}
			</div>
		</div>
	);

	const count_of = (v: Team_view): string | null => {
		if (!data) return null;
		if (v === 'workflow') return String(data.counts.phases);
		if (v === 'files' && data.files) return String(data.files.files.length);
		if (v === 'runs') return data.counts.runs === null ? null : String(data.counts.runs);
		if (v === 'installs' && (data.installs || data.overview)) return String((data.installs?.items ?? data.overview?.installs ?? []).length);
		if (v === 'versions') return String(data.counts.versions);
		return null;
	};
	const tabs = (
		<nav aria-label="Team" className="flex items-center gap-0.5 border-b border-[var(--g-line)]">
			{GROUPS.map((g, gi) => (
				<span key={gi} className="flex items-center">
					{gi ? <span aria-hidden className="mx-2 h-4 w-px bg-[var(--g-line)]" /> : null}
					{g.filter((v) => v !== 'settings' || can_settings).map((v) => {
						const n = count_of(v);
						return (
							<button key={v} type="button" aria-current={tab === v ? 'page' : undefined} onClick={() => go_tab(v)} className={`-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-[13px] font-medium ${tab === v ? 'border-[var(--g-acc)] text-[var(--g-ink)]' : 'border-transparent text-[var(--g-ink-3)] hover:text-[var(--g-ink)]'}`}>
								{TAB_LABEL[v]}{n !== null ? <span className="g-mono text-[11px] text-[var(--g-ink-3)]">{n}</span> : null}
							</button>
						);
					})}
				</span>
			))}
		</nav>
	);

	// ── tab bodies ──
	let content: ReactNode = null;
	if (data?.overview) {
		const o = data.overview;
		content = (
			<>
				<div className="relative overflow-hidden rounded-xl border border-[var(--g-line)] bg-[#0d0e10]">
					<div className="absolute left-3.5 top-3 z-10 flex items-center gap-2"><b className="text-[13px]">Workflow</b><span className="text-[12px] text-[var(--g-ink-3)]">{o.phases.length} phases{team?.version ? ` · v${team.version}` : ''}</span></div>
					<button type="button" onClick={() => go_tab('workflow')} className="absolute right-3 top-2.5 z-10 inline-flex h-7 items-center gap-1.5 rounded-md border border-[#2c2f35] bg-[rgba(22,23,26,.85)] px-2.5 text-[12px] text-[var(--g-ink-2)] hover:text-[var(--g-ink)]">Open workflow <ArrowRight aria-hidden className="h-3 w-3" /></button>
					<div className="pt-9"><Workflow_graph phases={o.phases} height={200} on_select={(p) => go_tab('workflow', { phase: p })} /></div>
					<div className="flex flex-wrap items-center gap-3 px-3.5 pb-2.5"><Workflow_legend phases={o.phases} />{o.support.length ? <span className="ml-auto flex items-center gap-1.5 text-[11.5px] text-[var(--g-ink-3)]">support: {o.support.map((s) => <span key={s.name} className="g-mono rounded border border-[var(--g-line-2)] bg-[var(--g-soft)] px-1.5 text-[11px] text-[var(--g-ink-2)]">{s.name}</span>)}</span> : null}</div>
				</div>
				<div className="grid grid-cols-[1fr_1fr_330px] gap-3.5">
					<section className={CARD}>
						<h3 className={H3}>Inputs <span className="text-[12px] font-normal text-[var(--g-ink-3)]">the form you fill in on Run</span></h3>
						{o.inputs.length ? o.inputs.map((i) => (
							<div key={i.name} className="flex items-center gap-3 border-b border-[var(--g-line-2)] px-4 py-2.5 last:border-b-0">
								<span className="g-mono w-[120px] shrink-0 truncate text-[12.5px]">{i.name}</span>
								<span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--g-ink-3)]">{i.description ?? (i.default ? `default: ${i.default}` : '—')}</span>
								<span className={`g-mono rounded border border-[var(--g-line-2)] bg-[var(--g-soft)] px-1.5 text-[11px] ${i.required ? 'text-[var(--g-acc)]' : 'text-[var(--g-ink-2)]'}`}>{i.required ? 'required' : 'optional'}</span>
							</div>
						)) : <p className="px-4 py-4 text-[12.5px] text-[var(--g-ink-3)]">No inputs — runs start straight away.</p>}
					</section>
					<section className={CARD}>
						<h3 className={H3}>{o.latest ? `What’s new in ${o.latest.version}` : 'Releases'}{o.latest?.published_at ? <span className="text-[12px] font-normal text-[var(--g-ink-3)]">{relative_time(o.latest.published_at)}</span> : null}</h3>
						<div className="px-4 py-3 text-[12.5px] text-[var(--g-ink-2)]">
							{o.latest?.changelog ? <pre className="whitespace-pre-wrap font-[inherit] leading-relaxed">{o.latest.changelog}</pre> : <p className="text-[var(--g-ink-3)]">{o.latest ? 'No release notes for this version.' : 'Not published yet.'}</p>}
							{data.counts.versions > 1 ? <button type="button" onClick={() => go_tab('versions')} className="mt-2.5 text-[12.5px] text-[var(--g-acc)] hover:underline">All {data.counts.versions} versions →</button> : null}
						</div>
					</section>
					<section className={`${CARD} px-4 py-3.5`}>
						<h4 className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--g-ink-3)]">Runs here</h4>
						{o.installs.length ? o.installs.slice(0, 6).map((i) => (
							<div key={i.realm_id} className="flex items-center justify-between py-1 text-[12.5px] text-[var(--g-ink-2)]">
								<span className="truncate">{i.realm_slug}</span>
								<span className="g-mono text-[var(--g-ink-3)]">{i.installed_count}/{i.online_daemon_count}</span>
								<span className={`g-mono ${i.behind ? 'text-[var(--g-warn-text)]' : ''}`}>{i.version ?? '—'}{i.behind ? ' ↑' : ''}</span>
							</div>
						)) : <p className="text-[12.5px] text-[var(--g-ink-3)]">Not installed in any realm you can see.</p>}
						<button type="button" onClick={() => (o.installs.length ? go_tab('installs') : set_adding(true))} className="mt-1.5 text-[12.5px] text-[var(--g-acc)] hover:underline">{o.installs.length ? 'Manage installs →' : '+ Add to a realm'}</button>
						{o.agents.length ? <div className="mt-2 flex justify-between gap-3 border-t border-[var(--g-line-2)] pt-2 text-[12.5px]"><span className="text-[var(--g-ink-3)]">Agents</span><span className="text-right text-[var(--g-ink-2)]">{o.agents.join(', ')}</span></div> : null}
					</section>
				</div>
			</>
		);
	} else if (data?.workflow) {
		const w = data.workflow;
		const ov = w.overlay;
		const graph_phases = ov?.phases ?? w.phases;
		const all = [...graph_phases, ...w.support];
		const sel = all.find((p) => p.name === phase_sel) ?? graph_phases[0] ?? null;
		content = (
			<>
				<div className="relative overflow-hidden rounded-xl border border-[var(--g-line)] bg-[#0d0e10]">
					<div className="absolute left-3 top-2.5 z-10 flex flex-wrap items-center gap-2">
						<select aria-label="Overlay a run" value={run_sel} onChange={(e) => set_params({ run: e.target.value === 'latest' ? null : e.target.value })} className={`${INPUT} h-7 w-[280px] bg-[rgba(22,23,26,.95)]`}>
							<option value="none">Plain</option>
							<option value="latest">Last run</option>
							{w.recent_runs.map((r) => <option key={r.run_id} value={r.run_id}>{r.run_name || r.run_id.slice(0, 8)} · {r.realm_slug ?? ''} · {r.state}</option>)}
						</select>
						{ov ? <span className="text-[11.5px] text-[var(--g-ink-3)]"><span className="text-[var(--g-ok)]">●</span> done <span className="text-[var(--g-run)]">●</span> running <span style={{ color: REVIEW_COLOR }}>●</span> waiting <span className="text-[var(--g-bad)]">●</span> failed</span> : null}
						{ov?.phases ? <span className="rounded bg-[var(--g-warn-soft)] px-1.5 text-[11.5px] text-[var(--g-warn-text)]">graph of v{ov.version}, the version this run used</span> : null}
						{run_sel !== 'none' && !ov ? <span className="text-[11.5px] text-[var(--g-ink-3)]">No runs to overlay.</span> : null}
					</div>
					<div className="absolute right-3 top-2.5 z-10 flex gap-1.5">
						{team?.can_edit && is_latest ? <button type="button" onClick={open_builder} className="inline-flex h-7 items-center rounded-md border border-[#2c2f35] bg-[rgba(22,23,26,.85)] px-2.5 text-[12px] text-[var(--g-ink-2)] hover:text-[var(--g-ink)]">Edit in Builder</button> : null}
					</div>
					<div className="pt-11"><Workflow_graph phases={graph_phases} height={240} selected={sel?.name ?? null} on_select={(p) => set_params({ phase: p }, true)} statuses={ov ? ov.statuses : null} /></div>
					<div className="flex flex-wrap items-center gap-3 px-3.5 pb-2.5"><Workflow_legend phases={graph_phases} />
						{w.support.length ? <span className="ml-auto flex items-center gap-1.5 text-[11.5px] text-[var(--g-ink-3)]">support phases (callable by any phase): {w.support.map((s) => <button key={s.name} type="button" aria-pressed={sel?.name === s.name} onClick={() => set_params({ phase: s.name }, true)} className={`g-mono rounded border px-1.5 text-[11px] ${sel?.name === s.name ? 'border-[var(--g-acc-line)] text-[var(--g-ink)]' : 'border-[var(--g-line-2)] bg-[var(--g-soft)] text-[var(--g-ink-2)]'}`}>{s.name}</button>)}</span> : null}
					</div>
				</div>
				{sel ? <Phase_inspector phase={sel} phases={graph_phases} statuses={ov?.statuses ?? null} run_name={ov ? (ov.run.run_name || ov.run.run_id.slice(0, 8)) : null} on_open_file={(f) => go_tab('files', { file: f })} /> : null}
			</>
		);
	} else if (data?.files) {
		const files = data.files.files;
		const cur = files.find((f) => f.path === file_sel) ?? files[0] ?? null;
		const roles = files.filter((f) => f.path.startsWith('roles/'));
		const top = files.filter((f) => !f.path.startsWith('roles/'));
		const item = (f: { path: string }) => (
			<button key={f.path} type="button" aria-current={cur?.path === f.path ? 'true' : undefined} onClick={() => set_params({ file: f.path }, true)} className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] ${cur?.path === f.path ? 'bg-[var(--g-soft)] text-[var(--g-ink)] shadow-[inset_2px_0_0_var(--g-acc)]' : 'text-[var(--g-ink-2)] hover:bg-[var(--g-soft)]'}`}>▤ <span className="truncate">{f.path.replace(/^roles\//, '')}</span></button>
		);
		const lines = cur?.content.split('\n') ?? [];
		content = (
			<div className="grid min-h-0 grid-cols-[240px_minmax(0,1fr)] gap-3.5">
				<div className={`${CARD} p-2`}>
					<p className="px-2.5 pb-1 pt-2 text-[10.5px] uppercase tracking-[0.07em] text-[var(--g-ink-3)]">v{team?.version ?? '—'} · package</p>
					{top.map(item)}
					{roles.length ? <p className="px-2.5 pb-1 pt-3 text-[10.5px] uppercase tracking-[0.07em] text-[var(--g-ink-3)]">roles</p> : null}
					{roles.map(item)}
					{!files.length ? <p className="px-2.5 py-3 text-[12px] text-[var(--g-ink-3)]">No files for this version.</p> : null}
					<div className="mt-3 grid gap-1.5 border-t border-[var(--g-line)] px-1 pt-3">
						{team?.can_edit && is_latest ? <button type="button" onClick={open_builder} className={ROW_ACTION_CLS}>Edit in Builder</button> : null}
					</div>
				</div>
				<div className={`${CARD} min-w-0 overflow-hidden`}>
					{cur ? (
						<>
							<div className={H3}><span className="g-mono text-[13px]">{cur.path}</span><span className="text-[12px] font-normal text-[var(--g-ink-3)]">{lines.length} lines · v{team?.version}</span>
								<button type="button" onClick={() => { void navigator.clipboard?.writeText(cur.content); set_msg({ tone: 'ok', text: `Copied ${cur.path}.` }); }} className={`${ROW_ACTION_CLS} ml-auto inline-flex items-center gap-1.5`}><Copy aria-hidden className="h-3 w-3" />Copy</button>
								<a download={cur.path.split('/').pop()} href={`data:text/plain;charset=utf-8,${encodeURIComponent(cur.content)}`} className={`${ROW_ACTION_CLS} inline-flex items-center gap-1.5`}><Download aria-hidden className="h-3 w-3" />Save</a>
							</div>
							<pre className="g-mono max-h-[560px] overflow-auto py-3 text-[12px] leading-[1.7] text-[var(--g-ink-2)]" data-testid="file-view">
								{lines.map((l, i) => <div key={i}><span className="mr-4 inline-block w-[38px] select-none text-right text-[#4a4d55]">{i + 1}</span>{cur.kind === 'yaml' ? highlight_yaml(l) : l}</div>)}
							</pre>
						</>
					) : <p className="px-4 py-6 text-[12.5px] text-[var(--g-ink-3)]">Nothing to show.</p>}
				</div>
			</div>
		);
	} else if (data?.runs) {
		const r = data.runs;
		const chips: Array<[string | null, string, number | null]> = [[null, 'All', r.counts.all], ['running', 'Running', r.counts.running], ['awaiting_input', 'Needs input', r.counts.awaiting_input], ['failed', 'Failed · 7d', r.counts.failed_7d]];
		const from = r.total ? r.offset + 1 : 0;
		const to = Math.min(r.offset + r.limit, r.total);
		content = (
			<>
				<div className="flex flex-wrap items-center gap-2">
					<div role="group" aria-label="State" className="flex gap-2">
						{chips.map(([id, l, n]) => <button key={l} type="button" aria-pressed={runs_state === id} onClick={() => set_params({ state: id, page: null }, true)} className={PILL(runs_state === id)}>{l}{n !== null ? <span className="g-mono text-[11px] text-[var(--g-ink-3)]"> {n}</span> : null}</button>)}
					</div>
					<select aria-label="Realm" value={runs_realm ?? ''} onChange={(e) => set_params({ realm: e.target.value || null, page: null }, true)} className={`${INPUT} ml-2 w-[200px]`}>
						<option value="">Realm: all</option>
						{r.realms.map((x) => <option key={x.id} value={x.id}>{x.slug}{x.org_slug ? ` · ${x.org_slug}` : ''}</option>)}
					</select>
					<input aria-label="Search runs" value={q_draft} onChange={(e) => set_q_draft(e.target.value)} placeholder="Search runs…" className={`${INPUT} w-[240px]`} />
					<span className="ml-auto text-[12px] text-[var(--g-ink-3)]">across {view_org ? `${view_org.display_name}’s realms` : 'every realm you can see'}</span>
				</div>
				<div className={`${CARD} overflow-hidden`}>
					{r.items.length === 0 ? <p className="px-4 py-12 text-center text-[13px] text-[var(--g-ink-3)]">{runs_state || runs_realm || runs_q ? 'No runs match these filters.' : 'This team hasn’t run yet.'}</p> : (
						<table className="w-full text-left text-[12.5px]">
							<thead><tr className="border-b border-[var(--g-line)] text-[10.5px] uppercase tracking-[0.07em] text-[var(--g-ink-3)]"><Sort_th sort={run_cols} k="run_name" className="px-4 py-2.5 font-semibold">Run</Sort_th><th className="px-4 py-2.5 font-semibold">Realm</th><Sort_th sort={run_cols} k="state" className="px-4 py-2.5 font-semibold">State</Sort_th><th className="px-4 py-2.5 font-semibold">Phase</th><Sort_th sort={run_cols} k="started_at" className="px-4 py-2.5 font-semibold">Started</Sort_th><Sort_th sort={run_cols} k="last_updated_at" className="px-4 py-2.5 font-semibold">Updated</Sort_th></tr></thead>
							<tbody>
								{r.items.map((x) => {
									const realm = x.realm_id ? realm_by_id.get(x.realm_id) : undefined;
									const href = x.org_slug && x.realm_slug ? run_href(x.org_slug, x.realm_slug, x.run_id) : realm ? run_href(realm.org_slug, realm.slug, x.run_id) : null;
									return (
										<tr key={x.run_id} onClick={href ? () => navigate(href) : undefined} className={`border-b border-[var(--g-line-2)] last:border-b-0 ${href ? 'cursor-pointer hover:bg-[var(--g-soft)]' : ''}`} data-testid={`run-${x.run_id}`}>
											<td className="max-w-[320px] px-4 py-2.5">{href ? <Link to={href} onClick={(e) => e.stopPropagation()} className="block truncate font-semibold text-[var(--g-ink)] hover:underline">{x.run_name || x.run_id}</Link> : <span className="block truncate font-semibold">{x.run_name || x.run_id}</span>}</td>
											<td className="px-4 py-2.5">{x.realm_slug ?? realm?.slug ? <span className="rounded-[5px] bg-[var(--g-run-soft)] px-1.5 py-px text-[11.5px] text-[#7cc4ff]">{x.realm_slug ?? realm?.slug}</span> : '—'}</td>
											<td className="px-4 py-2.5"><State_pill state={x.state} /></td>
											<td className="g-mono px-4 py-2.5 text-[12px] text-[var(--g-ink-2)]">{x.current_phase ?? '—'}</td>
											<td className="px-4 py-2.5 text-[var(--g-ink-3)]">{x.started_at ? relative_time(x.started_at) : '—'}</td>
											<td className="px-4 py-2.5 text-[var(--g-ink-3)]">{x.updated_at ? relative_time(x.updated_at) : '—'}</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					)}
					{r.total > r.limit ? (
						<div className="flex items-center justify-end gap-2 border-t border-[var(--g-line)] px-4 py-2.5 text-[12px] text-[var(--g-ink-3)]">
							<span>{from}–{to} of {r.total}</span>
							<button type="button" aria-label="Previous page" disabled={runs_page === 0} onClick={() => set_params({ page: runs_page - 1 ? String(runs_page - 1) : null }, true)} className="grid h-7 w-7 place-items-center rounded-md border border-[var(--g-line)] disabled:opacity-40">‹</button>
							<button type="button" aria-label="Next page" disabled={to >= r.total} onClick={() => set_params({ page: String(runs_page + 1) }, true)} className="grid h-7 w-7 place-items-center rounded-md border border-[var(--g-line)] disabled:opacity-40">›</button>
						</div>
					) : null}
				</div>
			</>
		);
	} else if (data?.installs) {
		const ins = { ...data.installs, items: sort_rows(data.installs.items, installs_sort, {
			realm: (i) => i.realm_name || i.realm_slug, version: (i) => i.version, daemons: (i) => i.installed_count, last_run_at: (i) => i.last_run_at,
		}) };
		content = (
			<>
				<div className="relative flex flex-wrap items-center gap-2">
					<span className="text-[13px] text-[var(--g-ink-2)]">Installed in <b className="text-[var(--g-ink)]">{ins.items.length}</b> of {ins.realms_total} realm{ins.realms_total === 1 ? '' : 's'} you can see</span>
					{ins.realms_checked < ins.realms_total ? <span className="text-[11.5px] text-[var(--g-ink-3)]">(checked the first {ins.realms_checked})</span> : null}
					{can_add ? <button type="button" onClick={() => set_adding(true)} className={`${PRIMARY} ml-auto`}>+ Add to a realm</button> : null}
				</div>
				<div className={`${CARD} overflow-hidden`}>
					{ins.items.length === 0 ? <p className="px-4 py-12 text-center text-[13px] text-[var(--g-ink-3)]">Not installed in any realm yet.</p> : (
						<table className="w-full text-left text-[12.5px]">
							<thead><tr className="border-b border-[var(--g-line)] text-[10.5px] uppercase tracking-[0.07em] text-[var(--g-ink-3)]"><Sort_th sort={installs_sort} k="realm" className="px-4 py-2.5 font-semibold">Realm</Sort_th><Sort_th sort={installs_sort} k="version" className="px-4 py-2.5 font-semibold">Version</Sort_th><Sort_th sort={installs_sort} k="daemons" className="px-4 py-2.5 font-semibold" title="Online daemons in the realm that have this team">Daemons with it</Sort_th><Sort_th sort={installs_sort} k="last_run_at" className="px-4 py-2.5 font-semibold">Last run</Sort_th><th className="w-[280px] px-4 py-2.5" /></tr></thead>
							<tbody>
								{ins.items.map((i) => {
									const short = i.installed_count < i.online_daemon_count;
									return (
										<tr key={i.realm_id} className="border-b border-[var(--g-line-2)] last:border-b-0" data-testid={`install-${i.realm_slug}`}>
											<td className="px-4 py-2.5"><Link to={i.org_slug ? `/o/${i.org_slug}/realms/${i.realm_slug}/teams` : '#'} className="font-semibold text-[var(--g-ink)] hover:underline">{i.realm_slug}</Link>{i.org_slug ? <span className="ml-1.5 text-[11px] text-[var(--g-ink-3)]">{i.org_slug}</span> : null}</td>
											<td className="px-4 py-2.5"><span className={`g-mono ${i.behind ? 'text-[var(--g-warn-text)]' : ''}`}>{i.version ?? '—'}</span>{i.behind ? <span className="ml-2 rounded-full bg-[var(--g-warn-soft)] px-2 py-px text-[11px] font-semibold text-[var(--g-warn-text)]">{team?.latest_version} available</span> : i.version && i.version === team?.latest_version ? <span className="ml-2 text-[11.5px] text-[var(--g-ink-3)]">latest</span> : null}
												{i.missing_agents.length ? <span className="block text-[11px] text-[var(--g-warn-text)]">needs agents: {i.missing_agents.join(', ')}</span> : null}</td>
											<td className="px-4 py-2.5"><Coverage i={i} /></td>
											<td className="px-4 py-2.5 text-[var(--g-ink-3)]">{i.last_run_at ? relative_time(i.last_run_at) : 'never'}</td>
											<td className="px-4 py-2.5 text-right">
												{confirm === `rm:${i.realm_id}` ? (
													<span className="inline-flex gap-1.5">
														<button type="button" disabled={busy !== null} onClick={() => void act(`rm:${i.realm_id}`, '/v1/realms/remove_team', { realm_id: i.realm_id, scope: team?.scope, slug: team?.name }, `Removed from ${i.realm_slug}; its daemons uninstall it.`)} className="rounded-md bg-[var(--g-bad)] px-2.5 py-1 text-[12px] font-semibold text-[#160606]">Uninstall</button>
														<button type="button" onClick={() => set_confirm(null)} className={ROW_ACTION_CLS}>Keep</button>
													</span>
												) : (
													<span className="inline-flex gap-1.5">
														{i.behind ? <button type="button" disabled={busy !== null} onClick={() => void act(`up:${i.realm_id}`, '/v1/realms/add_team', { realm_id: i.realm_id, scope: team?.scope, slug: team?.name }, `Upgrading ${i.realm_slug} to ${team?.latest_version}.`)} className={PRIMARY}>{busy === `up:${i.realm_id}` ? 'Upgrading…' : `Upgrade to ${team?.latest_version}`}</button>
															: short ? <button type="button" disabled={busy !== null} onClick={() => void act(`sync:${i.realm_id}`, '/v1/realms/add_team', { realm_id: i.realm_id, scope: team?.scope, slug: team?.name }, `Syncing ${i.realm_slug}’s daemons.`)} className={ROW_ACTION_CLS}>{busy === `sync:${i.realm_id}` ? 'Syncing…' : 'Sync daemons'}</button> : null}
														<button type="button" onClick={() => set_confirm(`rm:${i.realm_id}`)} className={ROW_ACTION_CLS}>Uninstall</button>
													</span>
												)}
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					)}
				</div>
				{ins.not_installed.length ? (
					<div className={`${CARD} flex flex-wrap items-center gap-2 px-4 py-3 text-[12.5px] text-[var(--g-ink-3)]`}>
						Not installed: {ins.not_installed.slice(0, 12).map((r) => <span key={r.id} className="rounded-[5px] bg-[var(--g-soft)] px-1.5 py-px text-[11.5px] text-[var(--g-ink-2)]">{r.slug}</span>)}
						<span className="ml-auto">Realm admins can install and remove teams.</span>
					</div>
				) : null}
			</>
		);
	} else if (data?.versions) {
		const vs = data.versions;
		const cmp = vs.compare;
		const tone: Record<string, string> = { added: '#3ecf8e', changed: '#f5a524', removed: '#ff5c5c' };
		const sign: Record<string, string> = { added: '+', changed: '~', removed: '−' };
		content = (
			<div className="grid grid-cols-[minmax(0,1fr)_480px] gap-4">
				<div className={`${CARD} py-1.5 pl-3 pr-4`}>
					{vs.items.length === 0 ? <p className="px-2 py-6 text-[12.5px] text-[var(--g-ink-3)]">No published versions yet.</p> : null}
					{vs.items.map((v) => (
						<div key={v.version} className="grid grid-cols-[18px_minmax(0,1fr)] gap-3" data-testid={`version-${v.version}`}>
							<div className="relative before:absolute before:bottom-0 before:left-2 before:top-0 before:w-px before:bg-[var(--g-line)]">
								<i className={`absolute left-[3px] top-[17px] block h-[11px] w-[11px] rounded-full border-2 ${v.is_latest ? 'border-[var(--g-acc)] bg-[var(--g-acc)] shadow-[0_0_0_4px_rgba(212,255,63,.12)]' : 'border-[#4a4d55] bg-[var(--g-panel)]'}`} />
							</div>
							<div className="border-b border-[var(--g-line-2)] py-3">
								<div className="flex flex-wrap items-center gap-2.5">
									<b className="g-mono text-[14px]">{v.version}</b>
									{v.is_latest ? <span className="rounded-full bg-[var(--g-acc-soft)] px-2 py-px text-[11px] font-semibold text-[var(--g-acc)]">latest</span> : null}
									{v.version === team?.version && !v.is_latest ? <span className="rounded-full bg-[var(--g-soft)] px-2 py-px text-[11px] text-[var(--g-ink-2)]">viewing</span> : null}
									<span className="text-[12px] text-[var(--g-ink-3)]">{v.published_at ? relative_time(v.published_at) : ''}</span>
									<span className="ml-auto flex gap-1.5">
										{v.version !== team?.version ? <button type="button" onClick={() => set_params({ v: v.is_latest ? null : v.version, tab: null })} className={ROW_ACTION_CLS}>View</button> : null}
										{cmp?.to !== v.version && cmp?.from !== v.version ? <button type="button" onClick={() => set_params({ from: v.version, to: cmp?.to ?? team?.version ?? null }, true)} className={ROW_ACTION_CLS}>Compare</button> : null}
									</span>
								</div>
								{v.changelog ? <pre className="mt-1.5 whitespace-pre-wrap font-[inherit] text-[12.5px] leading-relaxed text-[var(--g-ink-2)]">{v.changelog}</pre> : <p className="mt-1 text-[12px] text-[var(--g-ink-3)]">No release notes.</p>}
							</div>
						</div>
					))}
				</div>
				<div className={`${CARD} self-start overflow-hidden`}>
					<div className={H3}>Compare
						<select aria-label="Compare from" value={cmp?.from ?? ''} onChange={(e) => set_params({ from: e.target.value }, true)} className={`${INPUT} h-7 w-[100px]`}>{vs.items.map((v) => <option key={v.version} value={v.version}>{v.version}</option>)}</select>
						→
						<select aria-label="Compare to" value={cmp?.to ?? team?.version ?? ''} onChange={(e) => set_params({ to: e.target.value }, true)} className={`${INPUT} h-7 w-[100px]`}>{vs.items.map((v) => <option key={v.version} value={v.version}>{v.version}</option>)}</select>
					</div>
					{!cmp ? <p className="px-4 py-5 text-[12.5px] text-[var(--g-ink-3)]">{vs.items.length < 2 ? 'Only one version so far.' : 'Pick two different versions.'}</p>
						: cmp.changes.length === 0 ? <p className="px-4 py-5 text-[12.5px] text-[var(--g-ink-3)]">No workflow, role or input changes between {cmp.from} and {cmp.to}.</p>
							: cmp.changes.map((c) => (
								<div key={`${c.target}:${c.name}`} className="flex items-start gap-2.5 border-b border-[var(--g-line-2)] px-4 py-2.5 text-[12.5px] last:border-b-0" data-testid="version-change">
									<span className="g-mono grid h-5 w-5 shrink-0 place-items-center rounded-[5px] font-bold" style={{ color: tone[c.kind], background: `${tone[c.kind]}24` }}>{sign[c.kind]}</span>
									<div className="min-w-0"><b className="g-mono text-[12.5px]">{c.name}</b><div className="text-[var(--g-ink-3)]">{c.detail}</div></div>
								</div>
							))}
				</div>
			</div>
		);
	} else if (tab === 'settings' && team) {
		content = !can_settings ? <p className="text-[13px] text-[var(--g-ink-3)]">Only people who can edit this team see its settings.</p> : (
			<div className="grid grid-cols-2 gap-4">
				<section className={CARD}>
					<h3 className={H3}>General</h3>
					{team.can_edit && team.scope ? (
						<div className="grid grid-cols-[200px_minmax(0,1fr)] gap-4 border-b border-[var(--g-line-2)] px-4 py-3.5">
							<div><b className="text-[13px]">Name</b><p className="mt-0.5 text-[12px] text-[var(--g-ink-3)]">Renames within @{team.scope}. Lowercase letters, numbers and hyphens.</p></div>
							<div className="flex items-start gap-2">
								<input aria-label="New name" value={new_name} onChange={(e) => set_new_name(e.target.value)} className={`${INPUT} flex-1`} />
								<button type="button" disabled={busy !== null || !/^[a-z][a-z0-9-]*$/.test(new_name) || new_name === team.name} onClick={() => void act('rename', '/v1/teams/rename', { name: team.name, scope: team.scope, new_name }, `Renamed to ${new_name}.`, () => navigate(team_href(team.scope, new_name, 'settings'), { replace: true }))} className={ROW_ACTION_CLS}>{busy === 'rename' ? 'Renaming…' : 'Rename'}</button>
							</div>
						</div>
					) : null}
					<div className="grid grid-cols-[200px_minmax(0,1fr)] gap-4 px-4 py-3.5">
						<div><b className="text-[13px]">Description</b><p className="mt-0.5 text-[12px] text-[var(--g-ink-3)]">Edited with the team in the Builder.</p></div>
						<p className="text-[12.5px] text-[var(--g-ink-2)]">{team.description || '—'}</p>
					</div>
				</section>
				<div className="flex flex-col gap-4">
					{team.can_edit && team.status === 'published' ? (
						<section className={CARD}>
							<h3 className={H3}>Publishing</h3>
							<div className="grid grid-cols-[200px_minmax(0,1fr)] gap-4 border-b border-[var(--g-line-2)] px-4 py-3.5">
								<div><b className="text-[13px]">Unpublish</b><p className="mt-0.5 text-[12px] text-[var(--g-ink-3)]">Back to draft.</p></div>
								<div>{confirm === 'unpublish'
									? <span className="inline-flex gap-1.5"><button type="button" disabled={busy !== null} onClick={() => void act('unpublish', '/v1/teams/unpublish', { name: team.name, scope: team.scope }, `${label} is a draft again.`)} className="rounded-md bg-[var(--g-bad)] px-2.5 py-1 text-[12px] font-semibold text-[#160606]">Unpublish</button><button type="button" onClick={() => set_confirm(null)} className={ROW_ACTION_CLS}>Cancel</button></span>
									: <button type="button" onClick={() => set_confirm('unpublish')} className={ROW_ACTION_CLS}>Unpublish…</button>}</div>
							</div>
							{team.versions.length > 1 ? (
								<div className="grid grid-cols-[200px_minmax(0,1fr)] gap-4 px-4 py-3.5">
									<div><b className="text-[13px]">Delete a version</b><p className="mt-0.5 text-[12px] text-[var(--g-ink-3)]">Removes one version from the registry.</p></div>
									<div className="flex items-start gap-2">
										<select aria-label="Version to delete" value={del_version} onChange={(e) => set_del_version(e.target.value)} className={`${INPUT} w-[140px]`}>
											<option value="">Pick…</option>
											{team.versions.filter((v) => !v.is_latest).map((v) => <option key={v.version} value={v.version}>{v.version}</option>)}
										</select>
										{confirm === 'delver'
											? <><button type="button" disabled={busy !== null} onClick={() => void act('delver', '/v1/teams/delete_version', { name: team.name, scope: team.scope, version: del_version }, `Deleted ${del_version}.`)} className="rounded-md bg-[var(--g-bad)] px-2.5 py-1 text-[12px] font-semibold text-[#160606]">Delete {del_version}</button><button type="button" onClick={() => set_confirm(null)} className={ROW_ACTION_CLS}>Cancel</button></>
											: <button type="button" disabled={!del_version} onClick={() => set_confirm('delver')} className={ROW_ACTION_CLS}>Delete version…</button>}
									</div>
								</div>
							) : null}
						</section>
					) : null}
					{team.can_delete ? (
						<section className="rounded-[10px] border border-[var(--g-bad-line)] bg-[var(--g-panel)]">
							<h3 className={`${H3} text-[var(--g-bad)]`}>Danger zone</h3>
							<div className="grid grid-cols-[200px_minmax(0,1fr)] gap-4 px-4 py-3.5">
								<div><b className="text-[13px]">Delete team</b><p className="mt-0.5 text-[12px] text-[var(--g-ink-3)]">Removes it from the registry and from every realm’s team list.</p></div>
								<div>{confirm === 'delete'
									? <span className="inline-flex gap-1.5"><button type="button" disabled={busy !== null} onClick={() => void act('delete', '/v1/teams/delete', { name: team.name, scope: team.scope }, `Deleted ${label}.`, () => navigate('/teams', { replace: true }))} className="rounded-md bg-[var(--g-bad)] px-2.5 py-1 text-[12px] font-semibold text-[#160606]">Delete {team.name}</button><button type="button" onClick={() => set_confirm(null)} className={ROW_ACTION_CLS}>Cancel</button></span>
									: <button type="button" onClick={() => set_confirm('delete')} className="rounded-md border border-[var(--g-bad-line)] px-3 py-1.5 text-[12px] font-semibold text-[var(--g-bad)]">Delete team…</button>}</div>
							</div>
						</section>
					) : null}
				</div>
			</div>
		);
	}

	return (
		<Graphite_shell
			data={overview.data}
			title={team?.name ?? name}
			actions={<button type="button" onClick={() => void read.reload()} aria-label="Refresh" title="Refresh" className="grid h-8 w-8 place-items-center rounded-lg border border-[var(--g-line)] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]"><RefreshCw className="h-3.5 w-3.5" /></button>}
		>
			<div className="flex flex-col gap-3.5 px-7 py-6">
				<nav aria-label="Breadcrumb" className="text-[12.5px] text-[var(--g-ink-3)]">{team && !team.can_edit ? <Link to="/marketplace" className="hover:text-[var(--g-ink)]">Marketplace</Link> : <Link to={view_org ? `/teams?org=${encodeURIComponent(view_org.slug)}` : '/teams'} className="hover:text-[var(--g-ink)]">Teams</Link>} › <span className="text-[var(--g-ink-2)]">{label}</span></nav>
				{read.status === 'error' && !any_data ? (
					<Blocking_error http_status={read.http_status} code={read.code} error={read.error} on_retry={() => void read.reload()} what="team" />
				) : (
					<>
						{header(tab === 'overview')}
						{team?.forked_from ? <Lineage_strip origin={team.forked_from} /> : null}
						{tabs}
						{msg ? <p role={msg.tone === 'bad' ? 'alert' : 'status'} className={`text-[12.5px] ${msg.tone === 'bad' ? 'text-[var(--g-bad)]' : 'text-[var(--g-ok)]'}`}>{msg.text}</p> : null}
						{data?.partial ? <p className="text-[11.5px] text-[var(--g-ink-3)]">Some of this couldn’t be loaded — what’s shown may be incomplete.</p> : null}
						{!content && !(tab === 'settings' && team) ? <div className="h-[420px] animate-pulse rounded-xl border border-[var(--g-line)] bg-[var(--g-panel)]" aria-busy="true" aria-label="Loading" /> : content}
					</>
				)}
			</div>
			{running && team?.scope ? (
				<New_run_drawer team={{ scope: team.scope, slug: team.name }} on_close={() => set_running(false)}
					realm={running.realm_id ? ((r) => (r ? { id: r.id, slug: r.slug, org_slug: r.org_slug } : null))(realm_by_id.get(running.realm_id)) : null}
					on_add_to_realm={() => { set_running(false); set_adding(true); }} />
			) : null}
			{adding && team?.scope ? (
				<Add_team_drawer team_id={team.id} label={label} scope={team.scope} name={team.name} version={team.latest_version}
					orgs={(overview.data?.orgs ?? []).filter((o) => !view_org || o.id === view_org.id)} states={org_states ?? []}
					on_close={() => set_adding(false)} on_added={() => void read.reload()} on_run={(realm_id) => { set_adding(false); set_running({ realm_id }); }} />
			) : null}
			{forking && team ? (
				<Fork_dialog team_id={team.id} label={label} name={team.name} version={team.version} versions={team.versions}
					on_close={() => set_forking(false)}
					on_forked={(r, open) => { set_forking(false); navigate(open ? `/builder?draft=${encodeURIComponent(r.id)}&from=${encodeURIComponent(team_href(r.scope, r.name))}` : team_href(r.scope, r.name)); }} />
			) : null}
		</Graphite_shell>
	);
}
