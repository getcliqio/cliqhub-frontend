import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOutletContext, useParams } from 'react-router';
import { useOrgFetch } from '@/lib/org_context';
import { ApiErrorBanner } from '@/components/ui/api_error';
import { Realm_settings_nav } from '@/components/realm_settings_nav';
import type { Realm_outlet_context } from '@/layouts/realm_layout';

interface Mesh_settings_field {
	key: string;
	label: string;
	type: 'string' | 'secret' | 'enum' | 'boolean' | 'url';
	required?: boolean;
	description?: string;
	options?: Array<{ value: string; label: string }>;
	default?: unknown;
}

interface Mesh_adapter_info {
	id: string;
	label: string;
	settings_schema: Mesh_settings_field[];
}

interface A2a_settings {
	realm_id: string;
	a2a_enabled: boolean;
	has_bearer: boolean;
	bearer_prefix: string | null;
	mesh_provider_mode: 'inherit' | 'override' | 'none';
	active_provider_id: string | null;
	effective_provider_id: string | null;
	providers: Record<string, Record<string, unknown>>;
	mesh_status: Record<string, unknown> | null;
	card_url: string | null;
	send_url: string | null;
}

const field_class =
	'mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-900';
const secondary_btn_class =
	'rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800';
const primary_btn_class =
	'rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50';

export function Component() {
	const { realm, org_slug } = useOutletContext<Realm_outlet_context>();
	const { slug: slug_param = '', org: org_param = '' } = useParams();
	const base_path = `/o/${(org_param || org_slug).trim()}/realms/${(slug_param || realm.slug).trim()}`;
	const auth_fetch = useOrgFetch();

	const [settings, set_settings] = useState<A2a_settings | null>(null);
	const [adapters, set_adapters] = useState<Mesh_adapter_info[]>([]);
	const [form, set_form] = useState<Record<string, string>>({});
	const [error, set_error] = useState<string | null>(null);
	const [busy, set_busy] = useState(false);
	const [bearer_once, set_bearer_once] = useState<string | null>(null);
	const [msg, set_msg] = useState<string | null>(null);

	const load = useCallback(async () => {
		set_error(null);
		const [a2a_res, adapters_res] = await Promise.all([
			auth_fetch('/v1/realms/a2a', {
				method: 'POST',
				body: JSON.stringify({ action: 'get', realm_id: realm.id }),
			}),
			auth_fetch('/v1/mesh/adapters/list', {
				method: 'POST',
				body: JSON.stringify({}),
			}),
		]);
		const a2a_data = await a2a_res.json();
		const adapters_data = await adapters_res.json();
		if (!a2a_data.ok) {
			set_error(a2a_data.error?.message || a2a_data.error || 'Failed to load A2A settings');
			return;
		}
		set_settings(a2a_data as A2a_settings);
		set_adapters(adapters_data.adapters ?? []);
		const provider_id = a2a_data.active_provider_id || a2a_data.effective_provider_id;
		const blob = (provider_id && a2a_data.providers?.[provider_id]) || {};
		const next: Record<string, string> = {};
		for (const [k, v] of Object.entries(blob)) {
			if (k.endsWith('_set')) continue;
			next[k] = v == null ? '' : String(v);
		}
		set_form(next);
	}, [auth_fetch, realm.id]);

	useEffect(() => {
		void load();
	}, [load]);

	const selected_provider = settings?.mesh_provider_mode === 'none'
		? null
		: (settings?.mesh_provider_mode === 'override'
			? settings.active_provider_id
			: settings?.effective_provider_id);

	const selected_adapter = useMemo(
		() => adapters.find((a) => a.id === selected_provider) ?? null,
		[adapters, selected_provider],
	);

	async function save_a2a(patch: Record<string, unknown>) {
		set_busy(true);
		set_error(null);
		set_msg(null);
		try {
			const res = await auth_fetch('/v1/realms/a2a', {
				method: 'POST',
				body: JSON.stringify({ action: 'update', realm_id: realm.id, ...patch }),
			});
			const data = await res.json();
			if (!data.ok) {
				set_error(data.error?.message ?? 'Save failed');
				set_busy(false);
				return;
			}
			set_msg('Saved.');
			await load();
		} catch {
			set_error('Network error');
		}
		set_busy(false);
	}

	async function rotate_bearer() {
		set_busy(true);
		set_error(null);
		try {
			const res = await auth_fetch('/v1/auth/rotate_token', {
				method: 'POST',
				body: JSON.stringify({ type: 'a2a', realm_id: realm.id }),
			});
			const data = await res.json();
			if (!data.ok) {
				set_error(data.error?.message ?? 'Rotate failed');
				set_busy(false);
				return;
			}
			const bearer = data.bearer
				?? data.data?.bearer
				?? data.data?.token
				?? data.token
				?? null;
			set_bearer_once(typeof bearer === 'string' ? bearer : null);
			await load();
		} catch {
			set_error('Network error');
		}
		set_busy(false);
	}

	async function mesh_action(path: 'connect' | 'disconnect' | 'refresh') {
		set_busy(true);
		set_error(null);
		set_msg(null);
		try {
			const action = path === 'connect'
				? 'mesh_connect'
				: path === 'disconnect'
					? 'mesh_disconnect'
					: 'mesh_refresh';
			const res = await auth_fetch('/v1/realms/a2a', {
				method: 'POST',
				body: JSON.stringify({ action, realm_id: realm.id }),
			});
			const data = await res.json();
			if (!data.ok) {
				set_error(data.error?.message ?? `${path} failed`);
				set_busy(false);
				return;
			}
			set_msg(`Mesh ${path} completed.`);
			await load();
		} catch {
			set_error('Network error');
		}
		set_busy(false);
	}

	return (
		<div>
			<ApiErrorBanner error={error} onDismiss={() => set_error(null)} />

			<div className="flex flex-col gap-5 md:flex-row md:gap-6">
				<Realm_settings_nav base_path={base_path} />
				<div className="min-w-0 flex-1">
					{!settings ? (
						<p className="text-sm text-slate-500 dark:text-slate-400">Loading A2A settings…</p>
					) : (
						<div className="space-y-8">
							<div>
								<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">A2A</h2>
								<p className="mt-1 max-w-2xl text-xs text-slate-500 dark:text-slate-400">
									A2A lets this realm advertise itself as an Agent so other agents can discover and call it.
									Mesh providers (e.g. Svantic) are optional adapters.
									{' '}
									<a
										className="font-medium text-indigo-600 hover:underline"
										href="https://github.com/getcliqio/cliqhub/blob/main/docs/realm-a2a-mesh.md"
										target="_blank"
										rel="noreferrer"
									>
										Operator guide
									</a>
								</p>
								{msg ? <p className="mt-2 text-sm text-emerald-600">{msg}</p> : null}
							</div>

							<section className="space-y-4">
								<h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Agent surface</h3>
								<label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
									<input
										type="checkbox"
										checked={settings.a2a_enabled}
										disabled={busy}
										onChange={(e) => void save_a2a({ a2a_enabled: e.target.checked })}
										className="rounded border-slate-300"
									/>
									Enable A2A for this realm
								</label>
								{settings.card_url ? (
									<div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
										<div className="space-y-2 px-5 py-4 text-xs text-slate-600 dark:text-slate-300">
											<div className="break-all">
												<span className="font-semibold text-slate-800 dark:text-slate-100">Card</span>
												{' '}
												<code className="rounded bg-slate-100 px-1 dark:bg-slate-800">{settings.card_url}</code>
											</div>
											<div className="break-all">
												<span className="font-semibold text-slate-800 dark:text-slate-100">Send</span>
												{' '}
												<code className="rounded bg-slate-100 px-1 dark:bg-slate-800">{settings.send_url}</code>
											</div>
										</div>
									</div>
								) : null}
								<div className="flex flex-wrap items-center gap-3">
									<button
										type="button"
										className={secondary_btn_class}
										disabled={busy}
										onClick={() => void rotate_bearer()}
									>
										{settings.has_bearer ? 'Rotate A2A bearer' : 'Mint A2A bearer'}
									</button>
									{settings.has_bearer && settings.bearer_prefix ? (
										<span className="text-xs text-slate-500">prefix {settings.bearer_prefix}…</span>
									) : null}
								</div>
								{bearer_once ? (
									<div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
										Copy now — shown once:{' '}
										<code className="break-all font-mono">{bearer_once}</code>
									</div>
								) : null}
							</section>

							<section className="space-y-4 border-t border-slate-200 pt-6 dark:border-slate-700">
								<div>
									<h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Mesh</h3>
									<p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
										Optional adapter that registers this realm’s agent with an external mesh.
									</p>
								</div>

								<label className="block text-sm font-medium text-slate-800 dark:text-slate-200">
									Provider mode
									<select
										className={field_class}
										value={settings.mesh_provider_mode}
										disabled={busy}
										onChange={(e) => void save_a2a({
											mesh_provider_mode: e.target.value as A2a_settings['mesh_provider_mode'],
										})}
									>
										<option value="inherit">Inherit org default</option>
										<option value="override">Override for this realm</option>
										<option value="none">None (A2A only)</option>
									</select>
								</label>

								{settings.mesh_provider_mode === 'override' ? (
									<label className="block text-sm font-medium text-slate-800 dark:text-slate-200">
										Active provider
										<select
											className={field_class}
											value={settings.active_provider_id ?? ''}
											disabled={busy}
											onChange={(e) => void save_a2a({
												active_provider_id: e.target.value || null,
											})}
										>
											<option value="">Select…</option>
											{adapters.map((a) => (
												<option key={a.id} value={a.id}>{a.label}</option>
											))}
										</select>
									</label>
								) : null}

								{settings.effective_provider_id ? (
									<p className="text-xs text-slate-500">
										Effective provider:{' '}
										<span className="font-semibold text-slate-700 dark:text-slate-200">
											{settings.effective_provider_id}
										</span>
									</p>
								) : (
									<p className="text-xs text-slate-500">No mesh provider active.</p>
								)}

								{selected_adapter ? (
									<div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
										<h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
											{selected_adapter.label} settings
										</h4>
										{selected_adapter.settings_schema.map((field) => (
											<label key={field.key} className="block text-sm font-medium text-slate-800 dark:text-slate-200">
												{field.label}
												{field.type === 'enum' ? (
													<select
														className={field_class}
														value={form[field.key] ?? String(field.default ?? '')}
														disabled={busy || settings.mesh_provider_mode === 'inherit'}
														onChange={(e) => set_form((prev) => ({
															...prev,
															[field.key]: e.target.value,
														}))}
													>
														{(field.options ?? []).map((opt) => (
															<option key={opt.value} value={opt.value}>{opt.label}</option>
														))}
													</select>
												) : (
													<input
														className={field_class}
														type={field.type === 'secret' ? 'password' : 'text'}
														value={form[field.key] ?? ''}
														disabled={busy || settings.mesh_provider_mode === 'inherit'}
														onChange={(e) => set_form((prev) => ({
															...prev,
															[field.key]: e.target.value,
														}))}
													/>
												)}
												{field.description ? (
													<span className="mt-1 block text-xs font-normal text-slate-500">
														{field.description}
													</span>
												) : null}
											</label>
										))}
										{settings.mesh_provider_mode === 'override' ? (
											<button
												type="button"
												className={primary_btn_class}
												disabled={busy || !selected_provider}
												onClick={() => void save_a2a({
													provider_id: selected_provider,
													provider_settings: form,
												})}
											>
												Save provider settings
											</button>
										) : (
											<p className="text-xs text-slate-500">
												Inherited settings are edited under org Settings → A2A.
											</p>
										)}
										<div className="flex flex-wrap gap-2 pt-1">
											<button type="button" className={secondary_btn_class} disabled={busy} onClick={() => void mesh_action('connect')}>Connect</button>
											<button type="button" className={secondary_btn_class} disabled={busy} onClick={() => void mesh_action('disconnect')}>Disconnect</button>
											<button type="button" className={secondary_btn_class} disabled={busy} onClick={() => void mesh_action('refresh')}>Refresh</button>
										</div>
										{settings.mesh_status ? (
											<pre className="overflow-auto rounded-lg bg-slate-900 p-4 font-mono text-[11px] leading-relaxed text-slate-100">
												{JSON.stringify(settings.mesh_status, null, 2)}
											</pre>
										) : null}
										{typeof settings.mesh_status?.dispatch_secret_once === 'string' ? (
											<div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
												Dispatch secret (copy into Svantic Dispatch Auth for instance{' '}
												{String((settings.mesh_status.details as { instance_id?: string } | undefined)?.instance_id ?? '')}
												): <code className="break-all font-mono">{String(settings.mesh_status.dispatch_secret_once)}</code>
											</div>
										) : null}
									</div>
								) : null}
							</section>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
