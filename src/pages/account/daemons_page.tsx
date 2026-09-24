import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate, useOutletContext, useSearchParams } from 'react-router';
import { useOrgFetch } from '@/lib/org_context';
import { ApiErrorBanner } from '@/components/ui/api_error';
import { PageHeader } from '@/components/ui/page_header';
import { Pagination, PAGE_LIMIT, PAGE_SIZE_OPTIONS } from '@/components/pagination';
import { PAGE_HELP } from '@/lib/page_help';
import { use_poll } from '@/lib/use_poll';
import { Cpu } from 'lucide-react';
import type { Realm_outlet_context } from '@/layouts/realm_layout';
import { realm_qualified_label } from '@/lib/realm_url';

interface DaemonRow {
	id: string;
	name: string | null;
	user_id: string | null;
	user_email: string | null;
	hostname: string | null;
	ip: string | null;
	port: number | null;
	public_url: string | null;
	status: 'online' | 'stale' | 'offline';
	last_heartbeat: number | null;
	capacity: number;
	created_at: number | string;
	last_registered_at: number | string;
	workspace_count?: number;
	active_run_count?: number;
}

function status_badge(status: DaemonRow['status']): { classes: string; label: string } {
	if (status === 'online') {
		return { classes: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300', label: 'online' };
	}
	if (status === 'stale') {
		return { classes: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300', label: 'stale' };
	}
	return { classes: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400', label: 'offline' };
}

function format_heartbeat(ts: number | string | null): string {
	if (ts === null || ts === undefined) return 'never';
	const n = typeof ts === 'number' ? ts : Number(ts);
	if (!Number.isFinite(n) || n <= 0) return 'never';
	const age_s = Math.max(0, Math.floor((Date.now() - n) / 1000));
	if (age_s < 60) return `${age_s}s ago`;
	if (age_s < 3600) return `${Math.floor(age_s / 60)}m ago`;
	if (age_s < 86400) return `${Math.floor(age_s / 3600)}h ago`;
	return `${Math.floor(age_s / 86400)}d ago`;
}

function Daemon_row({
	daemon,
	base_path,
	confirm_remove,
	removing_id,
	on_confirm_remove,
	on_cancel_remove,
	on_remove,
}: {
	daemon: DaemonRow;
	base_path: string;
	confirm_remove: string | null;
	removing_id: string | null;
	on_confirm_remove: (id: string) => void;
	on_cancel_remove: () => void;
	on_remove: (id: string) => void;
}) {
	const navigate = useNavigate();
	const label = daemon.name || daemon.hostname || daemon.id;
	const badge = status_badge(daemon.status);
	const detail_path = `${base_path}/daemons/${daemon.id}`;

	return (
		<tr
			className="cursor-pointer transition hover:bg-slate-50 dark:hover:bg-slate-800/50"
			onClick={() => navigate(detail_path)}
			onKeyDown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					navigate(detail_path);
				}
			}}
			tabIndex={0}
			role="link"
			aria-label={`Open daemon ${label}`}
		>
			<td className="px-4 py-3">
				<p className="font-mono text-sm font-semibold text-slate-800 dark:text-slate-100">{label}</p>
				<p className="mt-0.5 font-mono text-[10px] text-slate-400">{daemon.id}</p>
			</td>
			<td className="px-4 py-3">
				<span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge.classes}`}>
					{badge.label}
				</span>
			</td>
			<td className="px-4 py-3 text-xs text-slate-500">{format_heartbeat(daemon.last_heartbeat)}</td>
			<td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
				{daemon.workspace_count ?? '—'}
			</td>
			<td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
				{daemon.active_run_count ?? '—'}
			</td>
			<td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
				{daemon.status !== 'stale' ? (
					<span className="text-[11px] text-slate-300">—</span>
				) : null}
				{daemon.status === 'stale' && confirm_remove === daemon.id ? (
					<span className="inline-flex items-center gap-2">
						<button
							type="button"
							onClick={() => on_remove(daemon.id)}
							disabled={removing_id === daemon.id}
							className="text-[11px] font-semibold text-red-600 hover:underline disabled:opacity-50"
						>
							{removing_id === daemon.id ? 'Removing…' : 'Confirm'}
						</button>
						<button
							type="button"
							onClick={on_cancel_remove}
							className="text-[11px] font-semibold text-slate-400 hover:underline"
						>
							Cancel
						</button>
					</span>
				) : null}
				{daemon.status === 'stale' && confirm_remove !== daemon.id ? (
					<button
						type="button"
						onClick={() => on_confirm_remove(daemon.id)}
						className="text-[11px] font-semibold text-slate-400 hover:text-red-600"
					>
						Remove
					</button>
				) : null}
			</td>
		</tr>
	);
}

export function Component() {
	const { realm, org_slug, base_path } = useOutletContext<Realm_outlet_context>();
	const auth_fetch = useOrgFetch();
	const [search_params, set_search_params] = useSearchParams();
	const offset = Math.max(0, Number(search_params.get('offset') ?? '0') || 0);
	const limit_raw = Number(search_params.get('limit') ?? '');
	const page_size = (PAGE_SIZE_OPTIONS as readonly number[]).includes(limit_raw)
		? limit_raw
		: PAGE_LIMIT;

	const [daemons, set_daemons] = useState<DaemonRow[]>([]);
	const [total, set_total] = useState(0);
	const [loading, set_loading] = useState(true);
	const [error, set_error] = useState<string | null>(null);
	const [removing_id, set_removing_id] = useState<string | null>(null);
	const [confirm_remove, set_confirm_remove] = useState<string | null>(null);

	const load = useCallback(async () => {
		set_loading(true);
		try {
			const res = await auth_fetch('/v1/daemons/get', {
				method: 'POST',
				body: JSON.stringify({
					realm_id: realm.id,
					limit: page_size,
					offset,
				}),
			});
			const data = await res.json();
			if (data.ok) {
				const active = (data.daemons ?? []).filter(
					(d: DaemonRow) => d.status === 'online' || d.status === 'stale',
				);
				set_daemons(active);
				set_total(Number(data.total ?? active.length));
				set_error(null);
				return;
			}
			set_error(typeof data.error === 'string' ? data.error : data.error?.message ?? 'Request failed');
		} catch {
			set_error('Failed to load daemons');
		} finally {
			set_loading(false);
		}
	}, [auth_fetch, realm.id, offset, page_size]);

	useEffect(() => {
		void load();
	}, [load]);

	use_poll(() => void load(), 15_000, !loading);

	function set_offset(next_offset: number) {
		const next = new URLSearchParams(search_params);
		if (next_offset <= 0) next.delete('offset');
		else next.set('offset', String(next_offset));
		set_search_params(next, { replace: true });
	}

	function set_page_size(next_size: number) {
		const next = new URLSearchParams(search_params);
		next.delete('offset');
		if (next_size === PAGE_LIMIT) next.delete('limit');
		else next.set('limit', String(next_size));
		set_search_params(next, { replace: true });
	}

	async function handle_remove(daemon_id: string) {
		set_removing_id(daemon_id);
		set_error(null);
		try {
			const res = await auth_fetch('/v1/daemons/remove', {
				method: 'POST',
				body: JSON.stringify({ daemon_id }),
			});
			const data = await res.json();
			if (!data.ok) {
				set_error(typeof data.error === 'string' ? data.error : data.error?.message ?? 'Remove failed');
				return;
			}
			set_daemons((prev) => prev.filter((d) => d.id !== daemon_id));
			set_total((t) => Math.max(0, t - 1));
		} catch {
			set_error('Failed to remove daemon');
		} finally {
			set_removing_id(null);
			set_confirm_remove(null);
		}
	}

	if (loading && daemons.length === 0) {
		return (
			<div className="flex min-h-[40vh] items-center justify-center">
				<p className="text-sm text-slate-400">Loading daemons...</p>
			</div>
		);
	}

	return (
		<div>
			<PageHeader
				icon={Cpu}
				title="Daemons"
				description={
					<>
						Active daemons in <span className="font-mono">{realm_qualified_label(org_slug, realm.slug)}</span>
						{' '}— click a row for workspaces, teams, and runs.
					</>
				}
				help={PAGE_HELP.daemons.help}
				docs_href={PAGE_HELP.daemons.docs_href}
				actions={(
					<button
						type="button"
						onClick={() => void load()}
						className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
					>
						Refresh
					</button>
				)}
			/>

			<ApiErrorBanner error={error} onDismiss={() => set_error(null)} />

			{daemons.length === 0 ? (
				<div className="rounded-xl border-2 border-dashed border-slate-200 py-12 text-center dark:border-slate-700">
					<p className="text-slate-400">No active daemons in this realm.</p>
					<p className="mt-2 text-xs text-slate-400">
						Enroll a daemon from{' '}
						<Link to={`${base_path}/settings/security/tokens`} className="text-indigo-600 hover:underline">
							Security → Tokens
						</Link>
						{' '}by minting a realm token.
					</p>
				</div>
			) : (
				<div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
					<table className="w-full min-w-[40rem] text-sm">
						<thead>
							<tr className="border-b border-slate-100 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:border-slate-800">
								<th className="px-4 py-2">Daemon</th>
								<th className="px-4 py-2">Status</th>
								<th className="px-4 py-2">Heartbeat</th>
								<th className="px-4 py-2">Workspaces</th>
								<th className="px-4 py-2">Active runs</th>
								<th className="px-4 py-2 text-right">Actions</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-slate-50 dark:divide-slate-800">
							{daemons.map((d) => (
								<Daemon_row
									key={d.id}
									daemon={d}
									base_path={base_path}
									confirm_remove={confirm_remove}
									removing_id={removing_id}
									on_confirm_remove={set_confirm_remove}
									on_cancel_remove={() => set_confirm_remove(null)}
									on_remove={(id) => void handle_remove(id)}
								/>
							))}
						</tbody>
					</table>
				</div>
			)}
			<Pagination
				total={total}
				offset={offset}
				limit={page_size}
				on_change={set_offset}
				on_limit_change={set_page_size}
				label="daemons"
			/>
		</div>
	);
}
