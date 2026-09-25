import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';

import { useOrgFetch } from '@/lib/org_context';
import { use_poll } from '@/lib/use_poll';

export interface Run_span {
	span_id: string;
	trace_id: string;
	parent_span_id: string | null;
	run_id: string;
	name: string;
	kind: string;
	status_code: 'OK' | 'ERROR' | 'UNSET' | string;
	status_message: string | null;
	start_unix_nano: string;
	end_unix_nano: string;
	duration_ms: number;
	attributes: Record<string, unknown>;
	events: Array<{ name: string; time_unix_nano: string; attributes: Record<string, unknown> }>;
	daemon_id: string | null;
	realm_id: string | null;
	created_at: number;
}

interface Run_timeline_panel_props {
	run_id: string;
	/** Poll while the run is still live. */
	live?: boolean;
}

interface Timeline_row {
	span: Run_span;
	depth: number;
	start_ms: number;
	end_ms: number;
	children: Timeline_row[];
}

/**
 * OTEL span waterfall for a single run. Fetched via
 * `/v1/runs/get_telemetry` (`kind: spans`); poll cadence matches the run's log/phase
 * refresh so live runs animate in place.
 */
export function Run_timeline_panel({ run_id, live }: Run_timeline_panel_props) {
	const auth_fetch = useOrgFetch();
	const [spans, set_spans] = useState<Run_span[]>([]);
	const [selected, set_selected] = useState<Run_span | null>(null);
	const [collapsed, set_collapsed] = useState<Set<string>>(new Set());
	const [loading, set_loading] = useState(true);
	const [error, set_error] = useState<string | null>(null);

	const load = useCallback(async (opts?: { silent?: boolean }) => {
		if (!opts?.silent) set_loading(true);
		try {
			const res = await auth_fetch('/v1/runs/get_telemetry', {
				method: 'POST',
				body: JSON.stringify({ kind: 'spans', run_id }),
			});
			const body = await res.json() as {
				ok?: boolean;
				data?: Run_span[];
				spans?: Run_span[];
				error?: unknown;
			};
			if (!body.ok) {
				set_error(typeof body.error === 'string' ? body.error : 'Failed to load timeline');
				return;
			}
			// TEL-ENV — spans array is `data` (flat `spans` is deploy fallback).
			const spans_payload = Array.isArray(body.data) ? body.data : (body.spans ?? []);
			set_spans(spans_payload as Run_span[]);
			set_error(null);
		} catch {
			if (!opts?.silent) set_error('Failed to load timeline');
		} finally {
			if (!opts?.silent) set_loading(false);
		}
	}, [auth_fetch, run_id]);

	useEffect(() => { void load(); }, [load]);
	use_poll(() => void load({ silent: true }), live ? 3_000 : 15_000, !loading);

	const { rows, window_start, window_end } = useMemo(() => build_timeline(spans), [spans]);

	if (loading) {
		return (
			<section className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">
				Loading timeline…
			</section>
		);
	}

	if (spans.length === 0) {
		return (
			<section className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">
				{error ?? 'No spans emitted yet for this run.'}
			</section>
		);
	}

	const total_ms = Math.max(1, window_end - window_start);

	return (
		<section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
			<div className="flex items-center justify-between border-b border-slate-100 bg-white px-4 py-2.5 dark:border-slate-800 dark:bg-slate-900">
				<div className="flex items-center gap-3 text-xs text-slate-500">
					<span className="font-semibold uppercase tracking-wider text-slate-400">Timeline</span>
					<span>{spans.length} span{spans.length === 1 ? '' : 's'}</span>
					<span>·</span>
					<span>{format_ms(total_ms)} total</span>
				</div>
				{error ? <span className="text-xs text-rose-500">{error}</span> : null}
			</div>

			<div className="flex min-h-0 flex-1 overflow-auto">
				<div className="flex-1 min-w-0 divide-y divide-slate-100 dark:divide-slate-800">
					{flatten_rows(rows, collapsed).map((row) => (
						<Timeline_row_view
							key={row.span.span_id}
							row={row}
							window_start={window_start}
							total_ms={total_ms}
							selected={selected?.span_id === row.span.span_id}
							collapsed={collapsed.has(row.span.span_id)}
							has_children={row.children.length > 0}
							on_toggle={() => toggle(collapsed, set_collapsed, row.span.span_id)}
							on_select={() => set_selected(row.span)}
						/>
					))}
				</div>
				{selected ? (
					<aside className="w-80 shrink-0 border-l border-slate-100 bg-slate-50/40 p-4 dark:border-slate-800 dark:bg-slate-950/40">
						<Timeline_attribute_drawer
							span={selected}
							on_close={() => set_selected(null)}
						/>
					</aside>
				) : null}
			</div>
		</section>
	);
}

function Timeline_row_view({
	row,
	window_start,
	total_ms,
	selected,
	collapsed,
	has_children,
	on_toggle,
	on_select,
}: {
	row: Timeline_row;
	window_start: number;
	total_ms: number;
	selected: boolean;
	collapsed: boolean;
	has_children: boolean;
	on_toggle: () => void;
	on_select: () => void;
}) {
	const left_pct = clamp_pct(((row.start_ms - window_start) / total_ms) * 100);
	const width_pct = clamp_pct(Math.max(0.5, ((row.end_ms - row.start_ms) / total_ms) * 100));
	const bar_class = status_bar_class(row.span.status_code);
	const agent = string_attr(row.span.attributes['agent.name']) ?? nested_agent_name(row.span.attributes.agent);

	return (
		<button
			type="button"
			onClick={on_select}
			className={
				'grid w-full grid-cols-[minmax(0,1fr)_2fr] items-center gap-3 px-3 py-2 text-left transition '
				+ (selected ? 'bg-indigo-50 dark:bg-indigo-950/40' : 'hover:bg-slate-50 dark:hover:bg-slate-800/40')
			}
		>
			<div className="flex min-w-0 items-center gap-1.5">
				<span
					className="shrink-0"
					style={{ marginLeft: `${row.depth * 12}px` }}
				>
					{has_children ? (
						<span
							onClick={(e) => { e.stopPropagation(); on_toggle(); }}
							className="inline-flex h-4 w-4 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
						>
							{collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
						</span>
					) : (
						<span className="inline-block h-4 w-4" />
					)}
				</span>
				<span
					className={
						'shrink-0 rounded px-1 text-[10px] font-semibold uppercase tracking-wider '
						+ status_pill_class(row.span.status_code)
					}
					title={row.span.status_message ?? row.span.status_code}
				>
					{status_short(row.span.status_code)}
				</span>
				<span className="min-w-0 truncate font-mono text-xs text-slate-800 dark:text-slate-200">
					{row.span.name}
				</span>
				{agent ? (
					<span className="shrink-0 truncate text-[11px] text-slate-400" title={agent}>
						{agent}
					</span>
				) : null}
			</div>
			<div className="relative h-4">
				<div className="absolute inset-0 rounded bg-slate-100/60 dark:bg-slate-800/40" />
				<div
					className={`absolute top-0 h-4 rounded ${bar_class}`}
					style={{ left: `${left_pct}%`, width: `${width_pct}%` }}
					title={`${format_ms(row.end_ms - row.start_ms)} · ${row.span.name}`}
				/>
				<span className="absolute right-1 top-0 text-[10px] leading-4 text-slate-500">
					{format_ms(row.end_ms - row.start_ms)}
				</span>
			</div>
		</button>
	);
}

function Timeline_attribute_drawer({
	span,
	on_close,
}: {
	span: Run_span;
	on_close: () => void;
}) {
	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0">
					<p className="truncate font-mono text-sm font-semibold text-slate-800 dark:text-slate-200">
						{span.name}
					</p>
					<p className="mt-0.5 text-xs text-slate-500">
						{format_ms(span.duration_ms)} · {span.kind} · {span.status_code}
					</p>
				</div>
				<button
					type="button"
					onClick={on_close}
					className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
					aria-label="Close details"
				>
					×
				</button>
			</div>
			<dl className="mt-3 space-y-2 text-xs">
				<div>
					<dt className="font-semibold uppercase tracking-wider text-slate-400">Span ID</dt>
					<dd className="mt-0.5 select-all break-all font-mono text-slate-700 dark:text-slate-300">
						{span.span_id}
					</dd>
				</div>
				<div>
					<dt className="font-semibold uppercase tracking-wider text-slate-400">Trace ID</dt>
					<dd className="mt-0.5 select-all break-all font-mono text-slate-700 dark:text-slate-300">
						{span.trace_id}
					</dd>
				</div>
				{span.parent_span_id ? (
					<div>
						<dt className="font-semibold uppercase tracking-wider text-slate-400">Parent</dt>
						<dd className="mt-0.5 select-all break-all font-mono text-slate-700 dark:text-slate-300">
							{span.parent_span_id}
						</dd>
					</div>
				) : null}
				{span.status_message ? (
					<div>
						<dt className="font-semibold uppercase tracking-wider text-slate-400">Status message</dt>
						<dd className="mt-0.5 whitespace-pre-wrap break-words text-slate-700 dark:text-slate-300">
							{span.status_message}
						</dd>
					</div>
				) : null}
				<div>
					<dt className="font-semibold uppercase tracking-wider text-slate-400">Attributes</dt>
					<dd className="mt-0.5">
						<pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md bg-white p-2 font-mono text-[11px] leading-relaxed text-slate-700 dark:bg-slate-900 dark:text-slate-300">
							{JSON.stringify(span.attributes ?? {}, null, 2)}
						</pre>
					</dd>
				</div>
				{span.events?.length ? (
					<div>
						<dt className="font-semibold uppercase tracking-wider text-slate-400">Events</dt>
						<dd className="mt-0.5">
							<pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-white p-2 font-mono text-[11px] leading-relaxed text-slate-700 dark:bg-slate-900 dark:text-slate-300">
								{JSON.stringify(span.events, null, 2)}
							</pre>
						</dd>
					</div>
				) : null}
			</dl>
		</div>
	);
}

function build_timeline(spans: Run_span[]): {
	rows: Timeline_row[];
	window_start: number;
	window_end: number;
} {
	if (spans.length === 0) return { rows: [], window_start: 0, window_end: 1 };

	const enriched = spans.map((span) => ({
		span,
		start_ms: nano_to_ms(span.start_unix_nano),
		end_ms: nano_to_ms(span.end_unix_nano),
	}));

	let window_start = Number.MAX_SAFE_INTEGER;
	let window_end = 0;
	for (const s of enriched) {
		if (s.start_ms < window_start) window_start = s.start_ms;
		if (s.end_ms > window_end) window_end = s.end_ms;
	}
	if (window_end <= window_start) window_end = window_start + 1;

	const by_id = new Map<string, Timeline_row>();
	for (const s of enriched) {
		by_id.set(s.span.span_id, {
			span: s.span,
			depth: 0,
			start_ms: s.start_ms,
			end_ms: s.end_ms,
			children: [],
		});
	}

	const roots: Timeline_row[] = [];
	for (const row of by_id.values()) {
		const parent_id = row.span.parent_span_id;
		if (parent_id && by_id.has(parent_id)) {
			by_id.get(parent_id)!.children.push(row);
			continue;
		}
		roots.push(row);
	}

	const sort_recursive = (list: Timeline_row[], depth: number): void => {
		list.sort((a, b) => a.start_ms - b.start_ms);
		for (const item of list) {
			item.depth = depth;
			sort_recursive(item.children, depth + 1);
		}
	};
	sort_recursive(roots, 0);

	return { rows: roots, window_start, window_end };
}

function flatten_rows(rows: Timeline_row[], collapsed: Set<string>): Timeline_row[] {
	const out: Timeline_row[] = [];
	const walk = (list: Timeline_row[]): void => {
		for (const row of list) {
			out.push(row);
			if (collapsed.has(row.span.span_id)) continue;
			if (row.children.length) walk(row.children);
		}
	};
	walk(rows);
	return out;
}

function toggle(
	collapsed: Set<string>,
	set_collapsed: (next: Set<string>) => void,
	span_id: string,
): void {
	const next = new Set(collapsed);
	if (next.has(span_id)) next.delete(span_id);
	else next.add(span_id);
	set_collapsed(next);
}

function nano_to_ms(nano: string): number {
	try {
		return Number(BigInt(nano) / 1_000_000n);
	} catch {
		return 0;
	}
}

function clamp_pct(v: number): number {
	if (!Number.isFinite(v)) return 0;
	if (v < 0) return 0;
	if (v > 100) return 100;
	return v;
}

function format_ms(ms: number): string {
	if (!Number.isFinite(ms) || ms <= 0) return '0ms';
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	const mins = Math.floor(ms / 60_000);
	const secs = Math.floor((ms % 60_000) / 1000);
	return `${mins}m ${secs}s`;
}

function status_bar_class(code: string): string {
	if (code === 'ERROR') return 'bg-rose-400';
	if (code === 'OK') return 'bg-emerald-400';
	return 'bg-sky-400';
}

function status_pill_class(code: string): string {
	if (code === 'ERROR') return 'bg-rose-100 text-rose-700';
	if (code === 'OK') return 'bg-emerald-100 text-emerald-700';
	return 'bg-sky-100 text-sky-700';
}

function status_short(code: string): string {
	if (code === 'ERROR') return 'ERR';
	if (code === 'OK') return 'OK';
	return 'RUN';
}

function string_attr(raw: unknown): string | null {
	if (typeof raw !== 'string') return null;
	const trimmed = raw.trim();
	return trimmed || null;
}

function nested_agent_name(raw: unknown): string | null {
	if (!raw || typeof raw !== 'object') return null;
	const value = (raw as { name?: unknown }).name;
	return string_attr(value);
}
