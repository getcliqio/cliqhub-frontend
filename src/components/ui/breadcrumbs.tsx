import { Link } from 'react-router';
import { Shell_above_card } from '@/layouts/product_shell';

export interface BreadcrumbItem {
	label: string;
	to?: string;
}

/** Trail of links — always render via Shell_above_card so crumbs sit above the app card. */
export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
	if (items.length === 0) return null;

	return (
		<Shell_above_card>
			<nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
				{items.map((item, index) => {
					const is_last = index === items.length - 1;
					return (
						<span key={`${item.label}-${index}`} className="flex items-center gap-1.5">
							{index > 0 ? <span className="text-slate-300">/</span> : null}
							{item.to && !is_last ? (
								<Link to={item.to} className="font-medium text-indigo-600 hover:underline">
									{item.label}
								</Link>
							) : (
								<span className={is_last ? 'font-semibold text-slate-800' : ''}>{item.label}</span>
							)}
						</span>
					);
				})}
			</nav>
		</Shell_above_card>
	);
}
