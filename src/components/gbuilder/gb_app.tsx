/**
 * The Graphite builder. Start screen until there is a team; then a three-pane
 * workspace: Build/AI on the left, Canvas · YAML · Changes in the middle, the
 * inspector (phase or team) on the right.
 *
 * Reads/writes (no new endpoints):
 *   saving     /v1/teams/create once for a new team, then /v1/teams/update
 *              { save_as: 'draft' } (autosave, debounced): edits are kept as the
 *              team's unpublished changes and never mint a version
 *   versions   only Publish mints one (/v1/teams/publish), which also clears
 *              the unpublished changes
 *   validate   /v1/teams/build {action: 'validate'} (debounced; local checks are instant)
 *   AI         /v1/teams/build {chat | suggest | improve_role | generate | status}
 *   publish    /v1/team_page/get (installs) · /v1/teams/publish · /v1/realms/add_team
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useAuth, useAuthFetch } from '@/lib/auth_context';
import { api_message } from '@/lib/use_bff_read';
import { use_overview } from '@/lib/overview';
import { useBuilder, useBuilderDispatch, type GeneratedTeam, type SingleAction } from '@/lib/builder/store';
import { clear_builder_session_restores } from '@/lib/builder/session_restore';
import { KINDS, PALETTE, kind_of, type Kind_id } from '@/lib/builder/kinds';
import { add_after, add_root, diff_teams, duplicate_phase, remove_bridged } from '@/lib/builder/graph_ops';
import { check_team, type Problem } from '@/lib/builder/checks';
import { team_to_yaml } from '@/lib/builder/yaml_tools';
import { team_scope, team_slug } from '@/lib/builder/publish';
import { Graphite_shell } from '@/components/graphite/graphite_shell';
import { Gb_canvas, KIND_MIME, Kind_tile, type Canvas_preview } from '@/components/gbuilder/gb_canvas';
import { Phase_panel, Team_panel } from '@/components/gbuilder/gb_inspector';
import { Gb_ai_panel } from '@/components/gbuilder/gb_ai_panel';
import { Gb_yaml } from '@/components/gbuilder/gb_yaml';
import { Gb_start } from '@/components/gbuilder/gb_start';
import { Gb_publish } from '@/components/gbuilder/gb_publish';

type Center = 'canvas' | 'yaml' | 'changes';
type Save_state = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved'; at: number } | { kind: 'error'; message: string } | { kind: 'unnamed' } | { kind: 'signed_out' } | { kind: 'manual' };

const TAB = (on: boolean) => `rounded-md px-3 py-1 text-[12.5px] ${on ? 'bg-[var(--g-soft)] font-semibold text-[var(--g-ink)]' : 'text-[var(--g-ink-3)] hover:text-[var(--g-ink)]'}`;
const GHOST = 'inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--g-line)] px-2.5 text-[12.5px] text-[var(--g-ink-2)] hover:text-[var(--g-ink)] disabled:opacity-40';
export const AUTOSAVE_MS = 1500;
export const VALIDATE_MS = 1200;

function is_typing(t: EventTarget | null): boolean {
	const el = t as HTMLElement | null;
	if (!el || !el.tagName) return false;
	return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable || Boolean(el.closest?.('.cm-editor'));
}

function ago(ms: number): string {
	const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
	return s < 5 ? 'just now' : s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`;
}

/** Autosave: create the draft once (new teams), then update it. */
function use_autosave(team: GeneratedTeam | null, dirty: boolean, draft_id: string | null, auto_create: boolean) {
	const auth_fetch = useAuthFetch();
	const dispatch = useBuilderDispatch();
	const { user, scopes } = useAuth();
	const [, set_search] = useSearchParams();
	const [state, set_state] = useState<Save_state>({ kind: 'idle' });
	const [, tick] = useState(0);
	const team_ref = useRef(team); team_ref.current = team;
	const busy = useRef(false);

	const save = useCallback(async () => {
		const t = team_ref.current;
		if (!t || busy.current) return;
		if (!user) { set_state({ kind: 'signed_out' }); return; }
		if (!draft_id && team_slug(t) === 'untitled-team') { set_state({ kind: 'unnamed' }); return; }
		busy.current = true;
		set_state({ kind: 'saving' });
		try {
			const body = draft_id
				? { team_id: draft_id, save_as: 'draft', description: t.description || '', team_json: JSON.stringify(t) }
				: { name: team_slug(t), scope: team_scope(t, scopes[0]?.slug ?? user.username ?? ''), description: t.description || '', team_json: JSON.stringify(t) };
			const res = await auth_fetch(draft_id ? '/v1/teams/update' : '/v1/teams/create', { method: 'POST', body: JSON.stringify(body) });
			const p = await res.json().catch(() => null);
			if (!res.ok || !p?.ok) { set_state({ kind: 'error', message: api_message(p, 'Couldn’t save the draft.') }); return; }
			const id = String(p.data?.id ?? draft_id ?? '');
			const changed_meanwhile = team_ref.current !== t;
			dispatch({ type: 'SET_DRAFT_ID', draft_id: id || null });
			if (changed_meanwhile) dispatch({ type: 'SET_DIRTY', dirty: true });
			if (!draft_id && id) set_search((s) => { const n = new URLSearchParams(s); n.set('draft', id); n.delete('view'); n.delete('fork'); return n; }, { replace: true });
			set_state({ kind: 'saved', at: Date.now() });
		} catch {
			set_state({ kind: 'error', message: 'Network error — not saved.' });
		} finally {
			busy.current = false;
		}
	}, [auth_fetch, dispatch, draft_id, scopes, set_search, user]);

	useEffect(() => {
		if (!team || !dirty) return;
		if (!draft_id && !auto_create) { set_state({ kind: 'manual' }); return; }
		const h = window.setTimeout(() => void save(), AUTOSAVE_MS);
		return () => window.clearTimeout(h);
	}, [team, dirty, draft_id, auto_create, save]);

	// keep "saved 12s ago" fresh
	useEffect(() => { const h = window.setInterval(() => tick((x) => x + 1), 15_000); return () => window.clearInterval(h); }, []);
	return { state, save };
}

/** Core validate (debounced). Local checks cover the same rules instantly; this is the final word. */
function use_core_validate(team: GeneratedTeam | null) {
	const auth_fetch = useAuthFetch();
	const [res, set_res] = useState<{ valid: boolean; errors: string[]; warnings: string[] } | null>(null);
	useEffect(() => {
		if (!team || !team.phases.length) { set_res(null); return; }
		let live = true;
		const h = window.setTimeout(() => {
			auth_fetch('/v1/teams/build', { method: 'POST', body: JSON.stringify({ action: 'validate', team }) })
				.then((r) => r.json().catch(() => null))
				.then((p) => { if (live && p?.ok && p.data) set_res({ valid: Boolean(p.data.valid), errors: p.data.errors ?? [], warnings: p.data.warnings ?? [] }); })
				.catch(() => { /* offline: local checks still show */ });
		}, VALIDATE_MS);
		return () => { live = false; window.clearTimeout(h); };
	}, [auth_fetch, team]);
	return res;
}

function Changes_view({ baseline, team, on_revert }: { baseline: GeneratedTeam | null; team: GeneratedTeam; on_revert: () => void }) {
	const changes = useMemo(() => diff_teams(baseline, team), [baseline, team]);
	const SIGN: Record<string, [string, string]> = { added: ['+', 'var(--g-ok)'], changed: ['~', 'var(--g-warn-text)'], removed: ['−', 'var(--g-bad)'] };
	return (
		<div className="h-full overflow-y-auto px-8 py-6" data-testid="changes-view">
			<div className="mx-auto max-w-[720px]">
				<div className="mb-4 flex items-center">
					<div>
						<h2 className="text-[17px] font-semibold">Changes</h2>
						<p className="text-[12.5px] text-[var(--g-ink-3)]">{baseline ? 'Since you opened this team.' : 'Everything is new in this team.'}</p>
					</div>
					{baseline && changes.length ? <button type="button" onClick={on_revert} className={`${GHOST} ml-auto`}>Revert all</button> : null}
				</div>
				{!changes.length ? <p className="rounded-xl border border-[var(--g-line)] p-6 text-center text-[13px] text-[var(--g-ink-3)]">No changes yet.</p> : (
					<ul className="grid gap-1.5">
						{changes.map((c, i) => (
							<li key={i} className="flex items-start gap-3 rounded-lg border border-[var(--g-line)] bg-[#121316] px-3 py-2 text-[13px]">
								<span className="g-mono w-3 font-bold" style={{ color: SIGN[c.kind][1] }}>{SIGN[c.kind][0]}</span>
								<span className="g-mono w-12 shrink-0 text-[11px] uppercase text-[var(--g-ink-3)]">{c.target}</span>
								<span><b>{c.name}</b> <span className="text-[var(--g-ink-3)]">{c.detail}</span></span>
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}

function Save_badge({ s, on_save }: { s: Save_state; on_save: () => void }) {
	const base = 'g-mono whitespace-nowrap rounded px-1.5 py-0.5 text-[11px]';
	if (s.kind === 'saving') return <span className={`${base} bg-[var(--g-soft)] text-[var(--g-ink-3)]`} role="status">saving…</span>;
	if (s.kind === 'saved') return <span className={`${base} bg-[var(--g-soft)] text-[var(--g-ink-3)]`} role="status">saved {ago(s.at)} · not published</span>;
	if (s.kind === 'error') return <button type="button" onClick={on_save} title={s.message} className={`${base} bg-[var(--g-bad-soft)] text-[var(--g-bad)]`}>not saved · retry</button>;
	if (s.kind === 'unnamed') return <span className={`${base} bg-[var(--g-warn-soft)] text-[var(--g-warn-text)]`}>name it to save</span>;
	if (s.kind === 'signed_out') return <span className={`${base} bg-[var(--g-warn-soft)] text-[var(--g-warn-text)]`}>sign in to save</span>;
	if (s.kind === 'manual') return <button type="button" onClick={on_save} className={`${base} border border-[var(--g-line)] text-[var(--g-ink-2)] hover:text-[var(--g-ink)]`}>Save as draft</button>;
	return null;
}

function download(name: string, text: string) {
	const url = URL.createObjectURL(new Blob([text], { type: 'text/yaml' }));
	const a = document.createElement('a'); a.href = url; a.download = name; a.click();
	window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Gb_app() {
	const state = useBuilder();
	const dispatch = useBuilderDispatch();
	const overview = use_overview();
	const navigate = useNavigate();
	const [search] = useSearchParams();
	const team = state.team;
	const selected = state.selected_phase;
	const [center, set_center] = useState<Center>('canvas');
	const [left, set_left] = useState<'build' | 'ai'>('build');
	const [preview, set_preview] = useState<Canvas_preview | null>(null);
	const [ai_req, set_ai_req] = useState<{ id: number; text: string } | null>(null);
	const [focus_inputs, set_focus_inputs] = useState(0);
	const [publishing, set_publishing] = useState(false);
	const [baseline, set_baseline] = useState<{ set: boolean; team: GeneratedTeam | null }>({ set: false, team: null });
	const [auto_create, set_auto_create] = useState(search.get('view') !== '1');

	// First team to appear (draft / edit / fork restore) is the baseline for Changes.
	useEffect(() => { if (team && !baseline.set) set_baseline({ set: true, team }); }, [team, baseline.set]);

	const local = useMemo(() => (team ? check_team(team) : []), [team]);
	const core = use_core_validate(team);
	const problems: Problem[] = useMemo(() => {
		if (!core || core.valid || local.some((p) => p.level === 'error')) return local;
		return [...local, ...core.errors.map((m, i) => ({ id: `core-${i}`, level: 'error' as const, phase: null, field: null, message: m }))];
	}, [local, core]);
	const by_phase = useMemo(() => {
		const m = new Map<string, 'error' | 'warning'>();
		for (const p of problems) if (p.phase && m.get(p.phase) !== 'error') m.set(p.phase, p.level);
		return m;
	}, [problems]);
	const save = use_autosave(team, state.dirty, state.draft_id, auto_create);

	const change = useCallback((next: GeneratedTeam, select?: string | null) => {
		const acts: SingleAction[] = [{ type: 'UPDATE_TEAM', team: next }];
		if (select !== undefined) acts.push({ type: 'SELECT_PHASE', name: select });
		dispatch({ type: 'BATCH', actions: acts });
	}, [dispatch]);
	const select = useCallback((name: string | null) => dispatch({ type: 'SELECT_PHASE', name }), [dispatch]);
	const ask_ai = useCallback((text: string) => { set_left('ai'); set_ai_req((r) => ({ id: (r?.id ?? 0) + 1, text })); }, []);

	function add_kind(kind: Kind_id) {
		if (!team) return;
		const r = selected && team.phases.some((p) => p.name === selected) ? add_after(team, kind, selected) : add_root(team, kind);
		if (r.ok) { change(r.team, r.name ?? null); set_center('canvas'); }
	}

	// keyboard: ⌫ delete (bridged), ⌘D duplicate, ⌘Z undo, ⌘K ask AI, Esc deselect
	const keys = useRef({ team, selected });
	keys.current = { team, selected };
	useEffect(() => {
		const on = (e: KeyboardEvent) => {
			if (publishing || is_typing(e.target)) return;
			const { team: t, selected: sel } = keys.current;
			if (!t) return;
			const mod = e.metaKey || e.ctrlKey;
			if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); dispatch({ type: 'UNDO' }); return; }
			if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); set_left('ai'); window.setTimeout(() => document.querySelector<HTMLTextAreaElement>('[aria-label="Ask AI"]')?.focus(), 0); return; }
			if (e.key === 'Escape') { dispatch({ type: 'SELECT_PHASE', name: null }); return; }
			if (!sel) return;
			if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); const r = remove_bridged(t, sel); if (r.ok) change(r.team, null); return; }
			if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); const r = duplicate_phase(t, sel); if (r.ok) change(r.team, r.name ?? null); }
		};
		window.addEventListener('keydown', on);
		return () => window.removeEventListener('keydown', on);
	}, [change, dispatch, publishing]);

	function start(t: GeneratedTeam) {
		set_baseline({ set: true, team: null });
		set_auto_create(true);
		dispatch({ type: 'SET_TEAM', team: t, validation: null });
		dispatch({ type: 'SET_DIRTY', dirty: true });
	}
	function start_over() {
		clear_builder_session_restores();
		dispatch({ type: 'RESET' });
		set_baseline({ set: false, team: null });
		set_preview(null); set_center('canvas');
		navigate('/builder', { replace: true });
	}

	const errors = problems.filter((p) => p.level === 'error');
	const warnings = problems.filter((p) => p.level === 'warning');
	const need_roles = team ? team.phases.filter((p) => KINDS[kind_of(p)].role === 'required').length : 0;
	const title = team ? (team.name.replace(/^@[^/]+\//, '') || 'untitled-team') : 'New team';

	const actions = team ? (
		<div className="flex items-center gap-2">
			<Save_badge s={save.state} on_save={() => { set_auto_create(true); void save.save(); }} />
			<div className="flex rounded-lg border border-[var(--g-line)] p-0.5" role="tablist" aria-label="View">
				{(['canvas', 'yaml', 'changes'] as Center[]).map((c) => <button key={c} type="button" role="tab" aria-selected={center === c} onClick={() => set_center(c)} className={TAB(center === c)}>{c === 'yaml' ? 'YAML' : c[0].toUpperCase() + c.slice(1)}</button>)}
			</div>
			<button type="button" onClick={() => download(`${team_slug(team)}.team.yml`, team_to_yaml(team))} className={GHOST}>↓ Export</button>
			<button type="button" onClick={start_over} className={GHOST} title="Start a new team">New</button>
			<button type="button" onClick={() => set_publishing(true)} disabled={!team.phases.length} className="inline-flex h-8 items-center rounded-md bg-[var(--g-acc)] px-3.5 text-[12.5px] font-semibold text-[var(--g-on-acc)] disabled:opacity-40">Publish…</button>
		</div>
	) : null;

	return (
		<Graphite_shell data={overview.data} title={title} actions={actions}>
			<div className="theme-graphite h-full min-h-0" data-testid="builder">
				{!team ? <Gb_start on_team={start} /> : (
					<div className="grid h-full min-h-0 grid-cols-[240px_minmax(0,1fr)_340px]">
						{/* left: build / AI */}
						<aside className="flex min-h-0 flex-col border-r border-[var(--g-line)] bg-[#101113]">
							<div className="grid grid-cols-2 border-b border-[var(--g-line)]" role="tablist" aria-label="Build or AI">
								<button type="button" role="tab" aria-selected={left === 'build'} onClick={() => set_left('build')} className={`py-2.5 text-[13px] ${left === 'build' ? 'border-b-2 border-[var(--g-acc)] font-semibold' : 'text-[var(--g-ink-3)]'}`}>Build</button>
								<button type="button" role="tab" aria-selected={left === 'ai'} onClick={() => set_left('ai')} className={`py-2.5 text-[13px] ${left === 'ai' ? 'border-b-2 border-[var(--g-acc)] font-semibold' : 'text-[var(--g-ink-3)]'}`}>✦ AI</button>
							</div>
							{left === 'ai' ? (
								<div className="min-h-0 flex-1"><Gb_ai_panel team={team} dispatch={dispatch} on_preview={set_preview} request={ai_req} /></div>
							) : (
								<div className="min-h-0 flex-1 overflow-y-auto px-3 py-3" data-testid="build-panel">
									<div className="mb-2 flex items-baseline px-1"><span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--g-ink-3)]">Add a phase</span><span className="ml-auto text-[10.5px] text-[var(--g-ink-3)]">drag or click</span></div>
									<div className="grid gap-1.5">
										{PALETTE.map((k) => (
											<button
												key={k}
												type="button"
												draggable
												onDragStart={(e) => { e.dataTransfer.setData(KIND_MIME, k); e.dataTransfer.setData('text/plain', k); e.dataTransfer.effectAllowed = 'copy'; }}
												onClick={() => add_kind(k)}
												title={selected ? `Add after ${selected}` : 'Add to the canvas'}
												className="flex cursor-grab items-center gap-2.5 rounded-lg border border-[var(--g-line)] bg-[#141518] px-2.5 py-2 text-left hover:border-[var(--g-acc-line)] active:cursor-grabbing"
												data-testid={`tile-${k}`}
											>
												<Kind_tile kind={k} size={26} />
												<span className="min-w-0"><b className="block text-[12.5px]">{KINDS[k].label}</b><span className="block truncate text-[11px] text-[var(--g-ink-3)]">{KINDS[k].blurb}</span></span>
											</button>
										))}
									</div>
									<div className="mb-1.5 mt-5 flex items-baseline px-1"><span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--g-ink-3)]">Outline</span><span className="ml-auto text-[10.5px] text-[var(--g-ink-3)]">{team.phases.filter((p) => !p.is_support).length} phases</span></div>
									<ul data-testid="outline">
										{team.phases.filter((p) => !p.is_support).map((p) => (
											<li key={p.name}>
												<button type="button" onClick={() => select(p.name)} className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[12.5px] ${selected === p.name ? 'bg-[var(--g-soft)] text-[var(--g-ink)]' : 'text-[var(--g-ink-2)] hover:bg-[var(--g-soft)]'}`}>
													<i aria-hidden className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: KINDS[kind_of(p)].color }} />
													<span className="truncate">{p.name}</span>
													{by_phase.get(p.name) ? <i aria-label={by_phase.get(p.name) === 'error' ? 'has errors' : 'has warnings'} className="ml-auto h-1.5 w-1.5 rounded-full" style={{ background: by_phase.get(p.name) === 'error' ? 'var(--g-bad)' : 'var(--g-warn)' }} /> : null}
												</button>
											</li>
										))}
									</ul>
									{team.phases.some((p) => p.is_support) ? (
										<>
											<p className="mb-1 mt-4 px-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--g-ink-3)]">Support</p>
											<ul>{team.phases.filter((p) => p.is_support).map((p) => <li key={p.name}><button type="button" onClick={() => select(p.name)} className="w-full truncate rounded-md px-2 py-1 text-left text-[12.5px] text-[var(--g-ink-3)] hover:bg-[var(--g-soft)]">{p.name}</button></li>)}</ul>
										</>
									) : null}
								</div>
							)}
						</aside>

						{/* center */}
						<section className="relative flex min-h-0 flex-col">
							{state.draft_id && team.version ? (
								<p className="border-b border-[var(--g-line)] bg-[var(--g-panel)] px-3 py-1.5 text-[12px] text-[var(--g-ink-3)]" data-testid="editing-note">
									Editing <span className="g-mono text-[var(--g-ink-2)]">{team.name}</span>. Changes save here as you go; realms keep running <span className="g-mono">v{team.version}</span> until you publish a new version.
								</p>
							) : null}
							<div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--g-line)] px-3 py-2" data-testid="status-pills">
								{errors.length ? (
									<button type="button" onClick={() => { const p = errors.find((x) => x.phase); if (p?.phase) select(p.phase); else select(null); }} className="rounded-full bg-[var(--g-bad-soft)] px-2.5 py-0.5 text-[12px] text-[var(--g-bad)]">✕ {errors.length} problem{errors.length === 1 ? '' : 's'}</button>
								) : team.phases.length ? <span className="rounded-full bg-[var(--g-ok-soft)] px-2.5 py-0.5 text-[12px] text-[var(--g-ok)]">✓ Valid workflow</span> : null}
								{need_roles ? <span className="rounded-full bg-[var(--g-soft)] px-2.5 py-0.5 text-[12px] text-[var(--g-ink-2)]">{need_roles} role brief{need_roles === 1 ? '' : 's'}</span> : null}
								{warnings.slice(0, 2).map((w) => <button key={w.id} type="button" onClick={() => select(w.phase)} className="max-w-[320px] truncate rounded-full bg-[var(--g-warn-soft)] px-2.5 py-0.5 text-[12px] text-[var(--g-warn-text)]">! {w.phase && !w.message.startsWith(w.phase) ? `${w.phase}: ` : ''}{w.message}</button>)}
								{warnings.length > 2 ? <span className="text-[12px] text-[var(--g-ink-3)]">+{warnings.length - 2} more</span> : null}
								<button type="button" onClick={() => dispatch({ type: 'UNDO' })} disabled={!state.history.length} className="ml-auto grid h-7 w-7 place-items-center rounded-md border border-[var(--g-line)] text-[var(--g-ink-3)] hover:text-[var(--g-ink)] disabled:opacity-30" aria-label="Undo" title="Undo (⌘Z)">↶</button>
							</div>
							<div className="min-h-0 flex-1">
								{center === 'canvas' ? (
									<Gb_canvas team={team} selected={selected} problems={by_phase} on_select={select} on_change={change} on_inputs={() => { select(null); set_focus_inputs((x) => x + 1); }} preview={preview} />
								) : center === 'yaml' ? (
									<Gb_yaml team={team} selected={selected} problems={problems} on_team={(t) => change(t)} on_select={select} on_role={(name, content) => change({ ...team, roles: team.roles.map((r) => (r.name === name ? { ...r, content } : r)) })} />
								) : (
									<Changes_view baseline={baseline.team} team={team} on_revert={() => baseline.team && change(baseline.team, null)} />
								)}
							</div>
							{center === 'canvas' && left !== 'ai' ? (
								<button type="button" onClick={() => set_left('ai')} className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full p-px shadow-[0_10px_30px_rgba(0,0,0,.5)]" style={{ background: 'linear-gradient(135deg,rgba(124,108,255,.9),rgba(255,122,217,.6),rgba(45,212,191,.6))' }}>
									<span className="flex items-center gap-2 rounded-full bg-[#131417] px-4 py-2 text-[12.5px] text-[var(--g-ink-2)]"><span className="text-[#cfc7ff]">✦</span> Ask AI to change anything <span className="g-mono text-[10.5px] text-[var(--g-ink-3)]">⌘K</span></span>
								</button>
							) : null}
						</section>

						{/* right: inspector */}
						<aside className="min-h-0 overflow-y-auto border-l border-[var(--g-line)] bg-[#101113]" data-testid="inspector">
							{selected && team.phases.some((p) => p.name === selected)
								? <Phase_panel team={team} name={selected} problems={problems.filter((p) => p.phase === selected)} on_change={change} on_select={select} />
								: <Team_panel team={team} problems={problems.filter((p) => !p.phase)} on_change={(t) => change(t)} on_ask_ai={ask_ai} focus_inputs={focus_inputs} />}
						</aside>
					</div>
				)}
				{publishing && team ? (
					<Gb_publish team={team} baseline={baseline.team} problems={problems} on_close={() => set_publishing(false)} on_published={() => set_baseline({ set: true, team })} />
				) : null}
			</div>
		</Graphite_shell>
	);
}
