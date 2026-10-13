/**
 * The realm header. On the overview: name, status, description, meta, Edit realm and the section
 * buttons. On every page below it (a section, a run, a team…): one compact title bar —
 * "{title} in org.realm" — with the same section buttons, so there's never a second title.
 *
 *   name · status (Ready / Missing agent config / No daemon available); description; org.slug · created by · updated
 *   on the right, buttons (not tabs): Edit realm (realm overview only) · Teams (N · missing agent config) · Runs (N running · need you)
 *   · Settings · Daemons (N online)
 *
 * Data: `realm_inbox/get { summary: true }`. The overview page passes what it already read; other
 * pages read it here (last result kept per realm so moving between pages doesn't flash). Edit realm
 * is a side panel that saves name and description together in one `realms/update`.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { useAuthFetch } from '@/lib/auth_context';
import { api_message, use_bff_read } from '@/lib/use_bff_read';
import { relative_time } from '@/lib/overview';
import type { Overview_realm } from '@/lib/overview';
import { REALM_HEALTH_LABEL, realm_health, type Realm_health, type Realm_inbox_data } from '@/lib/realm_inbox';
import { realm_path } from '@/lib/realm_url';
import { G_PRIMARY } from '@/components/graphite/g_agents';
import { ROW_ACTION_CLS } from '@/components/graphite/g_kinds';
import { Team_avatar } from '@/pages/teams/teams_graphite_page';

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

function Chip({ tone, children }: { tone: 'warn' | 'muted'; children: ReactNode }) {
	const cls = tone === 'warn' ? 'bg-[var(--g-warn-soft)] text-[var(--g-warn-text)]' : 'bg-[var(--g-soft)] text-[var(--g-ink-3)]';
	return <span className={`rounded-full px-1.5 py-px text-[11px] font-semibold ${cls}`}>{children}</span>;
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

/** Which header button a realm path belongs to. */
const SECTION_OF: Record<string, 'teams' | 'runs' | 'settings' | 'daemons'> = {
	teams: 'teams', runs: 'runs', settings: 'settings', agents: 'settings', daemons: 'daemons', workspaces: 'daemons',
};

/**
 * @param data - The overview page's own read (skips the header's read). Given → the full header.
 * @param title - Below the overview (a section, a run, a team…): the page's one title, shown as
 *   "{title} in org.realm" in a single compact row with the section buttons.
 * @param realm - The sidebar's realm (name / daemons online) while nothing has loaded yet.
 */
export function Realm_header({ org_slug, slug, data, reload, realm = null, title = null }: {
	org_slug: string; slug: string; data?: Realm_inbox_data | null; reload?: () => Promise<void>; realm?: Overview_realm | null; title?: ReactNode;
}) {
	const key = `${org_slug}/${slug}`;
	const own = use_bff_read<Realm_inbox_data>('/v1/realm_inbox/get', data === undefined && org_slug && slug ? { org_slug, slug, summary: true } : null, { refresh_ms: 60_000, fallback_error: 'Could not load this realm.' });
	// Only a realm read counts (anything else — an older BFF, an error body — is ignored).
	const fetched = own.data?.realm ? own.data : null;
	const d = data ?? fetched ?? LAST.get(key) ?? null;
	useEffect(() => { if (d) LAST.set(key, d); }, [key, d]);
	const [editing, set_editing] = useState(false);
	const { pathname } = useLocation();
	const base = realm_path(org_slug, slug);
	const sub = pathname.startsWith(`${base}/`) ? pathname.slice(base.length + 1).split('/')[0] : '';
	const current = SECTION_OF[sub] ?? null;

	const s = d?.summary ?? null;
	const name = d?.realm.name || realm?.name || slug;
	const online = s?.daemons?.online ?? realm?.daemons.online ?? null;
	const missing = s?.teams?.missing_agents ?? 0;
	const health = online === null ? null : realm_health(online, missing);
	const need_you = d ? d.counts.reviews + d.counts.awaiting_input : (realm?.needs_you ?? 0);
	const running = d?.counts.running ?? realm?.active_runs ?? null;

	const button = (k: 'teams' | 'runs' | 'settings' | 'daemons', to: string, label: string, extra?: ReactNode) => (
		<Link to={to} data-testid={`go-${k}`} aria-current={current === k ? 'page' : undefined}
			className={`${ROW_ACTION_CLS} inline-flex items-center gap-1.5`}>
			{label}{extra}
		</Link>
	);
	const count = (n: number | null | undefined, suffix = '') => (n === null || n === undefined ? null : <span className="g-mono font-normal text-[var(--g-ink-3)]">{n}{suffix}</span>);

	const sections = (
		<>
			{button('teams', `${base}/teams`, 'Teams', <>{count(s?.teams?.total)}{missing ? <Chip tone="warn">{missing} missing agent config</Chip> : null}</>)}
			{button('runs', `${base}/runs`, 'Runs', <>{count(running, ' running')}{need_you ? <Chip tone="warn">{need_you} need you</Chip> : null}</>)}
			{button('settings', `${base}/settings`, 'Settings')}
			{button('daemons', `${base}/daemons`, 'Daemons', count(online, ' online'))}
		</>
	);

	// Below the overview: one title bar — "{title} in org.realm" — and the section buttons.
	if (data === undefined) {
		return (
			<header className="flex flex-wrap items-center gap-3 border-b border-[var(--g-line)] px-7 py-3" data-testid="realm-header">
				<Link to={`${base}/inbox`} aria-label={`${name} overview`} className="shrink-0"><Team_avatar name={name} size={30} /></Link>
				<h1 className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-[18px] font-semibold tracking-tight">
					{title ? <span className="min-w-0 truncate">{title}</span> : null}
					{title ? <span className="text-[14px] font-normal text-[var(--g-ink-3)]">in</span> : null}
					<Link to={`${base}/inbox`} className={`g-mono hover:underline ${title ? 'text-[14px] font-medium text-[var(--g-ink-2)]' : ''}`} data-testid="realm-name">{org_slug}.{slug}</Link>
				</h1>
				{health ? <Health_badge health={health} /> : null}
				<nav aria-label="Realm sections" className="ml-auto flex flex-wrap items-center justify-end gap-2">{sections}</nav>
			</header>
		);
	}

	return (
		<header className="border-b border-[var(--g-line)] px-7 pb-4 pt-5" data-testid="realm-header">
			<div className="flex flex-wrap items-start gap-4">
				<Team_avatar name={name} size={44} />
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-2.5">
						<h1 className="text-[22px] font-semibold tracking-tight">{name}</h1>
						{health ? <Health_badge health={health} /> : null}
					</div>
					{s?.realm.description
						? <p className="mt-1 max-w-[780px] text-[13px] text-[var(--g-ink-2)]" data-testid="realm-description">{s.realm.description}</p>
						: s?.you.is_admin && d ? <button type="button" onClick={() => set_editing(true)} className="mt-1 text-[13px] text-[var(--g-ink-3)] hover:text-[var(--g-ink)] hover:underline" data-testid="add-description">Add a description</button> : null}
					<p className="mt-1 flex flex-wrap gap-x-2 text-[12px] text-[var(--g-ink-3)]" data-testid="realm-meta">
						<span className="g-mono text-[var(--g-ink-2)]">{org_slug}.{slug}</span>
						{s?.realm.created_by_username ? <span>· created by {s.realm.created_by_username}{s.realm.created_at ? ` ${relative_time(s.realm.created_at)}` : ''}</span> : null}
						{s?.realm.updated_at ? <span>· updated {relative_time(s.realm.updated_at)}</span> : null}
					</p>
				</div>
				{/* Buttons, not tabs: Edit realm, then a way into each part of the realm. */}
				<nav aria-label="Realm sections" className="flex flex-wrap items-center justify-end gap-2">
					{s?.you.is_admin && d ? <button type="button" onClick={() => set_editing(true)} className={ROW_ACTION_CLS}>Edit realm</button> : null}
					{sections}
				</nav>
			</div>
			{editing && d ? <Details_panel realm_id={d.realm.id} name={d.realm.name} description={s?.realm.description ?? null} on_close={() => set_editing(false)} on_saved={async () => { await (reload ? reload() : own.reload()); }} /> : null}
		</header>
	);
}
