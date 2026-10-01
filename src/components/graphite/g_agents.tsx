/**
 * Shared pieces for Manage › Agents and Realm › Agents: kind tile, setup badge,
 * the settings form (org defaults or one realm's overrides) and the register
 * dialog. Writes are single existing Core routes via the BFF pass-through:
 * agents/update_settings, agents/register, agents/deregister.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import yaml from 'js-yaml';
import { useAuthFetch } from '@/lib/auth_context';
import { api_message } from '@/lib/use_bff_read';
import { setting_applies } from '@/lib/setting_when';
import { agent_kind, settings_patch, type Agent_field, type Agent_settings_view } from '@/lib/agents';

export const G_PRIMARY = 'inline-flex shrink-0 items-center whitespace-nowrap gap-1.5 rounded-md bg-[var(--g-acc)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--g-on-acc)] hover:bg-[var(--g-acc-hover)] disabled:opacity-40';
export const G_BTN = 'inline-flex shrink-0 items-center whitespace-nowrap gap-1.5 rounded-md border border-[var(--g-line)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--g-ink-2)] hover:text-[var(--g-ink)] disabled:opacity-40';
export const G_INPUT = 'min-w-0 rounded-lg border border-[var(--g-line)] bg-[var(--g-bg)] px-3 py-1.5 text-[13px] text-[var(--g-ink)] outline-none placeholder:text-[#5d616b] focus:border-[var(--g-acc-line)]';
export const G_PILL = (on: boolean) => `inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[12.5px] ${on ? 'border-[var(--g-acc-line)] bg-[var(--g-acc-soft)] text-[var(--g-ink)]' : 'border-[var(--g-line)] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]'}`;

function hexa(hex: string, a: number) { const n = Number.parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; }

export function Agent_tile({ agent_type, name, size = 30 }: { agent_type: string; name?: string; size?: number }) {
	const k = agent_kind(agent_type, name);
	return <span aria-hidden className="grid shrink-0 place-items-center rounded-lg font-bold" style={{ width: size, height: size, fontSize: size * 0.46, color: k.color, background: hexa(k.color, 0.14), border: `1px solid ${hexa(k.color, 0.35)}` }}>{k.glyph}</span>;
}

export function Kind_chip({ agent_type, name }: { agent_type: string; name?: string }) {
	const k = agent_kind(agent_type, name);
	return <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--g-ink-2)]"><i aria-hidden className="block h-2 w-2 rounded-[2px]" style={{ background: k.color }} />{k.label}</span>;
}

export const Origin_badge = ({ is_system }: { is_system: boolean }) => is_system
	? <span className="rounded border border-[var(--g-line)] px-1.5 text-[10px] font-bold tracking-[0.05em] text-[var(--g-ink-3)]">BUILT-IN</span>
	: <span className="rounded border border-[rgba(155,140,255,.45)] px-1.5 text-[10px] font-bold tracking-[0.05em] text-[#cfc7ff]">CUSTOM</span>;

export function Setup_badge({ setup, used }: { setup: { has_settings: boolean; required_total: number; required_configured: number; ready: boolean } | null; used?: number | null }) {
	if (!setup) return <span className="text-[12px] text-[var(--g-ink-3)]">—</span>;
	if (!setup.has_settings || setup.required_total === 0) return <span className="rounded-full bg-[var(--g-soft)] px-2 py-0.5 text-[11.5px] font-semibold text-[var(--g-ink-3)]">No settings</span>;
	if (setup.ready) return <span className="rounded-full bg-[var(--g-ok-soft)] px-2 py-0.5 text-[11.5px] font-semibold text-[var(--g-ok)]">✓ Ready</span>;
	const missing = setup.required_total - setup.required_configured;
	if (used === 0) return <span className="text-[12px] text-[var(--g-ink-3)]">Not set · unused</span>;
	return <span className="rounded-full bg-[var(--g-warn-soft)] px-2 py-0.5 text-[11.5px] font-semibold text-[var(--g-warn-text)]">! {missing} of {setup.required_total} key{setup.required_total === 1 ? '' : 's'} missing</span>;
}

export function use_post() {
	const auth_fetch = useAuthFetch();
	return async (path: string, body: Record<string, unknown>): Promise<{ ok: true; data: unknown } | { ok: false; error: string; code: string | null }> => {
		try {
			const res = await auth_fetch(path, { method: 'POST', body: JSON.stringify(body) });
			const payload = await res.json().catch(() => null);
			if (!res.ok || !payload?.ok) return { ok: false, error: api_message(payload, 'Request failed'), code: (payload?.error?.code as string | undefined) ?? null };
			return { ok: true, data: payload.data ?? payload };
		} catch {
			return { ok: false, error: 'Network error — check your connection.', code: null };
		}
	};
}

function Source_tag({ f, mode, realm }: { f: Agent_field; mode: 'org' | 'realm'; realm: string | null }) {
	if (mode === 'realm') {
		if (f.source === 'realm') return <span className="text-[11px] text-[#8fb8ff]">overridden in {realm}</span>;
		if (f.org_value) return <span className="text-[11px] text-[var(--g-ink-3)]">from the org</span>;
		return <span className="text-[11px] text-[var(--g-warn-text)]">not set anywhere</span>;
	}
	return f.set ? <span className="text-[11px] text-[var(--g-ink-3)]">set for org</span> : <span className={`text-[11px] ${f.required ? 'text-[var(--g-warn-text)]' : 'text-[var(--g-ink-3)]'}`}>not set</span>;
}

/**
 * One form for both scopes.
 *   org   — edit the org defaults every realm inherits.
 *   realm — per key: inherit the org value, or override it here ("Use org value" clears).
 * Secret values arrive masked; they can be replaced, never read back.
 */
export function Settings_form({ view, org_id, agent_id, on_saved }: { view: Agent_settings_view; org_id: string; agent_id: string; on_saved: (msg: string) => void }) {
	const post = use_post();
	const mode = view.scope;
	const realm_slug = view.realm?.slug ?? null;
	const [edits, set_edits] = useState<Record<string, string>>({});
	const [clears, set_clears] = useState<Set<string>>(new Set());
	const [open_optional, set_open_optional] = useState(false);
	const [busy, set_busy] = useState(false);
	const [error, set_error] = useState<string | null>(null);
	useEffect(() => { set_edits({}); set_clears(new Set()); set_error(null); }, [view]);

	// Current values (as far as visibility of `when` keys goes).
	const current = useMemo(() => {
		const v: Record<string, string> = {};
		for (const f of view.fields) { const x = f.key in edits ? edits[f.key] : (f.secret ? (f.set ? 'set' : '') : f.value ?? f.org_value ?? ''); if (x) v[f.key] = x; }
		return v;
	}, [view.fields, edits]);
	const visible = view.fields.filter((f) => setting_applies({ when: f.when ?? undefined }, current));
	const required = visible.filter((f) => f.required);
	const optional = visible.filter((f) => !f.required);
	const patch = settings_patch(view.fields, edits, clears, mode);
	const dirty = Object.keys(patch.values).length + patch.clear.length > 0;
	const missing = required.filter((f) => {
		if (clears.has(f.key)) return !(mode === 'realm' && f.org_value);
		if (f.key in edits) return !edits[f.key].trim() && !(mode === 'realm' && f.org_value);
		return !(f.set || (mode === 'realm' && f.org_value));
	});

	async function save() {
		set_busy(true); set_error(null);
		const r = await post('/v1/agents/update_settings', { org_id, id: agent_id, ...(view.realm ? { realm_id: view.realm.id } : {}), settings: { ...(Object.keys(patch.values).length ? { values: patch.values } : {}), ...(patch.clear.length ? { clear: patch.clear } : {}) } });
		set_busy(false);
		if (!r.ok) { set_error(r.error); return; }
		on_saved(mode === 'realm' ? `Saved for ${realm_slug}.` : 'Saved for the org.');
	}

	function field(f: Agent_field) {
		const editing = f.key in edits;
		const cleared = clears.has(f.key);
		const inherited = mode === 'realm' && f.source !== 'realm';
		let control: ReactNode;
		if (inherited && !editing) {
			control = (
				<>
					<div className="flex-1 truncate rounded-lg border border-dashed border-[var(--g-line)] px-3 py-1.5 text-[13px] text-[var(--g-ink-3)]" data-testid={`inherited-${f.key}`}>{f.org_value ?? 'not set for the org'}</div>
					<button type="button" onClick={() => set_edits((e) => ({ ...e, [f.key]: '' }))} className={G_BTN}>Override here</button>
				</>
			);
		} else if (f.secret && f.set && !editing && !cleared) {
			control = (
				<>
					<div className="flex flex-1 items-center rounded-lg border border-[var(--g-line)] px-3 py-1.5 text-[13px]"><span className="g-mono text-[var(--g-ink-2)]" aria-label={`${f.key} is set`}>{f.value}</span>
						<button type="button" onClick={() => set_edits((e) => ({ ...e, [f.key]: '' }))} className="ml-auto text-[12px] font-semibold text-[var(--g-acc)]">Replace</button></div>
					{mode === 'realm' ? <button type="button" onClick={() => set_clears((c) => new Set(c).add(f.key))} className={G_BTN}>Use org value</button> : null}
				</>
			);
		} else if (cleared) {
			control = (
				<>
					<div className="flex-1 rounded-lg border border-dashed border-[var(--g-line)] px-3 py-1.5 text-[13px] text-[var(--g-ink-3)]">{mode === 'realm' ? `Will use the org value${f.org_value ? ` (${f.org_value})` : ''}` : 'Will be cleared'}</div>
					<button type="button" onClick={() => set_clears((c) => { const n = new Set(c); n.delete(f.key); return n; })} className={G_BTN}>Undo</button>
				</>
			);
		} else {
			control = (
				<>
					<input
						aria-label={f.key}
						type={f.secret ? 'password' : 'text'}
						autoComplete="off"
						value={editing ? edits[f.key] : (f.value ?? '')}
						onChange={(e) => set_edits((x) => ({ ...x, [f.key]: e.target.value }))}
						placeholder={f.secret ? 'Paste value — stored encrypted, never shown again' : f.default ? `default: ${f.default}` : ''}
						className={`${G_INPUT} flex-1 ${f.secret ? '' : 'g-mono'} ${f.required && !f.set && !editing ? 'border-[rgba(255,178,36,.5)]' : ''} ${mode === 'realm' ? 'border-[rgba(91,157,255,.5)]' : ''}`}
					/>
					{mode === 'realm' && (f.source === 'realm' || editing) ? <button type="button" onClick={() => { set_edits((e) => { const n = { ...e }; delete n[f.key]; return n; }); if (f.source === 'realm') set_clears((c) => new Set(c).add(f.key)); }} className={G_BTN}>Use org value</button> : null}
					{mode === 'org' && editing && f.secret ? <button type="button" onClick={() => set_edits((e) => { const n = { ...e }; delete n[f.key]; return n; })} className={G_BTN}>Cancel</button> : null}
				</>
			);
		}
		return (
			<div key={f.key} className="border-b border-[var(--g-line-2,var(--g-line))] py-3 last:border-b-0" data-testid={`field-${f.key}`}>
				<div className="mb-1.5 flex items-baseline gap-2"><b className="g-mono text-[12.5px]">{f.key}</b>{f.required ? <span className="text-[10.5px] text-[var(--g-acc)]">required</span> : null}<span className="ml-auto"><Source_tag f={f} mode={mode} realm={realm_slug} /></span></div>
				<div className="flex items-center gap-2">{control}</div>
				{f.description ? <p className="mt-1 text-[12px] text-[var(--g-ink-3)]">{f.description}</p> : null}
			</div>
		);
	}

	return (
		<div className="rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)] px-4" data-testid="settings-form">
			<div className="flex items-center gap-2 border-b border-[var(--g-line)] py-3">
				<b className="text-[13.5px]">{mode === 'realm' ? `Values in ${realm_slug}` : 'Org defaults'}</b>
				<span className="text-[12.5px] text-[var(--g-ink-3)]">{mode === 'realm' ? 'override a key to change it here only' : 'used by every realm unless the realm overrides a key'}</span>
				<span className="ml-auto text-[12px] text-[var(--g-ink-3)]">Required {view.required_configured} of {view.required_total} set</span>
			</div>
			{!view.fields.length ? <p className="py-4 text-[13px] text-[var(--g-ink-3)]">This agent has no settings.</p> : null}
			{required.map(field)}
			{optional.length ? (
				<div className="py-2">
					<button type="button" aria-expanded={open_optional} onClick={() => set_open_optional(!open_optional)} className="text-[12.5px] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]">{open_optional ? '▾' : '▸'} Optional settings ({optional.length})</button>
					{open_optional ? optional.map(field) : null}
				</div>
			) : null}
			{view.fields.length ? (
				<div className="flex items-center gap-2 border-t border-[var(--g-line)] py-3">
					<span className={`text-[12.5px] ${missing.length ? 'text-[var(--g-warn-text)]' : 'text-[var(--g-ink-3)]'}`}>{missing.length ? `${missing.length} required key${missing.length === 1 ? '' : 's'} still missing` : dirty ? 'Unsaved changes' : 'No unsaved changes'}</span>
					{error ? <span role="alert" className="text-[12.5px] text-[var(--g-bad)]">{error}</span> : null}
					<button type="button" disabled={!dirty || busy} onClick={() => { set_edits({}); set_clears(new Set()); }} className={`${G_BTN} ml-auto`}>Discard</button>
					<button type="button" disabled={!dirty || busy} onClick={() => void save()} className={G_PRIMARY}>{busy ? 'Saving…' : mode === 'realm' ? `Save for ${realm_slug}` : 'Save for org'}</button>
				</div>
			) : null}
		</div>
	);
}

/** Parse a pasted manifest (YAML or JSON) into what agents/register needs. */
export function parse_manifest(text: string): { ok: true; manifest: Record<string, unknown>; name: string; version: string | null; agent_type: string; description: string | null; required: string[]; optional: string[] } | { ok: false; error: string } {
	if (!text.trim()) return { ok: false, error: 'Paste a manifest.' };
	let doc: unknown;
	try { doc = yaml.load(text); } catch (e) { return { ok: false, error: (e as Error).message.split('\n')[0] }; }
	if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { ok: false, error: 'A manifest is a mapping with at least a name.' };
	const m = doc as Record<string, unknown>;
	const name = typeof m.name === 'string' ? m.name.trim() : '';
	if (!/^[a-z][a-z0-9-]*$/.test(name)) return { ok: false, error: name ? `“${name}” isn’t a valid agent name — lowercase letters, digits and dashes.` : 'The manifest needs a name.' };
	const keys = (list: unknown) => (Array.isArray(list) ? list.map((x) => (typeof x === 'string' ? x : (x as { key?: string })?.key)).filter((x): x is string => Boolean(x)) : []);
	const settings = (m.settings ?? {}) as { required?: unknown; optional?: unknown };
	return {
		ok: true, manifest: m, name,
		version: m.version != null ? String(m.version) : null,
		agent_type: typeof m.agent_type === 'string' ? m.agent_type : 'exec',
		description: typeof m.description === 'string' ? m.description : null,
		required: keys(settings.required), optional: keys(settings.optional),
	};
}

export function Register_dialog({ org_id, org_label, existing, on_close, on_done }: {
	org_id: string; org_label: string;
	/** name → registered versions (to warn before adding a version). */
	existing: Map<string, string[]>;
	on_close: () => void;
	on_done: (agent: { id: string; name: string }) => void;
}) {
	const post = use_post();
	const [text, set_text] = useState('');
	const [busy, set_busy] = useState(false);
	const [error, set_error] = useState<string | null>(null);
	const [force, set_force] = useState(false);
	const parsed = useMemo(() => parse_manifest(text), [text]);
	const prior = parsed.ok ? existing.get(parsed.name) ?? [] : [];
	const same = parsed.ok && parsed.version ? prior.includes(parsed.version) : false;

	async function register() {
		if (!parsed.ok) return;
		set_busy(true); set_error(null);
		const r = await post('/v1/agents/register', { org_id, name: parsed.name, ...(parsed.version ? { version: parsed.version } : {}), manifest: parsed.manifest, ...(parsed.description ? { description: parsed.description } : {}), agent_type: parsed.agent_type, ...(same && force ? { force: true } : {}) });
		set_busy(false);
		if (!r.ok) { set_error(r.error); return; }
		const d = r.data as { id?: string; name?: string };
		on_done({ id: String(d.id ?? ''), name: String(d.name ?? parsed.name) });
	}

	return (
		<div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) on_close(); }}>
			<div role="dialog" aria-modal="true" aria-label="Register a custom agent" className="w-full max-w-[780px] rounded-2xl border border-[var(--g-line)] bg-[#141518] shadow-[0_30px_80px_rgba(0,0,0,.6)]">
				<div className="flex items-center gap-2 border-b border-[var(--g-line)] px-5 py-3.5"><b className="text-[16px]">Register a custom agent</b><span className="g-mono text-[12px] text-[var(--g-ink-3)]">for {org_label}</span><button type="button" aria-label="Close" onClick={on_close} className="ml-auto text-[var(--g-ink-3)]">✕</button></div>
				<div className="grid gap-4 px-5 py-4 md:grid-cols-[1.1fr_.9fr]">
					<div>
						<p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--g-ink-3)]">manifest.yml <span className="normal-case tracking-normal">· paste or drop a file</span></p>
						<textarea aria-label="Agent manifest" value={text} onChange={(e) => set_text(e.target.value)} onDrop={(e) => { const f = e.dataTransfer.files?.[0]; if (f) { e.preventDefault(); void f.text().then(set_text); } }} rows={16} spellCheck={false} placeholder={'name: ledger-matcher\nversion: 0.4.0\nagent_type: exec\ndescription: …\nsettings:\n  required:\n    - key: bank_api_key'} className="g-mono w-full resize-y rounded-lg border border-[var(--g-line)] bg-[#0e0f11] p-3 text-[12px] leading-relaxed text-[var(--g-ink-2)] outline-none focus:border-[var(--g-acc-line)]" />
					</div>
					<div className="flex flex-col gap-2.5" data-testid="manifest-preview">
						{!parsed.ok ? <p className={`rounded-lg border px-3 py-2 text-[12.5px] ${text.trim() ? 'border-[var(--g-bad-line,var(--g-line))] text-[var(--g-bad)]' : 'border-[var(--g-line)] text-[var(--g-ink-3)]'}`} role={text.trim() ? 'alert' : undefined}>{parsed.error}</p> : (
							<>
								<div className="flex items-center gap-2.5 rounded-lg border border-[var(--g-line)] p-3"><Agent_tile agent_type={parsed.agent_type} name={parsed.name} size={32} /><div><b className="g-mono">{parsed.name}</b> <span className="g-mono text-[var(--g-ink-3)]">{parsed.version ?? 'no version'}</span><div className="text-[12px] text-[var(--g-ink-3)]">{agent_kind(parsed.agent_type, parsed.name).label}{parsed.description ? ` · ${parsed.description}` : ''}</div></div></div>
								<div className="rounded-lg border border-[var(--g-line)] p-3 text-[12.5px]">
									<p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--g-ink-3)]">Settings it declares</p>
									{[...parsed.required.map((k) => [k, 'required']), ...parsed.optional.map((k) => [k, 'optional'])].map(([k, t]) => <div key={k} className="flex"><span className="g-mono">{k}</span><span className={`ml-auto text-[11px] ${t === 'required' ? 'text-[var(--g-acc)]' : 'text-[var(--g-ink-3)]'}`}>{t}</span></div>)}
									{!parsed.required.length && !parsed.optional.length ? <span className="text-[var(--g-ink-3)]">None.</span> : <p className="mt-1.5 text-[var(--g-ink-3)]">You’ll set these right after registering.</p>}
								</div>
								{prior.length ? (
									<div className="rounded-lg border border-[rgba(255,178,36,.4)] p-3 text-[12.5px]">
										{same ? <><b className="text-[var(--g-warn-text)]">{parsed.version} is already registered</b><label className="mt-1.5 flex items-center gap-2 text-[var(--g-ink-2)]"><input type="checkbox" checked={force} onChange={(e) => set_force(e.target.checked)} className="accent-[var(--g-acc)]" />Replace it</label></>
											: <><b className="text-[var(--g-warn-text)]">{prior.join(', ')} already registered</b><p className="text-[var(--g-ink-3)]">This adds {parsed.version ?? 'a new version'} alongside. Teams pinned to an older version keep it.</p></>}
									</div>
								) : null}
								<span className="self-start rounded-full bg-[var(--g-ok-soft)] px-2.5 py-0.5 text-[12px] text-[var(--g-ok)]">✓ Manifest reads fine</span>
							</>
						)}
						{error ? <p role="alert" className="text-[12.5px] text-[var(--g-bad)]">{error}</p> : null}
					</div>
				</div>
				<div className="flex items-center gap-2 border-t border-[var(--g-line)] px-5 py-3.5">
					<button type="button" onClick={on_close} className={`${G_BTN} ml-auto`}>Cancel</button>
					<button type="button" disabled={!parsed.ok || busy || (same && !force)} onClick={() => void register()} className={G_PRIMARY}>{busy ? 'Registering…' : parsed.ok ? `Register ${parsed.name}${parsed.version ? ` ${parsed.version}` : ''}` : 'Register'}</button>
				</div>
			</div>
		</div>
	);
}
