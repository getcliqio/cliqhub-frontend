/**
 * Admin mode building blocks (Graphite): page header, stat tiles, filter chips,
 * tables, avatars and the "not hub-wide yet" note.
 */
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { avatar_color, initials } from '@/lib/admin';
import { G_PILL } from '@/components/graphite/g_agents';

export function Admin_header({ title, sub, right }: { title: string; sub?: ReactNode; right?: ReactNode }) {
	return (
		<div className="flex flex-wrap items-end justify-between gap-3">
			<div>
				<h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
				{sub ? <p className="mt-1 text-[13px] text-[var(--g-ink-3)]">{sub}</p> : null}
			</div>
			{right ? <div className="flex flex-wrap items-center gap-2">{right}</div> : null}
		</div>
	);
}

export function Stat_tile({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'ok' | 'warn' | 'bad' }) {
	const color = tone === 'ok' ? 'var(--g-ok)' : tone === 'warn' ? 'var(--g-warn)' : tone === 'bad' ? 'var(--g-bad)' : 'var(--g-ink)';
	return (
		<div className="rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)] px-4 py-3.5" data-testid={`stat-${label}`}>
			<div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--g-ink-3)]">{label}</div>
			<div className="g-mono mt-1 text-[24px] font-semibold leading-tight" style={{ color }}>{value}</div>
			{sub ? <div className="mt-0.5 text-[12px] text-[var(--g-ink-3)]">{sub}</div> : null}
		</div>
	);
}

export function Chips<K extends string>({ value, options, on_change, label = 'Filter' }: {
	value: K;
	options: Array<{ key: K; label: string; count?: number | null; tone?: 'bad' | 'warn' }>;
	on_change: (k: K) => void;
	label?: string;
}) {
	return (
		<div role="group" aria-label={label} className="flex flex-wrap gap-2">
			{options.map((o) => (
				<button key={o.key} type="button" aria-pressed={value === o.key} onClick={() => on_change(o.key)} className={G_PILL(value === o.key)}>
					{o.label}
					{o.count != null ? <span className={`g-mono text-[11px] ${o.count && o.tone === 'bad' ? 'text-[var(--g-bad)]' : o.count && o.tone === 'warn' ? 'text-[var(--g-warn-text)]' : 'text-[var(--g-ink-3)]'}`}>{o.count}</span> : null}
				</button>
			))}
		</div>
	);
}

export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
	return (
		<span aria-hidden className="grid shrink-0 place-items-center rounded-full font-bold text-[#0c0d0f]" style={{ width: size, height: size, background: avatar_color(name), fontSize: Math.round(size * 0.36) }}>
			{initials(name)}
		</span>
	);
}

export function Pill({ tone, children }: { tone: 'ok' | 'warn' | 'bad' | 'muted' | 'run'; children: ReactNode }) {
	const cls = {
		ok: 'bg-[var(--g-ok-soft)] text-[var(--g-ok)]',
		warn: 'bg-[var(--g-warn-soft)] text-[var(--g-warn-text)]',
		bad: 'bg-[var(--g-bad-soft)] text-[var(--g-bad)]',
		run: 'bg-[var(--g-run-soft)] text-[var(--g-run)]',
		muted: 'bg-[var(--g-soft)] text-[var(--g-ink-3)]',
	}[tone];
	return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${cls}`}>{children}</span>;
}

export const TABLE_WRAP = 'overflow-hidden rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)]';
export const TH = 'px-4 py-2.5 text-left text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[var(--g-ink-3)]';
export const TR = 'border-b border-[var(--g-line-2)] last:border-b-0';

export function Empty_row({ cols, children }: { cols: number; children: ReactNode }) {
	return <tr><td colSpan={cols} className="px-4 py-10 text-center text-[13px] text-[var(--g-ink-3)]">{children}</td></tr>;
}

export function Pager({ total, offset, limit, on_change }: { total: number; offset: number; limit: number; on_change: (offset: number) => void }) {
	if (total <= limit && offset === 0) return null;
	const end = Math.min(offset + limit, total);
	return (
		<div className="flex items-center gap-3 border-t border-[var(--g-line)] px-4 py-2.5 text-[12px] text-[var(--g-ink-3)]">
			<span>{total ? `${offset + 1}–${end} of ${total}` : '0'}</span>
			<button type="button" disabled={offset === 0} onClick={() => on_change(Math.max(0, offset - limit))} className="text-[var(--g-ink-2)] hover:text-[var(--g-ink)] disabled:opacity-30">← Prev</button>
			<button type="button" disabled={end >= total} onClick={() => on_change(offset + limit)} className="text-[var(--g-acc)] disabled:opacity-30">Next →</button>
		</div>
	);
}

/** Shown when Core still limits site admins to their own memberships (Core API < 3). */
export function Hub_scope_note({ what }: { what: string }) {
	return (
		<p role="note" data-testid="hub-scope-note" className="rounded-lg border border-[var(--g-line)] bg-[var(--g-soft)] px-3.5 py-2.5 text-[12.5px] text-[var(--g-ink-3)]">
			Showing only {what} in orgs you’re a member of. Hub-wide {what} need Core API 3 (<span className="g-mono">all: true</span> for site admins) — restart Core once that change is in.
		</p>
	);
}

export function Banner({ tone, children }: { tone: 'bad' | 'warn' | 'ok'; children: ReactNode }) {
	const cls = tone === 'bad' ? 'border-[var(--g-bad-line)] bg-[var(--g-bad-soft)]' : tone === 'warn' ? 'border-[rgba(255,178,36,.4)] bg-[var(--g-warn-soft)]' : 'border-[rgba(62,207,142,.35)] bg-[var(--g-ok-soft)]';
	return <div role={tone === 'ok' ? 'status' : 'alert'} className={`rounded-[10px] border px-4 py-2.5 text-[13px] ${cls}`}>{children}</div>;
}

/** URL state for admin list pages: `get(key)`, and `set(patch)` which drops empty keys (and the offset unless it's in the patch). */
export function use_list_params() {
	const [sp, set_sp] = useSearchParams();
	const set = (patch: Record<string, string | null>) => {
		const n = new URLSearchParams(sp);
		if (!('offset' in patch)) n.delete('offset');
		for (const [k, v] of Object.entries(patch)) { if (!v) n.delete(k); else n.set(k, v); }
		set_sp(n, { replace: true });
	};
	return { get: (k: string) => sp.get(k) ?? '', offset: Number(sp.get('offset') ?? 0) || 0, set };
}

/** Comma list with "+N" past `max`; a dash when empty. */
export function Few({ items, max = 2, mono = true }: { items: string[]; max?: number; mono?: boolean }) {
	if (!items.length) return <span className="text-[var(--g-ink-3)]">—</span>;
	return <span className={mono ? 'g-mono text-[12px]' : ''} title={items.join(', ')}>{items.slice(0, max).join(', ')}{items.length > max ? ` +${items.length - max}` : ''}</span>;
}
