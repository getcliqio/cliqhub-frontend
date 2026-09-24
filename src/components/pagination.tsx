import { ChevronLeft, ChevronRight } from 'lucide-react';

const LIMIT = 20;

export { LIMIT as PAGE_LIMIT };

export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
type Page_size = (typeof PAGE_SIZE_OPTIONS)[number];

interface PaginationProps {
	total: number;
	offset: number;
	limit?: number;
	on_change: (new_offset: number) => void;
	/** When provided, renders a page-size selector. */
	on_limit_change?: (new_limit: number) => void;
	/** Hide the "Items per page" selector even if `on_limit_change` is set. */
	hide_page_size?: boolean;
	/** Label for the item being paginated (default: 'items'). */
	label?: string;
}

export function Pagination({
	total,
	offset,
	limit = LIMIT,
	on_change,
	on_limit_change,
	hide_page_size,
	label = 'items',
}: PaginationProps) {
	const total_pages = Math.max(1, Math.ceil(total / limit));
	const current_page = Math.floor(offset / limit) + 1;
	const from = total === 0 ? 0 : offset + 1;
	const to = Math.min(offset + limit, total);
	const can_prev = offset > 0;
	const can_next = current_page < total_pages;

	if (total === 0 && !on_limit_change) return null;

	return (
		<div className="mt-4 flex flex-wrap items-center justify-end gap-x-6 gap-y-2 border-t border-slate-100 pt-3 text-xs text-slate-500">
			{on_limit_change && !hide_page_size ? (
				<label className="flex items-center gap-2">
					<span>Items per page:</span>
					<select
						value={limit}
						onChange={(e) => on_limit_change(Number(e.target.value))}
						className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 outline-none focus:border-slate-400"
					>
						{PAGE_SIZE_OPTIONS.map((n) => (
							<option key={n} value={n}>{n}</option>
						))}
					</select>
				</label>
			) : null}

			<span className="font-medium text-slate-600">
				{total === 0 ? `0 ${label}` : `${from.toLocaleString()}–${to.toLocaleString()} of ${total.toLocaleString()}`}
			</span>

			<div className="flex items-center gap-1">
				<button
					type="button"
					onClick={() => on_change(Math.max(0, offset - limit))}
					disabled={!can_prev}
					aria-label="Previous page"
					className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-500 transition hover:bg-slate-50 hover:text-slate-800 disabled:opacity-40 disabled:hover:bg-white"
				>
					<ChevronLeft className="h-3.5 w-3.5" strokeWidth={2} />
				</button>
				<button
					type="button"
					onClick={() => on_change(offset + limit)}
					disabled={!can_next}
					aria-label="Next page"
					className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-500 transition hover:bg-slate-50 hover:text-slate-800 disabled:opacity-40 disabled:hover:bg-white"
				>
					<ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
				</button>
			</div>
		</div>
	);
}

export type { Page_size };
