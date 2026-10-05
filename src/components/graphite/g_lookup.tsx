/**
 * Type-ahead filters for admin lists — search as you type, 10 at a time.
 * Nothing is loaded until the picker is opened; the picked value is labelled
 * with one by-id read.
 *
 *   Org_filter    POST /v1/orgs/get { query, limit } · /v1/orgs/get_by_id { org_id }
 *   Realm_filter  POST /v1/realms/get { all, org_id?, query, limit } · /v1/realms/get_by_id { realm_id }
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { useAuthFetch } from '@/lib/auth_context';

export interface Lookup_option { id: string; label: string; sub?: string | null }

const PAGE = 10;
const DEBOUNCE_MS = 250;

type Fetcher = ReturnType<typeof useAuthFetch>;

async function post_json(auth_fetch: Fetcher, path: string, body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
	try {
		const res = await auth_fetch(path, { method: 'POST', body: JSON.stringify(body) });
		const payload = await res.json().catch(() => null) as Record<string, unknown> | null;
		return res.ok && payload?.ok ? payload : null;
	} catch {
		return null;
	}
}

/** Generic type-ahead: `search(q)` returns up to a page of options; `resolve(id)` labels the current value. */
export function Lookup_filter({ label, all_label, value, on_change, search, resolve }: {
	label: string;
	all_label: string;
	value: string;
	on_change: (id: string) => void;
	search: (q: string) => Promise<Lookup_option[] | null>;
	resolve: (id: string) => Promise<Lookup_option | null>;
}) {
	const [open, set_open] = useState(false);
	const [q, set_q] = useState('');
	const [rows, set_rows] = useState<Lookup_option[]>([]);
	const [loading, set_loading] = useState(false);
	const [error, set_error] = useState(false);
	const [picked, set_picked] = useState<Lookup_option | null>(null);
	const box = useRef<HTMLDivElement | null>(null);
	const seq = useRef(0);

	useEffect(() => {
		if (!value) { set_picked(null); return; }
		if (picked?.id === value) return;
		let live = true;
		void resolve(value).then((o) => { if (live) set_picked(o ?? { id: value, label: value.slice(0, 8) }); });
		return () => { live = false; };
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [value]);

	useEffect(() => {
		if (!open) return;
		const my = ++seq.current;
		set_loading(true);
		const t = setTimeout(() => {
			void search(q.trim()).then((r) => {
				if (my !== seq.current) return;
				set_loading(false);
				set_error(r === null);
				set_rows(r ?? []);
			});
		}, q ? DEBOUNCE_MS : 0);
		return () => clearTimeout(t);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open, q]);

	useEffect(() => {
		if (!open) return;
		const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) set_open(false); };
		document.addEventListener('mousedown', close);
		return () => document.removeEventListener('mousedown', close);
	}, [open]);

	const choose = (o: Lookup_option | null) => {
		set_picked(o);
		set_open(false);
		set_q('');
		on_change(o?.id ?? '');
	};

	return (
		<div ref={box} className="relative w-[200px] min-w-0">
			<button type="button" aria-label={label} aria-haspopup="listbox" aria-expanded={open} onClick={() => set_open((v) => !v)} className="flex w-full items-center gap-2 rounded-lg border border-[var(--g-line)] bg-[var(--g-bg)] px-3 py-1.5 text-left text-[13px] text-[var(--g-ink)]">
				<span className="min-w-0 flex-1 truncate">{value ? picked?.label ?? '…' : all_label}</span>
				{value ? <X aria-label={`Clear ${label.toLowerCase()}`} role="button" className="h-3.5 w-3.5 shrink-0 text-[var(--g-ink-3)] hover:text-[var(--g-ink)]" onClick={(e) => { e.stopPropagation(); choose(null); }} /> : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--g-ink-3)]" />}
			</button>
			{open ? (
				<div className="absolute left-0 z-20 mt-1 w-[280px] rounded-lg border border-[var(--g-line)] bg-[var(--g-panel)] p-1.5 shadow-lg">
					<div className="flex items-center gap-2 rounded-md border border-[var(--g-line)] bg-[var(--g-bg)] px-2 py-1">
						<Search className="h-3.5 w-3.5 text-[var(--g-ink-3)]" />
						<input autoFocus aria-label={`Search ${label.toLowerCase()}`} value={q} onChange={(e) => set_q(e.target.value)} placeholder="Type to search…" className="min-w-0 flex-1 bg-transparent text-[13px] outline-none" />
					</div>
					<ul role="listbox" aria-label={label} className="mt-1 max-h-[260px] overflow-y-auto">
						{value ? <li><button type="button" role="option" aria-selected={false} onClick={() => choose(null)} className="w-full rounded px-2 py-1.5 text-left text-[13px] text-[var(--g-ink-3)] hover:bg-[var(--g-soft)]">{all_label}</button></li> : null}
						{rows.map((o) => (
							<li key={o.id}>
								<button type="button" role="option" aria-selected={o.id === value} onClick={() => choose(o)} className={`w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-[var(--g-soft)] ${o.id === value ? 'font-semibold' : ''}`}>
									<span className="block truncate">{o.label}</span>
									{o.sub ? <span className="g-mono block truncate text-[11.5px] text-[var(--g-ink-3)]">{o.sub}</span> : null}
								</button>
							</li>
						))}
						{loading ? <li className="px-2 py-1.5 text-[12.5px] text-[var(--g-ink-3)]">Searching…</li> : null}
						{!loading && error ? <li className="px-2 py-1.5 text-[12.5px] text-[var(--g-bad)]">Couldn’t search.</li> : null}
						{!loading && !error && !rows.length ? <li className="px-2 py-1.5 text-[12.5px] text-[var(--g-ink-3)]">{q ? 'No matches.' : 'Nothing here.'}</li> : null}
						{!loading && rows.length === PAGE ? <li className="px-2 py-1 text-[11.5px] text-[var(--g-ink-3)]">Showing the first {PAGE} — type to narrow.</li> : null}
					</ul>
				</div>
			) : null}
		</div>
	);
}

/** Org filter: searches every org (site admins) by name or slug. */
export function Org_filter({ value, on_change, all_label = 'Org: all' }: { value: string; on_change: (id: string) => void; all_label?: string }) {
	const auth_fetch = useAuthFetch();
	return (
		<Lookup_filter
			label="Organization" all_label={all_label} value={value} on_change={on_change}
			search={async (q) => {
				const p = await post_json(auth_fetch, '/v1/orgs/get', { limit: PAGE, ...(q ? { query: q } : {}) });
				const orgs = ((p?.data as { orgs?: Array<Record<string, unknown>> } | undefined)?.orgs ?? null);
				return orgs ? orgs.map((o) => ({ id: String(o.id), label: String(o.display_name || o.slug), sub: String(o.slug ?? '') })) : null;
			}}
			resolve={async (id) => {
				const d = (await post_json(auth_fetch, '/v1/orgs/get_by_id', { org_id: id }))?.data as Record<string, unknown> | undefined;
				return d ? { id, label: String(d.display_name || d.slug), sub: String(d.slug ?? '') } : null;
			}}
		/>
	);
}

/** Realm filter: searches every realm (site admins), inside `org_id` when one is picked. */
export function Realm_filter({ value, org_id, on_change }: { value: string; org_id?: string; on_change: (id: string) => void }) {
	const auth_fetch = useAuthFetch();
	const label_of = (r: Record<string, unknown>) => (r.org_slug && !org_id ? `${r.org_slug}.${r.slug}` : String(r.slug ?? ''));
	return (
		<Lookup_filter
			label="Realm" all_label="Realm: all" value={value} on_change={on_change}
			search={async (q) => {
				const p = await post_json(auth_fetch, '/v1/realms/get', { all: true, limit: PAGE, sort_by: 'slug', sort_dir: 'asc', ...(org_id ? { org_id } : {}), ...(q ? { query: q } : {}) });
				const items = ((p?.data as { items?: Array<Record<string, unknown>> } | undefined)?.items ?? null);
				return items ? items.map((r) => ({ id: String(r.id), label: label_of(r), sub: r.name && r.name !== r.slug ? String(r.name) : null })) : null;
			}}
			resolve={async (id) => {
				const p = await post_json(auth_fetch, '/v1/realms/get_by_id', { realm_id: id });
				const r = (p?.realm ?? p?.data) as Record<string, unknown> | undefined;
				return r ? { id, label: label_of(r) } : null;
			}}
		/>
	);
}
