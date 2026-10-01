/**
 * HUG review packet — the payload an agent/daemon sends with a review, and
 * helpers to read it. Sources: cliq-sdk `InputRequiredBundle` /
 * `HumanInputRequest`, the daemon's gate packet, Core `ReviewData`.
 *
 *   payload.upstream_text | summary | message   markdown brief
 *   payload.context: [{role, content}]          earlier turns (markdown)
 *   payload.inputs_schema | fields              form fields (both spellings)
 *   payload.check_results                       gate checks
 *   payload.iteration / max_iterations          gate loop position
 *   payload.mode                                verdict | input_pause | chat
 *   review.artifacts                            full content + preview
 */

export interface Review_artifact {
	id: string | number;
	phase: string | null;
	kind: string;
	name: string;
	mime_type: string;
	content: string | null;
	content_preview: string | null;
	sequence: number | null;
}
export interface Review_notification_row {
	id: string;
	user_id?: string | null;
	channel_target: string;
	action?: string | null;
	comment?: string | null;
	responded_at?: string | null;
}
export interface Review_group { group_idx: number; policy: string; channels: string[]; satisfied: boolean; notifications: Review_notification_row[] }
export interface Review_data {
	id: string;
	run_id: string;
	run_name: string | null;
	realm_id: string | null;
	realm_name: string | null;
	realm_slug: string | null;
	org_slug: string | null;
	team: string | null;
	phase: string | null;
	payload: Record<string, unknown>;
	verdict: Record<string, unknown> | null;
	status: 'pending' | 'decided' | 'completed' | 'expired' | string;
	route_targets: string[] | null;
	created_at: string;
	timeout_at: string;
	completed_at: string | null;
	claimed_by: string | null;
	claimed_at: string | null;
	message_count: number;
	artifacts: Review_artifact[];
	notification_groups?: Review_group[];
	policy?: Record<string, unknown>;
}
export interface Review_page_data { review: Review_data; org_id: string | null }

export type Field_type = 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'channel';
export interface Field_spec {
	name: string;
	label?: string;
	type: Field_type;
	required?: boolean;
	help?: string;
	default?: unknown;
	choices?: string[];
	placeholder?: string;
}
export type Field_value = string | boolean;

export function as_text(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value : null;
}

/**
 * Form fields from either spelling:
 *   Hub/YAML  `inputs_schema: [{type: text|textarea|number|boolean|select|channel, choices}]`
 *   SDK       `fields: [{type: text|enum|boolean|number, options}]`
 */
export function coerce_fields(payload: Record<string, unknown> | null | undefined): Field_spec[] {
	const raw = Array.isArray(payload?.inputs_schema) ? payload!.inputs_schema : Array.isArray(payload?.fields) ? payload!.fields : [];
	const out: Field_spec[] = [];
	for (const item of raw as unknown[]) {
		if (!item || typeof item !== 'object') continue;
		const o = item as Record<string, unknown>;
		const name = typeof o.name === 'string' ? o.name.trim() : '';
		if (!name) continue;
		const list = (v: unknown) => (Array.isArray(v) ? v.filter((c): c is string => typeof c === 'string') : undefined);
		const choices = list(o.choices) ?? list(o.options);
		const t = typeof o.type === 'string' ? o.type.trim() : 'text';
		const type: Field_type = t === 'enum' || t === 'select' ? (choices?.length ? 'select' : 'text')
			: t === 'textarea' || t === 'number' || t === 'boolean' || t === 'channel' ? t : 'text';
		out.push({
			name, type, choices,
			label: typeof o.label === 'string' ? o.label : undefined,
			required: o.required === true,
			help: typeof o.help === 'string' ? o.help : undefined,
			default: o.default,
			placeholder: typeof o.placeholder === 'string' ? o.placeholder : undefined,
		});
	}
	return out;
}

export function initial_values(fields: Field_spec[], prev: Record<string, Field_value> = {}): Record<string, Field_value> {
	const next = { ...prev };
	for (const f of fields) {
		if (f.name in next) continue;
		next[f.name] = f.type === 'boolean' ? f.default === true : f.default == null ? '' : String(f.default);
	}
	return next;
}

/** Form state → wire type. */
export function normalize_value(f: Field_spec, raw: Field_value): unknown {
	if (f.type === 'boolean') return raw === true || raw === 'true';
	if (f.type === 'number') {
		if (typeof raw !== 'string' || raw.trim() === '') return null;
		const n = Number(raw);
		return Number.isFinite(n) ? n : null;
	}
	if (f.type === 'channel') return typeof raw === 'string' ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];
	return typeof raw === 'string' ? raw : '';
}

export function is_missing(f: Field_spec, raw: Field_value | undefined): boolean {
	if (!f.required || f.type === 'boolean') return false;
	if (typeof raw !== 'string') return true;
	if (f.type === 'number') return raw.trim() === '' || !Number.isFinite(Number(raw));
	if (f.type === 'channel') return raw.split(',').map((s) => s.trim()).filter(Boolean).length === 0;
	return raw.trim() === '';
}

export interface Check_row { name: string; ok: boolean; detail: string | null }
/** check_results: strings ("PASS: name" / "FAIL: name — why") or objects {name|check, ok|passed|status, message|detail|reason}. */
export function parse_checks(value: unknown): Check_row[] {
	if (!Array.isArray(value)) return [];
	return value.map((item, i) => {
		if (typeof item === 'string') {
			const m = /^\s*(PASS|FAIL|OK|ERROR)\s*[:\-–]\s*(.*)$/i.exec(item);
			const ok = m ? /^(pass|ok)$/i.test(m[1]) : !/fail|error/i.test(item);
			const rest = m ? m[2] : item;
			const [name, ...why] = rest.split(/\s+[—–-]\s+/);
			return { name: name.trim() || `Check ${i + 1}`, ok, detail: why.join(' — ') || null };
		}
		const o = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
		return {
			name: as_text(o.name) ?? as_text(o.check) ?? `Check ${i + 1}`,
			ok: o.ok === true || o.passed === true || o.status === 'pass' || o.status === 'PASS',
			detail: as_text(o.message) ?? as_text(o.detail) ?? as_text(o.reason),
		};
	});
}

export type Review_mode = 'chat' | 'input' | 'verdict';
export function review_mode(r: Review_data, fields: Field_spec[]): Review_mode {
	if (r.payload?.mode === 'chat') return 'chat';
	if (r.payload?.mode === 'input_pause' || r.policy?.mode === 'input_pause' || fields.length > 0) return 'input';
	return 'verdict';
}
/** input_pause specifically (fields without a verdict — Continue only). */
export function is_input_pause(r: Review_data): boolean {
	return r.payload?.mode === 'input_pause' || r.policy?.mode === 'input_pause';
}

export function context_turns(payload: Record<string, unknown> | null | undefined): Array<{ role: string; content: string }> {
	const raw = payload?.context;
	if (!Array.isArray(raw)) return [];
	return raw.filter((t): t is { role: string; content: string } => !!t && typeof t === 'object' && typeof (t as { role?: unknown }).role === 'string' && typeof (t as { content?: unknown }).content === 'string')
		.map((t) => ({ role: t.role, content: t.content }));
}

/** The caller's notification row: first unanswered one, else any. Verdicts need its id. */
export function my_notification_id(r: Review_data, user_id: string | null | undefined): string | null {
	if (!user_id || !r.notification_groups) return null;
	const rows = r.notification_groups.flatMap((g) => g.notifications).filter((n) => n.user_id === user_id);
	return (rows.find((n) => !n.responded_at) ?? rows[0])?.id ?? null;
}

export function reviewer_count(r: Review_data): number {
	return new Set((r.notification_groups ?? []).flatMap((g) => g.notifications.map((n) => n.channel_target))).size;
}

/* ── artifacts ─────────────────────────────────────────────────────────── */

export type Artifact_bucket = 'markdown' | 'json' | 'csv' | 'image' | 'pdf' | 'html' | 'text';
export function artifact_bucket(mime: string | null | undefined, name: string): Artifact_bucket {
	const m = (mime ?? '').toLowerCase();
	const n = name.toLowerCase();
	if (m.includes('json') || n.endsWith('.json')) return 'json';
	if (m.includes('markdown') || /\.(md|mdx|markdown)$/.test(n)) return 'markdown';
	if (m.includes('csv') || n.endsWith('.csv') || n.endsWith('.tsv')) return 'csv';
	if (m.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/.test(n)) return 'image';
	if (m.includes('pdf') || n.endsWith('.pdf')) return 'pdf';
	if (m.includes('html') || /\.html?$/.test(n)) return 'html';
	return 'text';
}

export function looks_like_base64(s: string): boolean {
	if (!s || s.length < 8) return false;
	if (s.startsWith('data:')) return true;
	return /^[A-Za-z0-9+/=\s]+$/.test(s.slice(0, 200));
}

export function data_url(a: Review_artifact, fallback_mime: string): string | null {
	const c = a.content ?? '';
	if (c.startsWith('data:')) return c;
	if (looks_like_base64(c)) return `data:${a.mime_type || fallback_mime};base64,${c.replace(/\s+/g, '')}`;
	return null;
}

export function pretty_json(raw: string): string | null {
	try { return JSON.stringify(JSON.parse(raw), null, 2); } catch { return null; }
}

/** Minimal CSV/TSV parser (quotes, escaped quotes, commas/newlines in quotes). Caps rows. */
export function parse_csv(text: string, max_rows = 500): string[][] {
	const sep = text.split('\n', 1)[0].includes('\t') && !text.split('\n', 1)[0].includes(',') ? '\t' : ',';
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = '';
	let q = false;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (q) {
			if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
			continue;
		}
		if (ch === '"') q = true;
		else if (ch === sep) { row.push(cell); cell = ''; }
		else if (ch === '\n' || ch === '\r') {
			if (ch === '\r' && text[i + 1] === '\n') i++;
			row.push(cell); rows.push(row); row = []; cell = '';
			if (rows.length >= max_rows) return rows;
		} else cell += ch;
	}
	if (cell || row.length) { row.push(cell); rows.push(row); }
	return rows;
}

export function download_name(a: Review_artifact): string {
	const base = a.name?.trim() || `artifact-${a.id}`;
	if (/\.[a-z0-9]{1,6}$/i.test(base)) return base;
	const m = (a.mime_type ?? '').toLowerCase();
	if (m.includes('json')) return `${base}.json`;
	if (m.includes('markdown')) return `${base}.md`;
	if (m.includes('html')) return `${base}.html`;
	if (m.includes('csv')) return `${base}.csv`;
	if (m === 'text/plain') return `${base}.txt`;
	if (m.startsWith('image/')) return `${base}.${m.split('/')[1] || 'bin'}`;
	if (m.includes('pdf')) return `${base}.pdf`;
	return base;
}

export function download_artifact(a: Review_artifact): void {
	const bucket = artifact_bucket(a.mime_type, a.name);
	const content = a.content ?? a.content_preview ?? '';
	const mime = a.mime_type || 'application/octet-stream';
	let blob: Blob;
	if ((bucket === 'image' || bucket === 'pdf') && looks_like_base64(content) && !content.startsWith('data:')) {
		try {
			const bin = atob(content.replace(/\s+/g, ''));
			const bytes = new Uint8Array(bin.length);
			for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
			blob = new Blob([bytes], { type: mime });
		} catch { blob = new Blob([content], { type: mime }); }
	} else blob = new Blob([content], { type: mime });
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = download_name(a);
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function format_bytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
