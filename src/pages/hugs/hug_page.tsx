/**
 * Hug — /hugs/:hug_id (Graphite). A person is asked for input; this page shows what they are asked,
 * what the requester attached, the answers so far, and the form to answer (or change their answer)
 * while the Hug is open.
 *
 * Read: one `POST /v1/hug_page/get` (Core lets in anyone with runs.view on the Hug's realm).
 * Writes: `/v1/hugs/respond`; files stream to `/v1/artifacts/upload` as they are picked.
 */
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useAuth } from '@/lib/auth_context';
import { use_overview } from '@/lib/overview';
import { use_bff_read } from '@/lib/use_bff_read';
import { ago } from '@/lib/admin';
import { is_answerable, my_response, status_label, type Hug, type Hug_page_data } from '@/lib/hug';
import { Graphite_shell } from '@/components/graphite/graphite_shell';
import { Hug_context } from '@/components/hug/hug_context';
import { Hug_form } from '@/components/hug/hug_form';
import { Hug_responses } from '@/components/hug/hug_responses';
import { Blocking_error } from '@/pages/realm/realm_inbox_page';

function Status_badge({ hug, open }: { hug: Hug; open: boolean }) {
	if (open) return <span className="rounded-full bg-[var(--g-warn-soft)] px-2.5 py-1 text-[12px] font-semibold text-[var(--g-warn-text)]">● Open</span>;
	const tone = hug.status === 'closed' ? 'bg-[var(--g-ok-soft)] text-[var(--g-ok)]' : 'bg-[var(--g-soft)] text-[var(--g-ink-3)]';
	return <span className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ${tone}`}>{hug.status === 'open' ? 'Expired' : status_label(hug)}</span>;
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
	const run_href = h.org_slug && h.realm_slug ? `/o/${h.org_slug}/realms/${h.realm_slug}/runs/${encodeURIComponent(h.run_id)}` : null;
	const where = [h.realm_slug, h.team ? `@${h.team.replace(/^@/, '')}` : null, `phase ${h.phase}`].filter(Boolean).join(' · ');
	const not_sent = h.not_sent_to ?? [];

	return (
		<Graphite_shell data={overview.data} title="Hug" current_realm_id={h.realm_id}>
			<div className="flex flex-col gap-4 px-7 py-6">
				<nav aria-label="Breadcrumb" className="text-[12.5px] text-[var(--g-ink-3)]"><Link to="/hugs" className="hover:text-[var(--g-ink)]">HUGs</Link> › {h.title}</nav>
				<header className="flex flex-wrap items-start gap-3">
					<span aria-hidden className="grid h-9 w-9 place-items-center rounded-lg bg-[rgba(255,122,217,.14)] font-bold text-[var(--g-hug)]">H</span>
					<div className="min-w-0 flex-1">
						<h1 className="text-[20px] font-semibold tracking-tight">{h.title}</h1>
						<p className="text-[12.5px] text-[var(--g-ink-3)]">
							{where}
							{run_href ? <> · <Link to={run_href} className="hover:text-[var(--g-ink)]">{h.run_name || `run ${h.run_id.slice(0, 8)}`}</Link></> : null}
							{h.iteration > 0 ? ` · iteration ${h.iteration + 1}` : ''}
							{open ? ` · asked ${ago(h.created_at)} ago${h.last_reminded_at ? ` · reminded ${ago(h.last_reminded_at)} ago` : ''} · closes ${new Date(h.expires_at).toLocaleString()}` : h.closed_at ? ` · ended ${ago(h.closed_at)} ago` : ''}
						</p>
					</div>
					<Status_badge hug={h} open={open} />
				</header>

				<div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(340px,1fr)]">
					<Hug_context prompt={h.prompt} blocks={h.context} />

					<div className="flex flex-col gap-4">
						{open ? (
							<section className="flex flex-col gap-3 rounded-[10px] border border-[var(--g-acc-line)] bg-[var(--g-panel)] p-4" aria-label="Answer" data-testid="answer">
								<h2 className="text-[14px] font-semibold">{mine ? 'Your answer' : 'Your answer is needed'}</h2>
								{sent ? <p role="status" className="text-[12.5px] text-[var(--g-ok)]">Sent. You can change your answer while the Hug is open.</p> : null}
								<Hug_form key={mine?.response_id ?? 'new'} hug={h} mine={mine} on_sent={() => { set_sent(true); void read.reload(); }} />
								{user ? <p className="text-[11.5px] text-[var(--g-ink-3)]">Answering as {user.username}</p> : null}
							</section>
						) : (
							<section className="rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)] p-4" aria-label="Outcome">
								<h2 className="text-[14px] font-semibold">{h.status === 'open' ? 'Expired' : status_label(h)}</h2>
								<p className="mt-1 text-[12.5px] text-[var(--g-ink-3)]">This Hug no longer takes answers.</p>
							</section>
						)}

						<section className="rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)] px-4 py-3" aria-label="Answers so far">
							<h2 className="mb-2 text-[14px] font-semibold">Answers <span className="text-[12px] font-normal text-[var(--g-ink-3)]">{h.responses.length}</span></h2>
							<Hug_responses hug={h} me={user?.id} />
						</section>

						<section className="rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)] px-4 py-3 text-[12.5px]" aria-label="Asked">
							<h2 className="mb-1 text-[14px] font-semibold">Asked</h2>
							<p className="text-[var(--g-ink-2)]">Through {h.channels.join(', ')}</p>
							{not_sent.length ? (
								<p className="mt-1.5 text-[var(--g-warn-text)]" data-testid="not-sent">
									Not sent to {not_sent.map((p) => `${p.name} (${p.channel})`).join(', ')} — they can’t view runs in this realm.
								</p>
							) : null}
						</section>
					</div>
				</div>
			</div>
		</Graphite_shell>
	);
}
