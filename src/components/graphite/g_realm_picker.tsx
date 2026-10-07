/**
 * Realm picker — search as you type, 20 at a time, "Show more" to page.
 *
 * Backed by Core `POST /v1/realms/get { org_id?, query, limit, offset }`
 * (one existing route; no list of every realm is ever loaded up front).
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Lock, Search } from 'lucide-react';
import { useAuthFetch } from '@/lib/auth_context';

export interface Picked_realm {
	id: string;
	slug: string;
	org_slug: string | null;
}

type Row = { id: string; slug: string; name: string; org_slug: string | null };

export const REALM_PAGE = 20;

export function Realm_picker({ org_id, value, on_change, blocked, label = 'Realm', placeholder = 'Choose a realm…', show_org = false }: {
	/** Limit to one org; omit to search every org you belong to. */
	org_id?: string | null;
	value: Picked_realm | null;
	on_change: (r: Picked_realm) => void;
	/** Return a reason to show the realm locked (e.g. "view only"). */
	blocked?: (realm_id: string) => string | null;
	label?: string;
	placeholder?: string;
	show_org?: boolean;
}) {
	const auth_fetch = useAuthFetch();
	const [open, set_open] = useState(false);
	const [q, set_q] = useState('');
	const [rows, set_rows] = useState<Row[]>([]);
	const [total, set_total] = useState(0);
	const [loading, set_loading] = useState(false);
	const [error, set_error] = useState<string | null>(null);
	const [active, set_active] = useState(0);
	const box = useRef<HTMLDivElement | null>(null);
	const seq = useRef(0);

	async function load(query: string, offset: number) {
		const my = ++seq.current;
		set_loading(true);
		set_error(null);
		try {
			const body: Record<string, unknown> = { limit: REALM_PAGE, offset, sort_by: 'slug', sort_dir: 'asc' };
			if (org_id) body.org_id = org_id;
			if (query.trim()) body.query = query.trim();
			const res = await auth_fetch('/v1/realms/get', { method: 'POST', body: JSON.stringify(body) });
			const payload = await res.json().catch(() => null);
			if (my !== seq.current) return;
			if (!res.ok || !payload?.ok) { set_error('Couldn’t load realms.'); return; }
			const items = (payload.data?.items ?? []) as Row[];
			set_rows((cur) => (offset === 0 ? items : [...cur, ...items]));
			set_total(Number(payload.data?.total ?? items.length));
		} catch {
			if (my === seq.current) set_error('Network error — check your connection.');
		} finally {
			if (my === seq.current) set_loading(false);
		}
	}

	// Debounced search while open.
	useEffect(() => {
		if (!open) return;
		const t = setTimeout(() => { set_active(0); void load(q, 0); }, q ? 250 : 0);
		return () => clearTimeout(t);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open, q, org_id]);

	useEffect(() => {
		if (!open) return;
		const on_down = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) set_open(false); };
		document.addEventListener('mousedown', on_down);
		return () => document.removeEventListener('mousedown', on_down);
	}, [open]);

	function pick(r: Row) {
		if (blocked?.(r.id)) return;
		on_change({ id: r.id, slug: r.slug, org_slug: r.org_slug });
		set_open(false);
		set_q('');
	}

	function on_key(e: React.KeyboardEvent) {
		if (e.key === 'Escape') { e.preventDefault(); set_open(false); return; }
		if (e.key === 'ArrowDown') { e.preventDefault(); set_active((i) => Math.min(i + 1, rows.length - 1)); }
		if (e.key === 'ArrowUp') { e.preventDefault(); set_active((i) => Math.max(i - 1, 0)); }
		if (e.key === 'Enter') { e.preventDefault(); const r = rows[active]; if (r) pick(r); }
	}

	return (
		<div className="relative" ref={box}>
			<button
				type="button"
				aria-label={label}
				aria-haspopup="listbox"
				aria-expanded={open}
				onClick={() => set_open((v) => !v)}
				className="flex h-9 w-full min-w-0 items-center gap-2 rounded-md border border-[var(--g-line)] bg-[var(--g-bg)] px-2.5 text-left text-[13px] text-[var(--g-ink)] outline-none focus:border-[var(--g-acc-line)]"
			>
				<span className={`min-w-0 flex-1 truncate ${value ? '' : 'text-[var(--g-ink-3)]'}`}>
					{value ? (show_org && value.org_slug ? `${value.org_slug} › ${value.slug}` : value.slug) : placeholder}
				</span>
				<ChevronDown aria-hidden className="h-3.5 w-3.5 shrink-0 text-[var(--g-ink-3)]" />
			</button>
			{open ? (
				<div className="absolute left-0 right-0 top-10 z-[60] overflow-hidden rounded-lg border border-[var(--g-line-strong)] bg-[var(--g-pop)] shadow-[var(--g-pop-shadow)]">
					<div className="flex items-center gap-2 border-b border-[var(--g-line)] px-2.5">
						<Search aria-hidden className="h-3.5 w-3.5 text-[var(--g-ink-3)]" />
						<input
							autoFocus
							aria-label={`Search ${label.toLowerCase()}`}
							value={q}
							onChange={(e) => set_q(e.target.value)}
							onKeyDown={on_key}
							placeholder="Search realms…"
							className="h-9 min-w-0 flex-1 bg-transparent text-[13px] text-[var(--g-ink)] outline-none"
						/>
						<span className="shrink-0 text-[11px] text-[var(--g-ink-3)]">{total ? `${rows.length} of ${total}` : ''}</span>
					</div>
					<ul role="listbox" aria-label={label} className="max-h-[260px] overflow-y-auto py-1">
						{rows.map((r, i) => {
							const why = blocked?.(r.id) ?? null;
							const current = value?.id === r.id;
							return (
								<li
									key={r.id}
									role="option"
									aria-selected={current}
									aria-disabled={why ? true : undefined}
									onMouseEnter={() => set_active(i)}
									onMouseDown={(e) => { e.preventDefault(); pick(r); }}
									className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[13px] ${i === active ? 'bg-[var(--g-soft)]' : ''} ${why ? 'cursor-not-allowed text-[var(--g-ink-3)]' : 'text-[var(--g-ink)]'}`}
								>
									<span className="min-w-0 flex-1 truncate">{show_org && r.org_slug ? <span className="text-[var(--g-ink-3)]">{r.org_slug} › </span> : null}{r.slug}{r.name && r.name !== r.slug ? <span className="ml-2 text-[var(--g-ink-3)]">{r.name}</span> : null}</span>
									{why ? <span className="inline-flex shrink-0 items-center gap-1 text-[11px]"><Lock aria-hidden className="h-3 w-3" />{why}</span> : current ? <span className="shrink-0 text-[11px] text-[var(--g-acc)]">selected</span> : null}
								</li>
							);
						})}
						{!loading && rows.length === 0 && !error ? <li className="px-3 py-3 text-[12.5px] text-[var(--g-ink-3)]">{q ? 'No realms match.' : 'No realms.'}</li> : null}
						{error ? <li role="alert" className="px-3 py-2 text-[12.5px] text-[var(--g-bad)]">{error}</li> : null}
					</ul>
					{rows.length < total ? (
						<button type="button" disabled={loading} onMouseDown={(e) => { e.preventDefault(); void load(q, rows.length); }} className="w-full border-t border-[var(--g-line)] px-3 py-2 text-left text-[12.5px] font-semibold text-[var(--g-acc)] hover:bg-[var(--g-soft)] disabled:opacity-50">
							{loading ? 'Loading…' : `Show more (${total - rows.length} left)`}
						</button>
					) : loading ? <p className="border-t border-[var(--g-line)] px-3 py-2 text-[12px] text-[var(--g-ink-3)]">Loading…</p> : null}
				</div>
			) : null}
		</div>
	);
}
