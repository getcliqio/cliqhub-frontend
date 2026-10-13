/**
 * The Graphite builder. Start screen until there is a team; then the workspace:
 *   header    — breadcrumb (back to the team), avatar · name · @scope · status, and the team
 *               actions on that row: Discard · Download · Publish (New team is on the Teams list)
 *   left nav  — Team details · Phases (palette inline) · AI · Problems (last, scrolls)
 *   middle    — Canvas · YAML · Changes (switch on the canvas toolbar)
 *   right     — one panel at a time: the selected phase, the team details, or AI.
 *
 * Reads/writes (no new endpoints):
 *   drafts     /v1/teams/create → /v1/teams/update (autosave, debounced)
 *   validate   /v1/teams/build {action: 'validate'} (debounced; local checks are instant)
 *   AI         /v1/teams/build {chat | suggest | improve_role | generate | status}
 *   publish    /v1/team_page/get (installs) · /v1/teams/publish · /v1/realms/add_team
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as RKeyboardEvent } from 'react';
import { Download, IdCard, Shapes, Sparkles } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useAuth, useAuthFetch } from '@/lib/auth_context';
import { api_message } from '@/lib/use_bff_read';
import { use_overview } from '@/lib/overview';
import { useBuilder, useBuilderDispatch, type Builder_source, type GeneratedTeam, type SingleAction } from '@/lib/builder/store';
import { clear_builder_session_restores } from '@/lib/builder/session_restore';
import { KINDS, kind_of, type Kind_id } from '@/lib/builder/kinds';
import { add_after, add_root, diff_teams, duplicate_phase, remove_bridged } from '@/lib/builder/graph_ops';
import { check_team, type Problem } from '@/lib/builder/checks';
import { team_to_yaml } from '@/lib/builder/yaml_tools';
import { team_scope, team_slug } from '@/lib/builder/publish';
import { Graphite_shell } from '@/components/graphite/graphite_shell';
import { Gb_canvas, type Canvas_preview } from '@/components/gbuilder/gb_canvas';
import { Phase_panel, Team_panel } from '@/components/gbuilder/gb_inspector';
import { Gb_ai_panel } from '@/components/gbuilder/gb_ai_panel';
import { Gb_yaml } from '@/components/gbuilder/gb_yaml';
import { Gb_start } from '@/components/gbuilder/gb_start';
import { Gb_publish } from '@/components/gbuilder/gb_publish';
import { Problems_list } from '@/components/gbuilder/gb_problems';
import { Shape_palette } from '@/components/gbuilder/gb_palette';
import { Status_badge, Team_avatar } from '@/pages/teams/teams_graphite_page';

type Center = 'canvas' | 'yaml' | 'changes';
type Save_state = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved'; at: number } | { kind: 'error'; message: string } | { kind: 'unnamed' } | { kind: 'signed_out' } | { kind: 'manual' };

const TAB = (on: boolean) => `rounded-md px-3 py-1 text-[12.5px] ${on ? 'bg-[var(--g-soft)] font-semibold text-[var(--g-ink)]' : 'text-[var(--g-ink-3)] hover:text-[var(--g-ink)]'}`;
const NAV_ITEM = (on: boolean) => `flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] ${on ? 'bg-[var(--g-soft)] font-semibold text-[var(--g-ink)]' : 'text-[var(--g-ink-2)] hover:bg-[var(--g-soft)] hover:text-[var(--g-ink)]'}`;
const GHOST = 'inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-[var(--g-line)] px-2.5 text-[12.5px] text-[var(--g-ink-2)] hover:text-[var(--g-ink)] disabled:opacity-40';
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

/**
 * Autosave into the team's one working copy (`teams/update` with
 * `save_as: 'draft'` — never mints a version). A new team is created first
 * without a manifest, so it has no versions until it is published.
 */
function use_autosave(team: GeneratedTeam | null, dirty: boolean, draft_id: string | null, auto_create: boolean) {
	const auth_fetch = useAuthFetch();
	const dispatch = useBuilderDispatch();
	const { user, scopes } = useAuth();
	const [, set_search] = useSearchParams();
	const [state, set_state] = useState<Save_state>({ kind: 'idle' });
	const [, tick] = useState(0);
	const team_ref = useRef(team); team_ref.current = team;
	const busy = useRef(false);
	const halted = useRef(false);
	/** Something reached the server this session (Cancel then has to undo it). */
	const saved_any = useRef(false);

	const save = useCallback(async () => {
		const t = team_ref.current;
		if (!t || busy.current || halted.current) return;
		if (!user) { set_state({ kind: 'signed_out' }); return; }
		if (!draft_id && team_slug(t) === 'untitled-team') { set_state({ kind: 'unnamed' }); return; }
		busy.current = true;
		set_state({ kind: 'saving' });
		try {
			let id = draft_id;
			if (!id) {
				const res = await auth_fetch('/v1/teams/create', { method: 'POST', body: JSON.stringify({ name: team_slug(t), scope: team_scope(t, scopes[0]?.slug ?? user.username ?? ''), description: t.description || '' }) });
				const p = await res.json().catch(() => null);
				if (!res.ok || !p?.ok || !p.data?.id) { set_state({ kind: 'error', message: api_message(p, 'Couldn’t save the draft.') }); return; }
				id = String(p.data.id);
				saved_any.current = true;
				dispatch({ type: 'SET_DRAFT_ID', draft_id: id });
				set_search((s) => { const n = new URLSearchParams(s); n.set('draft', id!); n.delete('view'); n.delete('fork'); return n; }, { replace: true });
			}
			const res = await auth_fetch('/v1/teams/update', { method: 'POST', body: JSON.stringify({ team_id: id, description: t.description || '', team_json: JSON.stringify(t), save_as: 'draft' }) });
			const p = await res.json().catch(() => null);
			if (!res.ok || !p?.ok) { set_state({ kind: 'error', message: api_message(p, 'Couldn’t save the draft.') }); dispatch({ type: 'SET_DIRTY', dirty: true }); return; }
			saved_any.current = true;
			const changed_meanwhile = team_ref.current !== t;
			dispatch({ type: 'SET_DRAFT_ID', draft_id: id });
			if (changed_meanwhile) dispatch({ type: 'SET_DIRTY', dirty: true });
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

	/** Stop autosaving (Cancel) and wait for a save already in flight to land. */
	const halt = useCallback(async () => {
		halted.current = true;
		while (busy.current) await new Promise((r) => window.setTimeout(r, 50));
	}, []);
	const resume = useCallback(() => { halted.current = false; }, []);

	// keep "saved 12s ago" fresh
	useEffect(() => { const h = window.setInterval(() => tick((x) => x + 1), 15_000); return () => window.clearInterval(h); }, []);
	return { state, save, halt, resume, saved_any };
}

/**
 * Discard: throw the unpublished changes away and leave.
 *   new team / fork created here          → delete it (`teams/delete` by id)
 *   saved team with a working copy        → drop it (`save_as: 'discard'`) — this session's, and one
 *                                           that was there when it opened (Discard asks first)
 *   nothing saved, no working copy        → no request
 * Only teams that began in this session (`is_new`) are ever deleted; versions are never touched.
 */
export async function discard_session(
	auth_fetch: (url: string, init?: RequestInit) => Promise<Response>,
	{ is_new, opened_draft_id, draft_id, saved_any, copy }: { is_new: boolean; opened_draft_id: string | null; draft_id: string | null; saved_any: boolean; copy: Builder_source['copy'] },
): Promise<string | null> {
	let req: { url: string; body: Record<string, unknown> } | null = null;
	if (is_new && draft_id && draft_id !== opened_draft_id) req = { url: '/v1/teams/delete', body: { team_id: draft_id } };
	// A saved team: Discard throws away its working copy — what this session saved, and a copy that
	// was already there when it opened. The published versions are never touched.
	else if (draft_id && draft_id === opened_draft_id && (saved_any || copy)) req = { url: '/v1/teams/update', body: { team_id: draft_id, save_as: 'discard' } };
	if (!req) return null;
	try {
		const res = await auth_fetch(req.url, { method: 'POST', body: JSON.stringify(req.body) });
		const p = await res.json().catch(() => null);
		return res.ok && p?.ok ? null : api_message(p, 'Couldn’t discard the changes.');
	} catch {
		return 'Network error — changes not discarded.';
	}
}

/** Where Cancel goes: the page that opened the builder (`?from=`), else Build › Teams. */
export function cancel_target(from: string | null): string {
	return from && from.startsWith('/') && !from.startsWith('//') && !from.startsWith('/builder') ? from : '/teams';
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
							<li key={i} className="flex items-start gap-3 rounded-lg border border-[var(--g-line)] bg-[var(--g-head)] px-3 py-2 text-[13px]">
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

function Save_badge({ s, on_save, published }: { s: Save_state; on_save: () => void; published: boolean }) {
	const base = 'g-mono whitespace-nowrap rounded px-1.5 py-0.5 text-[11px]';
	if (s.kind === 'saving') return <span className={`${base} bg-[var(--g-soft)] text-[var(--g-ink-3)]`} role="status">saving…</span>;
	if (s.kind === 'saved') return <span className={`${base} bg-[var(--g-soft)] text-[var(--g-ink-3)]`} role="status">{published ? 'unpublished changes' : 'draft'} · saved {ago(s.at)}</span>;
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
	/** The phase palette is open in the left nav. */
	const [phases_open, set_phases_open] = useState(true);
	/** The AI panel is open on the right (a phase or the team details show over it). */
	const [ai_open, set_ai_open] = useState(false);
	/** AI was opened this session: its panel stays mounted (hidden) so the conversation survives closing it. */
	const [ai_mounted, set_ai_mounted] = useState(false);
	const [preview, set_preview] = useState<Canvas_preview | null>(null);
	const [ai_req, set_ai_req] = useState<{ id: number; text: string } | null>(null);
	const [focus_inputs, set_focus_inputs] = useState(0);
	/** The team details are open in the inspector — the default, so the Builder opens on the team
	 *  (a selected phase, or AI, takes the panel; closing returns to the canvas alone). */
	const [team_open, set_team_open] = useState(true);
	const [publishing, set_publishing] = useState(false);
	const [baseline, set_baseline] = useState<{ set: boolean; team: GeneratedTeam | null; draft_id: string | null; is_new: boolean }>({ set: false, team: null, draft_id: null, is_new: false });
	const [auto_create, set_auto_create] = useState(search.get('view') !== '1');
	const auth_fetch = useAuthFetch();
	const { user, scopes } = useAuth();
	const [cancel, set_cancel] = useState<{ step: 'confirm' | 'busy' } | { step: 'error'; message: string } | null>(null);

	// First team to appear (draft / edit / fork restore) is the baseline for Changes and for Cancel.
	useEffect(() => { if (team && !baseline.set) set_baseline({ set: true, team, draft_id: state.draft_id, is_new: search.get('fork') === '1' }); }, [team, baseline.set, state.draft_id, search]);

	const local = useMemo(() => (team ? check_team(team) : []), [team]);
	const core = use_core_validate(team);
	const problems: Problem[] = useMemo(() => {
		if (!core || core.valid || local.some((p) => p.level === 'error')) return local;
		return [...local, ...core.errors.map((m, i) => ({ id: `core-${i}`, level: 'error' as const, phase: null, field: null, message: m }))];
	}, [local, core]);
	// Canvas marker only: phase → worst level (the list itself is in the left panel).
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
	const select = useCallback((name: string | null) => { set_team_open(false); set_focus_inputs(0); dispatch({ type: 'SELECT_PHASE', name }); }, [dispatch]);
	/** Open the team details (optionally straight at the run inputs). */
	const focus_panel = useRef(false);
	const open_team = useCallback((at_inputs = false) => {
		select(null);
		set_team_open(true);
		if (at_inputs) set_focus_inputs((x) => x + 1);
		else focus_panel.current = true;
	}, [select]);
	const close_panel = useCallback(() => select(null), [select]);
	const phase_open = Boolean(team && selected && team.phases.some((p) => p.name === selected));
	const panel_open = Boolean(team) && (phase_open || team_open);
	/** What the right panel shows: a phase, the team details, else AI when it's open. */
	const right: 'phase' | 'team' | 'ai' | null = !team ? null : phase_open ? 'phase' : team_open ? 'team' : ai_open ? 'ai' : null;
	const panel_ref = useRef<HTMLElement | null>(null);
	const opener = useRef<HTMLElement | null>(null);
	const was_open = useRef(false);
	// Focus: remember what opened the inspector; an explicit open moves focus into it,
	// and closing it puts focus back where it came from.
	useEffect(() => {
		if (panel_open && !was_open.current) {
			const a = document.activeElement as HTMLElement | null;
			opener.current = a && a !== document.body && !panel_ref.current?.contains(a) ? a : null;
		}
		if (panel_open && focus_panel.current) {
			focus_panel.current = false;
			panel_ref.current?.querySelector<HTMLElement>('[data-gb-close]')?.focus();
		}
		if (!panel_open && was_open.current) {
			const a = document.activeElement;
			if (!a || a === document.body) {
				const o = opener.current;
				if (o?.isConnected) o.focus();
				else document.querySelector<HTMLElement>('[data-testid="team-details"]')?.focus();
			}
			opener.current = null;
		}
		was_open.current = panel_open;
	}, [panel_open, team_open]);
	function on_panel_key(e: RKeyboardEvent) {
		if (e.key !== 'Escape' || e.defaultPrevented) return;
		e.preventDefault();
		if (right === 'ai') set_ai_open(false); else close_panel();
	}
	const open_ai = useCallback(() => { select(null); set_ai_open(true); set_ai_mounted(true); }, [select]);
	const ask_ai = useCallback((text: string) => { open_ai(); set_ai_req((r) => ({ id: (r?.id ?? 0) + 1, text })); }, [open_ai]);

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
			if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); open_ai(); window.setTimeout(() => document.querySelector<HTMLTextAreaElement>('[aria-label="Ask AI"]')?.focus(), 0); return; }
			if (e.key === 'Escape') { if (!e.defaultPrevented) close_panel(); return; }
			if (!sel) return;
			if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); const r = remove_bridged(t, sel); if (r.ok) change(r.team, null); return; }
			if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); const r = duplicate_phase(t, sel); if (r.ok) change(r.team, r.name ?? null); }
		};
		window.addEventListener('keydown', on);
		return () => window.removeEventListener('keydown', on);
	}, [change, close_panel, dispatch, open_ai, publishing]);

	function start(t: GeneratedTeam) {
		set_baseline({ set: true, team: null, draft_id: null, is_new: true });
		set_auto_create(true);
		dispatch({ type: 'SET_TEAM', team: t, validation: null });
		dispatch({ type: 'SET_DIRTY', dirty: true });
	}

	// By content: a draft can be restored twice, giving an equal team in a new object.
	// Until the effect above captures the baseline, the team just loaded IS the baseline —
	// a click in that window (a fast user, a busy machine) must not read as "changed".
	const changed = useMemo(
		() => baseline.set && Boolean(team) && JSON.stringify(team) !== JSON.stringify(baseline.team),
		[team, baseline.set, baseline.team],
	);
	// Fixed when the session starts (a fork's ?fork=1 is dropped once its draft saves).
	const is_new = baseline.is_new;
	async function leave() {
		set_cancel({ step: 'busy' });
		await save.halt();
		const err = await discard_session(auth_fetch, { is_new, opened_draft_id: baseline.draft_id, draft_id: state.draft_id, saved_any: save.saved_any.current, copy: state.source?.copy ?? null });
		if (err) { save.resume(); set_cancel({ step: 'error', message: err }); return; }
		clear_builder_session_restores();
		dispatch({ type: 'RESET' });
		navigate(cancel_target(search.get('from')), { replace: true });
	}
	// An older working copy is thrown away too, so Discard always asks when there is one.
	const had_copy = Boolean(state.source?.copy);
	const cancel_question = is_new ? 'Discard this new team?' : had_copy ? 'Throw away all unpublished changes, including earlier ones?' : 'Discard your changes?';

	const need_roles = team ? team.phases.filter((p) => KINDS[kind_of(p)].role === 'required').length : 0;
	const title = team ? (team.name.replace(/^@[^/]+\//, '') || 'untitled-team') : 'New team';
	const label = team ? `@${team_scope(team, scopes?.[0]?.slug ?? user?.username ?? '')}/${title}` : '';

	// Team actions sit on the team header row (like the team page). New team is on the Teams list;
	// Canvas / YAML / Changes sit on the canvas.
	const actions = team ? (
		<div className="flex items-center gap-2">
			<Save_badge s={save.state} published={Boolean(state.source?.published)} on_save={() => { set_auto_create(true); void save.save(); }} />
			{cancel ? (
				<span className="inline-flex items-center gap-1.5" role="group" aria-label="Discard changes" data-testid="cancel-confirm">
					<span className={`text-[12px] ${cancel.step === 'error' ? 'text-[var(--g-bad)]' : 'text-[var(--g-ink-2)]'}`} role={cancel.step === 'error' ? 'alert' : undefined}>{cancel.step === 'error' ? cancel.message : cancel_question}</span>
					<button type="button" disabled={cancel.step === 'busy'} onClick={() => void leave()} className="inline-flex h-8 items-center rounded-md bg-[var(--g-bad)] px-2.5 text-[12.5px] font-semibold text-[var(--g-on-color)] disabled:opacity-50">{cancel.step === 'busy' ? 'Discarding…' : cancel.step === 'error' ? 'Try again' : 'Discard'}</button>
					<button type="button" disabled={cancel.step === 'busy'} onClick={() => set_cancel(null)} className={GHOST}>Keep editing</button>
				</span>
			) : (
				<button type="button" onClick={() => (changed || had_copy ? set_cancel({ step: 'confirm' }) : void leave())} className={GHOST} title="Throw away the unpublished changes, and leave">Discard</button>
			)}
			<button type="button" onClick={() => download(`${team_slug(team)}.team.yml`, team_to_yaml(team))} title="Download team.yml" className={GHOST}><Download aria-hidden className="h-3.5 w-3.5" />Download</button>
			<button type="button" onClick={() => set_publishing(true)} disabled={!team.phases.length} className="inline-flex h-8 items-center rounded-md bg-[var(--g-acc)] px-3.5 text-[12.5px] font-semibold text-[var(--g-on-acc)] disabled:opacity-40">Publish…</button>
		</div>
	) : null;

	return (
		<Graphite_shell data={overview.data} title={title}>
			<div className="theme-graphite g-app flex h-full min-h-0 flex-col" data-testid="builder">
				{!team ? <Gb_start on_team={start} /> : (<>
					{/* The team, as on its page: breadcrumb, avatar · name · @scope · status, then its actions. */}
					<header className="shrink-0 border-b border-[var(--g-line)] px-6 pb-3 pt-3.5" data-testid="team-header">
						<nav aria-label="Breadcrumb" className="text-[12.5px] text-[var(--g-ink-3)]">
							<Link to="/teams" className="hover:text-[var(--g-ink)]">Teams</Link>{' › '}
							{search.get('from') ? <Link to={cancel_target(search.get('from'))} className="hover:text-[var(--g-ink)]" title="Back to the team — your draft stays saved">{label}</Link> : <span>{label}</span>}
							{' › '}<span className="text-[var(--g-ink-2)]">Edit</span>
						</nav>
						<div className="mt-2 flex items-center gap-3.5">
							<Team_avatar name={title} size={40} />
							<div className="min-w-0 flex-1">
								<div className="flex flex-wrap items-center gap-2.5">
									<h1 className="truncate text-[20px] font-semibold tracking-tight">{title}</h1>
									<span className="g-mono rounded border border-[var(--g-line-2)] bg-[var(--g-soft)] px-1.5 py-px text-[11px] text-[var(--g-ink-2)]">{label}</span>
									<Status_badge status={state.source?.published ? 'published' : 'draft'} />
								</div>
								{team.description ? <p className="mt-0.5 truncate text-[12.5px] text-[var(--g-ink-3)]">{team.description}</p> : null}
							</div>
							{actions}
						</div>
					</header>
					<div className="flex min-h-0 flex-1">
						{/* left nav: Team details · Phases (palette inline) · AI · Problems (scrolls, last) */}
						<aside className="flex w-[232px] shrink-0 flex-col border-r border-[var(--g-line)] bg-[var(--g-input)]" aria-label="Build tools">
							<nav aria-label="Builder" className="flex shrink-0 flex-col gap-0.5 px-2 py-2">
								<button type="button" onClick={() => (right === 'team' ? close_panel() : open_team())} aria-expanded={right === 'team'} aria-controls="gb-inspector" className={NAV_ITEM(right === 'team')} data-testid="team-details" title="Team name, description, inputs and agents">
									<IdCard aria-hidden className="h-4 w-4" />Team details
								</button>
								{/* Not highlighted: only the item whose panel is open on the right is; this one just folds. */}
								<button type="button" onClick={() => set_phases_open((v) => !v)} aria-expanded={phases_open} className={NAV_ITEM(false)} data-testid="phases-item">
									<Shapes aria-hidden className="h-4 w-4" />Phases<span aria-hidden className="ml-auto text-[10px] text-[var(--g-ink-3)]">{phases_open ? '▾' : '▸'}</span>
								</button>
								{phases_open ? (
									<div className="pb-1 pl-2 pr-1 pt-1" data-testid="build-panel">
										<Shape_palette selected={phase_open ? selected : null} on_add={add_kind} />
									</div>
								) : null}
								<button type="button" onClick={() => (right === 'ai' ? set_ai_open(false) : open_ai())} aria-expanded={right === 'ai'} aria-controls="gb-inspector" className={NAV_ITEM(right === 'ai')} data-testid="ai-item" title="Ask AI to change the team (⌘K)">
									<Sparkles aria-hidden className="h-4 w-4" />AI<span className="g-mono ml-auto text-[10.5px] font-normal text-[var(--g-ink-3)]">⌘K</span>
								</button>
							</nav>
							<div className="flex min-h-0 flex-1 flex-col">
								<Problems_list team={team} problems={problems} on_open={(phase) => (phase && team.phases.some((p) => p.name === phase) ? select(phase) : open_team())} on_change={(t) => change(t)} />
							</div>
						</aside>

						{/* center */}
						<section className="relative flex min-h-0 min-w-0 flex-1 flex-col">
							<div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--g-line)] px-3 py-2" data-testid="canvas-toolbar">
								<div className="flex rounded-lg border border-[var(--g-line)] p-0.5" role="tablist" aria-label="View">
									{(['canvas', 'yaml', 'changes'] as Center[]).map((c) => <button key={c} type="button" role="tab" aria-selected={center === c} onClick={() => set_center(c)} className={TAB(center === c)}>{c === 'yaml' ? 'YAML' : c[0].toUpperCase() + c.slice(1)}</button>)}
								</div>
								{need_roles ? <span className="rounded-full bg-[var(--g-soft)] px-2.5 py-0.5 text-[12px] text-[var(--g-ink-2)]">{need_roles} role brief{need_roles === 1 ? '' : 's'}</span> : null}
								<button type="button" onClick={() => dispatch({ type: 'UNDO' })} disabled={!state.history.length} className="ml-auto grid h-8 w-8 place-items-center rounded-md border border-[var(--g-line)] text-[var(--g-ink-3)] hover:text-[var(--g-ink)] disabled:opacity-30" aria-label="Undo" title="Undo (⌘Z)">↶</button>
							</div>
							<div className="min-h-0 flex-1">
								{center === 'canvas' ? (
									<Gb_canvas team={team} selected={selected} problems={by_phase} on_select={select} on_change={change} on_inputs={() => open_team(true)} preview={preview} />
								) : center === 'yaml' ? (
									<Gb_yaml team={team} selected={selected} problems={problems} on_team={(t) => change(t)} on_select={select} on_role={(name, content) => change({ ...team, roles: team.roles.map((r) => (r.name === name ? { ...r, content } : r)) })} />
								) : (
									<Changes_view baseline={baseline.team} team={team} on_revert={() => baseline.team && change(baseline.team, null)} />
								)}
							</div>
						</section>

						{/* right: a phase, the team details, or AI — one at a time; AI stays mounted so its conversation survives */}
						{right || ai_mounted ? <aside
							id="gb-inspector"
							ref={panel_ref}
							hidden={!right}
							aria-label={right === 'phase' ? `Phase details: ${selected}` : right === 'team' ? 'Team details' : 'AI'}
							onKeyDown={on_panel_key}
							className={`g-slide-in-right ${right ? 'flex' : 'hidden'} min-h-0 w-[340px] shrink-0 flex-col overflow-y-auto border-l border-[var(--g-line)] bg-[var(--g-input)] shadow-[var(--g-drawer-shadow)]`}
							data-testid="inspector"
						>
							{right === 'phase' && selected ? <Phase_panel team={team} name={selected} on_change={change} on_select={select} on_close={close_panel} /> : null}
							{right === 'team' ? <Team_panel team={team} on_change={(t) => change(t)} on_ask_ai={ask_ai} focus_inputs={focus_inputs} on_close={close_panel} /> : null}
							<div hidden={right !== 'ai'} className={`${right === 'ai' ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col`} data-testid="ai-drawer">
								<div className="flex items-center gap-2 border-b border-[var(--g-line)] px-4 py-2.5 text-[13px] font-semibold">
									<Sparkles aria-hidden className="h-3.5 w-3.5 text-[var(--g-acc-text)]" />AI
									<button type="button" onClick={() => set_ai_open(false)} aria-label="Close AI" data-gb-close className="ml-auto text-[var(--g-ink-3)] hover:text-[var(--g-ink)]">✕</button>
								</div>
								<div className="min-h-0 flex-1"><Gb_ai_panel team={team} dispatch={dispatch} on_preview={set_preview} request={ai_req} /></div>
							</div>
						</aside> : null}
					</div>
				</>)}
				{publishing && team ? (
					<Gb_publish team={team} baseline={baseline.team} problems={problems} on_close={() => set_publishing(false)} on_published={() => { set_baseline({ set: true, team, draft_id: state.draft_id, is_new: false }); dispatch({ type: 'SET_SOURCE', source: { published: true, copy: null } }); }} />
				) : null}
			</div>
		</Graphite_shell>
	);
}
