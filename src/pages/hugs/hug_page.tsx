/**
 * Hug — /hugs/:hug_id (Graphite). A person is asked for input. Top to bottom:
 *
 *   review    — one small line of metadata (target channel, opened, expires, HUG ID; who it
 *               wasn't sent to, when that happened), then the title and the prompt
 *   workflow  — the team (`@scope/name vX`) and its run as a graph, each phase coloured by how it
 *               went and this Hug's phase highlighted; clicking a phase shows its output
 *   context   — what the requester attached (files, notes, checks, a conversation)
 *   response  — the requested inputs, Required then Optional, and Submit response at the bottom;
 *               once the Hug has ended, how it ended and the responses instead
 *
 * Read: `POST /v1/hug_page/get` (the Hug and its run's workflow; Core lets in anyone with runs.view
 * on the Hug's realm). A phase's output: `POST /v1/run_detail/get`, read only when a phase is opened.
 * Writes: `/v1/hugs/respond`; files stream to `/v1/artifacts/upload` as they are picked.
 */
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useAuth } from '@/lib/auth_context';
import { use_overview } from '@/lib/overview';
import { use_bff_read } from '@/lib/use_bff_read';
import { ago } from '@/lib/admin';
import { choice_label, is_answerable, my_response, status_label, type Hug, type Hug_page_data, type Hug_response, type Hug_run } from '@/lib/hug';
import type { Run_detail_data } from '@/lib/realm_inbox';
import type { Team_phase } from '@/lib/team_page';
import { Graphite_shell } from '@/components/graphite/graphite_shell';
import { Workflow_graph } from '@/components/graphite/g_workflow_graph';
import { G_phase_output } from '@/components/graphite/g_phase_output';
import { Md } from '@/components/graphite/g_md';
import { Hug_context } from '@/components/hug/hug_context';
import { Hug_form } from '@/components/hug/hug_form';
import { Hug_responses } from '@/components/hug/hug_responses';
import { Blocking_error } from '@/pages/realm/realm_inbox_page';
import { G_BTN, G_PRIMARY } from '@/components/graphite/g_agents';

const PANEL = 'rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)]';

/** "in 1h 52m" / "in 4m" — how long until `iso`. */
function until(iso: string, now: number = Date.now()): string {
	const m = Math.max(0, Math.round((Date.parse(iso) - now) / 60_000));
	if (m < 60) return `in ${m}m`;
	const h = Math.floor(m / 60);
	return h < 48 ? `in ${h}h ${m % 60}m` : `in ${Math.round(h / 24)}d`;
}

const clock = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function Status_pill({ hug, open, answered }: { hug: Hug; open: boolean; answered: boolean }) {
	if (open) {
		return answered
			? <span className="rounded-full bg-[var(--g-ok-soft)] px-2.5 py-0.5 text-[12px] font-semibold text-[var(--g-ok)]">Response sent</span>
			: <span className="rounded-full bg-[rgba(255,122,217,.14)] px-2.5 py-0.5 text-[12px] font-semibold text-[var(--g-hug)]">Waiting on you</span>;
	}
	const tone = hug.status === 'closed' ? 'bg-[var(--g-ok-soft)] text-[var(--g-ok)]' : 'bg-[var(--g-soft)] text-[var(--g-ink-3)]';
	return <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${tone}`}>{hug.status === 'open' ? 'Expired' : status_label(hug)}</span>;
}

/** One small line: target channel, opened, expires (or ended), HUG ID — and who it wasn't sent to, when that happened. */
function Meta_line({ hug, open }: { hug: Hug; open: boolean }) {
	const [copied, set_copied] = useState(false);
	const not_sent = hug.not_sent_to ?? [];
	const item = 'whitespace-nowrap';
	const val = 'text-[var(--g-ink-2)]';
	return (
		<div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-[var(--g-line)] pb-2.5 text-[11.5px] text-[var(--g-ink-3)]" data-testid="hug-meta">
			<span className={item}>Target channel <span className={`g-mono ${val}`}>{hug.channels.join(', ')}</span></span>
			<span className={item}>Opened <span className={val}>{clock(hug.created_at)}, {ago(hug.created_at)} ago</span></span>
			{open
				? <span className={item}>Expires <span className={val}>{clock(hug.expires_at)}, {until(hug.expires_at)}</span></span>
				: <span className={item}>Ended <span className={val}>{hug.closed_at ? `${clock(hug.closed_at)}, ${ago(hug.closed_at)} ago` : clock(hug.expires_at)}</span></span>}
			<span className={item}>
				HUG ID <span className={`g-mono ${val}`}>{hug.id.slice(0, 8)}</span>
				<button
					type="button"
					aria-label="Copy HUG ID"
					className="ml-1 text-[var(--g-ink-3)] hover:text-[var(--g-ink)]"
					onClick={() => { void navigator.clipboard?.writeText(hug.id).then(() => { set_copied(true); setTimeout(() => set_copied(false), 1500); }); }}
				>
					{copied ? 'copied' : '⧉'}
				</button>
			</span>
			{not_sent.length ? (
				<span className="text-[var(--g-warn-text)]" data-testid="not-sent">
					Not sent to {not_sent.map((p) => `${p.name} (via ${p.channel})`).join(', ')} — they can’t view runs in this realm
				</span>
			) : null}
		</div>
	);
}

/** The run's phases as the team page's graph expects them. */
function graph_phases(run: Hug_run): Team_phase[] {
	return run.phases.map((p) => ({
		name: p.name, type: p.type ?? 'standard', agent: p.agent, depends_on: p.depends_on, review: p.agent === 'hug',
		reviewers: null, max_iterations: null, commands: [], sources: [], targets: [], team: null, role: null, support: false,
	}));
}

/** The team, the run, and its workflow graph; a clicked phase shows its output underneath. */
function Workflow({ hug, run, run_href }: { hug: Hug; run: Hug_run; run_href: string | null }) {
	const [open_phase, set_open_phase] = useState<string | null>(null);
	const phases = useMemo(() => graph_phases(run), [run]);
	const statuses = useMemo(() => Object.fromEntries(run.phases.map((p) => [p.name, p.status])), [run]);
	const detail = use_bff_read<Run_detail_data>('/v1/run_detail/get', open_phase ? { run_id: run.run_id } : null, { fallback_error: 'Could not load the phase output.' });
	const outputs = (detail.data?.phase_outputs ?? []).filter((o) => o.phase === open_phase);
	const team = run.team_label ?? hug.team;
	return (
		<section className={`${PANEL} flex flex-col gap-2 px-4 py-3`} aria-label="Workflow">
			<div className="flex flex-wrap items-center gap-2 text-[12px]">
				{team ? (
					<span className="g-mono rounded-md bg-[rgba(182,156,255,.14)] px-2 py-0.5 text-[var(--g-t-team)]" data-testid="hug-team">
						{`@${team.replace(/^@/, '')}`}{run.team_version ? ` v${run.team_version}` : ''}
					</span>
				) : null}
				<span className="text-[var(--g-ink-3)]">{[hug.realm_slug, run.run_name].filter(Boolean).join(' · ')}</span>
				{run_href ? <Link to={run_href} className="ml-auto text-[var(--g-acc-text)] hover:underline">Open run</Link> : null}
			</div>
			<Workflow_graph
				phases={phases}
				statuses={statuses}
				selected={open_phase ?? hug.phase}
				on_select={(name) => set_open_phase((cur) => (cur === name ? null : name))}
				height={190}
				label="Run workflow"
			/>
			{open_phase ? (
				<div className="flex flex-col gap-2 border-t border-[var(--g-line)] pt-2.5" data-testid="phase-output">
					<div className="flex items-center gap-2 text-[12.5px]">
						<b>{open_phase}</b>
						<span className="text-[var(--g-ink-3)]">{statuses[open_phase] ?? ''}</span>
						<button type="button" aria-label="Close phase output" className="ml-auto text-[var(--g-ink-3)] hover:text-[var(--g-ink)]" onClick={() => set_open_phase(null)}>✕</button>
					</div>
					{detail.status === 'loading' && !detail.data
						? <div className="h-[60px] animate-pulse rounded-md bg-[var(--g-soft)]" aria-busy="true" aria-label="Loading" />
						: outputs.length
							? <G_phase_output outputs={outputs} run_link={() => run_href ?? '#'} />
							: <p className="text-[12.5px] text-[var(--g-ink-3)]">No output recorded for this phase.</p>}
				</div>
			) : null}
		</section>
	);
}

/** "Ana responded: approve, 5m ago" — others who already responded, in one quiet line. */
function Others_line({ hug, me }: { hug: Hug; me: string | null | undefined }) {
	const others = hug.responses.filter((r) => r.responder.user_id !== me);
	if (!others.length) return null;
	const first_value = (r: Hug_response): string | null => {
		const input = hug.requested_inputs.find((i) => i.name !== 'comment' && r.values[i.name] !== undefined && i.type !== 'file');
		return input ? choice_label(input, r.values[input.name]) : null;
	};
	const shown = others.slice(0, 2).map((r) => {
		const v = first_value(r);
		return `${r.responder.name} responded${v ? `: ${v}` : ''}, ${ago(r.responded_at)} ago`;
	});
	return (
		<p className="text-[12.5px] text-[var(--g-ink-3)]" data-testid="others-responded">
			{shown.join(' · ')}{others.length > 2 ? ` · ${others.length - 2} more` : ''}
		</p>
	);
}

/** Where to go once the Hug is answered or over: back to its run, or to the other Hugs. */
function Next_steps({ run_href, waiting }: { run_href: string | null; waiting: number }) {
	return (
		<div className="flex flex-wrap gap-2" data-testid="hug-next">
			{run_href ? <Link to={run_href} className={G_PRIMARY}>Back to the run</Link> : null}
			<Link to="/hugs" className={G_BTN}>{waiting > 0 ? `All HUGs (${waiting} waiting)` : 'All HUGs'}</Link>
		</div>
	);
}

export function Component() {
	const { hug_id = '' } = useParams();
	const overview = use_overview();
	const { user } = useAuth();
	const read = use_bff_read<Hug_page_data>('/v1/hug_page/get', hug_id ? { hug_id } : null, { refresh_ms: 20_000, fallback_error: 'Could not load this Hug.' });
	const [sent, set_sent] = useState(false);
	const h = read.data?.hug ?? null;

	if (!h) {
		return (
			<Graphite_shell data={overview.data} title="Hug">
				<div className="px-7 py-6">
					{read.status === 'error' ? <Blocking_error http_status={read.http_status} code={read.code} error={read.error} on_retry={() => void read.reload()} what="Hug" /> : <div className="h-[320px] animate-pulse rounded-[10px] bg-[var(--g-panel)]" aria-busy="true" aria-label="Loading" />}
				</div>
			</Graphite_shell>
		);
	}

	const open = is_answerable(h);
	const mine = my_response(h, user?.id);
	const run = read.data?.run ?? null;
	const run_href = h.org_slug && h.realm_slug ? `/o/${h.org_slug}/realms/${h.realm_slug}/runs/${encodeURIComponent(h.run_id)}` : null;
	const waiting = overview.data?.orgs.find((o) => o.slug === h.org_slug)?.counts.needs_you ?? 0;

	return (
		<Graphite_shell data={overview.data} title="Hug" current_realm_id={h.realm_id}>
			<div className="mx-auto flex w-full max-w-[960px] flex-col gap-4 px-7 py-6">
				<div className="flex items-center gap-2 text-[12.5px] text-[var(--g-ink-3)]">
					<nav aria-label="Breadcrumb" className="min-w-0 truncate"><Link to="/hugs" className="hover:text-[var(--g-ink)]">HUGs</Link> › {h.title}</nav>
					<span className="ml-auto"><Status_pill hug={h} open={open} answered={Boolean(mine)} /></span>
				</div>

				<section className={`${PANEL} flex flex-col gap-2.5 px-5 py-4`} aria-label="Review">
					<Meta_line hug={h} open={open} />
					<h1 className="text-[20px] font-semibold tracking-tight">{h.title}</h1>
					<Md class_name="text-[15px] leading-relaxed">{h.prompt}</Md>
				</section>

				{run ? <Workflow hug={h} run={run} run_href={run_href} /> : null}

				<Hug_context blocks={h.context} />

				{open ? (
					<section className="flex flex-col gap-3 rounded-[10px] border border-[var(--g-acc-line)] bg-[var(--g-panel)] px-5 py-4" aria-label="Your response" data-testid="answer">
						<h2 className="text-[15px] font-semibold">Your response</h2>
						<Others_line hug={h} me={user?.id} />
						{sent ? (
							<div className="flex flex-col gap-2.5" data-testid="hug-sent">
								<p role="status" className="text-[12.5px] text-[var(--g-ok)]">Response submitted. You can change it while the Hug is open.</p>
								<Next_steps run_href={run_href} waiting={waiting} />
							</div>
						) : null}
						<Hug_form key={mine?.response_id ?? 'new'} hug={h} mine={mine} on_sent={() => { set_sent(true); void read.reload(); }} />
					</section>
				) : (
					<section className={`${PANEL} flex flex-col gap-3 px-5 py-4`} aria-label="Outcome" data-testid="outcome">
						<div>
							<h2 className="text-[15px] font-semibold">{h.status === 'open' ? 'Expired' : status_label(h)}</h2>
							<p className="mt-0.5 text-[12.5px] text-[var(--g-ink-3)]">{h.outcome ? `${h.outcome} · ` : ''}This Hug no longer takes responses.</p>
						</div>
						{h.responses.length ? <Hug_responses hug={h} me={user?.id} /> : null}
						<Next_steps run_href={run_href} waiting={waiting} />
					</section>
				)}
			</div>
		</Graphite_shell>
	);
}
