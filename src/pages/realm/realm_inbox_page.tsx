/**
 * Realm page (Graphite) — the realm's overview, under the realm header that every realm page shares
 * (components/graphite/realm_header.tsx: name, status, Edit details, Teams · Runs · Settings · Daemons).
 *
 *   setup    — what's missing, only when something is
 *   cards    — teams (chips: Ready / Missing agent config), daemons (lights), people (avatars, roles, invites)
 *   danger   — folded; Delete realm lives in Settings › Danger zone
 *
 * Runs that need you and runs in progress live on the Runs page; a run starts from a team.
 *
 * Data: one `POST /v1/realm_inbox/get { org_slug, slug, summary: true }` (BFF composes the realm,
 * run counts, teams, daemons and people), shared with the header.
 */
import { useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { AlertTriangle, CheckCircle2, Lock, Plus, RefreshCw, SearchX } from 'lucide-react';
import { relative_time, use_overview } from '@/lib/overview';
import { use_bff_read } from '@/lib/use_bff_read';
import type { Realm_inbox_data, Realm_summary } from '@/lib/realm_inbox';
import { realm_path } from '@/lib/realm_url';
import { Graphite_shell } from '@/components/graphite/graphite_shell';
import { Realm_header } from '@/components/graphite/realm_header';
import { Secret_reveal } from '@/components/graphite/g_secret';
import { Avatar } from '@/components/graphite/g_admin';
import { ROW_ACTION_CLS } from '@/components/graphite/g_kinds';
import { ROW_OPENS, use_row_open } from '@/components/graphite/g_row';
import { Team_avatar } from '@/pages/teams/teams_graphite_page';
import type { Realm_created_state } from '@/pages/realms/new_realm_page';

export const INBOX_REFRESH_MS = 15_000;

const CARD = 'rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)]';

function Chip({ tone, children }: { tone: 'warn' | 'bad' | 'muted'; children: ReactNode }) {
	const cls = tone === 'warn' ? 'bg-[var(--g-warn-soft)] text-[var(--g-warn-text)]' : tone === 'bad' ? 'bg-[var(--g-bad-soft)] text-[var(--g-bad)]' : 'bg-[var(--g-soft)] text-[var(--g-ink-3)]';
	return <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${cls}`}>{children}</span>;
}

function Card({ title, action, children, testid }: { title: ReactNode; action?: ReactNode; children: ReactNode; testid: string }) {
	return (
		<section className={CARD} data-testid={testid}>
			<div className="flex items-center gap-2 border-b border-[var(--g-line)] px-4 py-2.5">
				<h2 className="text-[14px] font-semibold">{title}</h2>
				{action ? <span className="ml-auto flex items-center gap-2">{action}</span> : null}
			</div>
			<div className="px-4 py-3">{children}</div>
		</section>
	);
}

/** "1–5 of 12 ‹ ›" under a table; nothing when it all fits. */
function Pager({ what, offset, limit, total, on_page }: { what: string; offset: number; limit: number; total: number; on_page: (offset: number) => void }) {
	if (total <= limit) return null;
	const btn = 'grid h-6 w-6 place-items-center rounded-md border border-[var(--g-line)] text-[12px] disabled:opacity-40';
	return (
		<div className="mt-2 flex items-center justify-end gap-2 text-[12px] text-[var(--g-ink-3)]" data-testid={`${what}-pager`}>
			<span>{offset + 1}–{Math.min(offset + limit, total)} of {total}</span>
			<button type="button" aria-label={`Previous ${what}`} disabled={offset === 0} onClick={() => on_page(Math.max(0, offset - limit))} className={btn}>‹</button>
			<button type="button" aria-label={`Next ${what}`} disabled={offset + limit >= total} onClick={() => on_page(offset + limit)} className={btn}>›</button>
		</div>
	);
}

export function Realm_summary_view({ data, org_slug, slug, on_teams_page = () => {}, on_members_page = () => {} }: {
	data: Realm_inbox_data; org_slug: string; slug: string;
	/** Load another page of the Teams / Members tables (an offset). */
	on_teams_page?: (offset: number) => void;
	on_members_page?: (offset: number) => void;
}) {
	const row = use_row_open();
	const s: Realm_summary | null = data.summary ?? null;
	const base = realm_path(org_slug, slug);
	const online = s?.daemons?.online ?? 0;
	const missing = s?.teams?.missing_agents ?? 0;
	const teams = s?.teams?.items ?? [];
	const admin = s?.you.is_admin ?? false;
	const people = s?.people ?? null;
	const setup: Array<{ key: string; text: string; to: string; action: string }> = [];
	// No daemon online: the status badge says so; a daemon joins from its own machine, not from here.
	if (missing > 0) setup.push({ key: 'agents', text: `${missing} team${missing === 1 ? ' is' : 's are'} missing agent config — an agent ${missing === 1 ? 'it uses' : 'they use'} isn’t set up in your org.`, to: `${base}/agents`, action: 'Set up agents' });
	if (teams.length === 0 && s?.teams) setup.push({ key: 'teams', text: 'No teams installed yet.', to: `${base}/teams?install=1`, action: 'Install a team' });
	if (people && people.total <= 1 && admin) setup.push({ key: 'people', text: 'You’re the only one here.', to: `${base}/settings?section=members`, action: 'Invite people' });

	return (
		<div className="flex flex-col gap-4">
			{setup.length ? (
				<section className={`${CARD} px-4 py-3`} data-testid="setup">
					<h2 className="text-[14px] font-semibold">Finish setting up</h2>
					<ul className="mt-2 flex flex-col gap-2">
						{setup.map((x) => (
							<li key={x.key} className="flex flex-wrap items-center gap-3 text-[13px]">
								<AlertTriangle aria-hidden className="h-4 w-4 shrink-0 text-[var(--g-warn-text)]" />
								<span className="flex-1">{x.text}</span>
								<Link to={x.to} className={ROW_ACTION_CLS}>{x.action}</Link>
							</li>
						))}
					</ul>
				</section>
			) : null}

			<Card testid="teams-card" title={<>Teams <span className="ml-1 text-[12px] font-normal text-[var(--g-ink-3)]">{s?.teams ? s.teams.total : ''}</span></>} action={<><Link to={`${base}/teams`} className="text-[12px] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]">View all</Link><Link to={`${base}/teams?install=1`} className={`${ROW_ACTION_CLS} inline-flex items-center gap-1`}><Plus aria-hidden className="h-3.5 w-3.5" />Install a team</Link></>}>
				{!s?.teams ? <p className="text-[13px] text-[var(--g-ink-3)]">Couldn’t load the teams.</p> : teams.length === 0 ? <p className="text-[13px] text-[var(--g-ink-3)]">No teams installed yet.</p> : (
					<>
						<table className="w-full text-left text-[12.5px]" data-testid="teams-table">
							<thead><tr className="border-b border-[var(--g-line)] text-[10.5px] uppercase tracking-[0.07em] text-[var(--g-ink-3)]">
								<th className="py-2 pr-3 font-semibold">Team</th><th className="py-2 pr-3 font-semibold">Version</th><th className="py-2 pr-3 font-semibold">Status</th><th className="py-2 text-right font-semibold">Last run</th>
							</tr></thead>
							<tbody>
								{teams.map((t) => {
									// The version installed here: the realm's team page shows that one.
									const href = t.scope ? `${base}/teams/${encodeURIComponent(t.scope)}/${encodeURIComponent(t.slug)}${t.version ? `?v=${encodeURIComponent(t.version)}` : ''}` : null;
									return (
										<tr key={t.label} {...row({ to: href })} className={`border-b border-[var(--g-line-2)] last:border-b-0 ${href ? ROW_OPENS : ''}`} data-testid={`team-${t.slug}`}>
											<td className="max-w-[420px] py-2.5 pr-3">
												<span className="flex min-w-0 items-center gap-2">
													<Team_avatar name={t.slug} size={22} />
													{href ? <Link to={href} className="truncate font-semibold hover:underline">{t.label}</Link> : <span className="truncate font-semibold">{t.label}</span>}
												</span>
												{t.description ? <span className="mt-0.5 block truncate pl-[30px] text-[12px] text-[var(--g-ink-3)]" title={t.description} data-testid="team-description">{t.description}</span> : null}
											</td>
											<td className="g-mono whitespace-nowrap py-2.5 pr-3 text-[12px]">
												{t.version ?? '—'}
												{t.latest_version ? <span className="ml-1.5 rounded-full bg-[var(--g-acc-soft)] px-1.5 py-px text-[11px] text-[var(--g-acc)]" title="A newer version is published">↑ {t.latest_version}</span> : null}
											</td>
											<td className="whitespace-nowrap py-2.5 pr-3">{t.missing_agents.length ? <span title={`Needs ${t.missing_agents.join(', ')}`}><Chip tone="warn">Missing agent config</Chip></span> : <span className="text-[12px] font-semibold text-[var(--g-ok)]">Ready</span>}</td>
											<td className="whitespace-nowrap py-2.5 text-right text-[var(--g-ink-2)]">{t.last_run_at ? relative_time(t.last_run_at) : <span className="text-[var(--g-ink-3)]">never</span>}</td>
										</tr>
									);
								})}
							</tbody>
						</table>
						<Pager what="teams" offset={s.teams.offset} limit={s.teams.limit} total={s.teams.total} on_page={on_teams_page} />
					</>
				)}
			</Card>

			<div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(280px,2fr)]">
				<Card testid="members-card" title={<>Members <span className="ml-1 text-[12px] font-normal text-[var(--g-ink-3)]">{people ? people.total : ''}</span></>} action={<><Link to={`${base}/settings?section=members`} className="text-[12px] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]">View all</Link>{admin ? <Link to={`${base}/settings?section=members`} className={ROW_ACTION_CLS}>Invite</Link> : null}</>}>
					{!people ? <p className="text-[13px] text-[var(--g-ink-3)]">Couldn’t load the members.</p> : (
						<>
							<table className="w-full text-left text-[12.5px]" data-testid="members-table">
								<thead><tr className="border-b border-[var(--g-line)] text-[10.5px] uppercase tracking-[0.07em] text-[var(--g-ink-3)]"><th className="py-2 pr-3 font-semibold">Member</th><th className="py-2 font-semibold">Role</th></tr></thead>
								<tbody>
									{people.items.map((m) => (
										<tr key={m.member_id} className="border-b border-[var(--g-line-2)] last:border-b-0" data-testid={`member-${m.member_id}`}>
											<td className="py-2 pr-3"><span className="flex items-center gap-2"><Avatar name={m.username ?? '?'} size={24} /><span className="font-medium">{m.username ?? 'someone'}</span>{m.is_you ? <span className="text-[11.5px] text-[var(--g-ink-3)]">you</span> : null}</span></td>
											<td className="py-2 capitalize text-[var(--g-ink-2)]">{m.role}</td>
										</tr>
									))}
								</tbody>
							</table>
							<Pager what="members" offset={people.offset} limit={people.limit} total={people.total} on_page={on_members_page} />
							{people.pending_invites ? <p className="mt-2 text-[12px] text-[var(--g-ink-3)]" data-testid="pending-invites">{people.pending_invites} invite{people.pending_invites === 1 ? '' : 's'} pending</p> : null}
						</>
					)}
				</Card>
				<Card testid="daemons-card" title={<>Daemons <span className="ml-1 text-[12px] font-normal text-[var(--g-ink-3)]">{s?.daemons ? `${online} online` : ''}</span></>} action={<Link to={`${base}/daemons`} className="text-[12px] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]">View all</Link>}>
					{!s?.daemons ? <p className="text-[13px] text-[var(--g-ink-3)]">Couldn’t load the daemons.</p> : s.daemons.items.length === 0 ? <p className="text-[13px] text-[var(--g-ink-3)]">None yet. Run <code className="g-mono">cliqd</code> with an enrollment token to add one.</p> : (
						<ul className="flex flex-wrap gap-1.5" aria-label="Daemons">
							{s.daemons.items.map((d) => (
								<li key={d.id}>
									<Link to={`${base}/daemons/${d.id}`} title={`${d.name} · ${d.status}`} aria-label={`${d.name}, ${d.status}`} className="block h-3.5 w-3.5 rounded-full" style={{ background: d.status === 'online' ? 'var(--g-ok)' : d.status === 'stale' ? 'var(--g-warn)' : 'var(--g-line-strong)' }} />
								</li>
							))}
						</ul>
					)}
				</Card>
			</div>

			{admin ? (
				<details className={`${CARD} px-4 py-2.5`} data-testid="danger-zone">
					<summary className="cursor-pointer text-[13px] font-semibold text-[var(--g-bad)]">Danger zone</summary>
					<div className="mt-2 flex flex-wrap items-center gap-3 text-[13px]">
						<span className="flex-1 text-[var(--g-ink-2)]">Delete this realm, its members and tokens. Runs history stays in the audit log.</span>
						<Link to={`${base}/settings?section=danger`} className="rounded-md border border-[var(--g-bad-line)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--g-bad)] hover:bg-[var(--g-bad-soft)]">Delete realm…</Link>
					</div>
				</details>
			) : null}

		</div>
	);
}

/** BFF codes for “the BFF and Core are on different versions”. */
export const VERSION_SKEW_CODES = new Set(['upstream_route_missing', 'upstream_version_mismatch']);

export function Blocking_error({ http_status, error, on_retry, what, code = null }: { http_status: number | null; error: string; on_retry: () => void; what: string; code?: string | null }) {
	if (code && VERSION_SKEW_CODES.has(code)) {
		return (
			<div role="alert" data-testid="version-skew" className="mx-auto mt-10 max-w-[520px] rounded-xl border border-[var(--g-warn-line,var(--g-line))] bg-[var(--g-warn-soft)] p-6 text-center">
				<AlertTriangle aria-hidden className="mx-auto h-6 w-6 text-[var(--g-warn-text)]" />
				<p className="mt-2 text-[14px] font-semibold">The app and Core are out of sync</p>
				<p className="mt-1 text-[13px] text-[var(--g-ink-2)]">This {what} needs a newer Core than the one running. Restart or update Core, then try again.</p>
				<p className="g-mono mt-2 break-words text-[11.5px] text-[var(--g-ink-3)]">{error}</p>
				<button type="button" onClick={on_retry} className="mt-4 rounded-lg border border-[var(--g-line)] px-4 py-1.5 text-[13px] font-semibold">Try again</button>
			</div>
		);
	}
	if (http_status === 403) {
		return (
			<div role="alert" className="mx-auto mt-10 max-w-[460px] rounded-xl border border-[var(--g-line)] bg-[var(--g-panel)] p-6 text-center">
				<Lock aria-hidden className="mx-auto h-7 w-7 text-[var(--g-ink-3)]" />
				<p className="mt-3 text-[14px] font-semibold">You don’t have access to this {what}</p>
				<p className="mt-1 text-[13px] text-[var(--g-ink-3)]">Ask a realm admin to add you, or switch to a realm you’re a member of.</p>
				<Link to="/home" className="mt-4 inline-block rounded-lg border border-[var(--g-line)] px-4 py-1.5 text-[13px] font-semibold">Back to overview</Link>
			</div>
		);
	}
	if (http_status === 404) {
		return (
			<div role="alert" className="mx-auto mt-10 max-w-[460px] rounded-xl border border-[var(--g-line)] bg-[var(--g-panel)] p-6 text-center">
				<SearchX aria-hidden className="mx-auto h-7 w-7 text-[var(--g-ink-3)]" />
				<p className="mt-3 text-[14px] font-semibold">This {what} doesn’t exist</p>
				<p className="mt-1 text-[13px] text-[var(--g-ink-3)]">{error}</p>
				<Link to="/home" className="mt-4 inline-block rounded-lg border border-[var(--g-line)] px-4 py-1.5 text-[13px] font-semibold">Back to overview</Link>
			</div>
		);
	}
	return (
		<div role="alert" className="mx-auto mt-10 max-w-[460px] rounded-xl border border-[var(--g-bad-line)] bg-[var(--g-bad-soft)] p-6 text-center">
			<AlertTriangle aria-hidden className="mx-auto h-6 w-6 text-[var(--g-bad)]" />
			<p className="mt-2 text-[14px] font-semibold">Couldn’t load this {what}</p>
			<p className="mt-1 text-[13px] text-[var(--g-ink-3)]">{error}</p>
			<button type="button" onClick={on_retry} className="mt-4 rounded-lg border border-[var(--g-line)] px-4 py-1.5 text-[13px] font-semibold">Try again</button>
		</div>
	);
}

function Skeleton() {
	return (
		<div className="space-y-4" aria-busy="true" aria-label="Loading realm">
			<div className="h-12 w-80 animate-pulse rounded bg-[var(--g-panel)]" />
			<div className="grid grid-cols-4 gap-3">{[0, 1, 2, 3].map((i) => <div key={i} className="h-[72px] animate-pulse rounded-[10px] bg-[var(--g-panel)]" />)}</div>
			<div className="h-[220px] animate-pulse rounded-[10px] bg-[var(--g-panel)]" />
		</div>
	);
}

export function Component() {
	const { org = '', slug = '' } = useParams();
	const overview = use_overview();
	// Pages of the Teams / Members tables (the read returns 5 of each).
	const [teams_offset, set_teams_offset] = useState(0);
	const [members_offset, set_members_offset] = useState(0);
	const inbox = use_bff_read<Realm_inbox_data>(
		'/v1/realm_inbox/get',
		org && slug ? { org_slug: org, slug, summary: true, ...(teams_offset ? { teams_offset } : {}), ...(members_offset ? { members_offset } : {}) } : null,
		{ refresh_ms: INBOX_REFRESH_MS, fallback_error: 'Could not load this realm.' },
	);
	const data = inbox.data;
	const realm_id = data?.realm.id ?? null;
	const sidebar_realm = overview.data?.orgs.flatMap((o) => o.realms).find((r) => r.id === realm_id) ?? null;
	// Right after New realm: what was set up, and the enrollment token — shown once (navigation
	// state only; dismissing or reloading clears it).
	const location = useLocation();
	const navigate = useNavigate();
	const created = (location.state as Realm_created_state | null)?.created ?? null;
	const dismiss_created = () => navigate(`${location.pathname}${location.search}`, { replace: true, state: null });

	return (
		<Graphite_shell
			data={overview.data}
			current_realm_id={realm_id}
			title="Overview"
			actions={
				<button
					type="button"
					onClick={() => void inbox.reload()}
					className="grid h-8 w-8 place-items-center rounded-lg border border-[var(--g-line)] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]"
					aria-label="Refresh"
					title="Refresh"
				>
					<RefreshCw className="h-3.5 w-3.5" />
				</button>
			}
		>
			<Realm_header org_slug={org} slug={slug} data={data} reload={() => inbox.reload()} realm={sidebar_realm} />
			<div className="px-7 py-6">
				{created ? (
					<div className="mb-4 flex flex-col gap-2.5" data-testid="realm-created">
						<p className="flex flex-wrap items-center gap-2 text-[13.5px]">
							<CheckCircle2 aria-hidden className="h-4 w-4 text-[var(--g-ok)]" />
							<b>{created.name} is ready.</b>
							<span className="text-[var(--g-ink-3)]">
								{[created.members_added ? `${created.members_added} added` : null, created.invites.length ? `${created.invites.length} invite${created.invites.length === 1 ? '' : 's'} sent` : null, 'hello-world installed'].filter(Boolean).join(' · ')}
							</span>
						</p>
						{created.invites.filter((i) => !i.email_sent && i.invite_url).map((i) => (
							<p key={i.email} className="text-[12.5px] text-[var(--g-ink-2)]">Email isn’t set up, so share this link with {i.email}: <code className="g-mono text-[12px]">{i.invite_url}</code></p>
						))}
						{created.token ? (
							<Secret_reveal
								title={`Enrollment token ${created.token_name ?? ''}`.trim()}
								secret={created.token}
								env_name="CLIQ_DAEMON_TOKEN"
								note={`Set CLIQ_DAEMON_TOKEN on the machine that runs cliqd; it joins ${created.qualified_slug}. Make more tokens from the realm’s Access tokens.`}
								on_done={dismiss_created}
							/>
						) : <button type="button" onClick={dismiss_created} className={`${ROW_ACTION_CLS} w-fit`}>Dismiss</button>}
					</div>
				) : null}
				{inbox.status === 'loading' ? <Skeleton /> : null}
				{inbox.status === 'error' && data ? (
					<p role="status" className="mb-3 text-[12px] text-[var(--g-warn-text)]">Showing the last loaded data — {inbox.error}</p>
				) : null}
				{inbox.status === 'error' && !data ? (
					<Blocking_error http_status={inbox.http_status} code={inbox.code} error={inbox.error} on_retry={() => void inbox.reload()} what="realm" />
				) : null}
				{data ? <Realm_summary_view data={data} org_slug={org} slug={slug} on_teams_page={set_teams_offset} on_members_page={set_members_offset} /> : null}
			</div>
		</Graphite_shell>
	);
}
