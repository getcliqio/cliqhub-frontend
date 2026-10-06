/**
 * Manage › Agents / Realm › Agents — types for `POST /v1/agent_list/get` and
 * `POST /v1/agent_page/get` (BFF composition), plus small pure helpers.
 */
import { KINDS } from '@/lib/builder/kinds';
import type { Mcp_options } from '@/lib/mcp';

export interface Agent_used_by { scope: string; name: string; version: string | null; realms: Array<{ id: string; slug: string }> }
export interface Agent_list_row {
	id: string; name: string; version: string | null; versions: string[]; description: string | null;
	agent_type: string; is_system: boolean;
	setup: { has_settings: boolean; required_total: number; required_configured: number; ready: boolean } | null;
	overrides: Array<{ realm_id: string; realm_slug: string; keys: string[] }>;
	used_by: Agent_used_by[] | null;
	used_count: number | null;
}
export interface Agent_list_data {
	org_id: string;
	realm: { id: string; slug: string; name: string } | null;
	items: Agent_list_row[];
	counts: { all: number; needs_setup: number; in_use: number | null; custom: number; builtin: number };
	attention: { agents: string[]; teams: number } | null;
	realms_checked: number; realms_total: number;
	partial: boolean;
}
export interface Agent_field {
	key: string; description: string | null; default: string | null; when: Record<string, string> | null;
	required: boolean; secret: boolean;
	value: string | null; set: boolean; source: 'org' | 'realm' | null; org_value: string | null;
	/** How the form edits it (older BFFs omit it: treat as text / secret). */
	type?: 'text' | 'secret' | 'mcp_servers';
}
export interface Agent_settings_view {
	scope: 'org' | 'realm';
	realm: { id: string; slug: string; name: string } | null;
	fields: Agent_field[];
	required_total: number; required_configured: number; ready: boolean;
	/** The agent's MCP options, when it can use MCP servers. */
	mcp?: Mcp_options | null;
}
export interface Agent_realm_row { realm: { id: string; slug: string; name: string }; ready: boolean; keys: Record<string, 'org' | 'realm' | 'missing'>; used_here: string[] }
export type Agent_view = 'settings' | 'realms' | 'used_by' | 'manifest' | 'versions';
export interface Agent_page_data {
	org_id: string;
	agent: {
		id: string; name: string; version: string | null; description: string | null; agent_type: string; is_system: boolean;
		versions: Array<{ id: string; version: string | null; created_at: number; newest: boolean }>;
	};
	used_by: Agent_used_by[] | null;
	settings: Agent_settings_view | null;
	overrides: Array<{ realm_id: string; realm_slug: string; keys: string[] }> | null;
	realms: Agent_realm_row[] | null;
	required_keys: string[];
	manifest: Record<string, unknown> | null;
	partial: boolean;
}

export interface Agent_kind { id: string; label: string; color: string; glyph: string }

/** Kind shown for a catalog agent (same colours as the builder palette where they overlap). */
export function agent_kind(agent_type: string, name?: string): Agent_kind {
	const k = (id: keyof typeof KINDS, label?: string): Agent_kind => ({ id, label: label ?? KINDS[id].label, color: KINDS[id].color, glyph: KINDS[id].glyph });
	if (name === 'hug') return k('human', 'Human review');
	if (name === 'curl') return k('fetch', 'Fetch');
	if (name === 'team') return k('team', 'Sub-team');
	switch (agent_type) {
		case 'llm': return k('agent', 'LLM');
		case 'connector': return k('connector', 'Connector');
		case 'exec': return k('script', 'Script');
		case 'gate': return k('gate', 'Gate');
		case 'notify': return { id: 'notify', label: 'Notify', color: '#5b9dff', glyph: '✉' };
		case 'meta': return k('team', 'Meta');
		default: return { id: agent_type, label: agent_type || 'Agent', color: '#8a8c93', glyph: '•' };
	}
}

export const agents_href = (org_slug: string | null, multi: boolean) => (org_slug && multi ? `/agents?org=${encodeURIComponent(org_slug)}` : '/agents');
export const agent_href = (id: string, org_slug: string | null, tab?: Agent_view) => {
	const q = new URLSearchParams();
	if (org_slug) q.set('org', org_slug);
	if (tab && tab !== 'settings') q.set('tab', tab);
	const s = q.toString();
	return `/agents/${id}${s ? `?${s}` : ''}`;
};

/**
 * What the form sends: only changed keys. Clearing = explicit `clears`, or an
 * emptied input on a key set in this scope (org mode: any set key; realm
 * mode: only a realm override — an inherited org value is left alone).
 */
export function settings_patch(fields: Agent_field[], edits: Record<string, string>, clears: Set<string>, mode: 'org' | 'realm'): { values: Record<string, string>; clear: string[] } {
	const values: Record<string, string> = {};
	const clear: string[] = [];
	for (const f of fields) {
		const own = mode === 'org' ? f.set : f.source === 'realm';
		if (clears.has(f.key)) { if (own) clear.push(f.key); continue; }
		if (!(f.key in edits)) continue;
		const v = edits[f.key].trim();
		if (v === '') { if (own) clear.push(f.key); continue; }
		if (own && v === (f.value ?? '')) continue;
		values[f.key] = v;
	}
	// MCP secrets for servers added in this edit have no field yet (Core lists one per saved placeholder).
	const known = new Set(fields.map((f) => f.key));
	for (const [k, v] of Object.entries(edits)) if (k.startsWith('mcp.secrets.') && !known.has(k) && v.trim()) values[k] = v.trim();
	return { values, clear };
}
