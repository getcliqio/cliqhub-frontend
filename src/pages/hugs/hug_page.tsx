/**
 * Hug — /hugs/:hug_id (Graphite). A person is asked for input. Top to bottom:
 *
 *   review    — one small line of metadata (target channel, opened, expires, HUG ID; who it
 *               wasn't sent to, when that happened), then the title and the Hug's summary
 *   workflow  — the team (`@scope/name vX`) and its run as a graph, each phase coloured by how it
 *               went and this Hug's phase highlighted; clicking a phase shows its output
 *   response  — the Hug's hug in a sandboxed frame (`Hug_host`), in the states of PLAN-hug-widgets §6.4:
 *               (1) answering; (2) your answer as sent, "Change answer"; (3) changing it, Cancel;
 *               (4) a Hug that wasn't sent to you — the answers so far; (5) ended — how, and every answer.
 *               The Hub draws Submit (label and tone from the hug) and everything around the frame.
 *               Without a frame (a Hug opened before hugs, or its bundle gone) the answers are shown as
 *               key-values and nothing can be answered.
 *
 * Read: `POST /v1/hug_page/get` (the Hug, its `content_url` and its run's workflow; Core lets in anyone
 * with runs.view on the Hug's realm). A phase's output: `POST /v1/run_detail/get`, read only when a
 * phase is opened. Writes: `/v1/hugs/respond` (values and the hug's one-line summary); files stream to
 * `/v1/artifacts/upload` when the hug asks for one.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AnswerSnapshot, HugHost } from '@getcliqio/hug-frontend/host';
import { Link, useParams } from 'react-router';
import { useAuth, useAuthFetch } from '@/lib/auth_context';
import { use_overview } from '@/lib/overview';
import { use_bff_read } from '@/lib/use_bff_read';
import { ago } from '@/lib/admin';
import { hug_href, is_answerable, load_draft, my_response, outcome_tone, respond, save_draft, status_label, type Hug, type Hug_page_data, type Hug_round, type Hug_response, type Hug_run } from '@/lib/hug';
import type { Run_detail_data } from '@/lib/realm_inbox';
import type { Team_phase } from '@/lib/team_page';
import { Graphite_shell } from '@/components/graphite/graphite_shell';
import { Workflow_graph } from '@/components/graphite/g_workflow_graph';
import { G_phase_output } from '@/components/graphite/g_phase_output';
import { answer_of, Hug_host, Hug_read_budget } from '@/components/hug/hug_host';
import { read_budget } from '@getcliqio/hug-frontend/host';
import { Hug_responses, Response_values } from '@/components/hug/hug_responses';
import { Blocking_error } from '@/pages/realm/realm_inbox_page';
import { G_BTN, G_PRIMARY } from '@/components/graphite/g_agents';
import { G_DANGER } from '@/components/graphite/g_host';

const PANEL = 'rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)]';

/** "in 1h 52m" / "in 4m" — how long until `iso`. */
function until(iso: string, now: number = Date.now()): string {
	const m = Math.max(0, Math.round((Date.parse(iso) - now) / 60_000));
	if (m < 60) return `in ${m}m`;
	const h = Math.floor(m / 60);
	return h < 48 ? `in ${h}h ${m % 60}m` : `in ${Math.round(h / 24)}d`;
}

const clock = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * The status pill (§6.4): "Answered" once this person has; "Waiting on you" while they may answer; "Open" when they
 * can't (not sent to them, or the Hug has no page to answer in).
 */
const TONE_PILL = {
	good: 'bg-[var(--g-ok-soft)] text-[var(--g-ok)]',
	bad: 'bg-[var(--g-bad-soft)] text-[var(--g-bad)]',
	neutral: 'bg-[var(--g-soft)] text-[var(--g-ink-3)]',
} as const;
const TONE_TEXT = { good: 'text-[var(--g-ok)]', bad: 'text-[var(--g-bad)]', neutral: '' } as const;

function Status_pill({ hug, open, answered, can_answer }: { hug: Hug; open: boolean; answered: boolean; can_answer: boolean }) {
	if (open) {
		if (answered) return <span className="rounded-full bg-[var(--g-ok-soft)] px-2.5 py-0.5 text-[12px] font-semibold text-[var(--g-ok)]">Answered</span>;
		return can_answer
			? <span className="rounded-full bg-[rgba(255,122,217,.14)] px-2.5 py-0.5 text-[12px] font-semibold text-[var(--g-hug)]">Waiting on you</span>
			: <span className="rounded-full bg-[var(--g-soft)] px-2.5 py-0.5 text-[12px] font-semibold text-[var(--g-ink-3)]">Open</span>;
	}
	// Green for an approval approved, red for one rejected, neutral otherwise (live run 2026-11-10: "Rejected" was green).
	const tone = TONE_PILL[outcome_tone(hug)];
	return <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${tone}`} data-testid="status-pill" data-tone={outcome_tone(hug)}>{hug.status === 'open' ? 'Expired' : status_label(hug)}</span>;
}

/**
 * The rounds of this Hug's phase, oldest first (e2e 2026-11-10: "somewhere there should be a log of the iterations") —
 * a gate sent back asks again, each round its own Hug. Earlier rounds say how they ended and who answered what.
 */
function Rounds({ rounds }: { rounds: Hug_round[] }) {
	if (rounds.length < 2) return null;
	return (
		<section className={`${PANEL} flex flex-col gap-2 px-5 py-4`} aria-label="Rounds" data-testid="hug-rounds">
			<h2 className="text-[15px] font-semibold">Rounds</h2>
			<ol className="flex flex-col gap-2">
				{rounds.map((r) => (
					<li key={r.hug_id} className="text-[12.5px]" data-testid="hug-round-row">
						<span className="font-semibold">
							{r.current ? `Round ${r.round} · this Hug` : <Link to={hug_href(r.hug_id)} className="underline-offset-2 hover:underline">Round {r.round}</Link>}
						</span>
						{r.current ? null : <span className="text-[var(--g-ink-3)]"> · {r.outcome ?? status_label({ status: r.status, outcome: null })}</span>}
						{r.answers.map((a, i) => (
							<div key={i} className="mt-0.5 text-[var(--g-ink-2)]">
								{a.responder}{a.summary ? `: ${a.summary}` : ''}{a.note ? <span className="text-[var(--g-ink-3)]"> — “{a.note}”</span> : null}
							</div>
						))}
					</li>
				))}
			</ol>
		</section>
	);
}

/** One small line: target channel, opened, expires (or ended), HUG ID — and who it wasn't sent to, when that happened. */
function Meta_line({ hug, open, round = null }: { hug: Hug; open: boolean; round?: number | null }) {
	const [copied, set_copied] = useState(false);
	const not_sent = hug.not_sent_to ?? [];
	const item = 'whitespace-nowrap';
	const val = 'text-[var(--g-ink-2)]';
	return (
		<div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-[var(--g-line)] pb-2.5 text-[11.5px] text-[var(--g-ink-3)]" data-testid="hug-meta">
			{round ? <span className={item} data-testid="hug-round">Round <span className={val}>{round}</span></span> : null}
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

/** "Ana responded: Approved, 5m ago" — others who already responded, in one quiet line (their answers' summaries). */
function Others_line({ hug, me }: { hug: Hug; me: string | null | undefined }) {
	const others = hug.responses.filter((r) => r.responder.user_id !== me);
	if (!others.length) return null;
	const shown = others.slice(0, 2).map((r: Hug_response) => `${r.responder.name} responded${r.summary ? `: ${r.summary}` : ''}, ${ago(r.responded_at)} ago`);
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

/**
 * Your response, while the Hug is open (§6.4 states 1–3): one frame for the hug, in `answer` mode to answer or change
 * an answer and in `view` mode to show the one you sent. Submit is the Hub's button, with the hug's label and tone,
 * enabled only when the hug says the answer is valid. A Hug that wasn't sent to you (Core refuses the answer) shows
 * the answers so far instead (state 4).
 */
function Answer({ hug, content_url, mine, me, viewer, run_href, waiting, on_sent }: {
	hug: Hug;
	content_url: string;
	mine: Hug_response | null;
	me: string | null;
	viewer: { name: string; via: string[] };
	run_href: string | null;
	waiting: number;
	on_sent: () => void;
}) {
	const auth_fetch = useAuthFetch();
	const host = useRef<HugHost | null>(null);
	// This tab's unsent answer — a first answer, or a change to one (read once, when the page opens).
	const [draft] = useState(() => load_draft(hug.id, me));
	const [answering, set_answering] = useState(!mine || draft !== null);
	const [snapshot, set_snapshot] = useState<AnswerSnapshot | null>(null);
	const [busy, set_busy] = useState(false);
	const [error, set_error] = useState<string | null>(null);
	const [sent, set_sent] = useState(false);
	const [not_for_you, set_not_for_you] = useState(false);
	// The open Hug changed (the page re-reads it): tell the hug (§6.1 `update`). When it ends, the page draws state 5.
	useEffect(() => { host.current?.update({ expires_at: hug.expires_at, progress: hug.progress ?? null }); }, [hug.expires_at, hug.progress]);

	// Core refused at Submit (its view changed while the page was open, e.g. a role lost runs.view): read-only now.
	if (not_for_you) return <Not_for_you hug={hug} content_url={content_url} me={me} viewer={viewer} />;

	const submit = async () => {
		if (!host.current) return;
		set_busy(true);
		set_error(null);
		const outcome = await host.current.submit(async (values, summary) => {
			const r = await respond(auth_fetch, hug.id, values, summary);
			if (r.ok) return { ok: true, answer: { values, ...(summary ? { summary } : {}), responder: viewer, responded_at: new Date().toISOString() } };
			if (r.status === 403) set_not_for_you(true);
			return { ok: false, problems: [{ message: r.message }] };
		});
		set_busy(false);
		if (outcome?.ok) {
			save_draft(hug.id, me, null);
			set_answering(false);
			set_sent(true);
			on_sent();
		} else if (outcome) {
			set_error(outcome.problems.map((p) => p.message).join('; '));
		}
	};
	const change = () => { set_sent(false); set_error(null); host.current?.set_mode('answer'); set_answering(true); };
	const cancel = () => { set_error(null); save_draft(hug.id, me, null); host.current?.set_mode('view', answer_of(mine)); set_answering(false); };
	const problems = snapshot?.problems.length ?? 0;

	return (
		<section className="flex flex-col gap-3 rounded-[10px] border border-[var(--g-acc-line)] bg-[var(--g-panel)] px-5 py-4" aria-label="Your response" data-testid="answer">
			<h2 className="text-[15px] font-semibold">Your response</h2>
			<Others_line hug={hug} me={me} />
			<Progress_line hug={hug} />
			<Hug_host
				hug={hug}
				content_url={content_url}
				mode={mine && draft === null ? 'view' : 'answer'}
				mine={mine}
				viewing={mine}
				draft={draft}
				viewer={viewer}
				host_ref={host}
				on_state={(st) => {
					set_snapshot(st);
					if (host.current?.mode() === 'answer') save_draft(hug.id, me, st.values);
				}}
			/>
			{sent ? <p role="status" className="text-[12.5px] text-[var(--g-ok)]" data-testid="hug-sent">Response submitted. You can change it while the Hug is open.</p> : null}
			{error ? <p role="alert" className="text-[12.5px] text-[var(--g-bad)]" data-testid="hug-error">{error}</p> : null}
			<div className="flex flex-wrap items-center gap-2" data-testid="hug-bar">
				{answering ? (
					<>
						{problems ? <span className="text-[12px] text-[var(--g-ink-3)]" data-testid="hug-problems">{problems} problem{problems > 1 ? 's' : ''}</span> : null}
						{mine ? <button type="button" className={`${G_BTN} ml-auto`} onClick={cancel}>Cancel</button> : null}
						<button
							type="button"
							className={`${snapshot?.submit.tone === 'danger' ? G_DANGER : G_PRIMARY} ${mine ? '' : 'ml-auto'}`}
							disabled={busy || !snapshot?.valid}
							onClick={() => { void submit(); }}
							data-testid="hug-submit"
						>
							{snapshot?.submit.label ?? 'Submit'}
						</button>
					</>
				) : (
					<>
						<span className="text-[12.5px] text-[var(--g-ink-3)]">Submitted {mine ? clock(mine.responded_at) : 'just now'}</span>
						<button type="button" className={G_BTN} onClick={change} data-testid="hug-change">Change answer</button>
					</>
				)}
			</div>
			{sent ? <Next_steps run_href={run_href} waiting={waiting} /> : null}
		</section>
	);
}

/** The requester's status line while the Hug is open (§2, §6.1): why it's still waiting, e.g. an answer it couldn't use. */
function Progress_line({ hug }: { hug: Hug }) {
	if (!hug.progress) return null;
	return <p role="status" className="text-[12.5px] text-[var(--g-warn-text)]" data-testid="hug-progress">{hug.progress}</p>;
}

/** §6.4 state 4 — an open Hug this person may see but not answer: no answer frame, no Submit; the answers so far. */
function Not_for_you({ hug, content_url, me, viewer }: { hug: Hug; content_url: string; me: string | null; viewer: { name: string; via: string[] } }) {
	return (
		<section className={`${PANEL} flex flex-col gap-3 px-5 py-4`} aria-label="Answers so far" data-testid="not-for-you">
			<p className="text-[12.5px] text-[var(--g-ink-3)]">Only people this Hug was sent to can answer it ({hug.channels.join(', ')}).</p>
			<Progress_line hug={hug} />
			{hug.responses.length
				? <Hug_responses hug={hug} content_url={content_url} me={me} viewer={viewer} />
				: <p className="text-[12.5px] text-[var(--g-ink-3)]">No answers yet.</p>}
		</section>
	);
}

/** No frame for this Hug (opened before hugs, or its bundle is gone): its answers as key-values, nothing to answer. */
function Fallback({ hug, me }: { hug: Hug; me: string | null }) {
	return (
		<div className="flex flex-col gap-3" data-testid="hug-fallback">
			<p className="text-[12.5px] text-[var(--g-ink-3)]">This Hug’s page is no longer available. Its answers are shown as they were sent.</p>
			{hug.responses.length ? (
				<ul className="flex flex-col gap-3" aria-label="Answers">
					{hug.responses.map((r) => (
						<li key={r.response_id} className="flex flex-col gap-1" data-testid="hug-response">
							<div className="flex flex-wrap items-center gap-2 text-[12.5px]">
								<b>{r.responder.name}{me && r.responder.user_id === me ? ' (you)' : ''}</b>
								{r.summary ? <span className="rounded-full bg-[var(--g-soft)] px-2 py-0.5 text-[11.5px] font-semibold">{r.summary}</span> : null}
								<span className="ml-auto text-[11.5px] text-[var(--g-ink-3)]">{new Date(r.responded_at).toLocaleString()}</span>
							</div>
							<Response_values values={r.values} />
						</li>
					))}
				</ul>
			) : <p className="text-[12.5px] text-[var(--g-ink-3)]">No answers.</p>}
		</div>
	);
}

export function Component() {
	const { hug_id = '' } = useParams();
	const overview = use_overview();
	const { user } = useAuth();
	const read = use_bff_read<Hug_page_data>('/v1/hug_page/get', hug_id ? { hug_id } : null, { refresh_ms: 20_000, fallback_error: 'Could not load this Hug.' });
	// One read budget for every frame on this page (§6.3), new for each Hug.
	const budget = useMemo(() => read_budget(), [hug_id]);
	const h = read.data?.hug ?? null;
	// A Hug that no longer takes answers keeps no draft.
	const ended = h !== null && !is_answerable(h);
	useEffect(() => { if (h && ended) save_draft(h.id, user?.id, null); }, [h?.id, ended, user?.id]);

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
	const me = user?.id ?? null;
	const mine = my_response(h, me);
	const run = read.data?.run ?? null;
	const content_url = read.data?.content_url ?? null;
	const run_href = h.org_slug && h.realm_slug ? `/o/${h.org_slug}/realms/${h.realm_slug}/runs/${encodeURIComponent(h.run_id)}` : null;
	const waiting = overview.data?.orgs.find((o) => o.slug === h.org_slug)?.counts.needs_you ?? 0;
	const viewer = { name: user?.display_name?.trim() || user?.username || 'you', via: h.viewer?.via ?? mine?.via ?? [] };
	// Only someone Core would take an answer from is offered one (§6.4 state 4 otherwise: read-only).
	const can_answer = h.viewer?.can_answer ?? true;

	return (
		<Hug_read_budget.Provider value={budget}>
		<Graphite_shell data={overview.data} title="Hug" current_realm_id={h.realm_id}>
			<div className="mx-auto flex w-full max-w-[960px] flex-col gap-4 px-7 py-6">
				<div className="flex items-center gap-2 text-[12.5px] text-[var(--g-ink-3)]">
					<nav aria-label="Breadcrumb" className="min-w-0 truncate"><Link to="/hugs" className="hover:text-[var(--g-ink)]">HUGs</Link> › {h.title}</nav>
					<span className="ml-auto"><Status_pill hug={h} open={open} answered={Boolean(mine)} can_answer={can_answer && content_url !== null} /></span>
				</div>

				<section className={`${PANEL} flex flex-col gap-2.5 px-5 py-4`} aria-label="Review">
					<Meta_line hug={h} open={open} round={read.data?.rounds?.find((r) => r.current)?.round ?? null} />
					<h1 className="text-[20px] font-semibold tracking-tight">{h.title}</h1>
					{h.summary ? <p className="whitespace-pre-wrap text-[15px] leading-relaxed" data-testid="hug-summary">{h.summary}</p> : null}
				</section>

				<Rounds rounds={read.data?.rounds ?? []} />

				{run ? <Workflow hug={h} run={run} run_href={run_href} /> : null}

				{open && content_url && !can_answer ? (
					<Not_for_you hug={h} content_url={content_url} me={me} viewer={viewer} />
				) : open && content_url ? (
					<Answer
						key={h.id}
						hug={h}
						content_url={content_url}
						mine={mine}
						me={me}
						viewer={viewer}
						run_href={run_href}
						waiting={waiting}
						on_sent={() => { void read.reload(); }}
					/>
				) : (
					<section className={`${PANEL} flex flex-col gap-3 px-5 py-4`} aria-label="Outcome" data-testid="outcome">
						{open ? null : (
							<div>
								<h2 className={`text-[15px] font-semibold ${TONE_TEXT[outcome_tone(h)]}`}>{h.status === 'open' ? 'Expired' : status_label(h)}</h2>
								<p className="mt-0.5 text-[12.5px] text-[var(--g-ink-3)]">{h.outcome ? `${h.outcome} · ` : ''}This Hug no longer takes responses.</p>
							</div>
						)}
						{content_url
							? (h.responses.length ? <Hug_responses hug={h} content_url={content_url} me={me} viewer={viewer} /> : null)
							: <Fallback hug={h} me={me} />}
						<Next_steps run_href={run_href} waiting={waiting} />
					</section>
				)}
			</div>
		</Graphite_shell>
		</Hug_read_budget.Provider>
	);
}
