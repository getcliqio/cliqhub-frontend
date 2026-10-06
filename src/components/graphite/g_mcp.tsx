/**
 * MCP servers section of an agent's settings form (Manage › Agents and
 * Realm › Agents). Rendered from the agent manifest's `mcp` block:
 * presets to add in one click, custom servers when allowed, one secret
 * field per `${NAME}` placeholder, and a raw JSON view for pasting.
 *
 * Writes go through the form's own edits: `mcp.servers` (JSON) and
 * `mcp.secrets.<NAME>`; the form saves them with agents/update_settings.
 */
import { useMemo, useState } from 'react';
import type { Agent_field } from '@/lib/agents';
import {
	MCP_SECRET_PREFIX, MCP_SERVERS_KEY, mcp_placeholders, mcp_server_errors, mcp_stringify, mcp_summary, mcp_transport_of,
	parse_mcp, preset_server, secret_spec, type Mcp_options, type Mcp_server, type Mcp_transport,
} from '@/lib/mcp';
import { G_BTN, G_INPUT } from '@/components/graphite/g_agents';

type Pairs = Array<[string, string]>;
const to_pairs = (m?: Record<string, string>): Pairs => Object.entries(m ?? {});
const from_pairs = (p: Pairs): Record<string, string> | undefined => {
	const kept = p.filter(([k]) => k.trim());
	return kept.length ? Object.fromEntries(kept.map(([k, v]) => [k.trim(), v])) : undefined;
};

/** The stored value indented for editing (as is when it is not valid JSON). */
function pretty(value: string): string {
	if (!value.trim()) return '{\n}';
	try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
}

/** Draft of one server while it is being added or edited. */
interface Draft { original: string | null; name: string; transport: Mcp_transport; url: string; headers: Pairs; command: string; args: string; env: Pairs }

function draft_of(name: string | null, s: Mcp_server, fallback: Mcp_transport): Draft {
	return {
		original: name, name: name ?? '', transport: mcp_transport_of(s) ?? fallback,
		url: s.url ?? '', headers: to_pairs(s.headers), command: s.command ?? '', args: (s.args ?? []).join(' '), env: to_pairs(s.env),
	};
}

function server_of(d: Draft): Mcp_server {
	if (d.transport === 'http') { const headers = from_pairs(d.headers); return { url: d.url.trim(), ...(headers ? { headers } : {}) }; }
	const args = d.args.trim() ? d.args.trim().split(/\s+/) : [];
	const env = from_pairs(d.env);
	return { command: d.command.trim(), ...(args.length ? { args } : {}), ...(env ? { env } : {}) };
}

function Pairs_editor({ label, pairs, on }: { label: string; pairs: Pairs; on: (p: Pairs) => void }) {
	return (
		<div className="mt-2">
			<div className="mb-1 text-[11.5px] text-[var(--g-ink-3)]">{label} <span className="text-[var(--g-ink-3)]">— use {'${NAME}'} for secrets</span></div>
			{pairs.map(([k, v], i) => (
				<div key={i} className="mb-1 flex gap-1.5">
					<input aria-label={`${label} name ${i + 1}`} value={k} onChange={(e) => on(pairs.map((p, j) => (j === i ? [e.target.value, p[1]] : p)))} className={`${G_INPUT} g-mono w-[38%]`} placeholder="Name" />
					<input aria-label={`${label} value ${i + 1}`} value={v} onChange={(e) => on(pairs.map((p, j) => (j === i ? [p[0], e.target.value] : p)))} className={`${G_INPUT} g-mono flex-1`} placeholder="Value or ${SECRET}" />
					<button type="button" aria-label={`Remove ${label} ${i + 1}`} onClick={() => on(pairs.filter((_, j) => j !== i))} className="px-1 text-[var(--g-ink-3)] hover:text-[var(--g-ink)]">✕</button>
				</div>
			))}
			<button type="button" onClick={() => on([...pairs, ['', '']])} className="text-[12px] font-semibold text-[var(--g-acc)]">+ Add {label.toLowerCase().replace(/s$/, '')}</button>
		</div>
	);
}

export function Mcp_section({ opts, servers_field, secret_fields, mode, edits, set_edits, on_use_org }: {
	/** Realm scope: drop this realm's server list and use the org's. */
	on_use_org?: () => void;
	opts: Mcp_options;
	servers_field: Agent_field | undefined;
	secret_fields: Agent_field[];
	mode: 'org' | 'realm';
	edits: Record<string, string>;
	set_edits: (fn: (e: Record<string, string>) => Record<string, string>) => void;
}) {
	const [draft, set_draft] = useState<Draft | null>(null);
	const [raw, set_raw] = useState<string | null>(null);
	const [menu, set_menu] = useState(false);

	const editing_list = MCP_SERVERS_KEY in edits;
	const inherited = mode === 'realm' && servers_field?.source !== 'realm' && !editing_list;
	const value = editing_list ? edits[MCP_SERVERS_KEY] : (servers_field?.value ?? (mode === 'realm' ? servers_field?.org_value : null) ?? '');
	const parsed = useMemo(() => parse_mcp(value, opts), [value, opts]);
	const servers = parsed.servers;
	const placeholders = mcp_placeholders(servers);
	const secret_by_key = new Map(secret_fields.map((f) => [f.key, f]));
	const unused_presets = (opts.presets ?? []).filter((p) => !(p.name in servers));

	const write = (next: Record<string, Mcp_server>) => set_edits((e) => ({ ...e, [MCP_SERVERS_KEY]: mcp_stringify(next) }));
	const remove = (name: string) => { const next = { ...servers }; delete next[name]; write(next); };
	const draft_errors = draft ? mcp_server_errors(draft.name, server_of(draft), opts).concat(
		draft.name !== draft.original && draft.name in servers ? [`${draft.name}: a server with this name exists`] : []) : [];

	function save_draft() {
		if (!draft || draft_errors.length) return;
		const next: Record<string, Mcp_server> = {};
		for (const [n, s] of Object.entries(servers)) if (n !== draft.original) next[n] = s;
		next[draft.name] = server_of(draft);
		write(next);
		set_draft(null);
	}

	return (
		<div className="border-b border-[var(--g-line-2,var(--g-line))] py-3" data-testid="mcp-section">
			<div className="mb-2 flex items-baseline gap-2">
				<b className="text-[13px]">MCP servers</b>
				<span className="text-[12px] text-[var(--g-ink-3)]">tools this agent can call · {opts.transports.map((t) => (t === 'http' ? 'HTTP' : 'local (stdio)')).join(' and ')}{opts.allow_custom ? ' · custom servers allowed' : ''}</span>
				{inherited ? <button type="button" onClick={() => set_edits((e) => ({ ...e, [MCP_SERVERS_KEY]: value ?? '' }))} className={`${G_BTN} ml-auto`}>Override here</button> : null}
				{mode === 'realm' && !inherited && on_use_org ? <button type="button" onClick={on_use_org} className={`${G_BTN} ml-auto`}>Use org value</button> : null}
			</div>

			{!Object.keys(servers).length && !parsed.errors.length ? <p className="text-[12.5px] text-[var(--g-ink-3)]">{inherited ? 'No MCP servers for the org.' : 'No MCP servers yet.'}</p> : null}
			{parsed.errors.length ? <p role="alert" className="text-[12.5px] text-[var(--g-bad)]">{parsed.errors.join(' · ')}</p> : null}

			<ul className="divide-y divide-[var(--g-line)]">
				{Object.entries(servers).map(([name, s]) => {
					const needs = mcp_placeholders({ [name]: s });
					const missing = needs.filter((k) => !secret_by_key.get(`${MCP_SECRET_PREFIX}${k}`)?.set && !(edits[`${MCP_SECRET_PREFIX}${k}`] ?? '').trim()
						&& !(mode === 'realm' && secret_by_key.get(`${MCP_SECRET_PREFIX}${k}`)?.org_value));
					return (
						<li key={name} className="flex items-center gap-2 py-1.5 text-[13px]" data-testid={`mcp-server-${name}`}>
							<b className="g-mono">{name}</b>
							<span className="rounded border border-[var(--g-line)] px-1.5 text-[10.5px] text-[var(--g-ink-3)]">{mcp_transport_of(s) === 'http' ? 'HTTP' : 'stdio'}</span>
							<span className="g-mono min-w-0 flex-1 truncate text-[12px] text-[var(--g-ink-3)]">{mcp_summary(s)}</span>
							{needs.length ? (missing.length
								? <span className="text-[11.5px] text-[var(--g-warn-text)]">○ {missing.join(', ')} missing</span>
								: <span className="text-[11.5px] text-[var(--g-ok)]">● secrets set</span>) : null}
							{!inherited ? <>
								<button type="button" onClick={() => set_draft(draft_of(name, s, opts.transports[0]!))} className="text-[12px] font-semibold text-[var(--g-acc)]">Edit</button>
								<button type="button" aria-label={`Remove ${name}`} onClick={() => remove(name)} className="px-1 text-[var(--g-ink-3)] hover:text-[var(--g-ink)]">✕</button>
							</> : null}
						</li>
					);
				})}
			</ul>

			{!inherited && !draft && raw === null ? (
				<div className="relative mt-2 flex gap-2">
					{unused_presets.length || opts.allow_custom ? <button type="button" aria-expanded={menu} onClick={() => set_menu(!menu)} className={G_BTN}>+ Add server ▾</button> : null}
					<button type="button" onClick={() => set_raw(pretty(value ?? ''))} className={G_BTN}>Paste / edit JSON</button>
					{menu ? (
						<div role="menu" className="absolute left-0 top-9 z-10 min-w-[260px] rounded-lg border border-[var(--g-line)] bg-[var(--g-panel)] p-1 shadow-lg">
							{unused_presets.map((p) => (
								<button key={p.name} role="menuitem" type="button" onClick={() => { write({ ...servers, [p.name]: preset_server(p) }); set_menu(false); }} className="block w-full rounded px-2.5 py-1.5 text-left text-[13px] hover:bg-[var(--g-soft)]">
									<b>{p.label}</b> <span className="text-[11.5px] text-[var(--g-ink-3)]">{p.description ?? mcp_summary(p)}</span>
								</button>
							))}
							{opts.allow_custom ? <button role="menuitem" type="button" onClick={() => { set_draft(draft_of(null, {}, opts.transports[0]!)); set_menu(false); }} className="block w-full rounded px-2.5 py-1.5 text-left text-[13px] hover:bg-[var(--g-soft)]"><b>Custom server…</b></button> : null}
						</div>
					) : null}
				</div>
			) : null}

			{draft ? (
				<div className="mt-2 rounded-lg border border-[var(--g-acc-line)] p-3" data-testid="mcp-draft">
					<div className="flex flex-wrap gap-2">
						<input aria-label="Server name" value={draft.name} onChange={(e) => set_draft({ ...draft, name: e.target.value })} className={`${G_INPUT} g-mono w-40`} placeholder="name" />
						<select aria-label="Transport" value={draft.transport} onChange={(e) => set_draft({ ...draft, transport: e.target.value as Mcp_transport })} className={G_INPUT}>
							{opts.transports.map((t) => <option key={t} value={t}>{t === 'http' ? 'HTTP' : 'Local (stdio)'}</option>)}
						</select>
						{draft.transport === 'http'
							? <input aria-label="Server URL" value={draft.url} onChange={(e) => set_draft({ ...draft, url: e.target.value })} className={`${G_INPUT} g-mono flex-1`} placeholder="https://…/mcp" />
							: <>
								<input aria-label="Command" value={draft.command} onChange={(e) => set_draft({ ...draft, command: e.target.value })} className={`${G_INPUT} g-mono w-32`} placeholder="npx" />
								<input aria-label="Arguments" value={draft.args} onChange={(e) => set_draft({ ...draft, args: e.target.value })} className={`${G_INPUT} g-mono flex-1`} placeholder="-y @scope/server" />
							</>}
					</div>
					{draft.transport === 'http'
						? <Pairs_editor label="Headers" pairs={draft.headers} on={(headers) => set_draft({ ...draft, headers })} />
						: <Pairs_editor label="Environment" pairs={draft.env} on={(env) => set_draft({ ...draft, env })} />}
					{draft_errors.length ? <p role="alert" className="mt-2 text-[12px] text-[var(--g-bad)]">{draft_errors.join(' · ')}</p> : null}
					<div className="mt-2 flex gap-2">
						<button type="button" onClick={() => set_draft(null)} className={`${G_BTN} ml-auto`}>Cancel</button>
						<button type="button" disabled={draft_errors.length > 0} onClick={save_draft} className={G_BTN}>{draft.original ? 'Update server' : 'Add server'}</button>
					</div>
				</div>
			) : null}

			{raw !== null ? (
				<div className="mt-2">
					<textarea aria-label="MCP servers JSON" value={raw} onChange={(e) => set_raw(e.target.value)} rows={10} spellCheck={false} className="g-mono w-full rounded-lg border border-[var(--g-line)] bg-[var(--g-bg)] p-2 text-[12px]" />
					{(() => { const p = parse_mcp(raw, opts); return p.errors.length ? <p role="alert" className="text-[12px] text-[var(--g-bad)]">{p.errors.join(' · ')}</p> : null; })()}
					<div className="mt-1 flex gap-2">
						<span className="text-[11.5px] text-[var(--g-ink-3)]">Accepts {'{ "name": {…} }'} or a pasted {'{ "mcpServers": {…} }'}. Put secrets as {'${NAME}'}.</span>
						<button type="button" onClick={() => set_raw(null)} className={`${G_BTN} ml-auto`}>Cancel</button>
						<button type="button" disabled={parse_mcp(raw, opts).errors.length > 0} onClick={() => { write(parse_mcp(raw, opts).servers); set_raw(null); }} className={G_BTN}>Apply</button>
					</div>
				</div>
			) : null}

			{placeholders.length ? (
				<div className="mt-3">
					<div className="mb-1 text-[11.5px] font-semibold text-[var(--g-ink-3)]">Secrets — stored encrypted, never shown again</div>
					{placeholders.map((name) => {
						const key = `${MCP_SECRET_PREFIX}${name}`;
						const f = secret_by_key.get(key);
						const spec = secret_spec(opts, name);
						const typing = key in edits;
						const has = f?.set || (mode === 'realm' && !!f?.org_value);
						return (
							<div key={key} className="mb-1.5" data-testid={`mcp-secret-${name}`}>
								<div className="flex items-center gap-2">
									<b className="g-mono w-48 shrink-0 truncate text-[12px]">{name}</b>
									{has && !typing
										? <><span className="g-mono flex-1 text-[12.5px] text-[var(--g-ink-2)]">{f?.value ?? f?.org_value}{mode === 'realm' && f?.source !== 'realm' ? ' (from the org)' : ''}</span>
											<button type="button" onClick={() => set_edits((e) => ({ ...e, [key]: '' }))} className="text-[12px] font-semibold text-[var(--g-acc)]">Replace</button></>
										: <input aria-label={key} type="password" autoComplete="off" value={edits[key] ?? ''} onChange={(e) => set_edits((x) => ({ ...x, [key]: e.target.value }))}
											placeholder="Paste value" className={`${G_INPUT} flex-1 ${has ? '' : 'border-[rgba(255,178,36,.5)]'}`} />}
								</div>
								{spec?.description || spec?.help_url ? <p className="ml-[12.5rem] text-[11.5px] text-[var(--g-ink-3)]">{spec?.description}{spec?.help_url ? <> · <a href={spec.help_url} target="_blank" rel="noreferrer" className="text-[var(--g-acc)]">get one</a></> : null}</p> : null}
							</div>
						);
					})}
				</div>
			) : null}
		</div>
	);
}
