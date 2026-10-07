/**
 * Right-hand panel. Nothing selected → the team (description, use for / not
 * for, inputs, tags, agents). A phase selected → only what that kind of phase
 * needs (see lib/builder/kinds): a role brief only where the kind has one.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { useAuthFetch } from '@/lib/auth_context';
import { api_message } from '@/lib/use_bff_read';
import type { GeneratedPhase, GeneratedTeam } from '@/lib/builder/store';
import type { SourceEntry, TargetEntry } from '@/lib/types';
import { CONNECTOR_AGENTS, KINDS, LLM_AGENTS, PALETTE, kind_of, role_need, type Kind_id } from '@/lib/builder/kinds';
import { change_kind, connect, disconnect, duplicate_phase, remove_bridged, rename_phase, would_cycle, type Op_result } from '@/lib/builder/graph_ops';
import type { Problem } from '@/lib/builder/checks';
import { Kind_tile } from '@/components/gbuilder/gb_canvas';

export const IN = 'w-full rounded-lg border border-[var(--g-line)] bg-[var(--g-bg)] px-2.5 py-1.5 text-[12.5px] text-[var(--g-ink)] outline-none placeholder:text-[var(--g-ink-4)] focus:border-[var(--g-acc-line)]';
const BTN = 'rounded-md border border-[var(--g-line)] px-2.5 py-1 text-[12px] font-semibold hover:bg-[var(--g-soft)] disabled:opacity-50';
const AI_BTN = 'inline-flex items-center gap-1.5 rounded-lg border border-[rgba(155,140,255,.5)] bg-[linear-gradient(135deg,rgba(124,108,255,.35),rgba(255,122,217,.22))] px-2.5 py-1 text-[11.5px] font-semibold text-[var(--g-acc-text)] disabled:opacity-50';

export function Section({ title, right, children, id }: { title: string; right?: ReactNode; children: ReactNode; id?: string }) {
	return (
		<section id={id} className="border-b border-[var(--g-line)] px-4 py-3.5" aria-label={title}>
			<h3 className="mb-2 flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--g-ink-3)]">{title}{right ? <span className="ml-auto normal-case tracking-normal">{right}</span> : null}</h3>
			{children}
		</section>
	);
}

function List_editor({ label, items, on_change, placeholder }: { label: string; items: string[]; on_change: (v: string[]) => void; placeholder: string }) {
	return (
		<div className="grid gap-1.5">
			{items.map((t, i) => (
				<div key={i} className="flex gap-1.5">
					<input aria-label={`${label} ${i + 1}`} value={t} onChange={(e) => on_change(items.map((x, j) => (j === i ? e.target.value : x)))} className={IN} />
					<button type="button" aria-label={`Remove ${label} ${i + 1}`} onClick={() => on_change(items.filter((_, j) => j !== i))} className="px-1.5 text-[var(--g-ink-3)] hover:text-[var(--g-bad)]">✕</button>
				</div>
			))}
			<button type="button" onClick={() => on_change([...items, ''])} className="w-fit text-[12px] text-[var(--g-acc)]">+ {placeholder}</button>
		</div>
	);
}

function Problems({ items, team, on_change }: { items: Problem[]; team: GeneratedTeam; on_change: (t: GeneratedTeam) => void }) {
	if (!items.length) return null;
	return (
		<div className="grid gap-1.5 border-b border-[var(--g-line)] px-4 py-3" data-testid="panel-problems">
			{items.map((p) => (
				<div key={p.id} className={`flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-[12px] ${p.level === 'error' ? 'border-[var(--g-bad-line)] text-[var(--g-bad-text)]' : 'border-[rgba(255,178,36,.35)] text-[var(--g-warn-text)]'}`}>
					<span aria-hidden>{p.level === 'error' ? '●' : '!'}</span>
					<span className="flex-1">{p.message}</span>
					{p.fix ? <button type="button" onClick={() => on_change(p.fix!.apply(team))} className="shrink-0 font-semibold text-[var(--g-acc)]">{p.fix.label}</button> : null}
				</div>
			))}
		</div>
	);
}

/** Role brief editor with ✦ Improve (Core improve_role) → keep / discard. */
function Role_editor({ team, phase, need, label, on_role }: { team: GeneratedTeam; phase: GeneratedPhase; need: 'required' | 'optional'; label: string; on_role: (content: string) => void }) {
	const auth_fetch = useAuthFetch();
	const role = team.roles.find((r) => r.name === phase.name);
	const [busy, set_busy] = useState(false);
	const [proposal, set_proposal] = useState<string | null>(null);
	const [err, set_err] = useState<string | null>(null);
	useEffect(() => { set_proposal(null); set_err(null); }, [phase.name]);
	async function improve() {
		set_busy(true); set_err(null);
		try {
			const res = await auth_fetch('/v1/teams/build', { method: 'POST', body: JSON.stringify({
				action: 'improve_role', role_name: phase.name,
				role_content: role?.content.trim() ? role.content : `# ${phase.name}\n\nWrite the brief for the ${phase.name} phase of ${team.name}: ${team.description}`,
				team_name: team.name, team_description: team.description, phases: team.phases.map((p) => p.name),
			}) });
			const payload = await res.json().catch(() => null);
			if (!res.ok || !payload?.ok || !payload.data?.improved_content) { set_err(api_message(payload, 'Couldn’t improve the brief — try again.')); return; }
			set_proposal(String(payload.data.improved_content));
		} catch {
			set_err('Network error — try again.');
		} finally {
			set_busy(false);
		}
	}
	return (
		<Section title={label} right={<><span className={`mr-2 text-[10.5px] ${need === 'required' ? 'text-[var(--g-acc)]' : 'text-[var(--g-ink-3)]'}`}>{need}</span><button type="button" disabled={busy} onClick={() => void improve()} className={AI_BTN}>{busy ? '✦ Working…' : role?.content.trim() ? '✦ Improve' : '✦ Write it for me'}</button></>}>
			{proposal !== null ? (
				<div data-testid="role-proposal">
					<pre className="max-h-[260px] overflow-auto whitespace-pre-wrap rounded-lg border border-[rgba(62,207,142,.4)] bg-[rgba(62,207,142,.06)] p-2.5 font-[inherit] text-[12px] leading-relaxed text-[var(--g-ink-2)]">{proposal}</pre>
					<div className="mt-2 flex items-center gap-1.5"><span className="text-[11.5px] text-[var(--g-acc-text)]">✦ suggested brief</span><button type="button" onClick={() => set_proposal(null)} className={`${BTN} ml-auto`}>Discard</button><button type="button" onClick={() => { on_role(proposal); set_proposal(null); }} className="rounded-md bg-[var(--g-acc)] px-2.5 py-1 text-[12px] font-semibold text-[var(--g-on-acc)]">Keep</button></div>
				</div>
			) : (
				<textarea aria-label={label} value={role?.content ?? ''} onChange={(e) => on_role(e.target.value)} rows={9} placeholder={need === 'required' ? 'What this agent should do, produce and avoid…' : 'Optional'} className={`${IN} font-[inherit] leading-relaxed`} />
			)}
			{err ? <p role="alert" className="mt-1.5 text-[12px] text-[var(--g-bad)]">{err}</p> : null}
		</Section>
	);
}

function Commands({ phase, on, label }: { phase: GeneratedPhase; on: (p: Partial<GeneratedPhase>) => void; label: string }) {
	const cmds = phase.commands ?? [];
	return (
		<Section title={label}>
			<div className="grid gap-1.5">
				{cmds.map((c, i) => (
					<div key={i} className="grid grid-cols-[84px_1fr_auto] gap-1.5">
						<input aria-label={`Command ${i + 1} name`} value={c.name} onChange={(e) => on({ commands: cmds.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} className={IN} placeholder="name" />
						<input aria-label={`Command ${i + 1}`} value={c.run} onChange={(e) => on({ commands: cmds.map((x, j) => (j === i ? { ...x, run: e.target.value } : x)) })} className={`${IN} g-mono`} placeholder="npm test" />
						<button type="button" aria-label={`Remove command ${i + 1}`} onClick={() => on({ commands: cmds.filter((_, j) => j !== i) })} className="px-1.5 text-[var(--g-ink-3)] hover:text-[var(--g-bad)]">✕</button>
					</div>
				))}
				<button type="button" onClick={() => on({ commands: [...cmds, { name: `cmd-${cmds.length + 1}`, run: '' }] })} className="w-fit text-[12px] text-[var(--g-acc)]">+ add</button>
			</div>
		</Section>
	);
}

function Entries({ title, kind, items, on }: { title: string; kind: 'source' | 'target'; items: Array<SourceEntry | TargetEntry>; on: (v: Array<SourceEntry | TargetEntry>) => void }) {
	return (
		<Section title={title}>
			<div className="grid gap-2">
				{items.map((s, i) => (
					<div key={i} className="grid gap-1 rounded-lg border border-[var(--g-line-2)] p-2">
						<div className="flex gap-1.5">
							<input aria-label={`${title} ${i + 1} name`} value={s.name ?? ''} onChange={(e) => on(items.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className={IN} placeholder="name" />
							<button type="button" aria-label={`Remove ${title} ${i + 1}`} onClick={() => on(items.filter((_, j) => j !== i))} className="px-1.5 text-[var(--g-ink-3)] hover:text-[var(--g-bad)]">✕</button>
						</div>
						<input aria-label={`${title} ${i + 1} URL`} value={String(s.url ?? '')} onChange={(e) => on(items.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} className={`${IN} g-mono`} placeholder={kind === 'source' ? 'jira://$(inputs.ticket)' : 'gdrive://folder/'} />
						{kind === 'target' ? (
							<div className="flex gap-1.5">
								<input aria-label={`${title} ${i + 1} file`} value={String((s as TargetEntry).file ?? '')} onChange={(e) => on(items.map((x, j) => (j === i ? { ...x, file: e.target.value } : x)))} className={`${IN} g-mono`} placeholder="report.md" />
								<select aria-label={`${title} ${i + 1} mode`} value={String((s as TargetEntry).mode ?? 'create')} onChange={(e) => on(items.map((x, j) => (j === i ? { ...x, mode: e.target.value as TargetEntry['mode'] } : x)))} className={`${IN} w-[110px]`}>{['create', 'append', 'replace'].map((m) => <option key={m}>{m}</option>)}</select>
							</div>
						) : null}
					</div>
				))}
				<button type="button" onClick={() => on([...items, kind === 'source' ? { name: `source-${items.length + 1}`, url: '' } : { name: `target-${items.length + 1}`, file: '', url: '', mode: 'create' }])} className="w-fit text-[12px] text-[var(--g-acc)]">+ add</button>
			</div>
		</Section>
	);
}

export function Phase_panel({ team, name, problems, on_change, on_select }: { team: GeneratedTeam; name: string; problems: Problem[]; on_change: (t: GeneratedTeam, select?: string | null) => void; on_select: (n: string | null) => void }) {
	const phase = team.phases.find((p) => p.name === name);
	const [menu, set_menu] = useState(false);
	const [draft_name, set_draft_name] = useState(name);
	const [name_err, set_name_err] = useState<string | null>(null);
	useEffect(() => { set_draft_name(name); set_name_err(null); set_menu(false); }, [name]);
	if (!phase) return null;
	const kind = kind_of(phase); const k = KINDS[kind];
	const need = role_need(phase);
	const on = (partial: Partial<GeneratedPhase>) => on_change({ ...team, phases: team.phases.map((p) => (p.name === name ? { ...p, ...partial } : p)) });
	const run = (r: Op_result, select?: string | null) => { if (r.ok) on_change(r.team, select === undefined ? r.name : select); };
	const set_role = (content: string) => {
		const has = team.roles.some((r) => r.name === name);
		on_change({ ...team, roles: has ? team.roles.map((r) => (r.name === name ? { ...r, content } : r)) : [...team.roles, { name, content }] });
	};
	function commit_name() {
		if (draft_name === name) return;
		const r = rename_phase(team, name, draft_name.trim());
		if (!r.ok) { set_name_err(r.error); return; }
		run(r, draft_name.trim());
	}
	function toggle_support() {
		if (phase!.is_support) { on({ is_support: undefined }); return; }
		const r = remove_bridged(team, name);
		if (!r.ok) return;
		const roles = team.roles; // keep its brief
		on_change({ ...r.team, roles, phases: [...r.team.phases, { ...phase!, depends_on: [], is_support: true }] }, name);
	}
	const main = team.phases.filter((p) => !p.is_support && p.name !== name);
	const addable = main.filter((p) => !phase.depends_on.includes(p.name) && !would_cycle(team, p.name, name));
	const agents = [...new Set([...LLM_AGENTS, ...(team.agents ?? []).map((a) => a.name)])];

	return (
		<div data-testid="phase-panel">
			<div className="flex items-center gap-2.5 border-b border-[var(--g-line)] px-4 py-3">
				<Kind_tile kind={kind} size={32} />
				<div className="min-w-0 flex-1">
					<input aria-label="Phase name" value={draft_name} onChange={(e) => { set_draft_name(e.target.value); set_name_err(null); }} onBlur={commit_name} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} className="w-full bg-transparent text-[14px] font-semibold text-[var(--g-ink)] outline-none" />
					<select aria-label="Kind" value={kind} onChange={(e) => run(change_kind(team, name, e.target.value as Kind_id), name)} className="mt-0.5 bg-transparent text-[11.5px] text-[var(--g-ink-3)] outline-none">
						{PALETTE.map((id) => <option key={id} value={id}>{KINDS[id].label}</option>)}
					</select>
					{name_err ? <p role="alert" className="text-[11.5px] text-[var(--g-bad)]">{name_err}</p> : null}
				</div>
				<div className="relative">
					<button type="button" aria-label="Phase actions" aria-expanded={menu} onClick={() => set_menu(!menu)} className="grid h-7 w-7 place-items-center rounded-md text-[var(--g-ink-3)] hover:bg-[var(--g-soft)]"><MoreHorizontal className="h-4 w-4" /></button>
					{menu ? (
						<div role="menu" className="absolute right-0 top-8 z-20 w-[190px] rounded-lg border border-[var(--g-line-strong)] bg-[var(--g-pop)] p-1 shadow-lg">
							<button type="button" role="menuitem" onClick={() => run(duplicate_phase(team, name))} className="block w-full rounded px-2 py-1.5 text-left text-[12.5px] hover:bg-[var(--g-soft)]">Duplicate <span className="float-right text-[var(--g-ink-3)]">⌘D</span></button>
							<button type="button" role="menuitem" onClick={toggle_support} className="block w-full rounded px-2 py-1.5 text-left text-[12.5px] hover:bg-[var(--g-soft)]">{phase.is_support ? 'Move into the flow' : 'Make it a support phase'}</button>
							<button type="button" role="menuitem" onClick={() => { const r = remove_bridged(team, name); if (r.ok) on_change(r.team, null); }} className="block w-full rounded px-2 py-1.5 text-left text-[12.5px] text-[var(--g-bad)] hover:bg-[var(--g-soft)]">Delete <span className="float-right text-[var(--g-ink-3)]">⌫</span></button>
						</div>
					) : null}
				</div>
			</div>
			<Problems items={problems} team={team} on_change={(t) => on_change(t)} />

			{need !== 'none' ? <Role_editor team={team} phase={phase} need={need} label={k.role_label} on_role={set_role} /> : null}

			{kind === 'agent' || kind === 'gate' ? (
				<Section title="Agent">
					<select aria-label="Agent" value={phase.agent ?? ''} onChange={(e) => on({ agent: e.target.value || undefined })} className={IN}>
						{agents.map((a) => <option key={a} value={a}>{a}</option>)}
					</select>
					<input aria-label="Model" value={phase.model ?? ''} onChange={(e) => on({ model: e.target.value || undefined })} placeholder="Model (optional — the agent’s default)" className={`${IN} mt-1.5`} />
				</Section>
			) : null}

			{kind === 'script' ? <Commands phase={phase} on={on} label="Commands" /> : null}
			{kind === 'gate' || kind === 'human' ? <Commands phase={phase} on={on} label={kind === 'gate' ? 'Checks' : 'Checks shown to the reviewer'} /> : null}
			{kind === 'gate' || kind === 'script' ? (
				<Section title={kind === 'gate' ? 'If it fails' : 'Retries'}>
					<div className="flex items-center gap-2 text-[12.5px] text-[var(--g-ink-2)]">
						{kind === 'gate' ? <span>Route back to <b className="text-[var(--g-ink)]">{phase.depends_on.join(' / ') || '—'}</b>, up to</span> : <span>Retry up to</span>}
						<input aria-label="Max tries" type="number" min={1} max={5} value={phase.max_iterations ?? ''} onChange={(e) => on({ max_iterations: e.target.value ? Number(e.target.value) : undefined })} className={`${IN} w-16`} />
						<span>times</span>
					</div>
				</Section>
			) : null}

			{kind === 'human' ? (
				<Section title="Review">
					<label className="text-[11.5px] text-[var(--g-ink-3)]">Reviewer</label>
					<input aria-label="Reviewer" value={phase.review?.reviewer ?? ''} onChange={(e) => on({ review: { ...phase.review, reviewer: e.target.value } })} placeholder="a person, a group, or $(inputs.reviewers)" className={IN} />
					<div className="mt-2 grid grid-cols-2 gap-1.5">
						<input aria-label="Timeout" value={phase.review?.timeout ?? ''} onChange={(e) => on({ review: { ...phase.review, timeout: e.target.value || undefined } })} placeholder="timeout · 24h" className={IN} />
						<input aria-label="Remind every" value={phase.review?.remind_every ?? ''} onChange={(e) => on({ review: { ...phase.review, remind_every: e.target.value || undefined } })} placeholder="remind · 4h" className={IN} />
					</div>
					<input aria-label="Artifacts to show" value={(phase.review?.artifacts ?? []).join(', ')} onChange={(e) => on({ review: { ...phase.review, artifacts: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) } })} placeholder="files to show · docs/design.md, …" className={`${IN} mt-1.5`} />
				</Section>
			) : null}

			{kind === 'connector' ? (
				<Section title="Service">
					<select aria-label="Service" value={phase.agent ?? 'jira'} onChange={(e) => on({ agent: e.target.value })} className={IN}>{CONNECTOR_AGENTS.map((a) => <option key={a}>{a}</option>)}</select>
					<input aria-label="Action" value={phase.action ?? ''} onChange={(e) => on({ action: e.target.value })} placeholder="action · get_issue, upload, create_page…" className={`${IN} mt-1.5`} />
				</Section>
			) : null}
			{kind === 'connector' || kind === 'fetch' ? (
				<>
					<Entries title="Sources" kind="source" items={phase.sources ?? []} on={(v) => on({ sources: v.length ? (v as SourceEntry[]) : undefined })} />
					<Entries title="Targets" kind="target" items={phase.target_entries ?? []} on={(v) => on({ target_entries: v.length ? (v as TargetEntry[]) : undefined })} />
				</>
			) : null}

			{kind === 'team' ? (
				<Section title="Sub-team">
					<input aria-label="Team" value={phase.team ?? ''} onChange={(e) => on({ team: e.target.value })} placeholder="@scope/team-name" className={`${IN} g-mono`} />
					<p className="mb-1 mt-2.5 text-[11.5px] text-[var(--g-ink-3)]">Inputs it needs</p>
					{Object.entries(phase.inputs ?? {}).map(([key, val], i) => (
						<div key={i} className="mb-1.5 grid grid-cols-[1fr_1.4fr_auto] gap-1.5">
							<input aria-label={`Input ${i + 1} name`} value={key} onChange={(e) => { const entries = Object.entries(phase.inputs ?? {}); entries[i] = [e.target.value, val]; on({ inputs: Object.fromEntries(entries) }); }} className={`${IN} g-mono`} />
							<input aria-label={`Input ${i + 1} value`} value={val} onChange={(e) => on({ inputs: { ...phase.inputs, [key]: e.target.value } })} className={`${IN} g-mono`} placeholder="$(inputs.x) or text" />
							<button type="button" aria-label={`Remove input ${i + 1}`} onClick={() => { const next = { ...phase.inputs }; delete next[key]; on({ inputs: next }); }} className="px-1.5 text-[var(--g-ink-3)]">✕</button>
						</div>
					))}
					<button type="button" onClick={() => on({ inputs: { ...phase.inputs, [`input_${Object.keys(phase.inputs ?? {}).length + 1}`]: '' } })} className="text-[12px] text-[var(--g-acc)]">+ add</button>
				</Section>
			) : null}

			{!phase.is_support ? (
				<Section title="Runs after" right={<span className="text-[10.5px] text-[var(--g-ink-3)]">same as the arrows</span>}>
					<div className="flex flex-wrap items-center gap-1.5" data-testid="runs-after">
						{phase.depends_on.map((d) => (
							<span key={d} className="g-mono inline-flex items-center gap-1 rounded-md border border-[var(--g-line)] bg-[var(--g-soft)] px-1.5 py-0.5 text-[11.5px]">
								<button type="button" onClick={() => on_select(d)} className="hover:underline">{d}</button>
								<button type="button" aria-label={`Stop running after ${d}`} onClick={() => run(disconnect(team, d, name), name)} className="text-[var(--g-ink-3)] hover:text-[var(--g-bad)]">✕</button>
							</span>
						))}
						{addable.length ? (
							<select aria-label="Add a phase this runs after" value="" onChange={(e) => { if (e.target.value) run(connect(team, e.target.value, name), name); }} className="rounded-md border border-dashed border-[var(--g-line)] bg-transparent px-1.5 py-0.5 text-[11.5px] text-[var(--g-ink-3)]">
								<option value="">+ add</option>
								{addable.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
							</select>
						) : null}
						{!phase.depends_on.length && !addable.length ? <span className="text-[12px] text-[var(--g-ink-3)]">Starts the flow</span> : null}
					</div>
					<p className="mt-2 text-[11.5px] text-[var(--g-ink-3)]">Tip: drag from a phase’s bottom dot onto another phase to link them.</p>
				</Section>
			) : (
				<Section title="Support"><p className="text-[12px] text-[var(--g-ink-3)]">Not in the flow — any phase can call it.</p></Section>
			)}
		</div>
	);
}

export function Team_panel({ team, problems, on_change, on_ask_ai, focus_inputs }: { team: GeneratedTeam; problems: Problem[]; on_change: (t: GeneratedTeam) => void; on_ask_ai: (prompt: string) => void; focus_inputs: number }) {
	const inputs_ref = useRef<HTMLDivElement>(null);
	useEffect(() => { if (focus_inputs) { inputs_ref.current?.scrollIntoView?.({ block: 'center' }); inputs_ref.current?.querySelector<HTMLInputElement>('input')?.focus(); } }, [focus_inputs]);
	const scope = /^@([^/]+)\//.exec(team.name)?.[1] ?? null;
	const slug = team.name.replace(/^@[^/]+\//, '');
	const inputs = team.inputs ?? [];
	const counts = new Map<string, number>();
	for (const p of team.phases) if (p.agent) counts.set(p.agent, (counts.get(p.agent) ?? 0) + 1);
	return (
		<div data-testid="team-panel">
			<div className="border-b border-[var(--g-line)] px-4 py-3">
				<b className="text-[14px]">Team</b>
				<p className="text-[11.5px] text-[var(--g-ink-3)]">Click empty canvas to come back here.</p>
			</div>
			<Problems items={problems} team={team} on_change={on_change} />
			<Section title="Name & description">
				<div className="flex items-center gap-1">
					{scope ? <span className="g-mono text-[12px] text-[var(--g-ink-3)]">@{scope}/</span> : null}
					<input aria-label="Team name" value={slug} onChange={(e) => on_change({ ...team, name: scope ? `@${scope}/${e.target.value}` : e.target.value })} className={`${IN} g-mono`} />
				</div>
				<textarea aria-label="Description" value={team.description} onChange={(e) => on_change({ ...team, description: e.target.value })} rows={3} placeholder="What this team does, in a sentence." className={`${IN} mt-1.5`} />
			</Section>
			<Section title="Use it for" right={<button type="button" onClick={() => on_ask_ai('Suggest 2–3 short "use it for" and 2–3 "not for" bullets for this team and set them with UPDATE_TEAM (use_when, not_for).')} className={AI_BTN}>✦ Suggest</button>}>
				<List_editor label="Use it for" items={team.use_when ?? []} on_change={(v) => on_change({ ...team, use_when: v })} placeholder="add" />
			</Section>
			<Section title="Not for">
				<List_editor label="Not for" items={team.not_for ?? []} on_change={(v) => on_change({ ...team, not_for: v })} placeholder="add" />
			</Section>
			<Section title="Inputs" right={<span className="text-[10.5px] text-[var(--g-ink-3)]">the form Run asks for</span>} id="team-inputs">
				<div ref={inputs_ref} className="grid gap-1.5">
					{inputs.map((inp, i) => (
						<div key={i} className="grid grid-cols-[110px_1fr_auto] gap-1.5">
							<input aria-label={`Input ${i + 1} name`} value={inp.name} onChange={(e) => on_change({ ...team, inputs: inputs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} className={`${IN} g-mono`} />
							<input aria-label={`Input ${i + 1} description`} value={inp.description ?? ''} onChange={(e) => on_change({ ...team, inputs: inputs.map((x, j) => (j === i ? { ...x, description: e.target.value || undefined } : x)) })} placeholder="what it is" className={IN} />
							<button type="button" aria-label={`Remove input ${inp.name}`} onClick={() => on_change({ ...team, inputs: inputs.filter((_, j) => j !== i) })} className="px-1.5 text-[var(--g-ink-3)] hover:text-[var(--g-bad)]">✕</button>
						</div>
					))}
					<button type="button" onClick={() => on_change({ ...team, inputs: [...inputs, { name: `input_${inputs.length + 1}` }] })} className="w-fit text-[12px] text-[var(--g-acc)]">+ add input</button>
					<p className="text-[11.5px] text-[var(--g-ink-3)]">Phases use them as <span className="g-mono">$(inputs.name)</span>.</p>
				</div>
			</Section>
			<Section title="Tags">
				<input aria-label="Tags" value={(team.tags ?? []).join(', ')} onChange={(e) => on_change({ ...team, tags: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} placeholder="engineering, tdd" className={IN} />
			</Section>
			<Section title="Agents used" right={<span className="text-[10.5px] text-[var(--g-ink-3)]">from the phases</span>}>
				<div className="grid gap-1 text-[12px]">
					{[...counts].map(([a, n]) => <div key={a} className="flex"><span className="g-mono">{a}</span><span className="ml-auto text-[var(--g-ink-3)]">{n} phase{n === 1 ? '' : 's'}</span></div>)}
					{!counts.size ? <span className="text-[var(--g-ink-3)]">No phases yet.</span> : null}
				</div>
				{(team.agents ?? []).length ? (
					<details className="mt-2 text-[12px]">
						<summary className="cursor-pointer text-[var(--g-ink-3)]">Custom agents: entry point &amp; env</summary>
						{(team.agents ?? []).map((a, i) => (
							<div key={a.name} className="mt-1.5 grid gap-1">
								<span className="g-mono">{a.name}</span>
								<input aria-label={`${a.name} entry`} value={a.entry ?? ''} onChange={(e) => on_change({ ...team, agents: team.agents.map((x, j) => (j === i ? { ...x, entry: e.target.value || undefined } : x)) })} placeholder="entry" className={IN} />
								<input aria-label={`${a.name} env`} value={(a.env ?? []).join(', ')} onChange={(e) => on_change({ ...team, agents: team.agents.map((x, j) => (j === i ? { ...x, env: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) } : x)) })} placeholder="ENV_VAR, …" className={IN} />
							</div>
						))}
					</details>
				) : null}
			</Section>
		</div>
	);
}
