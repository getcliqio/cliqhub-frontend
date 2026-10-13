/**
 * Realm page (Graphite) — one page, no tabs: who the realm is, whether it can run, and a way into
 * each part of it.
 *
 *   header   — name, ✎ (Realm details panel: name + description, one realms/update), status
 *              (Ready / Missing agents / No daemon available), description, slug · creator · updated;
 *              More ▾ (Agents, Notifications, A2A, Access tokens, Settings) and Run… (pick a team)
 *   buttons  — Runs (running · need you) · Teams (· missing agent) · Daemons (N online) · Members
 *   setup    — what's missing, only when something is
 *   cards    — teams (chips), daemons (lights), people (avatars, roles, pending invites)
 *   danger   — folded; Delete realm lives in Settings › Danger zone
 *
 * Runs that need you and runs in progress live on the Runs page, not here.
 *
 * Data: one `POST /v1/realm_inbox/get { org_slug, slug, summary: true }` (BFF composes the realm,
 * run counts, teams, daemons and people). Writes: `realms/update`.
 */
import { useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { AlertTriangle, CheckCircle2, ChevronDown, Lock, Pencil, Play, Plus, RefreshCw, SearchX } from 'lucide-react';
import { use_overview, relative_time } from '@/lib/overview';
import { use_bff_read } from '@/lib/use_bff_read';
import { useAuthFetch } from '@/lib/auth_context';
import { api_message } from '@/lib/use_bff_read';
import { REALM_HEALTH_LABEL, realm_health, type Realm_health, type Realm_inbox_data, type Realm_summary } from '@/lib/realm_inbox';
import { realm_path } from '@/lib/realm_url';
import { Graphite_shell } from '@/components/graphite/graphite_shell';
import { Realm_nav } from '@/components/graphite/realm_nav';
import { Secret_reveal } from '@/components/graphite/g_secret';
import { Avatar } from '@/components/graphite/g_admin';
import { G_PRIMARY } from '@/components/graphite/g_agents';
import { ROW_ACTION_CLS } from '@/components/graphite/g_kinds';
import { Run_in_realm_dialog } from '@/components/run_in_realm_dialog';
import { Team_avatar } from '@/pages/teams/teams_graphite_page';
import type { Realm_created_state } from '@/pages/realms/new_realm_page';

export const INBOX_REFRESH_MS = 15_000;

const CARD = 'rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)]';
const INPUT = 'w-full rounded-md border border-[var(--g-line)] bg-[var(--g-bg)] px-2.5 py-1.5 text-[13px] outline-none focus:border-[var(--g-acc-line)]';

const HEALTH_TONE: Record<Realm_health, string> = {
	ready: 'bg-[var(--g-ok-soft,var(--g-soft))] text-[var(--g-ok)]',
	missing_agents: 'bg-[var(--g-warn-soft)] text-[var(--g-warn-text)]',
	no_daemon: 'bg-[var(--g-bad-soft)] text-[var(--g-bad)]',
};

export function Health_badge({ health }: { health: Realm_health }) {
	return (
		<span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${HEALTH_TONE[health]}`} data-testid="realm-status">
			<i aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />{REALM_HEALTH_LABEL[health]}
		</span>
	);
}

function use_post() {
	const auth_fetch = useAuthFetch();
	return async (path: string, body: Record<string, unknown>): Promise<{ ok: true } | { ok: false; error: string }> => {
		try {
			const res = await auth_fetch(path, { method: 'POST', body: JSON.stringify(body) });
			const payload = await res.json().catch(() => null);
			if (!res.ok || !payload?.ok) return { ok: false, error: api_message(payload, 'Request failed') };
			return { ok: true };
		} catch { return { ok: false, error: 'Network error' }; }
	};
}

/** One of the four buttons under the header: a count and a way in. */
function Section_button({ to, label, value, extra, testid }: { to: string; label: string; value: ReactNode; extra?: ReactNode; testid: string }) {
	return (
		<Link to={to} data-testid={testid} className={`${CARD} flex flex-col gap-1 px-4 py-3 hover:border-[var(--g-line-strong)]`}>
			<span className="text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--g-ink-3)]">{label}</span>
			<span className="flex flex-wrap items-baseline gap-2">
				<span className="g-mono text-[22px] font-medium leading-tight">{value}</span>
				{extra}
			</span>
		</Link>
	);
}

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

/** Realm details panel (✎): name and description, saved together in one realms/update. */
function Details_panel({ realm_id, name, description, on_close, on_saved }: { realm_id: string; name: string; description: string | null; on_close: () => void; on_saved: () => Promise<void> }) {
	const post = use_post();
	const [n, set_n] = useState(name);
	const [d, set_d] = useState(description ?? '');
	const [busy, set_busy] = useState(false);
	const [err, set_err] = useState<string | null>(null);
	const changed = n.trim() !== name || d.trim() !== (description ?? '');
	async function save() {
		set_busy(true); set_err(null);
		const res = await post('/v1/realms/update', { realm_id, name: n.trim(), description: d.trim() });
		set_busy(false);
		if (!res.ok) { set_err(res.error); return; }
		await on_saved();
		on_close();
	}
	return (
		<div className="fixed inset-0 z-50 flex justify-end bg-[var(--g-backdrop)]" role="dialog" aria-label="Realm details" onMouseDown={(e) => { if (e.target === e.currentTarget) on_close(); }} onKeyDown={(e) => { if (e.key === 'Escape') on_close(); }}>
			<form onSubmit={(e) => { e.preventDefault(); if (changed && n.trim()) void save(); }} className="flex h-full w-[440px] max-w-full flex-col gap-4 overflow-y-auto border-l border-[var(--g-line-strong)] bg-[var(--g-panel)] px-6 py-5 shadow-[var(--g-drawer-shadow)]">
				<div className="flex items-center">
					<h2 className="text-[16px] font-semibold">Realm details</h2>
					<button type="button" onClick={on_close} aria-label="Close" className="ml-auto text-[var(--g-ink-3)] hover:text-[var(--g-ink)]">✕</button>
				</div>
				<label className="flex flex-col gap-1.5 text-[12px] font-semibold text-[var(--g-ink-2)]">Name
					<input autoFocus value={n} onChange={(e) => set_n(e.target.value)} maxLength={100} className={INPUT} />
				</label>
				<label className="flex flex-col gap-1.5 text-[12px] font-semibold text-[var(--g-ink-2)]">Description
					<textarea value={d} onChange={(e) => set_d(e.target.value)} rows={4} maxLength={500} placeholder="What this realm is for" className={INPUT} />
				</label>
				<p className="text-[12px] text-[var(--g-ink-3)]">The slug stays the same, so links keep working.</p>
				{err ? <p role="alert" className="text-[12.5px] text-[var(--g-bad)]">{err}</p> : null}
				<div className="flex gap-2">
					<button type="submit" disabled={busy || !changed || !n.trim()} className={G_PRIMARY}>{busy ? 'Saving…' : 'Save'}</button>
					<button type="button" onClick={on_close} className={ROW_ACTION_CLS}>Cancel</button>
				</div>
			</form>
		</div>
	);
}

/** A small menu that closes when you pick something or click away. */
function Menu({ label, primary, disabled, title, children }: { label: ReactNode; primary?: boolean; disabled?: boolean; title?: string; children: (close: () => void) => ReactNode }) {
	const [open, set_open] = useState(false);
	return (
		<div className="relative" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) set_open(false); }}>
			<button type="button" disabled={disabled} title={title} aria-haspopup="menu" aria-expanded={open} onClick={() => set_open((v) => !v)} className={primary ? G_PRIMARY : `${ROW_ACTION_CLS} inline-flex items-center gap-1`}>
				{label}
			</button>
			{open ? (
				<div role="menu" className="absolute right-0 z-40 mt-1 flex min-w-[220px] flex-col rounded-lg border border-[var(--g-line)] bg-[var(--g-panel)] py-1 shadow-[var(--g-drawer-shadow)]">
					{children(() => set_open(false))}
				</div>
			) : null}
		</div>
	);
}
const MENU_ITEM = 'px-3 py-1.5 text-left text-[13px] hover:bg-[var(--g-soft)] disabled:cursor-not-allowed disabled:opacity-50';

export function Realm_summary_view({ data, org_slug, slug, reload }: { data: Realm_inbox_data; org_slug: string; slug: string; reload: () => Promise<void> }) {
	const s: Realm_summary | null = data.summary ?? null;
	const base = realm_path(org_slug, slug);
	const [editing, set_editing] = useState(false);
	const [running, set_running] = useState<{ scope: string; slug: string } | null>(null);
	const online = s?.daemons?.online ?? 0;
	const missing = s?.teams?.missing_agents ?? 0;
	const health = s?.daemons ? realm_health(online, missing) : null;
	const need_you = data.counts.reviews + data.counts.awaiting_input;
	const teams = s?.teams?.items ?? [];
	const admin = s?.you.is_admin ?? false;
	const people = s?.people ?? null;
	const setup: Array<{ key: string; text: string; to: string; action: string }> = [];
	if (s?.daemons && online === 0) setup.push({ key: 'daemon', text: s.daemons.total ? 'No daemon is online, so nothing can run.' : 'No daemon has joined yet, so nothing can run.', to: `${base}/daemons`, action: 'Connect a daemon' });
	if (missing > 0) setup.push({ key: 'agents', text: `${missing} team${missing === 1 ? ' uses' : 's use'} an agent your org hasn’t registered.`, to: `${base}/agents`, action: 'Set up agents' });
	if (teams.length === 0 && s?.teams) setup.push({ key: 'teams', text: 'No teams installed yet.', to: `${base}/teams?install=1`, action: 'Install a team' });
	if (people && people.total <= 1 && admin) setup.push({ key: 'people', text: 'You’re the only one here.', to: `${base}/settings?section=members`, action: 'Invite people' });
	const run_reason = online === 0 ? 'No daemon is online' : teams.length === 0 ? 'No teams installed' : undefined;

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-start gap-4">
				<Team_avatar name={data.realm.name || slug} size={48} />
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-2.5">
						<h1 className="text-[22px] font-semibold tracking-tight">{data.realm.name || slug}</h1>
						{admin ? <button type="button" aria-label="Edit realm details" title="Name and description" onClick={() => set_editing(true)} className="grid h-7 w-7 place-items-center rounded-md text-[var(--g-ink-3)] hover:bg-[var(--g-soft)] hover:text-[var(--g-ink)]"><Pencil aria-hidden className="h-3.5 w-3.5" /></button> : null}
						{health ? <Health_badge health={health} /> : null}
					</div>
					{s?.realm.description ? <p className="mt-1 max-w-[780px] text-[13px] text-[var(--g-ink-2)]">{s.realm.description}</p> : null}
					<p className="mt-1.5 flex flex-wrap gap-x-2 text-[12px] text-[var(--g-ink-3)]" data-testid="realm-meta">
						<span className="g-mono text-[var(--g-ink-2)]">{org_slug}.{slug}</span>
						{s?.realm.created_by_username ? <span>· created by {s.realm.created_by_username}{s.realm.created_at ? ` ${relative_time(s.realm.created_at)}` : ''}</span> : null}
						{s?.realm.updated_at ? <span>· updated {relative_time(s.realm.updated_at)}</span> : null}
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Menu label={<>More<ChevronDown aria-hidden className="h-3.5 w-3.5" /></>}>
						{(close) => (
							<>
								<Link role="menuitem" to={`${base}/agents`} onClick={close} className={MENU_ITEM}>Agents</Link>
								<Link role="menuitem" to={`/notifications?org=${encodeURIComponent(org_slug)}&realm=${encodeURIComponent(slug)}`} onClick={close} className={MENU_ITEM}>Notifications</Link>
								<Link role="menuitem" to={`${base}/settings?section=a2a`} onClick={close} className={MENU_ITEM}>A2A &amp; mesh</Link>
								<Link role="menuitem" to={`${base}/settings?section=tokens`} onClick={close} className={MENU_ITEM}>Access tokens</Link>
								<Link role="menuitem" to={`${base}/settings?section=general`} onClick={close} className={MENU_ITEM}>Settings</Link>
							</>
						)}
					</Menu>
					<Menu primary disabled={!!run_reason} title={run_reason} label={<><Play aria-hidden className="h-3.5 w-3.5" />Run…</>}>
						{(close) => teams.map((t) => (
							<button key={t.label} role="menuitem" type="button" disabled={!t.scope || t.missing_agents.length > 0} title={t.missing_agents.length ? `Needs ${t.missing_agents.join(', ')}` : undefined} onClick={() => { close(); if (t.scope) set_running({ scope: t.scope, slug: t.slug }); }} className={MENU_ITEM}>
								{t.label}{t.missing_agents.length ? <span className="ml-2 text-[11.5px] text-[var(--g-warn-text)]">missing agent</span> : null}
							</button>
						))}
					</Menu>
				</div>
			</div>

			<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
				<Section_button testid="go-runs" to={`${base}/runs`} label="Runs" value={data.counts.running} extra={<><span className="text-[12px] text-[var(--g-ink-3)]">running</span>{need_you ? <Chip tone="warn">{need_you} need you</Chip> : null}</>} />
				<Section_button testid="go-teams" to={`${base}/teams`} label="Teams" value={s?.teams?.total ?? '—'} extra={missing ? <Chip tone="warn">{missing} missing agent</Chip> : null} />
				<Section_button testid="go-daemons" to={`${base}/daemons`} label="Daemons" value={s?.daemons ? online : '—'} extra={<span className="text-[12px] text-[var(--g-ink-3)]">online</span>} />
				<Section_button testid="go-members" to={`${base}/settings?section=members`} label="Members" value={people?.total ?? '—'} extra={people?.pending_invites ? <Chip tone="muted">{people.pending_invites} pending</Chip> : null} />
			</div>

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

			<div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(280px,2fr)]">
				<Card testid="teams-card" title="Teams" action={<><Link to={`${base}/teams`} className="text-[12px] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]">View all</Link><Link to={`${base}/teams?install=1`} className={`${ROW_ACTION_CLS} inline-flex items-center gap-1`}><Plus aria-hidden className="h-3.5 w-3.5" />Install a team</Link></>}>
					{!s?.teams ? <p className="text-[13px] text-[var(--g-ink-3)]">Couldn’t load the teams.</p> : teams.length === 0 ? <p className="text-[13px] text-[var(--g-ink-3)]">No teams installed yet.</p> : (
						<ul className="flex flex-wrap gap-2">
							{teams.map((t) => (
								<li key={t.label} data-testid={`team-${t.slug}`} className="flex items-center gap-2 rounded-full border border-[var(--g-line)] py-1 pl-1 pr-3 text-[12.5px]">
									<Team_avatar name={t.slug} size={22} />
									{t.scope ? <Link to={`/teams/${t.scope}/${t.slug}`} className="font-medium hover:underline">{t.label}</Link> : <span className="font-medium">{t.label}</span>}
									{t.missing_agents.length ? <span title={`Needs ${t.missing_agents.join(', ')}`}><Chip tone="warn">Missing agent</Chip></span> : <span className="text-[11.5px] font-semibold text-[var(--g-ok)]">Ready</span>}
								</li>
							))}
						</ul>
					)}
				</Card>
				<div className="flex flex-col gap-4">
					<Card testid="daemons-card" title={<>Daemons <span className="ml-1 text-[12px] font-normal text-[var(--g-ink-3)]">{s?.daemons ? `${online} online` : ''}</span></>} action={<Link to={`${base}/daemons`} className="text-[12px] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]">{online === 0 ? 'Connect' : 'View all'}</Link>}>
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
					<Card testid="members-card" title="Members" action={admin ? <Link to={`${base}/settings?section=members`} className={ROW_ACTION_CLS}>Invite</Link> : null}>
						{!people ? <p className="text-[13px] text-[var(--g-ink-3)]">Couldn’t load the members.</p> : (
							<>
								<div className="flex -space-x-1.5">
									{people.items.slice(0, 8).map((m) => <span key={m.member_id} title={`${m.username ?? 'someone'} · ${m.role}`}><Avatar name={m.username ?? '?'} size={28} /></span>)}
									{people.total > 8 ? <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--g-soft)] text-[11px] text-[var(--g-ink-3)]">+{people.total - 8}</span> : null}
								</div>
								<p className="mt-2 text-[12px] text-[var(--g-ink-3)]" data-testid="roles">
									{Object.entries(people.by_role).map(([r, n]) => `${n} ${r}${n === 1 ? '' : 's'}`).join(' · ')}
									{people.pending_invites ? ` · ${people.pending_invites} invite${people.pending_invites === 1 ? '' : 's'} pending` : ''}
								</p>
							</>
						)}
					</Card>
				</div>
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

			{editing ? <Details_panel realm_id={data.realm.id} name={data.realm.name} description={s?.realm.description ?? null} on_close={() => set_editing(false)} on_saved={reload} /> : null}
			{running ? <Run_in_realm_dialog scope={running.scope} slug={running.slug} fixed_realm={{ id: data.realm.id, slug: data.realm.slug, name: data.realm.name }} on_close={() => set_running(null)} /> : null}
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
	const inbox = use_bff_read<Realm_inbox_data>(
		'/v1/realm_inbox/get',
		org && slug ? { org_slug: org, slug, summary: true } : null,
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
			title={data?.realm.name || slug}
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
			<Realm_nav org_slug={org} slug={slug} realm={sidebar_realm} />
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
				{data ? <Realm_summary_view data={data} org_slug={org} slug={slug} reload={() => inbox.reload()} /> : null}
			</div>
		</Graphite_shell>
	);
}
