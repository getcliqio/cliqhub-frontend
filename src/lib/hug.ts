/**
 * Hugs — a person is asked for input (PLAN-hug-requests, PLAN-hug-widgets). Types for `POST /v1/hug_page/get`,
 * answering (`POST /v1/hugs/respond`) and file uploads (`POST /v1/artifacts/upload?hug_id&requested_input&name`,
 * the file as the raw body).
 *
 * A Hug is opened with a hug — a frontend the page frames from the content origin (`content_url`) and talks to
 * through the host bridge (`components/hug/hug_host.tsx`). The hug checks answers; Core checks only their envelope
 * (size, a one-line summary, uploads under the Hug's upload slots). A Hug with no hug (opened before hugs) or whose
 * bundle is gone is shown read-only (`content_url: null`).
 */

import { mark_overview_stale } from '@/lib/overview';

// ── What Core sends ────────────────────────────────────────────────────────

/** A file a hug can read or a person uploaded. */
export interface File_ref {
	artifact_id: string;
	name: string;
	size: number;
	content_type: string;
	sha256?: string;
}

/** An upload slot: a top-level answer key that takes files. */
export interface Hug_file_slot {
	name: string;
	accept?: string[];
	max_bytes?: number;
	multiple?: boolean;
	required?: boolean;
}

export interface Hug_response {
	response_id: string;
	responder: { user_id: string; name: string };
	/** The Hug's channels that reached this person. */
	via: string[];
	/** The answer, as the hug's keys. */
	values: Record<string, unknown>;
	/** The answer in one line, from the hug ("Approved"); absent when it gave none. */
	summary?: string;
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
	/** The hug it was opened with; null for a Hug opened before hugs. */
	hug: { name: string; sha256: string } | null;
	/** What's asked, in plain text. */
	summary: string | null;
	/** The requester's latest status line while open ("1 answer couldn't be used; …"), or null (§6.1 progress). */
	progress?: string | null;
	/** The hug's params (only the hug reads them). */
	params: Record<string, unknown>;
	files: Hug_file_slot[];
	attachments: File_ref[];
	channels: string[];
	status: Hug_status;
	outcome: string | null;
	expires_at: string;
	created_at: string;
	closed_at: string | null;
	last_reminded_at: string | null;
	/** People its channels reach who can't see it, so it wasn't sent to them. */
	not_sent_to?: Array<{ name: string; channel: string }>;
	responses: Hug_response[];
	/**
	 * What the person reading it may do: answer only when Core would take their answer (open, and its channels
	 * reached them — `via`). Without it (an older Core) the page offers the answer and Core decides on Submit.
	 */
	viewer?: { can_answer: boolean; via: string[] } | null;
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
	/** Where the hug is framed from; null → the read-only fallback view. */
	content_url: string | null;
	run?: Hug_run | null;
}

export function hug_href(hug_id: string): string {
	return `/hugs/${encodeURIComponent(hug_id)}`;
}

// ── Answering ──────────────────────────────────────────────────────────────

type Auth_fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Submit (or replace) the caller's answer. Resolves with Core's error message when it refuses. */
export async function respond(
	auth_fetch: Auth_fetch,
	hug_id: string,
	values: Record<string, unknown>,
	summary?: string,
): Promise<{ ok: true; response_id: string } | { ok: false; status: number; message: string }> {
	const body: Record<string, unknown> = { hug_id, values, ...(summary ? { summary } : {}) };
	const res = await auth_fetch('/v1/hugs/respond', { method: 'POST', body: JSON.stringify(body) });
	const d = await res.json().catch(() => null) as { ok?: boolean; data?: { response_id?: string }; error?: { message?: string } | string } | null;
	if (res.ok && d?.ok) {
		// The nav's HUG count (and any overview on screen) reloads.
		mark_overview_stale();
		return { ok: true, response_id: d.data?.response_id ?? '' };
	}
	const message = typeof d?.error === 'string' ? d.error : d?.error?.message ?? 'Could not send your answer.';
	return { ok: false, status: res.status, message };
}

/** Why a file can't go into this upload slot, checked before uploading (Core checks again). */
export function file_problem(slot: Hug_file_slot, file: { name: string; type: string; size: number }, max_mb: number = UPLOAD_MAX_MB): string | null {
	const limit = Math.min(max_mb * 1024 * 1024, slot.max_bytes ?? Infinity);
	if (file.size > limit) return `${file.name} is larger than ${limit >= 1024 * 1024 ? `${Math.floor(limit / (1024 * 1024))} MB` : `${limit} bytes`}`;
	if (slot.accept?.length && !accepts(slot.accept, file)) return `${file.name} isn't one of: ${slot.accept.join(', ')}`;
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
 * Stream one file to `/v1/artifacts/upload` for one of a Hug's upload slots: the file is the raw body (no
 * multipart), its metadata in the query. XHR for progress and cancel.
 */
export function upload_file(hug_id: string, slot: string, file: File, on_progress: (fraction: number) => void = () => undefined): Upload {
	const xhr = new XMLHttpRequest();
	const q = new URLSearchParams({ hug_id, requested_input: slot, name: file.name });
	const done = new Promise<File_ref>((resolve, reject) => {
		xhr.upload.onprogress = (e) => { if (e.lengthComputable) on_progress(e.loaded / e.total); };
		xhr.onload = () => {
			let d: { ok?: boolean; data?: { artifact_id?: string; name?: string; size?: number; content_type?: string; sha256?: string }; error?: { message?: string } | string } | null = null;
			try { d = JSON.parse(xhr.responseText); } catch { /* not JSON (a proxy page) */ }
			if (xhr.status >= 200 && xhr.status < 300 && d?.ok && d.data?.artifact_id) {
				on_progress(1);
				resolve({
					artifact_id: d.data.artifact_id, name: d.data.name ?? file.name, size: d.data.size ?? file.size,
					content_type: d.data.content_type ?? file.type, sha256: d.data.sha256 ?? '',
				});
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

/** A value shown as text in the fallback view: strings as they are, file refs by name, the rest as JSON. */
export function value_text(v: unknown): string {
	if (v === null || v === undefined) return '—';
	if (typeof v === 'string') return v;
	if (typeof v === 'number' || typeof v === 'boolean') return String(v);
	const name = (x: unknown) => (x && typeof x === 'object' && 'artifact_id' in x && 'name' in x ? String((x as { name: unknown }).name) : null);
	if (name(v)) return name(v)!;
	if (Array.isArray(v) && v.length && v.every((x) => name(x))) return v.map(name).join(', ');
	return JSON.stringify(v);
}

// ── Drafts (unsent answers, this tab's session only — §9.2.9) ──────────────
// sessionStorage: a draft survives a reload in the same tab and is gone when the tab closes, so an answer never
// outlives the visit (a shared machine, a signed-out person).

const draft_key = (hug_id: string, user_id: string) => `hug-draft:${user_id}:${hug_id}`;

/** The unsent answer this person kept for this Hug in this tab, or null. */
export function load_draft(hug_id: string, user_id: string | null | undefined): Record<string, unknown> | null {
	if (!user_id) return null;
	try {
		const raw = sessionStorage.getItem(draft_key(hug_id, user_id));
		const v = raw ? JSON.parse(raw) as unknown : null;
		return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
	} catch {
		return null;
	}
}

/** Keep (or, with null, drop) this person's unsent answer for this Hug. */
export function save_draft(hug_id: string, user_id: string | null | undefined, values: Record<string, unknown> | null): void {
	if (!user_id) return;
	try {
		if (values) sessionStorage.setItem(draft_key(hug_id, user_id), JSON.stringify(values));
		else sessionStorage.removeItem(draft_key(hug_id, user_id));
	} catch { /* storage off (private window, quota): drafts aren't kept */ }
}
