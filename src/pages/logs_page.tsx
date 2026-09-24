import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useOutletContext } from 'react-router';
import { useOrgFetch } from '@/lib/org_context';
import { ApiErrorBanner } from '@/components/ui/api_error';
import { PageHeader } from '@/components/ui/page_header';
import { PAGE_HELP } from '@/lib/page_help';
import { Pagination } from '@/components/pagination';
import { Explorer_shell } from '@/components/explorer/explorer_shell';
import { Facet_sidebar, type Facet_group } from '@/components/explorer/facet_sidebar';
import {
	EXPLORER_PAGE_LIMIT,
	set_to_csv,
	use_explorer_params,
} from '@/components/explorer/use_explorer_params';
import { ScrollText } from 'lucide-react';
import type { Realm_outlet_context } from '@/layouts/realm_layout';
import { realm_qualified_label } from '@/lib/realm_url';

interface Log_line {
	id: string;
	run_id: string;
	run_name: string | null;
	created_at: number;
	level: string;
	message: string;
	daemon_id: string | null;
	daemon_name: string | null;
	workspace_id: string | null;
	workspace_name: string | null;
	team: string | null;
	concern: string | null;
}

interface Facet_bucket {
	value: string;
	label?: string;
	count: number;
}

const FACET_KEYS = ['level', 'concern', 'daemon_id', 'team', 'run_id', 'workspace_id'] as const;

function api_error_message(data: { error?: string | { message?: string } }): string {
	if (typeof data.error === 'string') return data.error;
	return data.error?.message ?? 'Request failed';
}

function level_class(level: string): string {
	if (level === 'error') return 'text-red-600';
	if (level === 'warn') return 'text-amber-600';
	if (level === 'debug') return 'text-slate-400';
	return 'text-sky-700';
}

function format_ts(ms: number): string {
	try {
		return new Date(ms).toLocaleTimeString();
	} catch {
		return String(ms);
	}
}

function short_id(id: string): string {
	if (id.length <= 8) return id;
	return `${id.slice(0, 8)}…`;
}

function name_with_id(name: string | null | undefined, id: string): string {
	const n = name?.trim();
	if (n) return `${n} (${short_id(id)})`;
	return short_id(id);
}

export function Component() {
	const { realm, org_slug, base_path } = useOutletContext<Realm_outlet_context>();
	const auth_fetch = useOrgFetch();
	const explorer = use_explorer_params(FACET_KEYS);

	const [query_draft, set_query_draft] = useState(explorer.q);
	const [lines, set_lines] = useState<Log_line[]>([]);
	const [total, set_total] = useState(0);
	const [facet_data, set_facet_data] = useState<Record<string, Facet_bucket[]>>({});
	const [loading, set_loading] = useState(true);
	const [refreshing, set_refreshing] = useState(false);
	const [error, set_error] = useState<string | null>(null);
	const has_loaded_ref = useRef(false);
	const request_seq = useRef(0);

	const facets_key = useMemo(
		() => FACET_KEYS.map((key) => `${key}=${set_to_csv(explorer.facets[key] ?? new Set())}`).join('&'),
		[explorer.facets],
	);

	useEffect(() => {
		set_query_draft(explorer.q);
	}, [explorer.q]);

	const load = useCallback(async (opts?: { soft?: boolean }) => {
		const soft = opts?.soft === true && has_loaded_ref.current;
		const seq = ++request_seq.current;
		if (soft) set_refreshing(true);
		else set_loading(true);

		try {
			const body: Record<string, unknown> = {
				realm_id: realm.id,
				limit: EXPLORER_PAGE_LIMIT,
				offset: explorer.offset,
			};
			if (explorer.q.trim()) body.q = explorer.q.trim();
			if (explorer.since_ms != null) body.since_ms = explorer.since_ms;
			for (const key of FACET_KEYS) {
				const vals = [...(explorer.facets[key] ?? [])];
				if (vals.length === 0) continue;
				if (key === 'level') body.levels = vals;
				if (key === 'concern') body.concerns = vals;
				if (key === 'daemon_id') body.daemon_ids = vals;
				if (key === 'team') body.teams = vals;
				if (key === 'run_id') body.run_ids = vals;
				if (key === 'workspace_id') body.workspace_ids = vals;
			}

			const res = await auth_fetch('/v1/runs/get_logs', {
				method: 'POST',
				body: JSON.stringify(body),
			});
			const data = await res.json();
			if (seq !== request_seq.current) return;

			if (!data.ok) {
				set_error(api_error_message(data));
				if (!soft) {
					set_lines([]);
					set_total(0);
				}
				return;
			}
			set_lines((data.lines ?? []) as Log_line[]);
			set_total(Number(data.total ?? 0));
			set_facet_data((data.facets ?? {}) as Record<string, Facet_bucket[]>);
			set_error(null);
			has_loaded_ref.current = true;
		} catch {
			if (seq !== request_seq.current) return;
			set_error('Failed to load logs');
			if (!soft) {
				set_lines([]);
				set_total(0);
			}
		} finally {
			if (seq !== request_seq.current) return;
			set_loading(false);
			set_refreshing(false);
		}
	}, [
		auth_fetch,
		realm.id,
		explorer.q,
		explorer.offset,
		explorer.since_ms,
		facets_key,
		explorer.facets,
	]);

	useEffect(() => {
		void load({ soft: false });
	}, [load]);

	useEffect(() => {
		if (!explorer.live) return;
		const timer = setInterval(() => { void load({ soft: true }); }, 4000);
		return () => clearInterval(timer);
	}, [explorer.live, load]);

	const realm_label = name_with_id(realm_qualified_label(org_slug, realm.slug), realm.id);

	const facet_groups: Facet_group[] = useMemo(() => ([
		{
			key: 'realm',
			title: 'Realm',
			options: [{ value: realm.id, label: realm_label, count: total }],
		},
		{
			key: 'level',
			title: 'Status',
			options: (facet_data.level ?? []).map((b) => ({ value: b.value, count: b.count })),
		},
		{
			key: 'concern',
			title: 'Concern',
			options: (facet_data.concern ?? []).map((b) => ({ value: b.value, count: b.count })),
		},
		{
			key: 'daemon_id',
			title: 'Daemon',
			options: (facet_data.daemon_id ?? []).map((b) => ({
				value: b.value,
				label: b.label ?? short_id(b.value),
				count: b.count,
			})),
		},
		{
			key: 'team',
			title: 'Team',
			options: (facet_data.team ?? []).map((b) => ({ value: b.value, count: b.count })),
		},
		{
			key: 'run_id',
			title: 'Run',
			options: (facet_data.run_id ?? []).map((b) => ({
				value: b.value,
				label: b.label ?? short_id(b.value),
				count: b.count,
			})),
		},
		{
			key: 'workspace_id',
			title: 'Workspace',
			options: (facet_data.workspace_id ?? []).map((b) => ({
				value: b.value,
				label: b.label ?? short_id(b.value),
				count: b.count,
			})),
		},
	]), [facet_data, realm.id, realm_label, total]);

	const show_empty = !loading && lines.length === 0;

	return (
		<div>
			<PageHeader
				icon={ScrollText}
				tone="sky"
				title="Logs"
				description={(
					<>
						Searchable run output for <span className="font-mono">{realm.slug}</span>.
						Enable{' '}
						<code className="rounded bg-slate-100 px-1 text-xs">hub_connect.sync</code>
						{' '}and{' '}
						<code className="rounded bg-slate-100 px-1 text-xs">hub_connect.sync_logs</code>
						{' '}on the daemon to mirror logs here.
					</>
				)}
				help={PAGE_HELP.logs.help}
				docs_href={PAGE_HELP.logs.docs_href}
			/>

			<ApiErrorBanner error={error} onDismiss={() => set_error(null)} />

			<Explorer_shell
				query={query_draft}
				on_query_change={set_query_draft}
				on_submit_query={(value) => explorer.set_q(value)}
				query_placeholder="Search log messages…"
				time={explorer.time}
				on_time_change={explorer.set_time}
				live={explorer.live}
				on_live_change={explorer.set_live}
				on_refresh={() => void load({ soft: true })}
				sidebar={(
					<Facet_sidebar
						groups={facet_groups}
						selected={{ ...explorer.facets, realm: new Set([realm.id]) }}
						on_toggle={(key, value) => {
							if (key === 'realm') return;
							explorer.toggle_facet(key, value);
						}}
						on_clear={(key) => {
							if (key === 'realm') return;
							explorer.clear_facet(key);
						}}
					/>
				)}
			>
				<div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
					<div className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500">
						<strong className="text-slate-800">{total}</strong> matching lines
						<span className="text-slate-400"> · {realm_label}</span>
						{loading ? ' · loading…' : ''}
						{refreshing ? ' · refreshing…' : ''}
					</div>
					{show_empty ? (
						<div className="px-4 py-12 text-center text-sm text-slate-500">
							No log lines match. If runs exist locally but not here, turn on{' '}
							<code className="rounded bg-slate-100 px-1 text-xs">hub_connect.sync_logs</code>
							{' '}and start a new run.
						</div>
					) : (
						<ul className="max-h-[65vh] divide-y divide-slate-100 overflow-auto font-mono text-[11px]">
							{loading && lines.length === 0 ? (
								<li className="px-4 py-8 text-center text-slate-500">Loading logs…</li>
							) : (
								lines.map((line) => (
									<li key={line.id} className="flex gap-3 px-4 py-1.5 hover:bg-slate-50">
										<span className="shrink-0 text-slate-400">{format_ts(line.created_at)}</span>
										<span className={`w-12 shrink-0 uppercase ${level_class(line.level)}`}>
											{line.level}
										</span>
										<span className="min-w-0 flex-1 break-all text-slate-800">{line.message}</span>
										{line.daemon_id ? (
											<span
												className="hidden max-w-[10rem] shrink-0 truncate text-slate-400 lg:inline"
												title={line.daemon_id}
											>
												{name_with_id(line.daemon_name, line.daemon_id)}
											</span>
										) : null}
										<Link
											to={`${base_path}/runs/${line.run_id}`}
											className="shrink-0 text-indigo-600 hover:underline"
											title={line.run_id}
										>
											{name_with_id(line.run_name, line.run_id)}
										</Link>
									</li>
								))
							)}
						</ul>
					)}
				</div>
				<Pagination
					total={total}
					offset={explorer.offset}
					limit={EXPLORER_PAGE_LIMIT}
					on_change={explorer.set_offset}
				/>
			</Explorer_shell>
		</div>
	);
}
