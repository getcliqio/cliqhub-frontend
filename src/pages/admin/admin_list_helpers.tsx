import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Shield } from 'lucide-react';
import { PageHeader } from '@/components/ui/page_header';
import { Breadcrumbs, type BreadcrumbItem } from '@/components/ui/breadcrumbs';

export function api_error_message(data: { error?: string | { message?: string } }): string {
	if (typeof data.error === 'string') return data.error;
	return data.error?.message ?? 'Request failed';
}

export function Admin_list_page({
	title,
	subtitle,
	icon,
	actions,
	crumbs,
	children,
}: {
	title: string;
	subtitle: string;
	icon?: LucideIcon;
	actions?: ReactNode;
	crumbs?: BreadcrumbItem[];
	children: ReactNode;
}) {
	const crumb_items = crumbs ?? [
		{ label: 'Admin', to: '/admin' },
		{ label: title.replace(/^All\s+/, '') },
	];

	return (
		<div>
			<Breadcrumbs items={crumb_items} />
			<PageHeader
				icon={icon ?? Shield}
				tone="rose"
				title={title}
				description={subtitle}
				actions={(
					<>
						<span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700">
							Site
						</span>
						{actions}
					</>
				)}
			/>
			{children}
		</div>
	);
}

export function use_admin_list_query() {
	const [filter_draft, set_filter_draft] = useState('');
	const [active_query, set_active_query] = useState('');
	const [offset, set_offset] = useState(0);

	function apply_filter(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = event.currentTarget;
		const raw = new FormData(form).get('query');
		const query = typeof raw === 'string' ? raw.trim() : filter_draft.trim();
		set_filter_draft(query);
		set_active_query(query);
		set_offset(0);
	}

	return {
		filter_draft,
		set_filter_draft,
		active_query,
		offset,
		set_offset,
		apply_filter,
	};
}

export function Admin_search_form({
	filter_draft,
	set_filter_draft,
	on_submit,
	placeholder,
}: {
	filter_draft: string;
	set_filter_draft: (v: string) => void;
	on_submit: (event: FormEvent<HTMLFormElement>) => void;
	placeholder: string;
}) {
	return (
		<form onSubmit={on_submit} className="mb-4 flex gap-2">
			<input
				name="query"
				value={filter_draft}
				onChange={(e) => set_filter_draft(e.target.value)}
				placeholder={placeholder}
				className="w-full max-w-md rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
			/>
			<button
				type="submit"
				className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
			>
				Search
			</button>
		</form>
	);
}

export { useCallback, useEffect, useState };
