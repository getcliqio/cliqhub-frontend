/**
 * Admin › Home (AD1) — is the hub OK, what needs an admin, what admins did.
 * Read: one `POST /v1/admin_home/get` (BFF composes users/orgs/realms/daemons/runs/audit).
 */
import { Link } from 'react-router';
import { RefreshCw } from 'lucide-react';
import { use_bff_read } from '@/lib/use_bff_read';
import { ago, audit_summary, type Admin_home_data } from '@/lib/admin';
import { Admin_header, Avatar, Hub_scope_note, Stat_tile } from '@/components/graphite/g_admin';
import { G_BTN } from '@/components/graphite/g_agents';
import { Blocking_error } from '@/pages/realm/realm_inbox_page';

const fmt = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('en-US'));

function Core_badge({ core }: { core: Admin_home_data['core'] }) {
	if (!core) return <span className="text-[12.5px] text-[var(--g-ink-3)]">Core status unknown</span>;
	const up = core.started_at ? ago(core.started_at) : null;
	return (
		<div className="flex flex-wrap items-center gap-2 text-[12.5px] text-[var(--g-ink-3)]" data-testid="core-badge">
			<span className="g-mono">Core {core.version ?? '?'} · API {core.api_version ?? '?'}</span>
			{core.compatible
				? <span className="rounded-full bg-[var(--g-ok-soft)] px-2 py-0.5 font-semibold text-[var(--g-ok)]">● BFF ↔ Core compatible</span>
				: <span className="rounded-full bg-[var(--g-bad-soft)] px-2 py-0.5 font-semibold text-[var(--g-bad)]" title={core.message ?? ''}>● {core.reachable ? 'Out of sync' : 'Core unreachable'}</span>}
			{up && core.reachable ? <span>up {up}</span> : null}
		</div>
	);
}

export function Component() {
	const read = use_bff_read<Admin_home_data>('/v1/admin_home/get', {}, { refresh_ms: 60_000, fallback_error: 'Could not load the admin home.' });
	const d = read.data;
	const c = d?.counts;
	const dot = { error: 'bg-[var(--g-bad)]', warn: 'bg-[var(--g-warn)]', info: 'bg-[var(--g-ink-3)]' } as const;

	return (
		<div className="flex flex-col gap-5">
			<Admin_header
				title="Hub health"
				sub="Everything across every org. Changes here affect all customers — they’re audited."
				right={<>{d ? <Core_badge core={d.core} /> : null}<button type="button" onClick={() => void read.reload()} aria-label="Refresh" className={G_BTN}><RefreshCw className="h-3.5 w-3.5" /></button></>}
			/>
			{read.status === 'error' && !d ? <Blocking_error http_status={read.http_status} code={read.code} error={read.error} on_retry={() => void read.reload()} what="admin home" /> : null}
			{d?.core && !d.core.compatible && d.core.message ? <p role="alert" className="rounded-lg border border-[var(--g-bad-line)] bg-[var(--g-bad-soft)] px-3.5 py-2.5 text-[12.5px]">{d.core.message}</p> : null}
			{read.status === 'loading' ? <div className="h-[110px] animate-pulse rounded-[10px] bg-[var(--g-panel)]" aria-busy="true" aria-label="Loading" /> : null}
			{c ? (
				<div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
					<Stat_tile label="Accounts" value={fmt(c.accounts)} sub={c.suspended ? `${c.suspended} suspended` : c.admins != null ? `${c.admins} site admin${c.admins === 1 ? '' : 's'}` : undefined} />
					<Stat_tile label="Organizations" value={fmt(c.orgs)} />
					<Stat_tile label="Realms" value={fmt(c.realms)} />
					<Stat_tile label="Daemons online" value={c.daemons ? `${c.daemons.online} / ${c.daemons.total}` : '—'} sub={c.daemons?.offline ? `${c.daemons.offline} offline` : undefined} tone={c.daemons?.offline ? 'warn' : c.daemons ? 'ok' : undefined} />
					<Stat_tile label="Runs · 24h" value={fmt(c.runs_24h?.total)} />
					<Stat_tile label="Failed · 24h" value={fmt(c.runs_24h?.failed)} sub={c.runs_24h?.total ? `${Math.round((c.runs_24h.failed / c.runs_24h.total) * 1000) / 10}%` : undefined} tone={c.runs_24h?.failed ? 'bad' : undefined} />
				</div>
			) : null}
			{d && !d.hub_wide ? <Hub_scope_note what="realms, daemons and runs" /> : null}
			{d?.partial ? <p className="text-[12px] text-[var(--g-warn-text)]">Some numbers couldn’t be loaded; showing what came back.</p> : null}

			{d ? (
				<div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
					<section className="rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)]" aria-label="Needs attention">
						<h2 className="flex items-center gap-2 border-b border-[var(--g-line)] px-4 py-3 text-[14px] font-semibold">Needs attention <span className="g-mono text-[12px] font-normal text-[var(--g-ink-3)]">{d.attention.length}</span></h2>
						{d.attention.length === 0 ? <p className="px-4 py-8 text-center text-[13px] text-[var(--g-ink-3)]">Nothing needs an admin right now.</p> : (
							<ul>{d.attention.map((a) => (
								<li key={a.id} className="flex items-center gap-3 border-b border-[var(--g-line-2)] px-4 py-3 last:border-b-0" data-testid={`attn-${a.id}`}>
									<span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${dot[a.severity]}`} />
									<div className="min-w-0 flex-1"><b className="block text-[13px] font-semibold">{a.title}</b><span className="text-[12.5px] text-[var(--g-ink-3)]">{a.detail}</span></div>
									<Link to={a.href} className={G_BTN}>{a.action}</Link>
								</li>
							))}</ul>
						)}
					</section>
					<section className="rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)]" aria-label="Recent admin activity">
						<h2 className="flex items-center gap-2 border-b border-[var(--g-line)] px-4 py-3 text-[14px] font-semibold">Recent admin activity <span className="text-[12px] font-normal text-[var(--g-ink-3)]">audit log</span></h2>
						{d.recent_audit.length === 0 ? <p className="px-4 py-8 text-center text-[13px] text-[var(--g-ink-3)]">No admin actions yet.</p> : (
							<ul>{d.recent_audit.map((e) => (
								<li key={e.id} className="flex items-center gap-3 border-b border-[var(--g-line-2)] px-4 py-2.5 text-[13px] last:border-b-0">
									<Avatar name={e.admin_username ?? '?'} size={24} />
									<span className="min-w-0 flex-1 truncate"><b>{e.admin_username ?? 'deleted user'}</b> <span className="g-mono text-[12px] text-[var(--g-ink-2)]">{e.action}</span> <span className="text-[var(--g-ink-3)]">{audit_summary(e.details) || `${e.target_type} ${e.target_id.slice(0, 8)}`}</span></span>
									<span className="g-mono shrink-0 text-[11.5px] text-[var(--g-ink-3)]">{ago(e.created_at)}</span>
								</li>
							))}</ul>
						)}
						<Link to="/admin/audit" className="block border-t border-[var(--g-line)] px-4 py-2.5 text-[12.5px] text-[var(--g-acc)]">Full audit log →</Link>
					</section>
				</div>
			) : null}
		</div>
	);
}
