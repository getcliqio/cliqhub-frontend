/**
 * The realm layout: every page inside a realm sits in it.
 *
 *   header    — the realm's name (the page's one big title), description (or "Add a description"),
 *               org.slug · created by · updated, Edit realm
 *   left nav  — Teams · Runs · Daemons · Settings, each with a signal instead of a count:
 *               ⚠ when something there needs you (Teams: a team missing agent config; Runs: a run
 *               waiting on you or failed in the last 24h; Settings: you're the only member),
 *               otherwise a green dot when runs are going / a daemon is online (grey: none online).
 *               The open run / team / daemon is nested under its section; Settings lists its parts.
 *   content   — the page; a section's "needs attention" line sits at its top.
 *
 * Data: `realm_inbox/get { summary: true }` (last result kept per realm so moving between pages
 * doesn't flash). Edit realm is a side panel that saves name and description in one `realms/update`.
 * Right after New realm, the token is shown once here (navigation state only).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { CheckCircle2 } from 'lucide-react';
import { useAuthFetch } from '@/lib/auth_context';
import { api_message, use_bff_read } from '@/lib/use_bff_read';
import { relative_time } from '@/lib/overview';
import type { Overview_realm } from '@/lib/overview';
import { REALM_HEALTH_LABEL, type Realm_health, type Realm_inbox_data } from '@/lib/realm_inbox';
import { realm_path } from '@/lib/realm_url';
import { G_PRIMARY } from '@/components/graphite/g_agents';
import { ROW_ACTION_CLS } from '@/components/graphite/g_kinds';
import { Secret_reveal } from '@/components/graphite/g_secret';
import { Team_avatar } from '@/pages/teams/teams_graphite_page';
import type { Realm_created_state } from '@/pages/realms/new_realm_page';

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

/** Edit realm: name and description, saved together in one realms/update. */
function Details_panel({ realm_id, name, description, on_close, on_saved }: { realm_id: string; name: string; description: string | null; on_close: () => void; on_saved: () => Promise<void> }) {
	const auth_fetch = useAuthFetch();
	const [n, set_n] = useState(name);
	const [d, set_d] = useState(description ?? '');
	const [busy, set_busy] = useState(false);
	const [err, set_err] = useState<string | null>(null);
	const changed = n.trim() !== name || d.trim() !== (description ?? '');
	async function save() {
		set_busy(true); set_err(null);
		try {
			const res = await auth_fetch('/v1/realms/update', { method: 'POST', body: JSON.stringify({ realm_id, name: n.trim(), description: d.trim() }) });
			const payload = await res.json().catch(() => null);
			if (!res.ok || !payload?.ok) { set_err(api_message(payload, 'Could not save.')); set_busy(false); return; }
		} catch { set_err('Network error'); set_busy(false); return; }
		set_busy(false);
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

/** Last summary per realm, so the header doesn't flash empty between realm pages. */
const LAST = new Map<string, Realm_inbox_data>();

type Section = 'teams' | 'runs' | 'daemons' | 'agents' | 'notifications' | 'settings';
/** Which section a realm path belongs to. */
const SECTION_OF: Record<string, Section> = {
	teams: 'teams', runs: 'runs', settings: 'settings', agents: 'agents', notifications: 'notifications', daemons: 'daemons', workspaces: 'daemons',
};

function Attention({ count, title }: { count: boolean; title: string }) {
	if (!count) return null;
	return <span role="img" aria-label={title} title={title} className="ml-auto grid h-4 w-4 shrink-0 place-items-center rounded-full bg-[var(--g-warn)] text-[11px] font-extrabold text-[#2a1d00]" data-testid="nav-attention">!</span>;
}
function Dot({ tone, title }: { tone: 'ok' | 'off'; title: string }) {
	return <span role="img" aria-label={title} title={title} className="ml-auto h-2 w-2 shrink-0 rounded-full" style={{ background: tone === 'ok' ? 'var(--g-ok)' : 'var(--g-ink-3)' }} data-testid={`nav-dot-${tone}`} />;
}

/**
 * @param item - The open run / team / daemon / workspace: nested under its section in the left nav.
 * @param realm - The sidebar's realm (name / daemons online) while nothing has loaded yet.
 */
export function Realm_header({ org_slug, slug, realm = null, item = null, children = null }: {
	org_slug: string; slug: string; realm?: Overview_realm | null; item?: ReactNode; children?: ReactNode;
}) {
	const key = `${org_slug}/${slug}`;
	const own = use_bff_read<Realm_inbox_data>('/v1/realm_inbox/get', org_slug && slug ? { org_slug, slug, summary: true } : null, { refresh_ms: 60_000, fallback_error: 'Could not load this realm.' });
	// Only a realm read counts (anything else — an older BFF, an error body — is ignored).
	const fetched = own.data?.realm ? own.data : null;
	const d = fetched ?? LAST.get(key) ?? null;
	useEffect(() => { if (d) LAST.set(key, d); }, [key, d]);
	const [editing, set_editing] = useState(false);
	const location = useLocation();
	const navigate = useNavigate();
	const { pathname, search } = location;
	const base = realm_path(org_slug, slug);
	const sub = pathname.startsWith(`${base}/`) ? pathname.slice(base.length + 1).split('/')[0] : '';
	const current: Section | null = SECTION_OF[sub] ?? null;
	const at_list = Boolean(current) && !item;
	// Right after New realm: what was set up and the enrollment token — shown once.
	const created = (location.state as Realm_created_state | null)?.created ?? null;
	const dismiss_created = () => navigate(`${pathname}${search}`, { replace: true, state: null });

	const s = d?.summary ?? null;
	const name = d?.realm.name || realm?.name || slug;
	const online = s?.daemons?.online ?? realm?.daemons.online ?? null;
	const missing = s?.teams?.missing_agents ?? 0;
	// Open Hugs that reached you (a run awaiting input waits on one, so it isn't counted again).
	const need_you = d ? d.counts.hugs : (realm?.needs_you ?? 0);
	const failed = d?.counts.failed_24h ?? 0;
	const running = d?.counts.running ?? realm?.active_runs ?? 0;
	const only_member = Boolean(s?.you.is_admin && s?.people && s.people.total <= 1);

	const link = (on: boolean, nested = false) => `flex items-center gap-2 rounded-lg px-2.5 py-[6px] text-[13px] ${nested ? 'pl-6 text-[12.5px]' : ''} ${on ? 'bg-[var(--g-soft)] font-semibold text-[var(--g-ink)] shadow-[inset_2px_0_0_var(--g-acc)]' : 'text-[var(--g-ink-2)] hover:bg-[var(--g-soft)] hover:text-[var(--g-ink)]'}`;
	const nested = (sec: Section) => (item && current === sec ? <span aria-current="page" className={`${link(true, true)} g-mono truncate`} data-testid="nav-item">{item}</span> : null);

	return (
		<>
			<header className="border-b border-[var(--g-line)] px-7 py-4" data-testid="realm-header">
				<div className="flex flex-wrap items-start gap-4">
					<Team_avatar name={name} size={40} />
					<div className="min-w-0 flex-1">
						<h1 className="text-[20px] font-semibold tracking-tight">{name}</h1>
						{s?.realm.description
							? <p className="mt-0.5 max-w-[780px] text-[13px] text-[var(--g-ink-2)]" data-testid="realm-description">{s.realm.description}</p>
							: s?.you.is_admin && d ? <button type="button" onClick={() => set_editing(true)} className="mt-0.5 text-[13px] text-[var(--g-ink-3)] hover:text-[var(--g-ink)] hover:underline" data-testid="add-description">Add a description</button> : null}
						<p className="mt-0.5 flex flex-wrap gap-x-2 text-[12px] text-[var(--g-ink-3)]" data-testid="realm-meta">
							<span className="g-mono text-[var(--g-ink-2)]">{org_slug}.{slug}</span>
							{s?.realm.created_by_username ? <span>· created by {s.realm.created_by_username}{s.realm.created_at ? ` ${relative_time(s.realm.created_at)}` : ''}</span> : null}
							{s?.realm.updated_at ? <span>· updated {relative_time(s.realm.updated_at)}</span> : null}
						</p>
					</div>
					{s?.you.is_admin && d ? <button type="button" onClick={() => set_editing(true)} className={ROW_ACTION_CLS}>Edit realm</button> : null}
				</div>
				{editing && d ? <Details_panel realm_id={d.realm.id} name={d.realm.name} description={s?.realm.description ?? null} on_close={() => set_editing(false)} on_saved={async () => { await own.reload(); }} /> : null}
			</header>
			<div className="grid gap-6 px-7 py-6 lg:grid-cols-[190px_minmax(0,1fr)]">
				<nav aria-label="Realm sections" className="flex flex-col gap-0.5 self-start" data-testid="realm-nav">
					<Link to={`${base}/teams`} aria-current={current === 'teams' && !item ? 'page' : undefined} className={link(current === 'teams' && !item)} data-testid="go-teams">Teams<Attention count={missing > 0} title={`${missing} team${missing === 1 ? ' is' : 's are'} missing agent config`} /></Link>
					{nested('teams')}
					<Link to={`${base}/runs`} aria-current={current === 'runs' && !item ? 'page' : undefined} className={link(current === 'runs' && !item)} data-testid="go-runs">Runs{need_you + failed > 0 ? <Attention count title={[need_you ? `${need_you} need${need_you === 1 ? 's' : ''} you` : null, failed ? `${failed} failed in the last 24h` : null].filter(Boolean).join(' · ')} /> : running > 0 ? <Dot tone="ok" title={`${running} running`} /> : null}</Link>
					{nested('runs')}
					<Link to={`${base}/daemons`} aria-current={current === 'daemons' && !item ? 'page' : undefined} className={link(current === 'daemons' && !item)} data-testid="go-daemons">Daemons{online === null ? null : online > 0 ? <Dot tone="ok" title={`${online} online`} /> : <Dot tone="off" title="No daemon online" />}</Link>
					{nested('daemons')}
					<Link to={`${base}/agents`} aria-current={current === 'agents' && !item ? 'page' : undefined} className={link(current === 'agents' && !item)} data-testid="go-agents">Agents<Attention count={missing > 0} title={`${missing} team${missing === 1 ? ' is' : 's are'} missing agent config`} /></Link>
					{/* Notifications and Settings show their parts as vertical tabs on their page. */}
					<Link to={`${base}/notifications/events`} aria-current={current === 'notifications' ? 'page' : undefined} className={link(current === 'notifications')} data-testid="go-notifications">Notifications</Link>
					<Link to={`${base}/settings`} aria-current={current === 'settings' ? 'page' : undefined} className={link(current === 'settings')} data-testid="go-settings">Settings<Attention count={only_member} title="You’re the only member" /></Link>
				</nav>
				<div className="min-w-0">
					{created ? (
						<div className="mb-4 flex flex-col gap-2.5" data-testid="realm-created">
							<p className="flex flex-wrap items-center gap-2 text-[13.5px]">
								<CheckCircle2 aria-hidden className="h-4 w-4 text-[var(--g-ok)]" />
								<b>{created.name} is ready.</b>
								<span className="text-[var(--g-ink-3)]">{[created.members_added ? `${created.members_added} added` : null, created.invites.length ? `${created.invites.length} invite${created.invites.length === 1 ? '' : 's'} sent` : null, 'hello-world installed'].filter(Boolean).join(' · ')}</span>
							</p>
							{created.invites.filter((i) => !i.email_sent && i.invite_url).map((i) => (
								<p key={i.email} className="text-[12.5px] text-[var(--g-ink-2)]">Email isn’t set up, so share this link with {i.email}: <code className="g-mono text-[12px]">{i.invite_url}</code></p>
							))}
							{created.token ? (
								<Secret_reveal title={`Enrollment token ${created.token_name ?? ''}`.trim()} secret={created.token} env_name="CLIQ_DAEMON_TOKEN"
									note={`Set CLIQ_DAEMON_TOKEN on the machine that runs cliqd; it joins ${created.qualified_slug}. Make more tokens in the realm’s Settings › Security.`} on_done={dismiss_created} />
							) : <button type="button" onClick={dismiss_created} className={`${ROW_ACTION_CLS} w-fit`}>Dismiss</button>}
						</div>
					) : null}
					{/* What needs you in this section, with a way to fix it. */}
					{at_list && current === 'teams' && missing > 0 ? (
						<Attention_line text={`${missing} team${missing === 1 ? ' is' : 's are'} missing agent config — an agent ${missing === 1 ? 'it uses' : 'they use'} isn’t set up in your org.`} to={`${base}/agents`} action="Set up agents" />
					) : null}
					{current === 'settings' && only_member ? <Attention_line text="You’re the only member." to={`${base}/settings`} action="Invite people" /> : null}
					{children}
				</div>
			</div>
		</>
	);
}

function Attention_line({ text, to, action }: { text: string; to: string; action: string }) {
	return (
		<div className="mb-4 flex flex-wrap items-center gap-3 rounded-[10px] border border-[var(--g-warn-line,var(--g-line))] bg-[var(--g-warn-soft)] px-4 py-2.5 text-[13px]" role="status" data-testid="attention">
			<span aria-hidden className="text-[var(--g-warn-text)]">⚠</span>
			<span className="flex-1">{text}</span>
			<Link to={to} className={ROW_ACTION_CLS}>{action}</Link>
		</div>
	);
}
