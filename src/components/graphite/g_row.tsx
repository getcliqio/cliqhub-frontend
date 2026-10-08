/**
 * Row interaction standard for every list and table.
 *
 * - The whole row does the row's default action (open the thing it shows) on click.
 * - That default action is also a visible control in the row — the name as a link, and
 *   when the row has other buttons, an explicit "Open" button among them — so it works
 *   from the keyboard and reads as clickable.
 * - Every other control in the row (buttons, links, menus, inputs) does only its own thing:
 *   the row ignores clicks that start inside an interactive element, so no control has to
 *   remember `stopPropagation`.
 * - Selecting text in a row doesn't open it; Cmd/Ctrl-click opens a link target in a new tab.
 */
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';

/** Elements that own their clicks; the row leaves them alone. */
const INTERACTIVE = 'a,button,input,select,textarea,label,summary,details,[role="button"],[role="menuitem"],[role="checkbox"],[role="switch"],[contenteditable="true"],[data-row-skip]';

/** Hover + pointer for a row that opens on click. */
export const ROW_OPENS = 'cursor-pointer hover:bg-[var(--g-soft)]';

/** What a row opens: a page (`to`) or an action (`on_open`, e.g. expand or select). */
export interface Row_target { to?: string | null; on_open?: (() => void) | null }

/**
 * Props for a row element that opens `target` on click — spread onto the `<tr>` / `<li>` / `<div>`.
 * Nothing when there is no target (the row is then plain).
 */
export function use_row_open(): (target: Row_target) => { onClick?: (e: ReactMouseEvent<HTMLElement>) => void; 'data-row-opens'?: '' } {
	const navigate = useNavigate();
	return ({ to, on_open }) => {
		if (!to && !on_open) return {};
		return {
			'data-row-opens': '',
			onClick: (e) => {
				if (e.defaultPrevented) return;
				const hit = (e.target as HTMLElement).closest(INTERACTIVE);
				if (hit && hit !== e.currentTarget && e.currentTarget.contains(hit)) return;
				if (typeof window !== 'undefined' && (window.getSelection?.()?.toString() ?? '').length > 0) return;
				if (to) {
					if (e.metaKey || e.ctrlKey) { window.open(to, '_blank', 'noopener'); return; }
					navigate(to);
					return;
				}
				on_open?.();
			},
		};
	};
}

const BTN = 'inline-flex h-7 items-center gap-1 rounded-md border border-[var(--g-line)] px-2.5 text-[12px] font-semibold text-[var(--g-ink)] hover:bg-[var(--g-soft)]';

/**
 * The row's default action as an explicit control — put it first among a row's buttons.
 * A link when it opens a page, a button when it runs `on_open`.
 */
export function Row_open({ to, on_open, children = 'Open', label }: Row_target & { children?: ReactNode; label?: string }) {
	if (to) return <Link to={to} className={BTN} aria-label={label} data-testid="row-open">{children}</Link>;
	return <button type="button" onClick={() => on_open?.()} className={BTN} aria-label={label} data-testid="row-open">{children}</button>;
}
