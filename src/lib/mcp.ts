/**
 * MCP servers in agent settings (the same rules as Core `lib/mcp_settings.ts`).
 *
 *   mcp.servers          JSON: { "<name>": { url, headers } | { command, args, env } }
 *   mcp.secrets.<NAME>   one secret per `${NAME}` placeholder in mcp.servers
 *
 * The agent's manifest `mcp` block says which transports it can run, which
 * presets to offer, and whether custom servers are allowed.
 */

export type Mcp_transport = 'http' | 'stdio';

export interface Mcp_secret_spec { key: string; description?: string; help_url?: string }

/** One server as stored in mcp.servers. */
export interface Mcp_server {
	url?: string; headers?: Record<string, string>;
	command?: string; args?: string[]; env?: Record<string, string>;
}

export interface Mcp_preset extends Mcp_server {
	name: string; label: string; transport: Mcp_transport; description?: string;
	secrets?: Mcp_secret_spec[];
}

/** The manifest's `mcp` block. */
export interface Mcp_options { transports: Mcp_transport[]; allow_custom?: boolean; presets?: Mcp_preset[] }

export const MCP_SERVERS_KEY = 'mcp.servers';
export const MCP_SECRET_PREFIX = 'mcp.secrets.';
const NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;
const PLACEHOLDER_RE = /\$\{([A-Z][A-Z0-9_]{0,63})\}/g;

export const mcp_transport_of = (s: Mcp_server): Mcp_transport | null => (s.url ? 'http' : s.command ? 'stdio' : null);

/** One-line summary of a server: its URL or its command line. */
export const mcp_summary = (s: Mcp_server): string => s.url ?? [s.command, ...(s.args ?? [])].filter(Boolean).join(' ');

/**
 * Parse a stored or pasted value (bare map, or `{ "mcpServers": { … } }`) and
 * check it against the agent's options.
 */
export function parse_mcp(value: string, opts: Mcp_options): { servers: Record<string, Mcp_server>; errors: string[] } {
	if (!value.trim()) return { servers: {}, errors: [] };
	let raw: unknown;
	try { raw = JSON.parse(value); } catch { return { servers: {}, errors: ['Not valid JSON'] }; }
	if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'mcpServers' in raw) raw = (raw as { mcpServers: unknown }).mcpServers;
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { servers: {}, errors: ['Expected { "<name>": { … } }'] };
	const servers = raw as Record<string, Mcp_server>;
	return { servers, errors: Object.entries(servers).flatMap(([n, s]) => mcp_server_errors(n, s, opts)) };
}

/** Problems with one server (empty = fine). */
export function mcp_server_errors(name: string, s: Mcp_server, opts: Mcp_options): string[] {
	const out: string[] = [];
	if (!NAME_RE.test(name)) out.push(`${name || '(no name)'}: use letters, digits, - or _`);
	if (!s || typeof s !== 'object') return [...out, `${name}: not an object`];
	const t = mcp_transport_of(s);
	if (!t) return [...out, `${name}: needs a URL or a command`];
	if (s.url && s.command) out.push(`${name}: has both a URL and a command`);
	if (!opts.transports.includes(t)) out.push(`${name}: this agent cannot run ${t === 'http' ? 'HTTP' : 'local (stdio)'} servers`);
	if (!(opts.presets ?? []).some((p) => p.name === name) && !opts.allow_custom) out.push(`${name}: this agent only allows its presets`);
	if (t === 'http') {
		try { if (!['http:', 'https:'].includes(new URL(s.url!).protocol)) out.push(`${name}: URL must be http(s)`); } catch { out.push(`${name}: URL is not valid`); }
	}
	return out;
}

/** `${NAME}` placeholders the servers use, sorted. */
export function mcp_placeholders(servers: Record<string, Mcp_server>): string[] {
	const names = new Set<string>();
	for (const s of Object.values(servers)) {
		const strings = [s.url, s.command, ...(s.args ?? []), ...Object.values(s.headers ?? {}), ...Object.values(s.env ?? {})];
		for (const str of strings) if (typeof str === 'string') for (const m of str.matchAll(PLACEHOLDER_RE)) names.add(m[1]!);
	}
	return [...names].sort();
}

/** A preset as a stored server (drops label, description, secrets …). */
export function preset_server(p: Mcp_preset): Mcp_server {
	return p.transport === 'http'
		? { url: p.url, ...(p.headers ? { headers: { ...p.headers } } : {}) }
		: { command: p.command, ...(p.args ? { args: [...p.args] } : {}), ...(p.env ? { env: { ...p.env } } : {}) };
}

/** Description / help link for a secret, from the preset that declares it. */
export function secret_spec(opts: Mcp_options, key: string): Mcp_secret_spec | null {
	for (const p of opts.presets ?? []) for (const s of p.secrets ?? []) if (s.key === key) return s;
	return null;
}

/** Stable text for the stored value (no whitespace, so unchanged lists compare equal). */
export const mcp_stringify = (servers: Record<string, Mcp_server>): string => (Object.keys(servers).length ? JSON.stringify(servers) : '');
