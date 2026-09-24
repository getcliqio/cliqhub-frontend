import { useState, useEffect, useCallback, useMemo, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useOrgFetch } from '@/lib/org_context';
import { ApiErrorBanner } from '@/components/ui/api_error';
import { PageHeader } from '@/components/ui/page_header';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { PAGE_HELP } from '@/lib/page_help';
import { NewTokenBanner } from '@/components/new_token_banner';
import { Pagination, PAGE_LIMIT } from '@/components/pagination';
import { format_date } from '@/lib/format_time';
import { KeyRound } from 'lucide-react';
import { classify_token_freshness, token_freshness_meta } from '@/lib/token_freshness';
import {
	sort_tokens,
	is_token_sort_option,
	TOKEN_SORT_OPTIONS,
	type Token_sort_option,
} from '@/lib/token_sort';

interface TokenPermissions {
	domains?: {
		orgs?: string[] | '*';
		scopes?: string[] | '*';
		realms?: string[] | '*';
	};
	access?: Record<string, Array<'read' | 'write' | 'admin'>>;
}

interface PersonalTokenRow {
	id: string;
	name: string;
	permissions: TokenPermissions;
	created_at: string;
	last_used_at: string | null;
}

interface OrgOption {
	id: string;
	slug: string;
	display_name: string;
}

function api_error_message(data: { error?: string | { message?: string } }): string {
	if (typeof data.error === 'string') return data.error;
	return data.error?.message ?? 'Request failed';
}

/** User PATs only. Realm enroll tokens live under `/realms/:slug`. */
export function Component() {
	const auth_fetch = useOrgFetch();
	const [search_params, set_search_params] = useSearchParams();
	const create_open = search_params.get('create') === '1';

	const [error, set_error] = useState<string | null>(null);
	const [new_token_value, set_new_token_value] = useState<string | null>(null);
	const [tokens, set_tokens] = useState<PersonalTokenRow[]>([]);
	const [total, set_total] = useState(0);
	const [offset, set_offset] = useState(0);
	const [page_size, set_page_size] = useState<number>(PAGE_LIMIT);
	const [loading, set_loading] = useState(true);
	const [creating, set_creating] = useState(false);
	const [new_name, set_new_name] = useState('');
	const [selected_org_ids, set_selected_org_ids] = useState<string[]>([]);
	const [minted_org_ids, set_minted_org_ids] = useState<string[]>([]);
	const [orgs, set_orgs] = useState<OrgOption[]>([]);
	const [filter_draft, set_filter_draft] = useState('');
	const [active_query, set_active_query] = useState('');

	// URL-persisted sort so bookmarks / shared links land on the
	// same ordering. Default 'newest' matches the pre-5.5 behavior.
	const raw_sort = search_params.get('sort');
	const sort_by: Token_sort_option = is_token_sort_option(raw_sort) ? raw_sort : 'newest';

	function set_sort_by(next: Token_sort_option) {
		const params = new URLSearchParams(search_params);
		if (next === 'newest') params.delete('sort');
		if (next !== 'newest') params.set('sort', next);
		set_search_params(params, { replace: true });
	}

	const sorted_tokens = useMemo(() => sort_tokens(tokens, sort_by), [tokens, sort_by]);

	const load_tokens = useCallback(async () => {
		set_loading(true);
		try {
			const body: Record<string, unknown> = {
				type: 'user',
				limit: page_size,
				offset,
			};
			const query = active_query.trim();
			if (query) body.query = query;

			const res = await auth_fetch('/v1/auth/get_tokens', {
				method: 'POST',
				body: JSON.stringify(body),
			});
			const data = await res.json();
			if (data.ok) {
				set_tokens(data.data.tokens);
				set_total(data.data.total ?? data.data.tokens.length);
				set_error(null);
				return;
			}
			set_error(api_error_message(data));
		} catch {
			set_error('Failed to load tokens');
		} finally {
			set_loading(false);
		}
	}, [auth_fetch, offset, page_size, active_query]);

	const load_orgs = useCallback(async () => {
		try {
			const res = await auth_fetch('/v1/orgs/get', {
				method: 'POST',
				body: JSON.stringify({ mine: true }),
			});
			const data = await res.json();
			if (!data.ok) return;
			set_orgs(data.data.orgs.map((o: OrgOption) => ({
				id: String(o.id),
				slug: o.slug,
				display_name: o.display_name,
			})));
		} catch {
			// non-critical
		}
	}, [auth_fetch]);

	useEffect(() => {
		load_tokens();
	}, [load_tokens]);

	useEffect(() => {
		load_orgs();
	}, [load_orgs]);

	function open_create() {
		const next = new URLSearchParams(search_params);
		next.set('create', '1');
		set_search_params(next, { replace: false });
		set_new_name('');
		set_selected_org_ids([]);
		set_error(null);
	}

	function close_create() {
		const next = new URLSearchParams(search_params);
		next.delete('create');
		set_search_params(next, { replace: true });
		set_new_name('');
		set_selected_org_ids([]);
		set_error(null);
	}

	function apply_filter(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = event.currentTarget;
		const raw = new FormData(form).get('query');
		const query = typeof raw === 'string' ? raw.trim() : filter_draft.trim();
		set_filter_draft(query);
		set_active_query(query);
		set_offset(0);
	}

	function clear_filter() {
		set_filter_draft('');
		set_active_query('');
		set_offset(0);
	}

	function toggle_org(org_id: string) {
		set_selected_org_ids((prev) => {
			if (prev.includes(org_id)) return prev.filter((id) => id !== org_id);
			return [...prev, org_id];
		});
	}

	async function handle_create() {
		const name = new_name.trim();
		if (!name) {
			set_error('Token name is required');
			return;
		}

		set_creating(true);
		set_error(null);
		try {
			const permissions: TokenPermissions | undefined = selected_org_ids.length > 0
				? { domains: { orgs: selected_org_ids } }
				: undefined;

			const res = await auth_fetch('/v1/auth/generate_token', {
				method: 'POST',
				body: JSON.stringify({
					type: 'user',
					name,
					permissions,
				}),
			});
			const data = await res.json();
			if (data.ok) {
				set_minted_org_ids([...selected_org_ids]);
				set_new_token_value(data.data.token);
				set_new_name('');
				set_selected_org_ids([]);
				close_create();
				await load_tokens();
				return;
			}
			set_error(api_error_message(data));
		} catch {
			set_error('Failed to create token');
		} finally {
			set_creating(false);
		}
	}

	async function handle_revoke(token_id: string) {
		set_error(null);
		try {
			const res = await auth_fetch('/v1/auth/revoke_token', {
				method: 'POST',
				body: JSON.stringify({ type: 'user', token_id }),
			});
			const data = await res.json();
			if (data.ok) {
				set_tokens((prev) => prev.filter((t) => t.id !== token_id));
				set_total((prev) => prev - 1);
				set_new_token_value(null);
				return;
			}
			set_error(api_error_message(data));
		} catch {
			set_error('Failed to revoke token');
		}
	}

	async function handle_rotate(token_id: string) {
		set_error(null);
		try {
			const res = await auth_fetch('/v1/auth/rotate_token', {
				method: 'POST',
				body: JSON.stringify({ type: 'user', token_id }),
			});
			const data = await res.json();
			if (data.ok) {
				set_new_token_value(data.data.token);
				return;
			}
			set_error(api_error_message(data));
		} catch {
			set_error('Failed to rotate token');
		}
	}

	if (create_open) {
		return (
			<div>
				<Breadcrumbs
					items={[
						{ label: 'User tokens', to: '/tokens' },
						{ label: 'Create' },
					]}
				/>
				<button
					type="button"
					onClick={close_create}
					className="text-xs font-medium text-indigo-600 hover:underline"
				>
					← Back to user tokens
				</button>
				<h1 className="mt-3 text-2xl font-extrabold tracking-tight">Create user token</h1>
				<p className="mt-1 max-w-2xl text-sm text-slate-500">
					Authenticates the CLI or CI to Hub. The secret is shown once after you create it.
				</p>

				<ApiErrorBanner error={error} onDismiss={() => set_error(null)} />

				<div className="mt-8 grid gap-8 xl:grid-cols-12">
					<div className="xl:col-span-7">
						<div className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
							<label className="block text-xs font-semibold text-slate-600">
								Name
								<input
									value={new_name}
									onChange={(e) => set_new_name(e.target.value)}
									onKeyDown={(e) => e.key === 'Enter' && handle_create()}
									placeholder="laptop-cli"
									aria-label="Token name"
									className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400"
									autoFocus
								/>
							</label>

							{orgs.length > 0 && (
								<div>
									<p className="mb-2 text-xs font-semibold text-slate-600">
										Organization access{' '}
										<span className="font-normal text-slate-400">
											(optional — leave empty for full access)
										</span>
									</p>
									<div className="flex flex-wrap gap-2">
										{orgs.map((org) => (
											<button
												key={org.id}
												type="button"
												onClick={() => toggle_org(org.id)}
												className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
													selected_org_ids.includes(org.id)
														? 'border-indigo-300 bg-indigo-50 text-indigo-700'
														: 'border-slate-200 text-slate-500 hover:border-slate-300'
												}`}
											>
												{org.display_name || org.slug}
											</button>
										))}
									</div>
								</div>
							)}

							<div className="flex gap-3 pt-2">
								<button
									type="button"
									onClick={handle_create}
									disabled={creating}
									className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
								>
									{creating ? 'Creating…' : 'Create token'}
								</button>
								<button
									type="button"
									onClick={close_create}
									className="rounded-lg border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
								>
									Cancel
								</button>
							</div>
						</div>
					</div>
					<aside className="xl:col-span-5">
						<div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-600">
							<p className="font-semibold text-slate-800">About user tokens</p>
							<ul className="mt-3 space-y-2">
								<li>
									<code className="rounded bg-white px-1 text-xs">cliq_tok_…</code> authenticates
									you to Hub.
								</li>
								<li>
									Realm tokens enroll daemons — mint under Realm → Realm tokens.
								</li>
							</ul>
						</div>
					</aside>
				</div>
			</div>
		);
	}

	if (loading && tokens.length === 0 && !new_token_value) {
		return (
			<div>
				<Breadcrumbs items={[{ label: 'User tokens' }]} />
				<div className="flex min-h-[30vh] items-center justify-center">
					<p className="text-sm text-slate-400">Loading user tokens...</p>
				</div>
			</div>
		);
	}

	return (
		<div>
			<Breadcrumbs items={[{ label: 'User tokens' }]} />
			<PageHeader
				icon={KeyRound}
				tone="slate"
				title="User tokens"
				description={(
					<>
						Your Hub PATs for{' '}
						<code className="rounded bg-slate-100 px-1 text-xs">cliq login</code>
						{' / CI — not realm enroll tokens.'}
					</>
				)}
				help={PAGE_HELP.tokens.help}
				docs_href={PAGE_HELP.tokens.docs_href}
				actions={(
					<button
						type="button"
						onClick={open_create}
						className="shrink-0 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
					>
						Create token
					</button>
				)}
			/>

			<div className="mb-4 grid gap-3 sm:grid-cols-2">
				<div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-4">
					<p className="text-xs font-bold uppercase tracking-wider text-indigo-600">This page</p>
					<p className="mt-1 text-sm font-semibold">User token (PAT)</p>
					<p className="mt-1 text-xs text-slate-500">
						<code className="rounded bg-white px-1">cliq_tok_…</code> · you ↔ Hub CLI/CI
					</p>
				</div>
				<Link
					to="/realms"
					className="rounded-xl border border-slate-200 bg-white p-4 hover:border-indigo-300"
				>
					<p className="text-xs font-bold uppercase tracking-wider text-slate-400">On each realm</p>
					<p className="mt-1 text-sm font-semibold">Realm token</p>
					<p className="mt-1 text-xs text-slate-500">
						<code className="rounded bg-slate-100 px-1">cliq_dt_…</code> · enroll daemon →
					</p>
				</Link>
			</div>

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
						placeholder="token name"
						aria-label="Filter tokens"
						className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
					/>
				</label>
				<label className="min-w-[10rem] text-xs font-semibold text-slate-600">
					Sort
					<select
						value={sort_by}
						onChange={(e) => set_sort_by(e.target.value as Token_sort_option)}
						aria-label="Sort tokens"
						data-testid="tokens-sort-select"
						className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
					>
						{TOKEN_SORT_OPTIONS.map((opt) => (
							<option key={opt.id} value={opt.id}>{opt.label}</option>
						))}
					</select>
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
						className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
					>
						Clear
					</button>
				)}
			</form>

			<ApiErrorBanner error={error} onDismiss={() => set_error(null)} />

			{new_token_value && (
				<NewTokenBanner
					token={new_token_value}
					permissions_summary={
						<Post_mint_summary
							org_ids={minted_org_ids}
							orgs={orgs}
						/>
					}
					on_dismiss={() => {
						set_new_token_value(null);
						set_minted_org_ids([]);
						set_selected_org_ids([]);
					}}
				/>
			)}

			{tokens.length === 0 && offset === 0 ? (
				<div className="mt-6 rounded-xl border-2 border-dashed border-slate-200 py-12 text-center">
					<p className="text-slate-400">
						{active_query ? 'No tokens match this filter.' : 'No user tokens yet.'}
					</p>
				</div>
			) : (
				<div className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b border-slate-100 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">
								<th className="px-5 py-2">Name</th>
								<th className="px-5 py-2">Created</th>
								<th className="px-5 py-2">Last used</th>
								<th className="px-5 py-2" />
							</tr>
						</thead>
						<tbody className="divide-y divide-slate-50">
							{sorted_tokens.map((t) => (
								<tr key={t.id} data-token-name={t.name}>
									<td className="px-5 py-3">
										<p className="text-sm font-semibold text-slate-800">{t.name}</p>
										<PermissionsBadges permissions={t.permissions} />
									</td>
									<td className="px-5 py-3 text-slate-500">{format_date(t.created_at)}</td>
									<td className="px-5 py-3 text-slate-400">
										<div className="flex items-center gap-2">
											<span>{t.last_used_at ? format_date(t.last_used_at) : 'never'}</span>
											<Token_freshness_badge token={t} />
										</div>
									</td>
									<td className="px-5 py-3 text-right">
										<div className="flex justify-end gap-2">
											<button
												type="button"
												onClick={() => handle_rotate(t.id)}
												className="rounded-lg border border-amber-200 px-3 py-1.5 text-xs font-semibold text-amber-600 hover:bg-amber-50"
											>
												Rotate
											</button>
											<button
												type="button"
												onClick={() => handle_revoke(t.id)}
												className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50"
											>
												Revoke
											</button>
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}

			<Pagination
				total={total}
				offset={offset}
				limit={page_size}
				on_change={set_offset}
				on_limit_change={(n) => { set_page_size(n); set_offset(0); }}
				label="tokens"
			/>
		</div>
	);
}

/**
 * Human-readable summary of what the just-minted token can do —
 * shown inside NewTokenBanner. The reader needs to verify org
 * bindings before confirming they've saved the secret.
 */
function Post_mint_summary({
	org_ids,
	orgs,
}: {
	org_ids: readonly string[];
	orgs: readonly OrgOption[];
}) {
	const org_lookup = new Map(orgs.map((o) => [o.id, o]));
	const org_labels = org_ids
		.map((id) => org_lookup.get(id)?.display_name ?? `#${id}`);

	return (
		<div className="space-y-1">
			<p className="font-semibold uppercase tracking-wider text-[10px] text-amber-800">
				This token can:
			</p>
			<ul className="ml-1 list-inside list-disc space-y-0.5">
				{org_ids.length === 0 ? (
					<li>Act across every org you belong to (default grant).</li>
				) : (
					<li>
						Act only in org{org_ids.length > 1 ? 's' : ''}:{' '}
						<span className="font-semibold">{org_labels.join(', ')}</span>
					</li>
				)}
			</ul>
		</div>
	);
}

/**
 * Small badge next to "Last used" that classifies a token as
 * active / stale / inactive / unused. Encourages users to revoke
 * tokens they've forgotten about — the "unused" and "inactive"
 * pills are colored to draw the eye.
 */
function Token_freshness_badge({ token }: { token: PersonalTokenRow }) {
	const bucket = classify_token_freshness(token);
	const meta = token_freshness_meta(bucket);
	return (
		<span
			data-testid="token-freshness-badge"
			data-freshness={bucket}
			className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${meta.class_name}`}
			title={meta.description}
		>
			{meta.label}
		</span>
	);
}

function PermissionsBadges({ permissions }: { permissions: TokenPermissions }) {
	const orgs = permissions?.domains?.orgs;
	const org_ids = Array.isArray(orgs)
		? orgs.filter((x): x is string => typeof x === 'string')
		: [];

	if (!permissions || (Object.keys(permissions).length === 0 && org_ids.length === 0)) {
		return (
			<div className="mt-1">
				<span className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
					Full access
				</span>
			</div>
		);
	}

	if (orgs === '*') {
		return (
			<div className="mt-1">
				<span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
					orgs:*
				</span>
			</div>
		);
	}

	if (org_ids.length === 0) return null;

	return (
		<div className="mt-1 flex flex-wrap gap-1.5">
			{org_ids.map((org_id) => (
				<span
					key={org_id}
					className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600"
				>
					org:{org_id}
				</span>
			))}
		</div>
	);
}
