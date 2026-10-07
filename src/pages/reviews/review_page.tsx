/**
 * Review (HUG) — /reviews/:review_id (Graphite).
 * Read: one `POST /v1/review_page/get` (the BFF finds the org that lets you see it).
 * Writes: reviews/verdict (PASS | REJECT | ROUTE:<target>, with form values and,
 * for chat reviews, the transcript) · reviews/send_message.
 *
 * The packet: markdown brief, earlier context turns, form fields, checks,
 * and artifacts (rendered markdown / JSON / CSV / images / PDF / text).
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useAuth, useAuthFetch } from '@/lib/auth_context';
import { use_overview } from '@/lib/overview';
import { use_bff_read } from '@/lib/use_bff_read';
import { ago } from '@/lib/admin';
import {
	as_text, coerce_fields, context_turns, initial_values, is_input_pause, is_missing, my_notification_id, normalize_value,
	parse_checks, review_mode, reviewer_count, type Field_value, type Review_page_data,
} from '@/lib/review_packet';
import { Graphite_shell } from '@/components/graphite/graphite_shell';
import { Artifact_viewer, Checks, Field_input, Md, Review_chat } from '@/components/graphite/g_review';
import { G_phase_outputs_list } from '@/components/graphite/g_phase_output';
import { G_BTN, G_INPUT, G_PRIMARY } from '@/components/graphite/g_agents';
import { Blocking_error } from '@/pages/realm/realm_inbox_page';

const G_DANGER = 'inline-flex items-center whitespace-nowrap rounded-md border border-[var(--g-bad-line)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--g-bad)] hover:bg-[var(--g-bad-soft)] disabled:opacity-40';

function Status_badge({ status, waiting_on_me }: { status: string; waiting_on_me: boolean }) {
	if (status === 'pending') return <span className="rounded-full bg-[var(--g-warn-soft)] px-2.5 py-1 text-[12px] font-semibold text-[var(--g-warn-text)]">● {waiting_on_me ? 'Waiting for you' : 'Pending'}</span>;
	if (status === 'expired') return <span className="rounded-full bg-[var(--g-soft)] px-2.5 py-1 text-[12px] font-semibold text-[var(--g-ink-3)]">Expired</span>;
	return <span className="rounded-full bg-[var(--g-ok-soft)] px-2.5 py-1 text-[12px] font-semibold text-[var(--g-ok)]">Decided</span>;
}

export function Component() {
	const { review_id = '' } = useParams();
	const navigate = useNavigate();
	const overview = use_overview();
	const { user } = useAuth();
	const auth_fetch = useAuthFetch();
	const read = use_bff_read<Review_page_data>('/v1/review_page/get', review_id ? { review_id } : null, { refresh_ms: 20_000, fallback_error: 'Could not load this review.' });
	const r = read.data?.review ?? null;
	const fields = useMemo(() => coerce_fields(r?.payload), [r]);
	const [values, set_values] = useState<Record<string, Field_value>>({});
	const [comment, set_comment] = useState('');
	const [route, set_route] = useState('');
	const [busy, set_busy] = useState(false);
	const [err, set_err] = useState<string | null>(null);
	const [tried, set_tried] = useState(false);
	const [show_raw, set_show_raw] = useState(false);

	// Seed defaults once fields are known; keep what the reviewer typed across refreshes.
	useEffect(() => { if (fields.length) set_values((prev) => initial_values(fields, prev)); }, [fields]);
	useEffect(() => { if (r?.route_targets?.length && !route) set_route(r.route_targets[0]); }, [r, route]);

	const realm_id = r?.realm_id ?? null;
	const title_bits = [r?.realm_slug, r?.team ? `@${r.team.replace(/^@/, '')}` : null, r?.phase ? `phase ${r.phase}` : null];

	if (!r) {
		return (
			<Graphite_shell data={overview.data} title="Review">
				<div className="px-7 py-6">
					{read.status === 'error' ? <Blocking_error http_status={read.http_status} code={read.code} error={read.error} on_retry={() => void read.reload()} what="review" /> : <div className="h-[320px] animate-pulse rounded-[10px] bg-[var(--g-panel)]" aria-busy="true" aria-label="Loading" />}
				</div>
			</Graphite_shell>
		);
	}

	const mode = review_mode(r, fields);
	const pause = is_input_pause(r);
	const active = r.status === 'pending';
	const notif = my_notification_id(r, user?.id);
	const checks = parse_checks(r.payload?.check_results);
	const brief = as_text(r.payload?.upstream_text) ?? as_text(r.payload?.summary) ?? as_text(r.payload?.message);
	const summary = as_text(r.payload?.summary);
	const turns = context_turns(r.payload);
	const iteration = typeof r.payload?.iteration === 'number' ? r.payload.iteration : null;
	const max_iter = typeof r.payload?.max_iterations === 'number' ? r.payload.max_iterations : null;
	const missing = fields.filter((f) => is_missing(f, values[f.name]));
	const my_claim = r.claimed_by != null && r.claimed_by === user?.id;
	const other_claim = r.claimed_by != null && r.claimed_by !== user?.id;
	const title = as_text(r.payload?.title) ?? (mode === 'chat' ? `Chat · ${r.phase ?? 'agent'}` : pause ? `Inputs needed · ${r.phase ?? 'phase'}` : `Review · ${r.phase ?? r.run_name ?? 'run'}`);
	const run_href = r.org_slug && r.realm_slug ? `/o/${r.org_slug}/realms/${r.realm_slug}/runs/${encodeURIComponent(r.run_id)}` : null;
	// Phase outputs are shown per phase (formatted, with Raw) when the BFF read them;
	// the viewer keeps the files and documents to review. An older BFF: as before.
	const earlier = read.data?.phase_outputs ?? [];
	const files = earlier.length ? r.artifacts.filter((a) => !(a.source === 'record' && (a.kind === 'output' || a.kind === 'phase_output'))) : r.artifacts;

	async function submit(action: string) {
		const affirmative = action === 'PASS' || action.startsWith('ROUTE:');
		set_tried(true);
		if (affirmative && missing.length) { set_err(`Fill the required field${missing.length > 1 ? 's' : ''}: ${missing.map((f) => f.label || f.name).join(', ')}`); return; }
		if (!notif) { set_err('You’re not a reviewer on this review, so you can’t decide it.'); return; }
		set_busy(true); set_err(null);
		try {
			const out: Record<string, unknown> = {};
			if (comment.trim()) out.comment = comment.trim();
			if (affirmative && fields.length) {
				const v: Record<string, unknown> = {};
				for (const f of fields) if (values[f.name] !== undefined) v[f.name] = normalize_value(f, values[f.name]);
				if (Object.keys(v).length) out.values = v;
			}
			if (mode === 'chat') {
				try {
					const m = await (await auth_fetch('/v1/reviews/get_messages', { method: 'POST', body: JSON.stringify({ review_id: r!.id }) })).json();
					const list = (m?.data?.messages ?? m?.data ?? []) as Array<{ role: string; text: string }>;
					if (Array.isArray(list)) out.chat_transcript = list.map((x) => ({ role: x.role, content: x.text }));
				} catch { /* verdict still goes without the transcript */ }
			}
			const res = await auth_fetch('/v1/reviews/verdict', { method: 'POST', body: JSON.stringify({ review_id: r!.id, action, fields: out, notification_id: notif }) });
			const d = await res.json().catch(() => null);
			if (!res.ok || !d?.ok) { set_err(typeof d?.error === 'string' ? d.error : d?.error?.message ?? 'Could not submit.'); return; }
			navigate('/hugs', { replace: true });
		} catch { set_err('Network error — try again.'); } finally { set_busy(false); }
	}

	return (
		<Graphite_shell data={overview.data} title="Review" current_realm_id={realm_id}>
			<div className="flex flex-col gap-4 px-7 py-6">
				<nav aria-label="Breadcrumb" className="text-[12.5px] text-[var(--g-ink-3)]"><Link to="/hugs" className="hover:text-[var(--g-ink)]">HUGs</Link> › Review</nav>
				<header className="flex flex-wrap items-start gap-3">
					<span aria-hidden className="grid h-9 w-9 place-items-center rounded-lg bg-[rgba(255,122,217,.14)] font-bold text-[var(--g-hug)]">H</span>
					<div className="min-w-0 flex-1">
						<h1 className="text-[20px] font-semibold tracking-tight">{title}</h1>
						<p className="text-[12.5px] text-[var(--g-ink-3)]">
							{title_bits.filter(Boolean).join(' · ')}
							{run_href ? <> · <Link to={run_href} className="hover:text-[var(--g-ink)]">{r.run_name || `run ${r.run_id.slice(0, 8)}`}</Link></> : null}
							{iteration != null ? ` · iteration ${iteration}${max_iter != null ? ` of ${max_iter}` : ''}` : ''}
							{active ? ` · waiting ${ago(r.created_at)}` : r.completed_at ? ` · closed ${ago(r.completed_at)} ago` : ''}
						</p>
					</div>
					<Status_badge status={r.status} waiting_on_me={Boolean(notif) && active} />
				</header>

				<div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(340px,1fr)]">
					<div className="flex min-w-0 flex-col gap-4">
						<section className="rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)] px-4 py-3.5" aria-label="Summary">
							<h2 className="mb-2 text-[14px] font-semibold">{pause ? 'Why the agent paused' : 'Summary'}</h2>
							{brief ? <Md>{brief}</Md> : <p className="text-[13px] text-[var(--g-ink-3)]">No summary was attached.</p>}
							{summary && brief !== summary ? <div className="mt-3 border-t border-[var(--g-line)] pt-3"><Md>{summary}</Md></div> : null}
						</section>
						{files.length ? (
							<section className="overflow-hidden rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)]" aria-label="Files to review">
								<h2 className="flex items-center gap-2 border-b border-[var(--g-line)] px-4 py-3 text-[14px] font-semibold">Files to review <span className="text-[12px] font-normal text-[var(--g-ink-3)]">{files.length}</span></h2>
								<Artifact_viewer artifacts={files} />
							</section>
						) : null}
						{earlier.length ? (
							<section className="overflow-hidden rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)]" aria-label="Earlier phases">
								<h2 className="flex items-center gap-2 border-b border-[var(--g-line)] px-4 py-3 text-[14px] font-semibold">Earlier phases <span className="text-[12px] font-normal text-[var(--g-ink-3)]">{new Set(earlier.map((o) => o.phase)).size}</span></h2>
								<G_phase_outputs_list outputs={earlier} run_link={(id) => (r.org_slug && r.realm_slug ? `/o/${r.org_slug}/realms/${r.realm_slug}/runs/${encodeURIComponent(id)}` : '#')} />
							</section>
						) : null}
						<Checks rows={checks} />
						{mode === 'chat' ? <Review_chat review_id={r.id} open={active} locked_by_other={other_claim} on_first_message={() => void read.reload()} /> : null}
						<div>
							<button type="button" onClick={() => set_show_raw((v) => !v)} className="text-[12px] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]">{show_raw ? 'Hide raw packet' : 'Show raw packet'}</button>
							{show_raw ? <pre className="g-mono mt-2 max-h-[320px] overflow-auto rounded-lg border border-[var(--g-line)] bg-[var(--g-bg)] p-3 text-[11.5px] text-[var(--g-ink-2)]">{JSON.stringify(r.payload, null, 2)}</pre> : null}
						</div>
					</div>

					<div className="flex flex-col gap-4">
						{active ? (
							<section className="flex flex-col gap-3.5 rounded-[10px] border border-[var(--g-acc-line)] bg-[var(--g-panel)] p-4" aria-label="Your decision" data-testid="decision">
								<h2 className="text-[14px] font-semibold">{fields.length ? 'The agent needs' : mode === 'chat' ? 'When you’re done' : 'Your decision'}</h2>
								{mode === 'chat' && reviewer_count(r) > 1 ? <p className="text-[12px] text-[var(--g-ink-3)]">{my_claim ? 'You’re handling this chat.' : other_claim ? 'Another reviewer is handling this chat.' : `${reviewer_count(r)} reviewers can see this; the first to reply handles it.`}</p> : null}
								{fields.map((f) => (
									<Field_input key={f.name} f={f} value={values[f.name] ?? (f.type === 'boolean' ? false : '')} invalid={tried && is_missing(f, values[f.name])} on_change={(v) => set_values((p) => ({ ...p, [f.name]: v }))} />
								))}
								{!pause ? (
									<label className="flex flex-col gap-1.5"><span className="text-[12.5px] text-[var(--g-ink-2)]">Comment (optional)</span>
										<textarea aria-label="Comment" rows={3} value={comment} onChange={(e) => set_comment(e.target.value)} className={`${G_INPUT} w-full`} />
									</label>
								) : null}
								{err ? <p role="alert" className="text-[12.5px] text-[var(--g-bad)]">{err}</p> : null}
								{notif ? (
									<div className="flex flex-wrap items-center gap-2 border-t border-[var(--g-line)] pt-3">
										<button type="button" disabled={busy || (tried && missing.length > 0)} onClick={() => void submit('PASS')} className={G_PRIMARY}>✓ {fields.length ? (pause ? 'Continue with these values' : 'Approve with these values') : 'Approve'}</button>
										{!pause ? <button type="button" disabled={busy} onClick={() => void submit('REJECT')} className={G_DANGER}>✕ Reject</button> : null}
										{!pause && r.route_targets?.length ? (
											<span className="flex items-center gap-1.5">
												<select aria-label="Send to" value={route} onChange={(e) => set_route(e.target.value)} className={`${G_INPUT} max-w-[160px]`}>{r.route_targets.map((t) => <option key={t} value={t}>{t}</option>)}</select>
												<button type="button" disabled={busy || !route} onClick={() => void submit(`ROUTE:${route}`)} className={G_BTN}>↪ Send to</button>
											</span>
										) : null}
									</div>
								) : <p className="border-t border-[var(--g-line)] pt-3 text-[12.5px] text-[var(--g-ink-3)]">You can see this review but aren’t one of its reviewers, so you can’t decide it.</p>}
								{user ? <p className="text-[11.5px] text-[var(--g-ink-3)]">Responding as {user.username}</p> : null}
							</section>
						) : r.verdict ? (
							<section className="rounded-[10px] border border-[rgba(62,207,142,.35)] bg-[var(--g-ok-soft)] p-4" aria-label="Decision">
								<h2 className="text-[14px] font-semibold">Decided: {String(r.verdict.action ?? '—')}</h2>
								<p className="mt-1 text-[12.5px] text-[var(--g-ink-2)]">{String(r.verdict.reviewer_name ?? r.verdict.responded_by ?? '')}{r.verdict.decided_at ? ` · ${new Date(String(r.verdict.decided_at)).toLocaleString()}` : ''}</p>
								{r.verdict.comment ? <div className="mt-2"><Md>{String(r.verdict.comment)}</Md></div> : null}
							</section>
						) : null}
						{turns.length ? (
							<section className="rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)] px-4 py-3" aria-label="Context">
								<h2 className="mb-2 text-[14px] font-semibold">Context</h2>
								<ol className="flex flex-col gap-2.5">{turns.map((t, i) => <li key={i}><div className="text-[11px] uppercase tracking-[0.06em] text-[var(--g-ink-3)]">{t.role}</div><Md class_name="text-[13px]">{t.content}</Md></li>)}</ol>
							</section>
						) : null}
						{r.notification_groups?.length ? (
							<section className="rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)] px-4 py-3" aria-label="Reviewers">
								<h2 className="mb-2 text-[14px] font-semibold">Reviewers <span className="text-[12px] font-normal text-[var(--g-ink-3)]">{r.notification_groups.filter((g) => g.satisfied).length} of {r.notification_groups.length} groups done</span></h2>
								{r.notification_groups.map((g) => (
									<div key={g.group_idx} className="mb-2 last:mb-0">
										<div className="text-[11.5px] text-[var(--g-ink-3)]"><span className="font-semibold uppercase">{g.policy}</span> of {g.channels.join(', ')} {g.satisfied ? '· ✓ done' : '· waiting'}</div>
										{g.notifications.map((n) => <div key={n.id} className="flex items-center gap-2 text-[12.5px]"><span className={`h-1.5 w-1.5 rounded-full ${!n.responded_at ? 'bg-[var(--g-ink-3)]' : n.action === 'REJECT' ? 'bg-[var(--g-bad)]' : 'bg-[var(--g-ok)]'}`} />{n.channel_target}{n.action ? <b className="text-[11.5px]">{n.action}</b> : null}{n.comment ? <span className="truncate text-[var(--g-ink-3)]">“{n.comment}”</span> : null}</div>)}
									</div>
								))}
							</section>
						) : null}
					</div>
				</div>
			</div>
		</Graphite_shell>
	);
}
