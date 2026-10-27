/**
 * Hugs — a person is asked for input (PLAN-hug-requests). Types for `POST /v1/hug_page/get`, the
 * form's values, checks for messages, answering (`POST /v1/hugs/respond`) and file uploads
 * (`POST /v1/artifacts/upload?hug_id&requested_input&name`, the file as the raw body).
 *
 * Core validates every answer with the SDK (`validate_values`) and is the authority; the checks here
 * mirror it only to show messages before sending (src/__tests__/hug_contract.test.ts keeps them in
 * step with the SDK). Core's 422 problems are shown the same way, per input.
 */

import { mark_overview_stale } from '@/lib/overview';

// ── What Core sends ────────────────────────────────────────────────────────

interface Input_common {
	name: string;
	label?: string;
	help?: string;
	required?: boolean;
	default?: unknown;
	ui?: Record<string, unknown>;
}
export type Requested_input =
	| Input_common & { type: 'text'; multiline?: boolean; min_length?: number; max_length?: number }
	| Input_common & { type: 'number'; min?: number; max?: number; integer?: boolean }
	| Input_common & { type: 'boolean' }
	| Input_common & { type: 'enum'; choices: Array<{ value: string; label?: string }>; multiple?: boolean }
	| Input_common & { type: 'file'; accept?: string[]; max_bytes?: number; multiple?: boolean }
	| Input_common & { type: 'channel'; multiple?: boolean };

export type Context_block =
	| { type: 'markdown'; text: string }
	| { type: 'artifact'; artifact_id: string; label?: string }
	| { type: 'checks'; results: Array<{ name: string; ok: boolean; summary?: string }> }
	| { type: 'transcript'; turns: Array<{ role: string; content: string }> };

export interface Hug_response {
	response_id: string;
	responder: { user_id: string; name: string };
	/** The Hug's channels that reached this person. */
	via: string[];
	values: Record<string, unknown>;
	comment: string | null;
	responded_at: string;
}

export type Hug_status = 'open' | 'closed' | 'expired' | 'cancelled';

export interface Hug {
	id: string;
	hug_url: string;
	run_id: string;
	run_name: string | null;
	team: string | null;
	phase: string;
	iteration: number;
	realm_id: string;
	realm_name: string | null;
	realm_slug: string | null;
	org_slug: string | null;
	title: string;
	prompt: string;
	context: Context_block[];
	requested_inputs: Requested_input[];
	channels: string[];
	/** Presentation hints from the requester (e.g. `{ kind: 'gate' }`). */
	ui: Record<string, unknown> | null;
	status: Hug_status;
	outcome: string | null;
	expires_at: string;
	created_at: string;
	closed_at: string | null;
	last_reminded_at: string | null;
	/** People its channels reach who can't see it, so it wasn't sent to them. */
	not_sent_to?: Array<{ name: string; channel: string }>;
	responses: Hug_response[];
}

/** One phase of the Hug's run (for the workflow graph). */
export interface Hug_run_phase {
	name: string;
	type: string | null;
	agent: string | null;
	status: string;
	depends_on: string[];
}

/** The Hug's run: its team and how far it has got; null when it couldn't be read. */
export interface Hug_run {
	run_id: string;
	run_name: string | null;
	state: string;
	team_label: string | null;
	team_version: string | null;
	phases: Hug_run_phase[];
}

export interface Hug_page_data {
	hug: Hug;
	/** Absent from an older BFF. */
	run?: Hug_run | null;
}

/** Inputs a response must have, and the rest (a boolean always has a value, so it is never missing). */
export function split_inputs(inputs: readonly Requested_input[]): { required: Requested_input[]; optional: Requested_input[] } {
	const required = inputs.filter((i) => i.required !== false && i.type !== 'boolean');
	return { required, optional: inputs.filter((i) => !required.includes(i)) };
}

/** How many required inputs the form doesn't have a value for yet. */
export function missing_required(inputs: readonly Requested_input[], form: Form_values): number {
	const values = to_values(inputs, form);
	return split_inputs(inputs).required.filter((i) => values[i.name] === undefined).length;
}

/** A file uploaded for a `file` input (what the value holds). */
export interface File_ref {
	artifact_id: string;
	name: string;
	size: number;
	content_type: string;
}

export function hug_href(hug_id: string): string {
	return `/hugs/${encodeURIComponent(hug_id)}`;
}

// ── The form ───────────────────────────────────────────────────────────────

/** A form value per type: text and number are kept as typed (string), the rest as sent. */
export type Form_value = string | boolean | string[] | File_ref[];
export type Form_values = Record<string, Form_value>;

/** Form values to start from: the caller's own answer when they gave one, else each input's default. */
export function initial_values(inputs: readonly Requested_input[], mine?: Hug_response | null): Form_values {
	const out: Form_values = {};
	for (const i of inputs) {
		const v = mine && i.name in mine.values ? mine.values[i.name] : i.default;
		out[i.name] = to_form(i, v);
	}
	return out;
}

function to_form(i: Requested_input, v: unknown): Form_value {
	switch (i.type) {
		case 'boolean': return v === true;
		case 'number': return typeof v === 'number' ? String(v) : '';
		case 'enum':
			if (i.multiple) return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
			return typeof v === 'string' ? v : '';
		case 'channel': return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' && v ? [v] : [];
		case 'file': {
			const list = Array.isArray(v) ? v : v && typeof v === 'object' ? [v] : [];
			return list.filter((f): f is File_ref => !!f && typeof (f as File_ref).artifact_id === 'string');
		}
		default: return typeof v === 'string' ? v : '';
	}
}

/**
 * Form values → the values Core takes. An empty optional input is left out; an empty required one
 * is left out too, so Core (and {@link value_problems}) report it as required.
 */
export function to_values(inputs: readonly Requested_input[], form: Form_values): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const i of inputs) {
		const v = form[i.name];
		switch (i.type) {
			case 'boolean': out[i.name] = v === true; break;
			case 'number': {
				const s = typeof v === 'string' ? v.trim() : '';
				if (s !== '') out[i.name] = Number(s);
				break;
			}
			case 'enum':
				if (i.multiple) { if (Array.isArray(v) && v.length) out[i.name] = v; } else if (typeof v === 'string' && v) out[i.name] = v;
				break;
			case 'channel': if (Array.isArray(v) && v.length) out[i.name] = v; break;
			case 'file': {
				const refs = (Array.isArray(v) ? v : []) as File_ref[];
				if (refs.length) out[i.name] = i.multiple ? refs.map((f) => ({ artifact_id: f.artifact_id })) : { artifact_id: refs[0].artifact_id };
				break;
			}
			default: if (typeof v === 'string' && v !== '') out[i.name] = v;
		}
	}
	return out;
}

/** Most files one input takes (the SDK's MAX_FILES_PER_INPUT). */
export const MAX_FILES_PER_INPUT = 10;

/**
 * What's wrong with each value, keyed by input name — the SDK's `validate_values` rules, worded the
 * same, for messages before sending.
 */
export function value_problems(inputs: readonly Requested_input[], values: Record<string, unknown>): Record<string, string> {
	const out: Record<string, string> = {};
	for (const i of inputs) {
		const v = values[i.name];
		if (v === undefined || v === null) {
			if (i.required !== false) out[i.name] = 'required';
			continue;
		}
		const p = problem(i, v);
		if (p) out[i.name] = p;
	}
	return out;
}

function problem(i: Requested_input, v: unknown): string | null {
	switch (i.type) {
		case 'text': {
			if (typeof v !== 'string') return 'must be text';
			const max = i.max_length ?? 100_000;
			if (v.length > max) return `must be at most ${max} characters`;
			if (i.min_length !== undefined && v.length < i.min_length) return `must be at least ${i.min_length} characters`;
			if (i.required !== false && v.trim() === '') return 'required';
			return null;
		}
		case 'number':
			if (typeof v !== 'number' || !Number.isFinite(v)) return 'must be a number';
			if (i.integer && !Number.isInteger(v)) return 'must be a whole number';
			if (i.min !== undefined && v < i.min) return `must be at least ${i.min}`;
			if (i.max !== undefined && v > i.max) return `must be at most ${i.max}`;
			return null;
		case 'boolean': return typeof v === 'boolean' ? null : 'must be true or false';
		case 'enum': {
			const allowed = new Set(i.choices.map((c) => c.value));
			if (i.multiple) {
				if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) return 'must be a list of choices';
				if (new Set(v).size !== v.length) return 'has a choice more than once';
				if (i.required !== false && v.length === 0) return 'required';
				const bad = v.find((x) => !allowed.has(x));
				return bad === undefined ? null : `'${bad}' is not one of the choices`;
			}
			if (typeof v !== 'string') return 'must be one of the choices';
			return allowed.has(v) ? null : `'${v}' is not one of the choices`;
		}
		case 'file': {
			const is_ref = (x: unknown) => !!x && typeof x === 'object' && !Array.isArray(x) && typeof (x as File_ref).artifact_id === 'string' && (x as File_ref).artifact_id !== '';
			if (i.multiple) {
				if (!Array.isArray(v) || !v.every(is_ref)) return 'must be a list of uploaded files';
				if (v.length > MAX_FILES_PER_INPUT) return `takes at most ${MAX_FILES_PER_INPUT} files`;
				if (i.required !== false && v.length === 0) return 'required';
				return null;
			}
			return is_ref(v) ? null : 'must be an uploaded file';
		}
		case 'channel':
			if (!Array.isArray(v) || !v.every((x) => typeof x === 'string' && x.trim() !== '')) return 'must be a list of channel names';
			if (!i.multiple && v.length > 1) return 'takes one channel';
			if (i.required !== false && v.length === 0) return 'required';
			return null;
	}
}

/**
 * Core's refusal message (`name: problem; name: problem`) → problems per input; the rest (not about
 * one input) under `''`.
 */
export function problems_from_message(message: string, inputs: readonly Requested_input[]): Record<string, string> {
	const names = new Set(inputs.map((i) => i.name));
	const out: Record<string, string> = {};
	for (const part of message.split('; ')) {
		const at = part.indexOf(': ');
		const name = at > 0 ? part.slice(0, at) : '';
		if (names.has(name)) out[name] = part.slice(at + 2);
		else out[''] = out[''] ? `${out['']}; ${part}` : part;
	}
	return out;
}

/** The label people see for an input. */
export function input_label(i: Requested_input): string {
	return i.label || i.name.replace(/_/g, ' ');
}

/** The label of an enum value (its choice label, else the value). */
export function choice_label(i: Requested_input, value: unknown): string {
	if (i.type === 'enum' && typeof value === 'string') return i.choices.find((c) => c.value === value)?.label ?? value;
	if (Array.isArray(value)) return value.map((v) => (typeof v === 'object' && v ? String((v as File_ref).name ?? (v as File_ref).artifact_id) : choice_label(i, v))).join(', ');
	if (typeof value === 'boolean') return value ? 'Yes' : 'No';
	if (value && typeof value === 'object') return String((value as File_ref).name ?? (value as File_ref).artifact_id ?? '');
	return value == null ? '' : String(value);
}

// ── Answering ──────────────────────────────────────────────────────────────

type Auth_fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Submit (or replace) the caller's answer. Resolves with Core's error message when it refuses. */
export async function respond(auth_fetch: Auth_fetch, hug_id: string, values: Record<string, unknown>, comment: string): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
	const body: Record<string, unknown> = { hug_id, values };
	if (comment.trim()) body.comment = comment.trim();
	const res = await auth_fetch('/v1/hugs/respond', { method: 'POST', body: JSON.stringify(body) });
	const d = await res.json().catch(() => null) as { ok?: boolean; error?: { message?: string } | string } | null;
	if (res.ok && d?.ok) {
		// The nav's HUG count (and any overview on screen) reloads.
		mark_overview_stale();
		return { ok: true };
	}
	const message = typeof d?.error === 'string' ? d.error : d?.error?.message ?? 'Could not send your answer.';
	return { ok: false, status: res.status, message };
}

/** Why a file can't be sent for this input, checked before uploading (Core checks again). */
export function file_problem(input: Extract<Requested_input, { type: 'file' }>, file: { name: string; type: string; size: number }, max_mb: number): string | null {
	const limit = Math.min(max_mb * 1024 * 1024, input.max_bytes ?? Infinity);
	if (file.size > limit) return `${file.name} is larger than ${limit >= 1024 * 1024 ? `${Math.floor(limit / (1024 * 1024))} MB` : `${limit} bytes`}`;
	if (input.accept?.length && !accepts(input.accept, file)) return `${file.name} isn't one of: ${input.accept.join(', ')}`;
	return null;
}

function accepts(accept: readonly string[], file: { name: string; type: string }): boolean {
	const name = file.name.toLowerCase();
	const type = (file.type || '').toLowerCase();
	return accept.some((a) => {
		const x = a.toLowerCase();
		if (x.startsWith('.')) return name.endsWith(x);
		if (x.endsWith('/*')) return type.startsWith(x.slice(0, -1));
		return type === x;
	});
}

/** The largest upload the Hub takes (MB) — CLIQ_ARTIFACT_MAX_MB's default; Core and the BFF enforce it. */
export const UPLOAD_MAX_MB = 50;

export interface Upload {
	/** Resolves with the stored file, or rejects with a message. */
	done: Promise<File_ref>;
	abort: () => void;
}

/**
 * Stream one file to `/v1/artifacts/upload` for a Hug's `file` input: the file is the raw body (no
 * multipart), its metadata in the query. XHR for progress and cancel.
 */
export function upload_file(hug_id: string, input: string, file: File, on_progress: (fraction: number) => void): Upload {
	const xhr = new XMLHttpRequest();
	const q = new URLSearchParams({ hug_id, requested_input: input, name: file.name });
	const done = new Promise<File_ref>((resolve, reject) => {
		xhr.upload.onprogress = (e) => { if (e.lengthComputable) on_progress(e.loaded / e.total); };
		xhr.onload = () => {
			let d: { ok?: boolean; data?: { artifact_id?: string; name?: string; size?: number; content_type?: string }; error?: { message?: string } | string } | null = null;
			try { d = JSON.parse(xhr.responseText); } catch { /* not JSON (a proxy page) */ }
			if (xhr.status >= 200 && xhr.status < 300 && d?.ok && d.data?.artifact_id) {
				on_progress(1);
				resolve({ artifact_id: d.data.artifact_id, name: d.data.name ?? file.name, size: d.data.size ?? file.size, content_type: d.data.content_type ?? file.type });
				return;
			}
			const msg = typeof d?.error === 'string' ? d.error : d?.error?.message;
			reject(new Error(xhr.status === 413 ? msg ?? `${file.name} is too large` : msg ?? `Upload failed (${xhr.status || 'network'})`));
		};
		xhr.onerror = () => reject(new Error('Upload failed — check your connection and retry.'));
		xhr.onabort = () => reject(new Error('Upload cancelled'));
	});
	xhr.open('POST', `/v1/artifacts/upload?${q}`);
	xhr.withCredentials = true;
	xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
	xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
	xhr.send(file);
	return { done, abort: () => xhr.abort() };
}

// ── Reading a Hug ──────────────────────────────────────────────────────────

/** Whether the Hug still takes answers (open and not past its expiry). */
export function is_answerable(h: Pick<Hug, 'status' | 'expires_at'>, now: number = Date.now()): boolean {
	return h.status === 'open' && Date.parse(h.expires_at) > now;
}

/** The caller's own answer, when they gave one. */
export function my_response(h: Pick<Hug, 'responses'>, user_id: string | null | undefined): Hug_response | null {
	return user_id ? h.responses.find((r) => r.responder.user_id === user_id) ?? null : null;
}

/** How a closed Hug ended, in words. */
export function status_label(h: Pick<Hug, 'status' | 'outcome'>): string {
	if (h.status === 'open') return 'Open';
	if (h.status === 'expired') return 'Expired';
	if (h.status === 'cancelled') return h.outcome ? `Cancelled — ${h.outcome}` : 'Cancelled';
	return h.outcome || 'Closed';
}
