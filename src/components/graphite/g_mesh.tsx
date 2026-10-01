/**
 * A2A + mesh settings (Graphite): org defaults and per-realm A2A.
 *   Org:   orgs/mesh/get · orgs/mesh/update
 *   Realm: realms/a2a {action: get|update|mesh_connect|mesh_disconnect|mesh_refresh}
 *          · mesh/adapters/list · auth/rotate_token {type:'a2a'}
 * Provider settings come from each adapter's settings_schema; secret values
 * are never read back (the API returns `<key>_set` flags instead).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuthFetch } from '@/lib/auth_context';
import { Banner } from '@/components/graphite/g_admin';
import { G_BTN, G_INPUT, G_PRIMARY } from '@/components/graphite/g_agents';
import { Secret_reveal } from '@/components/graphite/g_secret';

export interface Mesh_field { key: string; label: string; type: 'string' | 'secret' | 'enum' | 'boolean' | 'url'; required?: boolean; description?: string; options?: Array<{ value: string; label: string }>; default?: unknown }
export interface Mesh_adapter { id: string; label: string; settings_schema: Mesh_field[] }

type Raw = Record<string, unknown>;
async function call(fetcher: ReturnType<typeof useAuthFetch>, path: string, body: Raw): Promise<{ ok: true; data: Raw } | { ok: false; error: string }> {
	try {
		const res = await fetcher(path, { method: 'POST', body: JSON.stringify(body) });
		const d = await res.json().catch(() => null) as Raw | null;
		if (!res.ok || !d?.ok) {
			const e = d?.error as { message?: string } | string | undefined;
			return { ok: false, error: typeof e === 'string' ? e : e?.message ?? `Request failed (${res.status})` };
		}
		return { ok: true, data: (d.data as Raw | undefined) ?? d };
	} catch { return { ok: false, error: 'Network error — try again.' }; }
}

/** Form state for a provider blob; `<key>_set` markers are dropped. */
export function provider_form(blob: Raw | undefined | null): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(blob ?? {})) if (!k.endsWith('_set')) out[k] = v == null ? '' : String(v);
	return out;
}

export function Provider_fields({ adapter, form, set_form, secrets_set, disabled }: { adapter: Mesh_adapter; form: Record<string, string>; set_form: (f: Record<string, string>) => void; secrets_set?: Raw; disabled?: boolean }) {
	return (
		<div className="grid gap-3 sm:grid-cols-2">
			{adapter.settings_schema.map((f) => (
				<label key={f.key} className="flex flex-col gap-1.5 text-[12.5px] text-[var(--g-ink-2)]">
					<span>{f.label}{f.required ? <span className="ml-1 text-[var(--g-bad)]">*</span> : null}</span>
					{f.type === 'enum' ? (
						<select aria-label={f.label} disabled={disabled} value={form[f.key] ?? String(f.default ?? '')} onChange={(e) => set_form({ ...form, [f.key]: e.target.value })} className={`${G_INPUT} w-full`}>
							{(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
						</select>
					) : f.type === 'boolean' ? (
						<select aria-label={f.label} disabled={disabled} value={form[f.key] ?? String(f.default ?? 'false')} onChange={(e) => set_form({ ...form, [f.key]: e.target.value })} className={`${G_INPUT} w-full`}><option value="true">On</option><option value="false">Off</option></select>
					) : (
						<input aria-label={f.label} disabled={disabled} type={f.type === 'secret' ? 'password' : 'text'} value={form[f.key] ?? ''} placeholder={f.type === 'secret' && secrets_set?.[`${f.key}_set`] ? 'set — type to replace' : f.description} onChange={(e) => set_form({ ...form, [f.key]: e.target.value })} className={`${G_INPUT} w-full`} />
					)}
					{f.description && f.type !== 'secret' ? <span className="text-[11.5px] text-[var(--g-ink-3)]">{f.description}</span> : null}
				</label>
			))}
		</div>
	);
}

interface Org_mesh { active_provider_id: string | null; providers: Record<string, Raw>; auto_enable_a2a_on_realm_create: boolean; adapters: Mesh_adapter[] }

/** Org-wide A2A defaults (realms inherit unless they override). */
export function Org_mesh_panel({ org_id, can_edit }: { org_id: string; can_edit: boolean }) {
	const fetcher = useAuthFetch();
	const [s, set_s] = useState<Org_mesh | null>(null);
	const [form, set_form] = useState<Record<string, string>>({});
	const [msg, set_msg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
	const [busy, set_busy] = useState(false);
	const load = useCallback(async () => {
		const r = await call(fetcher, '/v1/orgs/mesh/get', { org_id });
		if (!r.ok) { set_msg({ tone: 'bad', text: r.error }); return; }
		const d = r.data as unknown as Org_mesh;
		set_s({ ...d, adapters: d.adapters ?? [], providers: d.providers ?? {} });
		set_form(provider_form(d.active_provider_id ? d.providers?.[d.active_provider_id] : null));
	}, [fetcher, org_id]);
	useEffect(() => { void load(); }, [load]);
	async function save(patch: Raw, done = 'Saved.') {
		set_busy(true); set_msg(null);
		const r = await call(fetcher, '/v1/orgs/mesh/update', { org_id, ...patch });
		set_busy(false);
		set_msg(r.ok ? { tone: 'ok', text: done } : { tone: 'bad', text: r.error });
		if (r.ok) await load();
	}
	const adapter = useMemo(() => s?.adapters.find((a) => a.id === s.active_provider_id) ?? null, [s]);
	if (!s) return msg ? <Banner tone="bad">{msg.text}</Banner> : <div className="h-[160px] animate-pulse rounded-[10px] bg-[var(--g-panel)]" aria-busy="true" />;
	return (
		<div className="flex max-w-[760px] flex-col gap-4">
			<p className="text-[12.5px] text-[var(--g-ink-3)]">A2A lets each realm advertise itself as an agent other agents can discover and call. These are the org defaults; realms inherit them unless they override (Realm › Settings › A2A).</p>
			{msg ? <Banner tone={msg.tone}>{msg.text}</Banner> : null}
			<section className="flex flex-col gap-3.5 rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)] p-4">
				<label className="flex items-center gap-2 text-[13px]"><input type="checkbox" disabled={!can_edit || busy} checked={s.auto_enable_a2a_on_realm_create} onChange={(e) => void save({ auto_enable_a2a_on_realm_create: e.target.checked })} />Turn on A2A for new realms in this org</label>
				<label className="flex flex-col gap-1.5 text-[12.5px] text-[var(--g-ink-2)]">Mesh provider
					<select aria-label="Mesh provider" disabled={!can_edit || busy} value={s.active_provider_id ?? ''} onChange={(e) => void save({ active_provider_id: e.target.value || null })} className={`${G_INPUT} w-[280px]`}>
						<option value="">None (A2A only)</option>
						{s.adapters.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
					</select>
				</label>
				{adapter ? (
					<>
						<Provider_fields adapter={adapter} form={form} set_form={set_form} secrets_set={s.providers[adapter.id]} disabled={!can_edit || busy} />
						{can_edit ? <div><button type="button" disabled={busy} onClick={() => void save({ provider_id: adapter.id, provider_settings: form }, 'Provider settings saved.')} className={G_PRIMARY}>Save provider settings</button></div> : null}
					</>
				) : null}
			</section>
		</div>
	);
}

interface Realm_a2a { a2a_enabled: boolean; has_bearer: boolean; bearer_prefix: string | null; mesh_provider_mode: 'inherit' | 'override' | 'none'; active_provider_id: string | null; effective_provider_id: string | null; providers: Record<string, Raw>; mesh_status: Raw | null; card_url: string | null; send_url: string | null }

/** One realm's A2A surface and mesh connection. */
export function Realm_a2a_panel({ realm_id, can_edit }: { realm_id: string; can_edit: boolean }) {
	const fetcher = useAuthFetch();
	const [s, set_s] = useState<Realm_a2a | null>(null);
	const [adapters, set_adapters] = useState<Mesh_adapter[]>([]);
	const [form, set_form] = useState<Record<string, string>>({});
	const [msg, set_msg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
	const [busy, set_busy] = useState(false);
	const [bearer, set_bearer] = useState<string | null>(null);
	const load = useCallback(async () => {
		const [a, ad] = await Promise.all([call(fetcher, '/v1/realms/a2a', { action: 'get', realm_id }), call(fetcher, '/v1/mesh/adapters/list', {})]);
		if (!a.ok) { set_msg({ tone: 'bad', text: a.error }); return; }
		const d = a.data as unknown as Realm_a2a;
		set_s({ ...d, providers: d.providers ?? {} });
		set_adapters(ad.ok ? ((ad.data.adapters as Mesh_adapter[] | undefined) ?? []) : []);
		const pid = d.active_provider_id || d.effective_provider_id;
		set_form(provider_form(pid ? d.providers?.[pid] : null));
	}, [fetcher, realm_id]);
	useEffect(() => { void load(); }, [load]);
	async function act(body: Raw, done: string) {
		set_busy(true); set_msg(null);
		const r = await call(fetcher, '/v1/realms/a2a', { realm_id, ...body });
		set_busy(false);
		set_msg(r.ok ? { tone: 'ok', text: done } : { tone: 'bad', text: r.error });
		if (r.ok) await load();
	}
	async function rotate() {
		set_busy(true); set_msg(null);
		const r = await call(fetcher, '/v1/auth/rotate_token', { type: 'a2a', realm_id });
		set_busy(false);
		if (!r.ok) { set_msg({ tone: 'bad', text: r.error }); return; }
		const v = r.data.bearer ?? r.data.token;
		set_bearer(typeof v === 'string' ? v : null);
		await load();
	}
	const provider = s?.mesh_provider_mode === 'none' ? null : s?.mesh_provider_mode === 'override' ? s.active_provider_id : s?.effective_provider_id;
	const adapter = adapters.find((a) => a.id === provider) ?? null;
	if (!s) return msg ? <Banner tone="bad">{msg.text}</Banner> : <div className="h-[200px] animate-pulse rounded-[10px] bg-[var(--g-panel)]" aria-busy="true" />;
	const status = s.mesh_status;
	const connected = status && (status.connected === true || status.status === 'connected');
	return (
		<div className="flex max-w-[760px] flex-col gap-4" data-testid="realm-a2a">
			{msg ? <Banner tone={msg.tone}>{msg.text}</Banner> : null}
			{bearer ? <Secret_reveal title="A2A bearer token" secret={bearer} note="Callers send it as Authorization: Bearer … to the send endpoint." on_done={() => set_bearer(null)} /> : null}
			<section className="flex flex-col gap-3 rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)] p-4" aria-label="Agent surface">
				<div className="flex items-center gap-2"><b className="text-[14px]">Agent-to-agent surface</b>
					<label className="ml-auto flex items-center gap-2 text-[12.5px]"><input type="checkbox" aria-label="A2A enabled" disabled={!can_edit || busy} checked={s.a2a_enabled} onChange={(e) => void act({ action: 'update', a2a_enabled: e.target.checked }, e.target.checked ? 'A2A turned on.' : 'A2A turned off.')} />{s.a2a_enabled ? 'On' : 'Off'}</label>
				</div>
				{s.card_url ? <label className="flex flex-col gap-1 text-[12.5px] text-[var(--g-ink-2)]">Agent card<input readOnly value={s.card_url} className={`${G_INPUT} g-mono w-full`} /></label> : null}
				{s.send_url ? <label className="flex flex-col gap-1 text-[12.5px] text-[var(--g-ink-2)]">Send endpoint<input readOnly value={s.send_url} className={`${G_INPUT} g-mono w-full`} /></label> : null}
				<div className="flex flex-wrap items-center gap-2">
					{s.card_url ? <button type="button" onClick={() => void navigator.clipboard?.writeText(s.card_url!)} className={G_BTN}>Copy card URL</button> : null}
					{can_edit ? <button type="button" disabled={busy} onClick={() => void rotate()} className={G_BTN}>{s.has_bearer ? 'Rotate bearer token…' : 'Create bearer token'}</button> : null}
					{s.has_bearer && s.bearer_prefix ? <span className="g-mono text-[12px] text-[var(--g-ink-3)]">current: {s.bearer_prefix}…</span> : null}
				</div>
			</section>
			<section className="flex flex-col gap-3 rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)] p-4" aria-label="Mesh">
				<b className="text-[14px]">Mesh</b>
				<div role="radiogroup" aria-label="Mesh provider mode" className="flex flex-wrap gap-2">
					{([['inherit', `Use org default${s.effective_provider_id && s.mesh_provider_mode === 'inherit' ? ` (${s.effective_provider_id})` : ''}`], ['override', 'Override for this realm'], ['none', 'None (A2A only)']] as const).map(([k, l]) => (
						<button key={k} type="button" role="radio" aria-checked={s.mesh_provider_mode === k} disabled={!can_edit || busy} onClick={() => void act({ action: 'update', mesh_provider_mode: k }, 'Saved.')} className={`rounded-full border px-3 py-1 text-[12.5px] ${s.mesh_provider_mode === k ? 'border-[var(--g-acc-line)] bg-[var(--g-acc-soft)] text-[var(--g-ink)]' : 'border-[var(--g-line)] text-[var(--g-ink-3)]'}`}>{l}</button>
					))}
				</div>
				{s.mesh_provider_mode === 'override' ? (
					<select aria-label="Provider" disabled={!can_edit || busy} value={s.active_provider_id ?? ''} onChange={(e) => void act({ action: 'update', active_provider_id: e.target.value || null }, 'Saved.')} className={`${G_INPUT} w-[260px]`}>
						<option value="">Choose a provider…</option>
						{adapters.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
					</select>
				) : null}
				{adapter ? <Provider_fields adapter={adapter} form={form} set_form={set_form} secrets_set={s.providers[adapter.id]} disabled={!can_edit || busy || s.mesh_provider_mode === 'inherit'} /> : null}
				{adapter && s.mesh_provider_mode === 'override' && can_edit ? <div><button type="button" disabled={busy} onClick={() => void act({ action: 'update', provider_id: provider, provider_settings: form }, 'Provider settings saved.')} className={G_PRIMARY}>Save provider settings</button></div> : null}
				{provider ? (
					<div className="flex flex-wrap items-center gap-2 border-t border-[var(--g-line)] pt-3 text-[12.5px]">
						<span className={`rounded-full px-2 py-0.5 font-semibold ${connected ? 'bg-[var(--g-ok-soft)] text-[var(--g-ok)]' : 'bg-[var(--g-soft)] text-[var(--g-ink-3)]'}`}>● {connected ? 'Connected' : status ? String(status.status ?? 'Not connected') : 'Not connected'}</span>
						{can_edit ? <span className="ml-auto flex gap-2"><button type="button" disabled={busy} onClick={() => void act({ action: 'mesh_connect' }, 'Connected.')} className={G_BTN}>Connect</button><button type="button" disabled={busy} onClick={() => void act({ action: 'mesh_refresh' }, 'Refreshed.')} className={G_BTN}>Refresh</button><button type="button" disabled={busy} onClick={() => void act({ action: 'mesh_disconnect' }, 'Disconnected.')} className={G_BTN}>Disconnect</button></span> : null}
					</div>
				) : null}
				{typeof status?.dispatch_secret_once === 'string' ? <Secret_reveal title="Mesh dispatch secret" secret={String(status.dispatch_secret_once)} on_done={() => void load()} /> : null}
			</section>
		</div>
	);
}
