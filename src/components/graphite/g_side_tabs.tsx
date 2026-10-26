/**
 * A page's parts as vertical tabs on its left (Notifications › Events, Channels; Org settings › General, Roles, …),
 * the same look as Account › Settings. The sidebar lists only the page; its parts are here.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router';

export interface Side_tab {
	id: string;
	label: string;
	to: string;
	active: boolean;
	/** Shown in the danger colour (e.g. Danger zone). */
	danger?: boolean;
}

/**
 * @param label - The nav's accessible name (e.g. "Notifications").
 * @param tabs - The parts, in order.
 * @param children - The open part.
 */
export function Side_tabs({ label, tabs, children }: { label: string; tabs: Side_tab[]; children: ReactNode }) {
	return (
		<div className="flex flex-col gap-6 md:flex-row">
			<nav aria-label={label} className="flex w-full shrink-0 flex-col gap-0.5 md:w-[200px]" data-testid="side-tabs">
				{tabs.map((t) => (
					<Link
						key={t.id}
						to={t.to}
						replace
						aria-current={t.active ? 'page' : undefined}
						className={`block w-full rounded-lg px-2.5 py-[7px] text-left text-[13px] ${t.active ? 'bg-[var(--g-hover)] text-white shadow-[inset_2px_0_0_var(--g-acc)]' : `${t.danger ? 'text-[var(--g-bad)]' : 'text-[var(--g-ink-2)]'} hover:bg-[var(--g-soft)]`}`}
						data-testid={`side-tab-${t.id}`}
					>
						{t.label}
					</Link>
				))}
			</nav>
			<div className="min-w-0 flex-1">{children}</div>
		</div>
	);
}
