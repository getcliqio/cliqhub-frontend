/**
 * Sortable table headers (Graphite) — one hook + one `<th>` for every table.
 *
 * - `use_table_sort` keeps the sort in the URL (`?sort=<key>&dir=asc|desc`, or
 *   `?<param>_sort=` when a page has several sortable tables; like
 *   `q` / `offset`), resets paging (`offset` / `page`) when it changes, and gives
 *   the request fields (`sort.body` → `{ sort_by, sort_dir }`) for server-paged lists.
 * - Which columns are sortable comes from the server for server-paged lists
 *   (`sort.with_sortable(data.sortable)` — the BFF lists only keys Core applies
 *   today, see the BFF's `lib/core_list.ts` capability map), or from the page for
 *   small lists it sorts itself (`mode: 'client'` + `sort_rows`, all rows loaded).
 *   A column that can't sort renders as a plain header, so no header ever does nothing.
 * - `Sort_th` is the header: a button that toggles asc/desc, `aria-sort`, and an icon.
 */
import { useRef, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

export type Sort_dir = 'asc' | 'desc';

export interface Table_sort {
	/** Active column (URL, else the page default), or null. */
	by: string | null;
	dir: Sort_dir;
	/** Columns that can be sorted right now (headers outside it render plain). */
	sortable: ReadonlySet<string>;
	/** Header click: a new column starts at its first direction; the active one flips. */
	toggle: (key: string) => void;
	/** Request fields for a server-sorted list: set only when the URL asks for one of `keys`. */
	body: { sort_by?: string; sort_dir?: Sort_dir };
	/**
	 * The same sort with the server's `sortable` list (server-paged lists, after the read).
	 * `undefined` / `null` while loading keeps the last answer's list (none before the first).
	 */
	with_sortable: (keys: readonly string[] | null | undefined) => Table_sort;
}

export interface Table_sort_opts {
	/** Every column this list can be asked to sort by (the BFF's `sort_by` enum, or the page's own keys). */
	keys: readonly string[];
	/**
	 * `client`: all rows are loaded and the page sorts them (`sort_rows`) — every key is sortable.
	 * `server` (default): the list is sorted where it is paged; columns light up via `with_sortable`.
	 */
	mode?: 'server' | 'client';
	/** The order the list has without a sort param, shown on its header. */
	default_sort?: { by: string; dir: Sort_dir };
	/** First direction when a column is picked (default asc; e.g. dates → desc). */
	first_dir?: Partial<Record<string, Sort_dir>>;
	/** Paging params to drop when the sort changes (default `offset`, `page`). */
	reset?: readonly string[];
	/**
	 * URL param prefix when a page has several sortable tables
	 * (`tokens` → `?tokens_sort=&tokens_dir=`); default `sort` / `dir`.
	 */
	param?: string;
}

const DIRS: readonly Sort_dir[] = ['asc', 'desc'];

/** Sort state in the URL plus the request fields for it. */
export function use_table_sort(opts: Table_sort_opts): Table_sort {
	const [sp, set_sp] = useSearchParams();
	// Last server answer's list, so headers don't flicker (or drop focus) while a re-sorted page loads.
	const last = useRef<readonly string[] | null>(null);

	const sort_key = opts.param ? `${opts.param}_sort` : 'sort';
	const dir_key = opts.param ? `${opts.param}_dir` : 'dir';
	const url_by = sp.get(sort_key);
	const url_dir = sp.get(dir_key);
	const asked = url_by && opts.keys.includes(url_by) ? url_by : null;
	const by = asked ?? opts.default_sort?.by ?? null;
	const dir: Sort_dir = asked
		? (DIRS.includes(url_dir as Sort_dir) ? url_dir as Sort_dir : opts.first_dir?.[asked] ?? 'asc')
		: opts.default_sort?.dir ?? 'asc';

	const toggle = (key: string) => {
		const next_dir: Sort_dir = by === key ? (dir === 'asc' ? 'desc' : 'asc') : opts.first_dir?.[key] ?? 'asc';
		set_sp((prev) => {
			const n = new URLSearchParams(prev);
			n.set(sort_key, key);
			n.set(dir_key, next_dir);
			for (const r of opts.reset ?? ['offset', 'page']) n.delete(r);
			return n;
		}, { replace: true });
	};

	const make = (live: readonly string[]): Table_sort => ({
		by, dir, toggle,
		sortable: new Set(live.filter((k) => opts.keys.includes(k))),
		body: asked ? { sort_by: asked, sort_dir: dir } : {},
		with_sortable: (keys) => {
			if (keys) last.current = keys;
			return make(keys ?? last.current ?? []);
		},
	});
	return make(opts.mode === 'client' ? opts.keys : []);
}

/**
 * A table header cell; sortable when `k` is in `sort.sortable`, else a plain `<th>`.
 * Pass the cell classes the table already uses (e.g. `TH`).
 */
export function Sort_th({ sort, k, children, className, title }: { sort: Table_sort; k: string; children: ReactNode; className?: string; title?: string }) {
	if (!sort.sortable.has(k)) return <th className={className} title={title}>{children}</th>;
	const active = sort.by === k;
	const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
	return (
		<th className={className} title={title} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} data-testid={`sort-${k}`}>
			<button
				type="button"
				onClick={() => sort.toggle(k)}
				className={`inline-flex items-center gap-1 [text-transform:inherit] [letter-spacing:inherit] hover:text-[var(--g-ink)] ${active ? 'text-[var(--g-ink)]' : ''}`}
			>
				{children}
				<Icon aria-hidden className={`h-3 w-3 shrink-0 ${active ? '' : 'opacity-40'}`} />
			</button>
		</th>
	);
}

/** Value used to order one row by one column (null/undefined sort last). */
export type Sort_value = string | number | boolean | null | undefined;

/**
 * Client-side sort for a list whose rows are all loaded (never for one page of a
 * server-paged list). Stable; nulls last in both directions; strings by locale, numeric-aware.
 */
export function sort_rows<T>(rows: readonly T[], sort: Pick<Table_sort, 'by' | 'dir'>, values: Record<string, (row: T) => Sort_value>): T[] {
	const get = sort.by ? values[sort.by] : undefined;
	if (!get) return [...rows];
	const sign = sort.dir === 'desc' ? -1 : 1;
	return rows
		.map((row, i) => ({ row, i, v: get(row) }))
		.sort((a, b) => {
			const an = a.v == null || a.v === '';
			const bn = b.v == null || b.v === '';
			if (an || bn) return an === bn ? a.i - b.i : an ? 1 : -1;
			const c = typeof a.v === 'string' && typeof b.v === 'string'
				? a.v.localeCompare(b.v, undefined, { numeric: true, sensitivity: 'base' })
				: Number(a.v) - Number(b.v);
			return c * sign || a.i - b.i;
		})
		.map((x) => x.row);
}
