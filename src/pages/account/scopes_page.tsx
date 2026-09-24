import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useOrgFetch } from '@/lib/org_context';
import { ApiErrorBanner } from '@/components/ui/api_error';
import { PageHeader } from '@/components/ui/page_header';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { PAGE_HELP } from '@/lib/page_help';

interface ScopeRow {
	id: number;
	slug: string;
	display_name: string;
	visibility: string;
	scope_type: string;
}

function api_error_message(data: { error?: string | { message?: string } }): string {
	if (typeof data.error === 'string') return data.error;
	return data.error?.message ?? 'Request failed';
}

export function Component() {
	const auth_fetch = useOrgFetch();
	const [scopes, set_scopes] = useState<ScopeRow[]>([]);
	const [loading, set_loading] = useState(true);
	const [error, set_error] = useState<string | null>(null);
	const [filter_draft, set_filter_draft] = useState('');
	const [active_query, set_active_query] = useState('');

	const load = useCallback(async () => {
		set_loading(true);
		try {
			const body: Record<string, unknown> = { mine: true };
			const query = active_query.trim();
			if (query) body.query = query;

			const res = await auth_fetch('/v1/scopes/get', {
				method: 'POST',
				body: JSON.stringify(body),
			});
			const data = await res.json();
			if (!data.ok) {
				set_error(api_error_message(data));
				return;
			}
			set_scopes(data.data?.scopes ?? []);
			set_error(null);
		} catch {
			set_error('Failed to load scopes');
		} finally {
			set_loading(false);
		}
	}, [auth_fetch, active_query]);

	useEffect(() => {
		void load();
	}, [load]);

	function apply_filter(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = event.currentTarget;
		const raw = new FormData(form).get('query');
		const query = typeof raw === 'string' ? raw.trim() : filter_draft.trim();
		set_filter_draft(query);
		set_active_query(query);
	}

	function clear_filter() {
		set_filter_draft('');
		set_active_query('');
	}

	return (
		<div>
			<Breadcrumbs items={[{ label: 'Scopes' }]} />
			<PageHeader
				title="Scopes"
				description="Package namespaces for teams. Scopes do not enroll daemons — realms do."
				help={PAGE_HELP.scopes.help}
				docs_href={PAGE_HELP.scopes.docs_href}
			/>

			<form
				onSubmit={apply_filter}
				className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4"
			>
				<label className="min-w-[12rem] flex-1 text-xs font-semibold text-slate-600">
					Filter
					<input
						name="query"
						value={filter_draft}
						onChange={(e) => set_filter_draft(e.target.value)}
						placeholder="scope slug"
						aria-label="Filter scopes"
						className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
					/>
				</label>
				<button
					type="submit"
					className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
				>
					Apply
				</button>
				{active_query && (
					<button
						type="button"
						onClick={clear_filter}
						className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600"
					>
						Clear
					</button>
				)}
			</form>

			<ApiErrorBanner error={error} onDismiss={() => set_error(null)} />

			{loading ? (
				<p className="text-sm text-slate-400">Loading scopes…</p>
			) : scopes.length === 0 ? (
				<div className="rounded-xl border-2 border-dashed border-slate-200 py-12 text-center">
					<p className="text-slate-400">
						{active_query ? 'No scopes match this filter.' : 'No scopes on this account yet.'}
					</p>
					{!active_query && (
						<p className="mt-2 text-xs text-slate-400">
							Join an{' '}
							<Link to="/organizations" className="text-indigo-600 hover:underline">
								organization
							</Link>
							{' '}or use the personal scope created at signup.
						</p>
					)}
				</div>
			) : (
				<div className="divide-y overflow-hidden rounded-xl border border-slate-200 bg-white font-mono text-sm">
					{scopes.map((scope) => (
						<div
							key={scope.id}
							className="flex items-center justify-between gap-3 px-5 py-3"
						>
							<div className="min-w-0">
								<p className="font-semibold text-slate-800">@{scope.slug}</p>
								<p className="mt-0.5 font-sans text-xs text-slate-400">
									{scope.display_name}
									{' · '}
									{scope.scope_type === 'org' ? 'organization' : 'personal'}
									{' · '}
									{scope.visibility}
								</p>
							</div>
							<div className="flex shrink-0 gap-2 font-sans">
								<Link
									to={`/browse/s/${scope.slug}`}
									className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
								>
									Browse teams
								</Link>
								<Link
									to="/teams"
									className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
								>
									My teams
								</Link>
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
