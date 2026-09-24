/**
 * Settings → Integrations → JIRA (slices 1.7 + 1.8).
 *
 * Renders one row per (admin realm × JIRA binding). In the slice-1.8
 * runtime model the same realm can be bound to N JIRA workspaces AND
 * the same workspace can be bound into N realms — so an operator sees
 * one row per subscription, not one row per realm. Realms with no
 * bindings surface as a single "not connected" row.
 *
 *  - **bound row**: workspace_id, connected date, actions (rotate
 *    secret, disconnect).
 *  - **unbound row**: "not connected" pill + hint that the panel
 *    lazy-provisions on first dispatch.
 *
 * The SPA never drives register/rotate on the *initial* wiring — that
 * happens the first time a Cliq run is dispatched to a realm from a
 * JIRA panel. Once bound, rotate/disconnect from here work as normal.
 *
 * Gated by `VITE_ENABLE_JIRA_INTEGRATION`. When unset (or the backend
 * flag is off), a `<Navigate to="/settings" replace />` is returned
 * so the URL becomes a soft 404 that stays inside the shell.
 */

import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router';
import { useOrgFetch } from '@/lib/org_context';
import { PageHeader } from '@/components/ui/page_header';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { ApiErrorBanner } from '@/components/ui/api_error';
import { NewTokenBanner } from '@/components/new_token_banner';
import { format_date } from '@/lib/format_time';
import { Plug } from 'lucide-react';

interface JiraBinding {
	realm_id: string;
	realm_slug: string;
	realm_name: string;
	channel_id: string | null;
	workspace_id: string | null;
	connected_at: number | null;
}


function api_error_message(data: { error?: string | { message?: string } }): string {
	if (typeof data.error === 'string') return data.error;
	return data.error?.message ?? 'Request failed';
}

function is_flag_enabled(): boolean {
	return import.meta.env.VITE_ENABLE_JIRA_INTEGRATION === 'true';
}

export function Component() {
	if (!is_flag_enabled()) return <Navigate to="/settings" replace />;

	const auth_fetch = useOrgFetch();
	const [bindings, set_bindings] = useState<JiraBinding[]>([]);
	const [loading, set_loading] = useState(true);
	const [error, set_error] = useState<string | null>(null);
	const [rotated_secret, set_rotated_secret] = useState<string | null>(null);
	// busy is keyed per (realm_id, workspace_id) so N bindings on the
	// same realm don't disable each other's rotate/disconnect buttons.
	const [busy_binding_key, set_busy_binding_key] = useState<string | null>(null);

	const load = useCallback(async () => {
		set_loading(true);
		try {
			// Body is empty — session cookie identifies the caller. The
			// backend controller resolves user_id from req.auth.user
			// (falls back to body.api_token, unused here).
			const res = await auth_fetch('/v1/integrations/jira/list', {
				method: 'POST',
				body: JSON.stringify({}),
			});
			// Handle backend flag off (404) explicitly so the operator
			// gets a clear message rather than a hard error.
			if (res.status === 404) {
				set_error('JIRA integration is not enabled on this Cliq deployment.');
				set_bindings([]);
				return;
			}
			const data = await res.json();
			if (data.ok) {
				set_bindings(data.bindings ?? []);
				set_error(null);
				return;
			}
			set_error(api_error_message(data));
		} catch {
			set_error('Failed to load JIRA bindings');
		} finally {
			set_loading(false);
		}
	}, [auth_fetch]);

	useEffect(() => { load(); }, [load]);

	async function handle_rotate(realm_id: string, workspace_id: string) {
		const key = `${realm_id}::${workspace_id}`;
		set_busy_binding_key(key);
		set_error(null);
		set_rotated_secret(null);
		try {
			const res = await auth_fetch('/v1/integrations/jira/rotate_secret', {
				method: 'POST',
				body: JSON.stringify({ realm_id, workspace_id }),
			});
			const data = await res.json();
			if (data.ok) {
				set_rotated_secret(data.secret);
				return;
			}
			set_error(api_error_message(data));
		} catch {
			set_error('Failed to rotate secret');
		} finally {
			set_busy_binding_key(null);
		}
	}

	async function handle_disconnect(realm_id: string, workspace_id: string) {
		const confirmed = window.confirm(
			`Disconnect JIRA workspace ${workspace_id} from this realm? ` +
			'Forge will keep the plaintext secret; you must uninstall the Cliq Forge app ' +
			'from the workspace separately to stop event delivery.',
		);
		if (!confirmed) return;
		const key = `${realm_id}::${workspace_id}`;
		set_busy_binding_key(key);
		set_error(null);
		try {
			const res = await auth_fetch('/v1/integrations/jira/disconnect', {
				method: 'POST',
				body: JSON.stringify({ realm_id, workspace_id }),
			});
			const data = await res.json();
			if (data.ok) {
				await load();
				return;
			}
			set_error(api_error_message(data));
		} catch {
			set_error('Failed to disconnect JIRA workspace');
		} finally {
			set_busy_binding_key(null);
		}
	}


	if (loading && bindings.length === 0) {
		return (
			<div>
				<Breadcrumbs items={[
					{ label: 'Settings', to: '/settings' },
					{ label: 'JIRA' },
				]} />
				<div className="flex min-h-[30vh] items-center justify-center">
					<p className="text-sm text-slate-400">Loading JIRA bindings...</p>
				</div>
			</div>
		);
	}

	return (
		<div>
			<Breadcrumbs items={[
				{ label: 'Settings', to: '/settings' },
				{ label: 'JIRA' },
			]} />
			<PageHeader
				icon={Plug}
				tone="slate"
				title="JIRA integration"
				description={(
					<>
						Cliq run lifecycle events (started, completed, failed, crashed, input-required)
						fan out to Atlassian JIRA workspaces via the Cliq Forge app, which posts them on
						linked issues. Bindings are created automatically the first time you dispatch a
						run to a realm from a JIRA panel.
					</>
				)}
			/>

			<ApiErrorBanner error={error} onDismiss={() => set_error(null)} />

			{rotated_secret && (
				<div className="mt-4">
					<p className="mb-2 text-xs font-semibold text-amber-700">
						New webhook secret — paste this into the JIRA Forge admin now. It is shown
						once and cannot be recovered.
					</p>
					<NewTokenBanner token={rotated_secret} />
				</div>
			)}

			<div className="mt-6 rounded-xl border border-indigo-100 bg-indigo-50/40 p-4 text-xs text-slate-600">
				<p className="font-semibold text-slate-800">How bindings appear</p>
				<ol className="mt-2 list-decimal space-y-1 pl-4">
					<li>Install the Cliq Forge app into your JIRA workspace (Marketplace).</li>
					<li>Paste a Cliq PAT on the Forge <em>Connect</em> page — no realm choice needed.</li>
					<li>Open a JIRA issue, choose a realm + team, and click <em>Develop using Cliq</em>.</li>
					<li>The first dispatch auto-creates a webhook binding for that (workspace, realm)
						pair. It will appear here.</li>
				</ol>
			</div>

			{bindings.length === 0 ? (
				<div className="mt-6 rounded-xl border-2 border-dashed border-slate-200 py-12 text-center">
					<p className="text-slate-400">
						You don't admin any realms yet, so there's nothing to bind.
					</p>
				</div>
			) : (
				<div className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b border-slate-100 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">
								<th className="px-5 py-2">Realm</th>
								<th className="px-5 py-2">JIRA workspace</th>
								<th className="px-5 py-2">Connected</th>
								<th className="px-5 py-2" />
							</tr>
						</thead>
						<tbody className="divide-y divide-slate-50">
							{bindings.map((b) => {
								const key = `${b.realm_id}::${b.workspace_id ?? 'unbound'}`;
								return (
									<RealmRow
										key={`${b.realm_id}::${b.channel_id ?? 'unbound'}`}
										binding={b}
										busy={busy_binding_key === key}
										on_rotate={handle_rotate}
										on_disconnect={handle_disconnect}
									/>
								);
							})}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}

interface RowProps {
	binding: JiraBinding;
	busy: boolean;
	on_rotate: (realm_id: string, workspace_id: string) => void;
	on_disconnect: (realm_id: string, workspace_id: string) => void;
}

function RealmRow({
	binding, busy, on_rotate, on_disconnect,
}: RowProps) {
	const is_bound = binding.channel_id !== null && binding.workspace_id !== null;

	if (!is_bound) {
		return (
			<tr data-realm-id={binding.realm_id}>
				<td className="px-5 py-3">
					<p className="text-sm font-semibold text-slate-800">{binding.realm_name}</p>
					<p className="text-xs text-slate-500">{binding.realm_slug}</p>
				</td>
				<td className="px-5 py-3" colSpan={2}>
					<span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
						Not connected
					</span>
					<span className="ml-2 text-xs text-slate-400">
						Connect from the Cliq Forge app in your JIRA workspace.
					</span>
				</td>
				<td />
			</tr>
		);
	}

	return (
		<tr data-realm-id={binding.realm_id}>
			<td className="px-5 py-3">
				<p className="text-sm font-semibold text-slate-800">{binding.realm_name}</p>
				<p className="text-xs text-slate-500">{binding.realm_slug}</p>
			</td>
			<td className="px-5 py-3">
				<code className="rounded bg-slate-100 px-2 py-0.5 text-xs">
					{binding.workspace_id}
				</code>
			</td>
			<td className="px-5 py-3 text-slate-500">
				{binding.connected_at ? format_date(binding.connected_at) : '—'}
			</td>
			<td className="px-5 py-3 text-right">
				<div className="flex justify-end gap-2">
					<button
						type="button"
						onClick={() => on_rotate(binding.realm_id, binding.workspace_id!)}
						disabled={busy}
						className="rounded-lg border border-amber-200 px-3 py-1.5 text-xs font-semibold text-amber-600 hover:bg-amber-50 disabled:opacity-50"
					>
						Rotate secret
					</button>
					<button
						type="button"
						onClick={() => on_disconnect(binding.realm_id, binding.workspace_id!)}
						disabled={busy}
						className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
					>
						Disconnect
					</button>
				</div>
			</td>
		</tr>
	);
}
