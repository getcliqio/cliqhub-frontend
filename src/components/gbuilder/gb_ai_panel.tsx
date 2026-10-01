/**
 * AI copilot. Core `chat` returns typed actions (ADD_PHASE, UPDATE_PHASE…);
 * they are proposals: previewed on the canvas, then applied all at once
 * (one undo) or discarded. `suggest` offers improvements to try.
 */
import { useEffect, useRef, useState } from 'react';
import { useAuthFetch } from '@/lib/auth_context';
import { api_message } from '@/lib/use_bff_read';
import { INITIAL_STATE, builder_reducer, type BuilderAction, type GeneratedTeam, type SingleAction } from '@/lib/builder/store';
import { diff_teams, type Team_change } from '@/lib/builder/graph_ops';
import type { Canvas_preview } from '@/components/gbuilder/gb_canvas';

const SAFE = new Set(['ADD_PHASE', 'REMOVE_PHASE', 'UPDATE_PHASE', 'ADD_ROLE', 'UPDATE_ROLE', 'REMOVE_ROLE', 'ADD_DEPENDENCY', 'REMOVE_DEPENDENCY', 'UPDATE_TEAM']);

interface Msg { role: 'user' | 'assistant'; content: string; changes?: Team_change[]; status?: 'pending' | 'applied' | 'discarded' }
interface Suggestion { type?: string; title: string; description: string }

/** Apply chat actions to a copy of the team (the preview). */
export function preview_actions(team: GeneratedTeam, actions: SingleAction[]): GeneratedTeam {
	let s: typeof INITIAL_STATE = { ...INITIAL_STATE, team };
	for (const a of actions) s = builder_reducer(s, a);
	const t = s.team ?? team;
	return { ...t, phases: t.phases.map((p) => { const { pending: _p, ...rest } = p; return rest; }) };
}

export function to_preview(team: GeneratedTeam, next: GeneratedTeam): Canvas_preview {
	const d = diff_teams(team, next);
	return {
		team: next,
		added: new Set(d.filter((c) => c.kind === 'added' && c.target === 'phase').map((c) => c.name)),
		changed: new Set(d.filter((c) => (c.kind === 'changed' && c.target === 'phase') || c.target === 'role').map((c) => c.name.replace(/^roles\/|\.md$/g, ''))),
		removed: d.filter((c) => c.kind === 'removed' && c.target === 'phase').map((c) => c.name),
	};
}

const SIGN: Record<string, [string, string, string]> = { added: ['ADD', 'var(--g-ok)', 'var(--g-ok-soft)'], changed: ['EDIT', 'var(--g-warn-text)', 'var(--g-warn-soft)'], removed: ['DEL', 'var(--g-bad)', 'var(--g-bad-soft)'] };

export function Gb_ai_panel({ team, dispatch, on_preview, request }: {
	team: GeneratedTeam;
	dispatch: (a: BuilderAction) => void;
	on_preview: (p: Canvas_preview | null) => void;
	/** A prompt sent from elsewhere (e.g. “Suggest” in the team panel). */
	request: { id: number; text: string } | null;
}) {
	const auth_fetch = useAuthFetch();
	const [msgs, set_msgs] = useState<Msg[]>([]);
	const [input, set_input] = useState('');
	const [busy, set_busy] = useState(false);
	const [pending, set_pending] = useState<{ actions: SingleAction[]; msg: number } | null>(null);
	const [sugs, set_sugs] = useState<Suggestion[] | null>(null);
	const [sug_busy, set_sug_busy] = useState(false);
	const [sug_err, set_sug_err] = useState<string | null>(null);
	const last_req = useRef(0);
	const scroller = useRef<HTMLDivElement>(null);
	useEffect(() => { scroller.current?.scrollTo?.({ top: scroller.current.scrollHeight }); }, [msgs]);
	useEffect(() => { if (request && request.id !== last_req.current) { last_req.current = request.id; void send(request.text); } }, [request]); // eslint-disable-line react-hooks/exhaustive-deps
	useEffect(() => () => on_preview(null), []); // eslint-disable-line react-hooks/exhaustive-deps

	async function send(text: string) {
		const t = text.trim();
		if (!t || busy) return;
		if (pending) discard();
		const history = msgs.map((m) => ({ role: m.role, content: m.content }));
		const next: Msg[] = [...msgs, { role: 'user', content: t }];
		set_msgs(next); set_input(''); set_busy(true);
		try {
			const res = await auth_fetch('/v1/teams/build', { method: 'POST', body: JSON.stringify({ action: 'chat', team, message: t, history }) });
			const payload = await res.json().catch(() => null);
			if (!res.ok || !payload?.ok) { set_msgs([...next, { role: 'assistant', content: api_message(payload, 'Something went wrong — try again.') }]); return; }
			const actions = ((payload.data?.actions ?? []) as SingleAction[]).filter((a) => a && SAFE.has(a.type));
			if (!actions.length) { set_msgs([...next, { role: 'assistant', content: String(payload.data?.reply ?? 'Done.') }]); return; }
			const preview = preview_actions(team, actions);
			const p = to_preview(team, preview);
			const changes = diff_teams(team, preview);
			set_msgs([...next, { role: 'assistant', content: String(payload.data?.reply ?? 'Here’s the plan — preview is on the canvas.'), changes, status: 'pending' }]);
			set_pending({ actions, msg: next.length });
			on_preview(p);
		} catch {
			set_msgs([...next, { role: 'assistant', content: 'Network error — try again.' }]);
		} finally {
			set_busy(false);
		}
	}
	function mark(status: Msg['status']) { if (pending) set_msgs((m) => m.map((x, i) => (i === pending.msg ? { ...x, status } : x))); }
	function apply() {
		if (!pending) return;
		const confirms: SingleAction[] = pending.actions.filter((a): a is Extract<SingleAction, { type: 'ADD_PHASE' }> => a.type === 'ADD_PHASE').map((a) => ({ type: 'CONFIRM_PHASE', name: a.phase.name }));
		dispatch({ type: 'BATCH', actions: [...pending.actions, ...confirms] });
		mark('applied'); set_pending(null); on_preview(null);
	}
	function discard() { mark('discarded'); set_pending(null); on_preview(null); }

	async function suggest() {
		set_sug_busy(true); set_sug_err(null);
		try {
			const res = await auth_fetch('/v1/teams/build', { method: 'POST', body: JSON.stringify({ action: 'suggest', team_name: team.name, description: team.description, phases: team.phases, roles: team.roles }) });
			const payload = await res.json().catch(() => null);
			if (!res.ok || !payload?.ok) { set_sug_err(api_message(payload, 'Couldn’t get suggestions.')); return; }
			const list = payload.data?.suggestions;
			set_sugs(Array.isArray(list) ? list.filter((s: Suggestion) => s?.title).slice(0, 6) : []);
		} catch {
			set_sug_err('Network error — try again.');
		} finally {
			set_sug_busy(false);
		}
	}

	return (
		<div className="flex h-full min-h-0 flex-col" data-testid="ai-panel">
			<div ref={scroller} className="min-h-0 flex-1 overflow-auto px-3 py-3">
				{!msgs.length ? (
					<div className="rounded-xl border border-[var(--g-line)] bg-[#121316] p-3 text-[12.5px] text-[var(--g-ink-2)]">
						<b className="text-[var(--g-ink)]">Ask for any change.</b> “Add a security scan in parallel with tests”, “send failures back to implement, max 3 tries”, “explain this workflow”.
						<p className="mt-1.5 text-[11.5px] text-[var(--g-ink-3)]">Changes are shown on the canvas first — nothing changes until you apply.</p>
					</div>
				) : null}
				{msgs.map((m, i) => (
					<div key={i} className={`mb-2.5 rounded-xl px-3 py-2.5 text-[12.5px] leading-relaxed ${m.role === 'user' ? 'ml-8 bg-[var(--g-acc)] text-[var(--g-on-acc)]' : 'mr-3 bg-[var(--g-soft)] text-[var(--g-ink-2)]'}`} data-testid={`msg-${m.role}`}>
						{m.content}
						{m.changes?.length ? (
							<div className="mt-2 grid gap-1.5">
								{m.changes.map((c, j) => { const [k, fg, bg] = SIGN[c.kind]; return (
									<div key={j} className="flex items-start gap-2 rounded-lg border border-[var(--g-line)] bg-[#111215] px-2 py-1.5 text-[12px]">
										<span className="g-mono shrink-0 rounded px-1 text-[10px] font-bold" style={{ color: fg, background: bg }}>{c.target === 'role' ? 'ROLE' : k}</span>
										<span><b className="text-[var(--g-ink)]">{c.name}</b><span className="block text-[var(--g-ink-3)]">{c.detail}</span></span>
									</div>
								); })}
								{m.status === 'pending' ? (
									<div className="mt-1 flex gap-1.5">
										<button type="button" onClick={apply} className="rounded-md bg-[var(--g-acc)] px-3 py-1 text-[12px] font-semibold text-[var(--g-on-acc)]">Apply all</button>
										<button type="button" onClick={discard} className="rounded-md border border-[var(--g-line)] px-3 py-1 text-[12px] font-semibold">Discard</button>
									</div>
								) : <p className="text-[11.5px] text-[var(--g-ink-3)]">{m.status === 'applied' ? 'Applied — ⌘Z to undo.' : 'Discarded.'}</p>}
							</div>
						) : null}
					</div>
				))}
				{busy ? <p className="px-1 text-[12px] text-[#cfc7ff]" role="status">✦ Thinking…</p> : null}

				<div className="mt-3">
					<div className="mb-1.5 flex items-center"><span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--g-ink-3)]">Suggestions</span>
						<button type="button" disabled={sug_busy} onClick={() => void suggest()} className="ml-auto whitespace-nowrap text-[12px] text-[var(--g-acc)] disabled:opacity-50">{sug_busy ? 'Looking…' : sugs ? 'Refresh' : '✦ Suggest'}</button></div>
					{sug_err ? <p role="alert" className="text-[12px] text-[var(--g-bad)]">{sug_err}</p> : null}
					{sugs?.length === 0 ? <p className="text-[12px] text-[var(--g-ink-3)]">Nothing to suggest — looks good.</p> : null}
					{sugs?.map((s, i) => (
						<div key={i} className="mb-1.5 flex items-start gap-2 rounded-lg border border-[var(--g-line)] bg-[#121316] px-2.5 py-2 text-[12px]" data-testid="suggestion">
							<span className="flex-1"><b className="text-[var(--g-ink)]">{s.title}</b><span className="block text-[var(--g-ink-3)]">{s.description}</span></span>
							<button type="button" onClick={() => void send(`${s.title}: ${s.description}`)} className="shrink-0 font-semibold text-[var(--g-acc)]">Try →</button>
						</div>
					))}
				</div>
			</div>
			<form onSubmit={(e) => { e.preventDefault(); void send(input); }} className="border-t border-[var(--g-line)] p-3">
				<div className="rounded-xl p-px" style={{ background: 'linear-gradient(135deg,rgba(124,108,255,.8),rgba(255,122,217,.55),rgba(45,212,191,.55))' }}>
					<div className="flex items-end gap-2 rounded-[11px] bg-[#121316] p-2">
						<textarea aria-label="Ask AI" value={input} onChange={(e) => set_input(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(input); } }} rows={2} placeholder="Ask for a change…" className="min-h-0 flex-1 resize-none bg-transparent text-[12.5px] text-[var(--g-ink)] outline-none placeholder:text-[#5d616b]" />
						<button type="submit" disabled={busy || !input.trim()} className="rounded-md bg-[var(--g-acc)] px-2.5 py-1 text-[12px] font-semibold text-[var(--g-on-acc)] disabled:opacity-40">Send</button>
					</div>
				</div>
			</form>
		</div>
	);
}
