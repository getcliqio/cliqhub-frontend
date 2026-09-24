import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useAuthFetch } from '@/lib/auth_context';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';

interface Member {
	user_id: string;
	username: string;
	display_name: string;
	role: string;
}

interface OrgScope {
	id: string;
	slug: string;
	display_name: string;
	visibility: string;
	member_count: number;
}

interface OrgDetail {
	id: string;
	slug: string;
	display_name: string;
	created_at: string;
	my_role: string;
	members: Member[];
	scopes: OrgScope[];
}

export function Component() {
	const authFetch = useAuthFetch();
	const navigate = useNavigate();
	const params = useParams();
	const org_id = params.id ?? '';

	const [org, setOrg] = useState<OrgDetail | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [action_error, setActionError] = useState('');

	const [editing_name, setEditingName] = useState(false);
	const [edit_display, setEditDisplay] = useState('');

	const [add_username, setAddUsername] = useState('');
	const [adding, setAdding] = useState(false);

	const [creating_scope, setCreatingScope] = useState(false);
	const [scope_slug, setScopeSlug] = useState('');
	const [scope_display, setScopeDisplay] = useState('');
	const [scope_visibility, setScopeVisibility] = useState<'public' | 'private'>('public');

	const [expanded_scope, setExpandedScope] = useState<string | null>(null);

	const [org_delete_expanded, setOrgDeleteExpanded] = useState(false);
	const [org_delete_text, setOrgDeleteText] = useState('');
	const [org_deleting, setOrgDeleting] = useState(false);

	const [scope_delete, setScopeDelete] = useState<{ id: string; slug: string } | null>(null);
	const [scope_delete_text, setScopeDeleteText] = useState('');

	const load = useCallback(async () => {
		try {
			const res = await authFetch('/v1/orgs/get_by_id', {
				method: 'POST', body: JSON.stringify({ org_id }),
			});
			const data = await res.json();
			if (data.ok) {
				setOrg(data.data);
			}
			if (!data.ok) {
				setError(data.error?.message || 'Failed to load org');
			}
		} catch {
			setError('Network error');
		} finally {
			setLoading(false);
		}
	}, [authFetch, org_id]);

	useEffect(() => { load(); }, [load]);

	async function handle_update_name() {
		setActionError('');
		try {
			const res = await authFetch('/v1/orgs/update', {
				method: 'POST', body: JSON.stringify({ org_id, display_name: edit_display }),
			});
			const data = await res.json();
			if (!data.ok) { setActionError(data.error?.message || 'Failed'); return; }
			setEditingName(false);
			load();
		} catch {
			setActionError('Network error');
		}
	}

	async function handle_add_member() {
		setActionError('');
		setAdding(true);
		try {
			const res = await authFetch('/v1/orgs/add_member', {
				method: 'POST', body: JSON.stringify({ org_id, username: add_username }),
			});
			const data = await res.json();
			if (!data.ok) { setActionError(data.error?.message || 'Failed'); return; }
			setAddUsername('');
			load();
		} catch {
			setActionError('Network error');
		} finally {
			setAdding(false);
		}
	}

	async function handle_remove_member(user_id: string) {
		setActionError('');
		try {
			const res = await authFetch('/v1/orgs/remove_member', {
				method: 'POST', body: JSON.stringify({ org_id, user_id }),
			});
			const data = await res.json();
			if (!data.ok) { setActionError(data.error?.message || 'Failed'); return; }
			load();
		} catch {
			setActionError('Network error');
		}
	}

	async function handle_set_role(user_id: string, role: 'admin' | 'member') {
		setActionError('');
		try {
			const roles_res = await authFetch('/v1/orgs/list_roles', {
				method: 'POST',
				body: JSON.stringify({ org_id }),
			});
			const roles_data = await roles_res.json();
			if (!roles_data.ok) {
				setActionError(roles_data.error?.message || 'Failed to load roles');
				return;
			}
			const role_id = (roles_data.data?.roles ?? []).find((r: { slug: string }) => r.slug === role)?.id;
			if (role_id == null) {
				setActionError(`Role '${role}' not found in this org`);
				return;
			}
			const res = await authFetch('/v1/users/update_role', {
				method: 'POST', body: JSON.stringify({ org_id, user_id, role_id }),
			});
			const data = await res.json();
			if (!data.ok) { setActionError(data.error?.message || 'Failed'); return; }
			load();
		} catch {
			setActionError('Network error');
		}
	}

	async function handle_create_scope() {
		setActionError('');
		const full_slug = scope_slug ? `${org!.slug}-${scope_slug}` : '';
		try {
			const res = await authFetch('/v1/scopes/new', {
				method: 'POST',
				body: JSON.stringify({
					org_id,
					slug: full_slug,
					display_name: scope_display || undefined,
					visibility: scope_visibility,
					scope_type: 'org',
				}),
			});
			const data = await res.json();
			if (!data.ok) { setActionError(data.error?.message || 'Failed'); return; }
			setScopeSlug('');
			setScopeDisplay('');
			setScopeVisibility('public');
			setCreatingScope(false);
			load();
		} catch {
			setActionError('Network error');
		}
	}

	async function handle_delete_org() {
		if (!org || org_delete_text !== org.slug) return;
		setOrgDeleting(true);
		setActionError('');
		try {
			const res = await authFetch('/v1/orgs/delete', {
				method: 'POST', body: JSON.stringify({ org_id }),
			});
			const data = await res.json();
			if (!data.ok) { setActionError(data.error?.message || 'Failed'); setOrgDeleting(false); return; }
			navigate('/admin/orgs');
		} catch {
			setActionError('Network error');
			setOrgDeleting(false);
		}
	}

	async function handle_delete_scope() {
		if (!scope_delete || scope_delete_text !== `@${scope_delete.slug}`) return;
		setActionError('');
		try {
			const res = await authFetch('/v1/scopes/delete', {
				method: 'POST', body: JSON.stringify({ scope_id: scope_delete.id }),
			});
			const data = await res.json();
			if (!data.ok) { setActionError(data.error?.message || 'Failed'); return; }
			setScopeDelete(null);
			setScopeDeleteText('');
			load();
		} catch {
			setActionError('Network error');
		}
	}

	async function handle_assign_scope(scope_id: string, user_id: string) {
		setActionError('');
		try {
			const res = await authFetch('/v1/scopes/add_user', {
				method: 'POST', body: JSON.stringify({ scope_id, user_id }),
			});
			const data = await res.json();
			if (!data.ok) { setActionError(data.error?.message || 'Failed'); return; }
			load();
		} catch {
			setActionError('Network error');
		}
	}

	async function handle_unassign_scope(scope_id: string, user_id: string) {
		setActionError('');
		try {
			const res = await authFetch('/v1/scopes/remove_user', {
				method: 'POST', body: JSON.stringify({ scope_id, user_id }),
			});
			const data = await res.json();
			if (!data.ok) { setActionError(data.error?.message || 'Failed'); return; }
			load();
		} catch {
			setActionError('Network error');
		}
	}

	if (loading) {
		return (
			<div className="flex min-h-[40vh] items-center justify-center">
				<p className="text-sm text-slate-600">Loading...</p>
			</div>
		);
	}

	if (error || !org) {
		return (
			<div className="flex min-h-[40vh] flex-col items-center justify-center gap-3">
				<p className="text-sm text-red-500">{error || 'Org not found'}</p>
				<button onClick={() => navigate('/admin/orgs')} className="text-sm text-indigo-600 hover:underline">
					Back to Organizations
				</button>
			</div>
		);
	}

	return (
		<div>
			<Breadcrumbs
				items={[
					{ label: 'Admin', to: '/admin' },
					{ label: 'Orgs', to: '/admin/orgs' },
					{ label: org.display_name || org.slug },
				]}
			/>
			{/* Header */}
			<div className="mb-8">
				<button onClick={() => navigate('/admin/orgs')} className="mb-2 text-xs text-slate-500 hover:text-slate-700">
					&larr; Organizations
				</button>
				<div className="flex items-center gap-3">
					<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-100 text-sm font-bold text-indigo-700">
						{org.slug[0].toUpperCase()}
					</div>
					<div className="flex-1">
						{editing_name ? (
							<div className="flex items-center gap-2">
								<input
									value={edit_display}
									onChange={(e) => setEditDisplay(e.target.value)}
									className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-bold outline-none focus:border-indigo-400"
									autoFocus
								/>
								<button onClick={handle_update_name} className="rounded bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700">Save</button>
								<button onClick={() => setEditingName(false)} className="text-xs text-slate-500 hover:text-slate-700">Cancel</button>
							</div>
						) : (
							<div className="flex items-center gap-2">
								<h1 className="text-2xl font-extrabold">{org.display_name}</h1>
								<button
									onClick={() => { setEditDisplay(org.display_name); setEditingName(true); }}
									className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-500 hover:bg-slate-50 hover:text-slate-700"
								>
									Edit
								</button>
							</div>
						)}
						<p className="text-sm text-slate-600">@{org.slug} &middot; Created {new Date(org.created_at).toLocaleDateString()}</p>
					</div>
				</div>
			</div>

			{action_error && (
				<div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-600">
					{action_error}
					<button onClick={() => setActionError('')} className="ml-2 text-red-400 hover:text-red-600">✕</button>
				</div>
			)}

			{/* Members Section */}
			<section className="mb-10">
				<div className="mb-4 flex items-center justify-between">
					<h2 className="text-lg font-bold text-slate-700">Members</h2>
					<span className="text-xs text-slate-600">{org.members.length} member{org.members.length !== 1 ? 's' : ''}</span>
				</div>

				<div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
					<div className="flex gap-3">
						<input
							value={add_username}
							onChange={(e) => setAddUsername(e.target.value)}
							placeholder="Username to add..."
							className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
							onKeyDown={(e) => e.key === 'Enter' && add_username && handle_add_member()}
						/>
						<button
							onClick={handle_add_member}
							disabled={!add_username || adding}
							className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
						>
							{adding ? 'Adding...' : 'Add Member'}
						</button>
					</div>
				</div>

				<div className="space-y-2">
					{org.members.map((m) => (
						<div
							key={m.user_id}
							className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-5 py-3"
						>
							<div className="flex items-center gap-3">
								<div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">
									{m.username[0].toUpperCase()}
								</div>
								<div>
									<p className="text-sm font-semibold text-slate-800">{m.display_name}</p>
									<p className="text-xs text-slate-600">@{m.username}</p>
								</div>
							</div>
							<div className="flex items-center gap-2">
								<span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
									m.role === 'admin'
										? 'bg-indigo-50 text-indigo-700'
										: 'bg-slate-100 text-slate-600'
								}`}>
									{m.role}
								</span>
							<button
								onClick={() => handle_set_role(m.user_id, m.role === 'admin' ? 'member' : 'admin')}
								className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50"
								>
									{m.role === 'admin' ? 'Demote' : 'Promote'}
								</button>
								<button
									onClick={() => handle_remove_member(m.user_id)}
									className="rounded-lg border border-red-200 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50"
								>
									Remove
								</button>
							</div>
						</div>
					))}
				</div>
			</section>

			{/* Scopes Section */}
			<section>
				<div className="mb-4 flex items-center justify-between">
					<h2 className="text-lg font-bold text-slate-700">Scopes</h2>
					{!creating_scope && (
						<button
							onClick={() => setCreatingScope(true)}
							className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
						>
							+ New Scope
						</button>
					)}
				</div>

				{creating_scope && (
					<div className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50/50 p-4">
						<p className="mb-2 text-sm font-semibold text-slate-800">New Scope</p>
						<div className="grid grid-cols-2 gap-3">
							<div className="flex items-center overflow-hidden rounded-lg border border-slate-200 focus-within:border-indigo-400">
								<span className="whitespace-nowrap bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700">@{org.slug}-</span>
								<input
									value={scope_slug}
									onChange={(e) => setScopeSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
									placeholder="e.g. labs"
									className="w-full px-2 py-2 text-sm outline-none"
									autoFocus
								/>
							</div>
							<input
								value={scope_display}
								onChange={(e) => setScopeDisplay(e.target.value)}
								placeholder="Display name (optional)"
								className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
							/>
						</div>
						<div className="mt-3 flex items-center gap-4">
							<label className="flex items-center gap-2 text-xs text-slate-600">
								<input type="radio" name="vis" value="public" checked={scope_visibility === 'public'} onChange={() => setScopeVisibility('public')} />
								Public
							</label>
							<label className="flex items-center gap-2 text-xs text-slate-600">
								<input type="radio" name="vis" value="private" checked={scope_visibility === 'private'} onChange={() => setScopeVisibility('private')} />
								Private
							</label>
						</div>
						<div className="mt-3 flex gap-2">
							<button onClick={handle_create_scope} disabled={!scope_slug} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">Create</button>
							<button onClick={() => { setCreatingScope(false); setActionError(''); }} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50">Cancel</button>
						</div>
					</div>
				)}

				<div className="space-y-2">
					{org.scopes.map((scope) => {
						const is_default = scope.slug === org.slug;
						const is_expanded = expanded_scope === scope.id;

						return (
							<div key={scope.id} className="rounded-xl border border-slate-200 bg-white">
								<div className="flex items-center justify-between px-5 py-4">
									<div className="flex items-center gap-3">
										<button
										onClick={() => setExpandedScope(is_expanded ? null : scope.id)}
										className="text-xs text-slate-500 hover:text-slate-700"
										>
											{is_expanded ? '▾' : '▸'}
										</button>
										<div>
											<div className="flex items-center gap-2">
												<p className="font-mono text-sm font-bold text-slate-700">@{scope.slug}</p>
												{is_default && (
													<span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">default</span>
												)}
												<span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
													scope.visibility === 'public'
														? 'bg-emerald-50 text-emerald-700'
														: 'bg-amber-50 text-amber-700'
												}`}>
													{scope.visibility}
												</span>
											</div>
											{scope.display_name !== scope.slug && (
												<p className="mt-0.5 text-xs text-slate-600">{scope.display_name}</p>
											)}
										</div>
									</div>
									<div className="flex items-center gap-2 text-xs text-slate-700">
										<span>{scope.member_count} member{scope.member_count !== 1 ? 's' : ''}</span>
										{!is_default && (
											<button
												onClick={(e) => { e.stopPropagation(); setScopeDelete({ id: scope.id, slug: scope.slug }); setScopeDeleteText(''); }}
												className="rounded-lg border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
											>
												Delete
											</button>
										)}
									</div>
								</div>

								{is_expanded && (
									<div className="border-t border-slate-100 px-5 py-4">
										<p className="mb-3 text-xs font-semibold text-slate-700">Scope Member Access</p>
									<p className="mb-3 text-xs text-slate-600">
										Org admins automatically have access to all scopes. Toggle access for other members below.
									</p>
										<div className="space-y-1.5">
											{org.members
												.filter((m) => m.role !== 'admin')
												.map((m) => (
													<div key={m.user_id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
														<div className="flex items-center gap-2">
															<div className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-600">
																{m.username[0].toUpperCase()}
															</div>
															<span className="text-xs font-medium text-slate-700">@{m.username}</span>
														</div>
														<div className="flex gap-1">
															<button
																onClick={() => handle_assign_scope(scope.id, m.user_id)}
																className="rounded border border-emerald-200 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-50"
															>
																Grant
															</button>
															<button
																onClick={() => handle_unassign_scope(scope.id, m.user_id)}
																className="rounded border border-red-200 px-2 py-0.5 text-[10px] font-semibold text-red-600 hover:bg-red-50"
															>
																Revoke
															</button>
														</div>
													</div>
												))}
											{org.members.filter((m) => m.role !== 'admin').length === 0 && (
												<p className="text-xs text-slate-600">No non-admin members to assign.</p>
											)}
										</div>
									</div>
								)}
							</div>
						);
					})}
				</div>
			</section>

			{/* Scope delete confirmation */}
			{scope_delete && (
				<div className="mb-6 rounded-lg border border-red-300 bg-red-50 p-4">
					<p className="text-sm font-medium text-red-800">Delete scope @{scope_delete.slug}? This cannot be undone.</p>
					<div className="mt-2">
						<label className="mb-1 block text-xs text-slate-600">
							Type <span className="font-mono font-semibold">@{scope_delete.slug}</span> to confirm
						</label>
						<input
							type="text"
							value={scope_delete_text}
							onChange={(e) => setScopeDeleteText(e.target.value)}
							placeholder={`@${scope_delete.slug}`}
							className="w-full max-w-sm rounded-lg border border-red-300 px-3 py-2 font-mono text-sm outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
						/>
					</div>
					{action_error && <p className="mt-2 text-xs text-red-500">{action_error}</p>}
					<div className="mt-3 flex gap-2">
						<button
							onClick={handle_delete_scope}
							disabled={scope_delete_text !== `@${scope_delete.slug}`}
							className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
						>
							Delete
						</button>
						<button onClick={() => { setScopeDelete(null); setScopeDeleteText(''); }} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
							Cancel
						</button>
					</div>
				</div>
			)}

			{/* Danger zone — org deletion */}
			<section className="mb-10">
				<div className="rounded-lg border border-red-200 bg-red-50/50 p-4">
					{!org_delete_expanded ? (
						<button
							onClick={() => { setOrgDeleteExpanded(true); setOrgDeleteText(''); }}
							className="text-sm font-medium text-red-600 hover:text-red-800"
						>
							Delete this organization...
						</button>
					) : (
						<div>
							<p className="text-sm font-medium text-red-800">
								Delete {org.slug}? This removes all scopes and memberships. This cannot be undone.
							</p>
							<div className="mt-2">
								<label className="mb-1 block text-xs text-slate-600">
									Type <span className="font-mono font-semibold">{org.slug}</span> to confirm
								</label>
								<input
									type="text"
									value={org_delete_text}
									onChange={(e) => setOrgDeleteText(e.target.value)}
									placeholder={org.slug}
									className="w-full max-w-sm rounded-lg border border-red-300 px-3 py-2 font-mono text-sm outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
								/>
							</div>
							{action_error && <p className="mt-2 text-xs text-red-500">{action_error}</p>}
							<div className="mt-3 flex gap-2">
								<button
									onClick={handle_delete_org}
									disabled={org_delete_text !== org.slug || org_deleting}
									className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
								>
									{org_deleting ? 'Deleting...' : 'Delete'}
								</button>
								<button onClick={() => setOrgDeleteExpanded(false)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
									Cancel
								</button>
							</div>
						</div>
					)}
				</div>
			</section>
		</div>
	);
}
