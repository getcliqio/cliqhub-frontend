import { RefreshCw } from 'lucide-react';

/**
 * Compact refresh icon-button for search/filter toolbars.
 *
 * Placed next to the search input on list pages (runs, teams, …) so the
 * user can pull the freshest slice without reloading the whole route
 * (which would drop unsaved filter drafts, scroll position, etc.).
 *
 * Behaviour contract:
 *   - `busy=true`  → spins the icon and disables the button so a second
 *     click cannot pile a duplicate request on top of the in-flight one.
 *   - `on_click`   → the page's existing list-loader (`load` / `load_data`).
 *     The caller owns error surfacing; this component is presentation only.
 */
export interface List_refresh_button_props {
    on_click: () => void;
    busy?: boolean;
    /** Screen-reader label. Defaults to a generic phrase; pages should
     *  pass a specific one (e.g. "Refresh runs"). */
    label?: string;
    /** Optional trailing className for tuning size/spacing per host. */
    className?: string;
}

export function List_refresh_button({
    on_click,
    busy = false,
    label = 'Refresh list',
    className = '',
}: List_refresh_button_props) {
    return (
        <button
            type="button"
            onClick={on_click}
            disabled={busy}
            aria-label={label}
            aria-busy={busy || undefined}
            title={label}
            data-testid="list-refresh-button"
            className={
                'inline-flex shrink-0 items-center justify-center rounded-md '
                + 'border border-slate-200 bg-white p-1.5 text-slate-500 '
                + 'transition hover:border-indigo-300 hover:text-indigo-700 '
                + 'disabled:cursor-not-allowed disabled:opacity-60 '
                + 'dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 '
                + `dark:hover:border-indigo-500/50 dark:hover:text-indigo-300 ${className}`
            }
        >
            <RefreshCw
                className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`}
                aria-hidden="true"
            />
        </button>
    );
}
