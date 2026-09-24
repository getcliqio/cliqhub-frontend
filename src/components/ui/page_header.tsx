import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { HelpTip } from '@/components/ui/help_tip';

/** Palette tokens for the header avatar-badge. Keep small and cohesive. */
export type Page_header_tone =
	| 'indigo'
	| 'violet'
	| 'sky'
	| 'emerald'
	| 'amber'
	| 'rose'
	| 'slate';

const TONE_CLASSES: Record<Page_header_tone, string> = {
	indigo: 'bg-indigo-500 text-white',
	violet: 'bg-violet-500 text-white',
	sky: 'bg-sky-500 text-white',
	emerald: 'bg-emerald-500 text-white',
	amber: 'bg-amber-500 text-white',
	rose: 'bg-rose-500 text-white',
	slate: 'bg-slate-700 text-white',
};

interface PageHeaderProps {
	title: string;
	description?: ReactNode;
	/** Longer explanation shown in the ? tip next to the title. */
	help?: string;
	/** Optional docs link inside the ? tip (not shown as a separate page link). */
	docs_href?: string;
	actions?: ReactNode;
	/** Lucide icon shown inside the circular badge next to the title. */
	icon?: LucideIcon;
	/** Badge color tone. Defaults to indigo. */
	tone?: Page_header_tone;
}

/**
 * Standard product page chrome: circular avatar-badge + title (+ optional ?),
 * subtext below, actions on the right. Vertically balanced by matching the
 * badge diameter to the title's cap-height row.
 */
export function PageHeader({
	title,
	description,
	help,
	docs_href,
	actions,
	icon: Icon,
	tone = 'indigo',
}: PageHeaderProps) {
	const badge_class = TONE_CLASSES[tone];

	return (
		<div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-3">
					{Icon ? (
						<span
							className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${badge_class}`}
							aria-hidden
						>
							<Icon className="h-[18px] w-[18px]" strokeWidth={2} />
						</span>
					) : null}
				<h1 className="text-xl font-semibold leading-none tracking-tight text-slate-900 dark:text-slate-100 sm:text-[22px]">
					{title}
				</h1>
					{help ? (
						<span className="ml-0.5">
							<HelpTip label={title} docs_href={docs_href}>
								{help}
							</HelpTip>
						</span>
					) : null}
				</div>
			{description ? (
				<p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{description}</p>
			) : null}
			</div>
			{actions ? (
				<div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
			) : null}
		</div>
	);
}
