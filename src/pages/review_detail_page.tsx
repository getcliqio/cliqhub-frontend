import { Link, useNavigate, useParams } from 'react-router';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { useOrgFetch } from '@/lib/org_context';
import { useAuth } from '@/lib/auth_context';
import { ChannelUserPicker } from '@/components/channel_user_picker';
import { realm_qualified_label } from '@/lib/realm_url';
import { ReviewChatPanel } from '@/components/review_chat_panel';
import { ReviewClaimBanner } from '@/components/review_claim_banner';

interface ReviewArtifact {
	id: number;
	phase: string;
	kind: string;
	name: string;
	mime_type: string | null;
	content: string;
	content_preview: string;
	sequence: number | null;
}

/** A single reviewer notification row from the API. */
interface ReviewNotificationRow {
	id: string;
	group_idx: number;
	channel_target: string;
	channel_id: string | null;
	user_id: string | null;
	responded_by: number | null;
	responded_at: string | null;
	action: string | null;
	comment: string | null;
}

/** A reviewer group from the API. */
interface ReviewGroupData {
	group_idx: number;
	policy: 'any' | 'all';
	channels: string[];
	satisfied: boolean;
	notifications: ReviewNotificationRow[];
}

interface ReviewData {
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
	status: string;
	route_targets: string[] | null;
	created_at: string;
	timeout_at: string;
	completed_at: string | null;
	artifacts: ReviewArtifact[];
	notification_groups?: ReviewGroupData[];
	policy?: Record<string, unknown>;
	/** User ID of the reviewer who claimed this review for chat. */
	claimed_by: string | null;
	claimed_at: string | null;
	/** Number of chat messages on this review. */
	message_count: number;
}

function api_error_message(data: { error?: string | { message?: string } }): string {
	if (typeof data.error === 'string') return data.error;
	return data.error?.message ?? 'Request failed';
}

function short_id(id: string): string {
	if (id.length <= 12) return id;
	return `${id.slice(0, 12)}…`;
}

function as_text(value: unknown): string | null {
	if (typeof value === 'string' && value.trim()) return value;
	return null;
}

/**
 * Structured input field the reviewer must fill before the phase can
 * continue. Populated by the daemon (hug agent) from the team's
 * `phases[].review.inputs` YAML block and shipped in the review's
 * `payload.inputs_schema`. Optional — reviews without a schema still
 * render the plain approve/reject flow as before.
 */
interface InputFieldSpec {
	name: string;
	label?: string;
	type: 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'channel';
	required?: boolean;
	help?: string;
	default?: unknown;
	choices?: string[];
	placeholder?: string;
}

/** Runtime-checked coercion — payloads come off the wire as `unknown`. */
function coerce_inputs_schema(raw: unknown): InputFieldSpec[] {
	if (!Array.isArray(raw)) return [];
	const out: InputFieldSpec[] = [];
	for (const item of raw) {
		if (!item || typeof item !== 'object') continue;
		const obj = item as Record<string, unknown>;
		const name = typeof obj['name'] === 'string' ? obj['name'].trim() : '';
		if (!name) continue;
		const raw_type = typeof obj['type'] === 'string' ? obj['type'].trim() : 'text';
		const type: InputFieldSpec['type'] = (
			raw_type === 'textarea' || raw_type === 'number'
				|| raw_type === 'boolean' || raw_type === 'select'
				|| raw_type === 'channel'
		) ? raw_type : 'text';
		const choices = Array.isArray(obj['choices'])
			? (obj['choices'] as unknown[]).filter((c): c is string => typeof c === 'string')
			: undefined;
		out.push({
			name,
			label: typeof obj['label'] === 'string' ? obj['label'] : undefined,
			type,
			required: obj['required'] === true,
			help: typeof obj['help'] === 'string' ? obj['help'] : undefined,
			default: obj['default'],
			choices,
			placeholder: typeof obj['placeholder'] === 'string' ? obj['placeholder'] : undefined,
		});
	}
	return out;
}

/** Convert stringy form state back into the wire type for each field. */
function normalize_value(spec: InputFieldSpec, raw: string | boolean): unknown {
	if (spec.type === 'boolean') return raw === true || raw === 'true';
	if (spec.type === 'number') {
		if (typeof raw !== 'string' || raw.trim() === '') return null;
		const n = Number(raw);
		return Number.isFinite(n) ? n : null;
	}
	/** Channel inputs are comma-separated → string array. */
	if (spec.type === 'channel') {
		if (typeof raw !== 'string') return [];
		return raw.split(',').map((s) => s.trim()).filter(Boolean);
	}
	if (typeof raw !== 'string') return '';
	return raw;
}

function is_missing(spec: InputFieldSpec, raw: string | boolean): boolean {
	if (!spec.required) return false;
	if (spec.type === 'boolean') return false;
	if (spec.type === 'number') {
		if (typeof raw !== 'string' || raw.trim() === '') return true;
		return !Number.isFinite(Number(raw));
	}
	/** Channel: missing if no entries after split. */
	if (spec.type === 'channel') {
		if (typeof raw !== 'string') return true;
		return raw.split(',').map((s) => s.trim()).filter(Boolean).length === 0;
	}
	return typeof raw !== 'string' || raw.trim() === '';
}

/** Render a single input field per spec. */
function InputField({ spec, value, on_change }: {
	spec: InputFieldSpec;
	value: string | boolean;
	on_change: (v: string | boolean) => void;
}) {
	const label = spec.label || spec.name;
	const base_input_cls
		= 'mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100';

	const help_row = spec.help ? (
		<p className="mt-1 text-xs text-slate-500">{spec.help}</p>
	) : null;

	if (spec.type === 'textarea') {
		return (
			<label className="block text-sm text-slate-700">
				<span className="font-medium">
					{label}
					{spec.required ? <span className="ml-1 text-rose-600">*</span> : null}
				</span>
				<textarea
					value={typeof value === 'string' ? value : ''}
					onChange={(e) => on_change(e.target.value)}
					rows={4}
					placeholder={spec.placeholder}
					className={base_input_cls}
				/>
				{help_row}
			</label>
		);
	}
	if (spec.type === 'select' && spec.choices && spec.choices.length > 0) {
		return (
			<label className="block text-sm text-slate-700">
				<span className="font-medium">
					{label}
					{spec.required ? <span className="ml-1 text-rose-600">*</span> : null}
				</span>
				<select
					value={typeof value === 'string' ? value : ''}
					onChange={(e) => on_change(e.target.value)}
					className={base_input_cls}
				>
					<option value="">— select —</option>
					{spec.choices.map((c) => (
						<option key={c} value={c}>{c}</option>
					))}
				</select>
				{help_row}
			</label>
		);
	}
	if (spec.type === 'channel') {
		const selected_arr = typeof value === 'string'
			? value.split(',').map((s) => s.trim()).filter(Boolean)
			: [];
		return (
			<div className="block text-sm text-slate-700">
				<span className="font-medium">
					{label}
					{spec.required ? <span className="ml-1 text-rose-600">*</span> : null}
				</span>
				<ChannelUserPicker
					selected={selected_arr}
					on_change={(next) => on_change(next.join(','))}
					placeholder={spec.placeholder || 'Search users or channels…'}
					class_name="mt-1"
				/>
				{spec.help ? (
					<p className="mt-1 text-xs text-slate-500">{spec.help}</p>
				) : null}
			</div>
		);
	}
	if (spec.type === 'boolean') {
		return (
			<label className="flex items-start gap-2 text-sm text-slate-700">
				<input
					type="checkbox"
					checked={value === true || value === 'true'}
					onChange={(e) => on_change(e.target.checked)}
					className="mt-0.5 h-4 w-4 rounded border-slate-300"
				/>
				<span>
					<span className="font-medium">{label}</span>
					{help_row}
				</span>
			</label>
		);
	}
	// text (default) / number
	return (
		<label className="block text-sm text-slate-700">
			<span className="font-medium">
				{label}
				{spec.required ? <span className="ml-1 text-rose-600">*</span> : null}
			</span>
			<input
				type={spec.type === 'number' ? 'number' : 'text'}
				value={typeof value === 'string' ? value : ''}
				onChange={(e) => on_change(e.target.value)}
				placeholder={spec.placeholder}
				className={base_input_cls}
			/>
			{help_row}
		</label>
	);
}

function MetaChip({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
			<p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
			<div className="mt-0.5 text-sm font-medium text-slate-800">{children}</div>
		</div>
	);
}

function CheckResults({ value }: { value: unknown }) {
	if (!Array.isArray(value) || value.length === 0) return null;
	return (
		<ul className="mt-2 space-y-2">
			{value.map((item, idx) => {
				const row: Record<string, unknown> = item && typeof item === 'object'
					? item as Record<string, unknown>
					: { value: item };
				const name = as_text(row.name) || as_text(row.check) || `Check ${idx + 1}`;
				const ok = row.ok === true || row.passed === true || row.status === 'pass';
				const detail = as_text(row.message) || as_text(row.detail) || as_text(row.reason);
				return (
					<li
						key={`${name}-${idx}`}
						className={`rounded-lg border px-3 py-2 text-sm ${
							ok
								? 'border-emerald-200 bg-emerald-50 text-emerald-900'
								: 'border-amber-200 bg-amber-50 text-amber-950'
						}`}
					>
						<p className="font-semibold">{name}{ok ? ' — pass' : ' — needs attention'}</p>
						{detail ? <p className="mt-1 text-xs opacity-90">{detail}</p> : null}
					</li>
				);
			})}
		</ul>
	);
}

/** Reduce a MIME type to a simple render bucket. */
function mime_bucket(mime: string | null | undefined, name: string): 'json' | 'markdown' | 'image' | 'pdf' | 'html' | 'text' {
	const m = (mime ?? '').toLowerCase();
	const lower_name = name.toLowerCase();
	if (m.includes('json') || lower_name.endsWith('.json')) return 'json';
	if (m.includes('markdown') || lower_name.endsWith('.md') || lower_name.endsWith('.mdx')) return 'markdown';
	if (m.startsWith('image/')) return 'image';
	if (m.includes('pdf') || lower_name.endsWith('.pdf')) return 'pdf';
	if (m.includes('html') || lower_name.endsWith('.html') || lower_name.endsWith('.htm')) return 'html';
	return 'text';
}

/** Best-effort filename for downloads — appends extension inferred from MIME/name. */
function download_filename(artifact: ReviewArtifact): string {
	const base = artifact.name?.trim() || `artifact-${artifact.id}`;
	const has_ext = /\.[a-z0-9]{1,6}$/i.test(base);
	if (has_ext) return base;
	const m = (artifact.mime_type ?? '').toLowerCase();
	if (m.includes('json')) return `${base}.json`;
	if (m.includes('markdown')) return `${base}.md`;
	if (m.includes('html')) return `${base}.html`;
	if (m === 'text/plain') return `${base}.txt`;
	if (m.startsWith('image/')) return `${base}.${m.split('/')[1] || 'bin'}`;
	if (m.includes('pdf')) return `${base}.pdf`;
	return base;
}

/**
 * Detect whether the artifact `content` string looks like base64 —
 * used for binary previews (image, pdf) which the store keeps as
 * base64-in-text. Not perfect (short valid text like "aGVsbG8="
 * would match) but the caller only inspects this for binary MIMEs.
 */
function looks_like_base64(s: string): boolean {
	if (!s || s.length < 8) return false;
	if (s.startsWith('data:')) return true;
	return /^[A-Za-z0-9+/=\s]+$/.test(s.slice(0, 200));
}

/** Try to pretty-print JSON. Returns null when the input isn't parseable. */
function try_pretty_json(raw: string): string | null {
	try {
		return JSON.stringify(JSON.parse(raw), null, 2);
	} catch {
		return null;
	}
}

/**
 * Renders a review's artifact with a MIME-aware body:
 *   json      → pretty-printed with 2-space indent
 *   markdown  → rendered with react-markdown
 *   image     → inline <img> (works for raw data: URLs or base64 blobs)
 *   pdf       → <iframe> preview when the content is base64/data
 *   html      → escaped code (safer default than sandboxing at review time)
 *   text      → plain <pre>
 *
 * Adds a truncation banner when the store returned only the first
 * ~4KB, plus per-artifact Copy and Download buttons so the reviewer
 * always has an escape hatch to the raw content.
 */
function ArtifactCard({ artifact, default_open }: { artifact: ReviewArtifact; default_open?: boolean }) {
	const [open, set_open] = useState(default_open ?? false);
	const [copied, set_copied] = useState(false);

	const content = artifact.content ?? '';
	const preview = artifact.content_preview ?? content;
	const truncated = content.length > 0 && preview.length < content.length;
	const bucket = mime_bucket(artifact.mime_type, artifact.name);
	const is_empty = !content && !preview;

	const pretty_json = useMemo(
		() => (bucket === 'json' ? try_pretty_json(content || preview) : null),
		[bucket, content, preview],
	);

	async function on_copy(): Promise<void> {
		try {
			// Prefer the pretty-printed form for JSON so pasting into
			// another tool preserves the reviewer's on-screen view.
			await navigator.clipboard.writeText(pretty_json ?? content ?? preview);
			set_copied(true);
			setTimeout(() => set_copied(false), 1500);
		} catch {
			/* clipboard may be unavailable in insecure contexts */
		}
	}

	function on_download(): void {
		const filename = download_filename(artifact);
		const mime = artifact.mime_type || 'application/octet-stream';
		// For base64/binary blobs, decode before writing so the download is
		// a real binary file instead of the base64 text.
		if ((bucket === 'image' || bucket === 'pdf') && looks_like_base64(content) && !content.startsWith('data:')) {
			try {
				const bin = atob(content.replace(/\s+/g, ''));
				const bytes = new Uint8Array(bin.length);
				for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
				const blob = new Blob([bytes], { type: mime });
				trigger_download(blob, filename);
				return;
			} catch {
				/* fall through to text download */
			}
		}
		const blob = new Blob([content || preview], { type: mime });
		trigger_download(blob, filename);
	}

	function render_body(): ReactNode {
		if (is_empty) return <p className="p-4 text-xs italic text-slate-400">(empty)</p>;

		if (bucket === 'json') {
			return (
				<pre className="max-h-[32rem] overflow-auto bg-slate-50 p-4 font-mono text-xs leading-relaxed text-slate-800 whitespace-pre-wrap">
					{pretty_json ?? preview}
				</pre>
			);
		}
		if (bucket === 'markdown') {
			return (
				<div className="prose prose-sm max-h-[32rem] max-w-none overflow-auto p-4 text-slate-800">
					<ReactMarkdown>{preview}</ReactMarkdown>
				</div>
			);
		}
		if (bucket === 'image') {
			const src = content.startsWith('data:')
				? content
				: looks_like_base64(content)
					? `data:${artifact.mime_type || 'image/png'};base64,${content.replace(/\s+/g, '')}`
					: null;
			if (!src) {
				return (
					<pre className="max-h-96 overflow-auto bg-slate-50 p-4 text-xs text-slate-700 whitespace-pre-wrap">
						{preview}
					</pre>
				);
			}
			return (
				<div className="flex items-center justify-center bg-slate-50 p-4">
					<img
						src={src}
						alt={artifact.name}
						className="max-h-[32rem] w-auto rounded border border-slate-200 shadow-sm"
					/>
				</div>
			);
		}
		if (bucket === 'pdf') {
			const src = content.startsWith('data:')
				? content
				: looks_like_base64(content)
					? `data:application/pdf;base64,${content.replace(/\s+/g, '')}`
					: null;
			if (!src) {
				return (
					<div className="p-4 text-xs text-slate-500">
						PDF content not inlineable — use Download to view.
					</div>
				);
			}
			return (
				<iframe
					src={src}
					title={artifact.name}
					className="h-[32rem] w-full border-0 bg-white"
				/>
			);
		}
		// html / text / fallback — render escaped in a <pre> for safety.
		return (
			<pre className="max-h-[32rem] overflow-auto bg-slate-50 p-4 font-mono text-xs leading-relaxed text-slate-700 whitespace-pre-wrap">
				{preview}
			</pre>
		);
	}

	return (
		<div className="rounded-lg border border-slate-200 bg-white">
			<div className="flex items-center justify-between gap-3 px-4 py-3">
				<button
					type="button"
					className="flex min-w-0 flex-1 items-baseline gap-2 text-left hover:opacity-80"
					onClick={() => set_open((v) => !v)}
				>
					<span className="text-xs text-slate-400" aria-hidden>
						{open ? '▾' : '▸'}
					</span>
					<div className="min-w-0">
						<p className="truncate text-sm font-semibold text-slate-800">
							{artifact.name}
						</p>
						<p className="mt-0.5 truncate text-xs text-slate-500">
							{artifact.kind}
							{artifact.phase ? ` · ${artifact.phase}` : ''}
							{artifact.mime_type ? ` · ${artifact.mime_type}` : ''}
							{content ? ` · ${format_bytes(content.length)}` : ''}
							{truncated ? ' · truncated' : ''}
						</p>
					</div>
				</button>
				<div className="flex shrink-0 gap-1">
					<button
						type="button"
						onClick={on_copy}
						className="rounded border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
						title="Copy content to clipboard"
					>
						{copied ? 'Copied' : 'Copy'}
					</button>
					<button
						type="button"
						onClick={on_download}
						className="rounded border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
						title="Download full artifact"
					>
						Download
					</button>
				</div>
			</div>
			{open ? (
				<>
					{truncated ? (
						<p className="border-t border-slate-100 bg-amber-50 px-4 py-2 text-[11px] text-amber-800">
							Showing the first {format_bytes(preview.length)} of {format_bytes(content.length)}.
							Use <span className="font-semibold">Download</span> for the full artifact.
						</p>
					) : null}
					<div className="border-t border-slate-100">{render_body()}</div>
				</>
			) : null}
		</div>
	);
}

/** Trigger a browser download for a blob without navigating away. */
function trigger_download(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function format_bytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Renders the reviewer notification groups with policy status. */
function NotificationGroupsPanel({ groups }: { groups: ReviewGroupData[] }) {
	if (groups.length === 0) return null;

	return (
		<section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
			<h2 className="text-sm font-semibold text-slate-800">
				Reviewer Groups
				<span className="ml-2 text-xs font-normal text-slate-400">
					{groups.filter((g) => g.satisfied).length}/{groups.length} satisfied
				</span>
			</h2>
			<div className="mt-3 space-y-3">
				{groups.map((group) => (
					<div
						key={group.group_idx}
						className={`rounded-lg border px-4 py-3 ${
							group.satisfied
								? 'border-emerald-200 bg-emerald-50/50'
								: 'border-slate-200 bg-slate-50'
						}`}
					>
						<div className="flex items-center gap-2">
							<span className={`inline-block rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
								group.satisfied
									? 'bg-emerald-200 text-emerald-800'
									: 'bg-slate-200 text-slate-600'
							}`}>
								{group.policy}
							</span>
							<span className="text-xs text-slate-500">
								{group.channels.join(', ')}
							</span>
							{group.satisfied ? (
								<span className="text-xs font-semibold text-emerald-700">✓ satisfied</span>
							) : (
								<span className="text-xs text-slate-400">waiting…</span>
							)}
						</div>
						{group.notifications.length > 0 ? (
							<div className="mt-2 space-y-1">
								{group.notifications.map((notif) => (
									<div
										key={notif.id}
										className="flex items-center gap-2 text-xs"
									>
										<span className={`inline-block h-2 w-2 rounded-full ${
											!notif.responded_at ? 'bg-slate-300'
												: notif.action === 'PASS' || notif.action === 'APPROVE' ? 'bg-emerald-500'
												: notif.action === 'REJECT' ? 'bg-red-500'
												: 'bg-indigo-500'
										}`} />
										<span className="font-medium text-slate-700">
											{notif.channel_target}
										</span>
										{notif.action ? (
											<span className={`rounded px-1.5 py-0.5 font-semibold ${
												notif.action === 'PASS' || notif.action === 'APPROVE'
													? 'bg-emerald-100 text-emerald-800'
													: notif.action === 'REJECT'
														? 'bg-red-100 text-red-800'
														: 'bg-indigo-100 text-indigo-800'
											}`}>
												{notif.action}
											</span>
										) : null}
										{notif.comment ? (
											<span className="text-slate-500 italic">
												"{notif.comment}"
											</span>
										) : null}
										{notif.responded_at ? (
											<span className="text-slate-400">
												{new Date(notif.responded_at).toLocaleString()}
											</span>
										) : null}
									</div>
								))}
							</div>
						) : null}
					</div>
				))}
			</div>
		</section>
	);
}

/** Native Hub HUG review — approve / reject / route; verdict syncs back to the daemon. */
export function Component() {
	const { review_id = '' } = useParams();
	const navigate = useNavigate();
	const auth_fetch = useOrgFetch();
	const { user: auth_user } = useAuth();

	const [review, set_review] = useState<ReviewData | null>(null);
	const [loading, set_loading] = useState(true);
	const [error, set_error] = useState<string | null>(null);
	const [comment, set_comment] = useState('');
	const [route_target, set_route_target] = useState('');
	const [submitting, set_submitting] = useState(false);
	const [show_raw, set_show_raw] = useState(false);
	/**
	 * Values entered for `payload.inputs_schema` fields (if the review
	 * carries a schema). Keyed by field `name`. Stored as raw string
	 * (or boolean for checkboxes) — normalized to wire types only at
	 * submit time via `normalize_value`.
	 */
	const [input_values, set_input_values] = useState<Record<string, string | boolean>>({});

	const load = useCallback(async () => {
		if (!review_id) return;
		set_loading(true);
		try {
			const res = await auth_fetch('/v1/reviews/get_by_id', {
				method: 'POST',
				body: JSON.stringify({ review_id }),
			});
			const data = await res.json();
			if (!data.ok) {
				set_error(api_error_message(data));
				set_review(null);
				return;
			}
			const row = data.data as ReviewData;
			set_review({
				...row,
				artifacts: Array.isArray(row.artifacts) ? row.artifacts : [],
			});
			set_route_target(row.route_targets?.[0] ?? '');
			// Seed the inputs form from the schema's declared defaults —
			// only fill fields the reviewer hasn't touched yet. This
			// preserves in-flight edits across the auto-refresh after a
			// (failed) submit.
			const schema = coerce_inputs_schema(row.payload?.['inputs_schema']);
			if (schema.length > 0) {
				set_input_values((prev) => {
					const next = { ...prev };
					for (const spec of schema) {
						if (spec.name in next) continue;
						if (spec.type === 'boolean') {
							next[spec.name] = spec.default === true;
							continue;
						}
						next[spec.name] = spec.default == null ? '' : String(spec.default);
					}
					return next;
				});
			}
			set_error(null);
		} catch {
			set_error('Failed to load review');
			set_review(null);
		} finally {
			set_loading(false);
		}
	}, [auth_fetch, review_id]);

	useEffect(() => {
		void load();
	}, [load]);

	async function submit_verdict(action: string) {
		if (!review_id) return;
		// Required-input enforcement only applies to affirmative actions
		// (PASS / ROUTE:*). REJECT is allowed even without values —
		// rejecting a step that can't proceed with the current inputs
		// is a valid outcome.
		const affirmative = action === 'PASS' || action.startsWith('ROUTE:');
		if (affirmative) {
			const missing = inputs_schema
				.filter((s) => is_missing(s, input_values[s.name] ?? ''))
				.map((s) => s.label || s.name);
			if (missing.length > 0) {
				set_error(`Please fill required input${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`);
				return;
			}
		}
		set_submitting(true);
		set_error(null);
		try {
			const fields: Record<string, unknown> = {};
			if (comment.trim()) fields.comment = comment.trim();
			// Ship structured values only when a schema was declared and
			// the action is affirmative. This keeps REJECT payloads
			// clean (no half-filled values getting merged into inputs
			// on the daemon side).
			if (affirmative && inputs_schema.length > 0) {
				const values: Record<string, unknown> = {};
				for (const spec of inputs_schema) {
					const raw = input_values[spec.name];
					if (raw === undefined) continue;
					values[spec.name] = normalize_value(spec, raw);
				}
				if (Object.keys(values).length > 0) fields.values = values;
			}
			/** In chat mode, fetch the full transcript and attach to the verdict. */
			if (review_mode === 'chat') {
				try {
					const msg_res = await auth_fetch('/v1/reviews/get_messages', {
						method: 'POST',
						body: JSON.stringify({ review_id }),
					});
					const msg_data = await msg_res.json();
					if (msg_data.ok && Array.isArray(msg_data.data)) {
						fields.chat_transcript = (msg_data.data as Array<{ role: string; text: string }>)
							.map((m) => ({ role: m.role, content: m.text }));
					}
				} catch {
					/* Non-fatal — submit verdict without transcript. */
				}
			}

			const verdict_body: Record<string, unknown> = {
				review_id,
				action,
				fields,
			};
			if (my_notification_id) {
				verdict_body.notification_id = my_notification_id;
			}
			const res = await auth_fetch('/v1/reviews/verdict', {
				method: 'POST',
				body: JSON.stringify(verdict_body),
			});
			const data = await res.json();
			if (!data.ok) {
				set_error(api_error_message(data));
				return;
			}
			navigate('/events?tab=hug');
		} catch {
			set_error('Failed to submit verdict');
		} finally {
			set_submitting(false);
		}
	}

	const inputs_schema = useMemo<InputFieldSpec[]>(
		() => coerce_inputs_schema(review?.payload?.['inputs_schema']),
		[review],
	);
	const missing_required = useMemo(
		() => inputs_schema.some((s) => is_missing(s, input_values[s.name] ?? '')),
		[inputs_schema, input_values],
	);

	const is_active = review?.status === 'pending';
	const is_decided = review?.status === 'decided' || review?.status === 'completed';

	/**
	 * Find the caller's notification_id from the review's notification groups.
	 * Matches on user_id — the first un-responded notification for this user.
	 */
	const my_notification_id = useMemo(() => {
		if (!auth_user || !review?.notification_groups) return null;
		for (const group of review.notification_groups) {
			for (const notif of group.notifications) {
				if (notif.user_id === auth_user.id && !notif.responded_at) {
					return notif.id;
				}
			}
		}
		/** Fall back to any notification for this user (already responded). */
		for (const group of review.notification_groups) {
			for (const notif of group.notifications) {
				if (notif.user_id === auth_user.id) return notif.id;
			}
		}
		return null;
	}, [auth_user, review?.notification_groups]);

	const upstream_text = useMemo(
		() => as_text(review?.payload?.upstream_text),
		[review],
	);
	const payload_message = useMemo(
		() => as_text(review?.payload?.message),
		[review],
	);
	const brief_text = upstream_text || payload_message;
	const check_results = review?.payload?.check_results;
	const iteration = review?.payload?.iteration;
	const max_iterations = review?.payload?.max_iterations;

	const is_input_pause = useMemo(() => {
		const payload_mode = review?.payload?.['mode'];
		const policy = review?.policy as Record<string, unknown> | undefined;
		return payload_mode === 'input_pause' || policy?.['mode'] === 'input_pause';
	}, [review]);

	/** Detect the review interaction mode. */
	const review_mode = useMemo<'chat' | 'structured_input' | 'verdict'>(() => {
		if (review?.payload?.['mode'] === 'chat') return 'chat';
		if (is_input_pause || inputs_schema.length > 0) return 'structured_input';
		return 'verdict';
	}, [review, is_input_pause, inputs_schema]);

	/** Claim state derived from the review + current user. */
	const is_my_claim = review?.claimed_by !== null && review?.claimed_by === auth_user?.id;
	const is_other_claim = review?.claimed_by !== null && review?.claimed_by !== auth_user?.id;

	/** Count distinct reviewer targets for the claim banner. */
	const reviewer_count = useMemo(() => {
		if (!review?.notification_groups) return 0;
		const unique = new Set<string>();
		for (const group of review.notification_groups) {
			for (const notif of group.notifications) {
				unique.add(notif.channel_target);
			}
		}
		return unique.size;
	}, [review?.notification_groups]);

	const pause_summary = useMemo(
		() => as_text(review?.payload?.['summary']) || brief_text,
		[review, brief_text],
	);
	const pause_context = useMemo(() => {
		const raw = review?.payload?.['context'];
		if (!Array.isArray(raw)) return [] as Array<{ role: string; content: string }>;
		return raw
			.filter((t): t is { role: string; content: string } =>
				!!t && typeof t === 'object'
				&& typeof (t as { role?: unknown }).role === 'string'
				&& typeof (t as { content?: unknown }).content === 'string')
			.map((t) => ({ role: t.role, content: t.content }));
	}, [review]);

	return (
		<div className="flex min-h-[70vh] flex-col">
			<Breadcrumbs
				items={[
					{ label: 'HUGs and Events', to: '/events?tab=hug' },
					{ label: review?.phase || (review_id ? short_id(review_id) : 'Review') },
				]}
			/>
			<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
				<div>
					<h1 className="text-xl font-bold text-slate-900">
						{review?.phase
							? (review_mode === 'chat' ? `Chat: ${review.phase}`
								: is_input_pause ? `Inputs: ${review.phase}`
								: `Review: ${review.phase}`)
							: (review_mode === 'chat' ? 'Agent Chat'
								: is_input_pause ? 'Supply inputs'
								: 'HUG Review')}
					</h1>
					<p className="mt-1 text-sm text-slate-500">
						{review_mode === 'chat'
							? 'Chat with the agent, then approve or reject when ready.'
							: is_input_pause
								? 'Fill the fields below. Values merge into run inputs and the phase resumes.'
								: 'Approve, reject, or route. The verdict is stored in Hub and pushed to the daemon via sync.'}
					</p>
				</div>
				<Link
					to="/events?tab=hug"
					className="text-sm font-semibold text-indigo-700 underline hover:text-indigo-800"
				>
					Back to queue →
				</Link>
			</div>

			{loading ? (
				<p className="py-10 text-center text-sm text-slate-400">Loading…</p>
			) : error && !review ? (
				<div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-8 text-sm text-amber-900">
					{error}
				</div>
			) : !review ? (
				<div className="rounded-xl border border-slate-200 px-5 py-8 text-sm text-slate-500">
					Review not found.
				</div>
			) : (
				<div className="space-y-6">
					<div className="flex flex-wrap items-center gap-3">
						<span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700">
							{review.status}
						</span>
						{typeof iteration === 'number' && typeof max_iterations === 'number' ? (
							<span className="text-xs text-slate-500">
								Iteration {iteration}/{max_iterations}
							</span>
						) : null}
					</div>

					<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
						<MetaChip label="Realm">
							{review.realm_slug ? (
								<Link
									to={`/o/${encodeURIComponent(review.org_slug ?? 'unknown')}/realms/${encodeURIComponent(review.realm_slug)}`}
									className="text-indigo-700 hover:underline"
								>
									{realm_qualified_label(review.org_slug, review.realm_slug)}
								</Link>
							) : (
								review.realm_id || '—'
							)}
						</MetaChip>
						<MetaChip label="Team">{review.team || '—'}</MetaChip>
						<MetaChip label="Run">
							{review.run_id ? (
								<div>
									<p className="font-medium text-slate-800">{review.run_name || '—'}</p>
									<Link
										to={`/runs/${review.run_id}`}
										className="mt-0.5 block break-all font-mono text-xs font-normal text-indigo-700 hover:underline"
									>
										{review.run_id}
									</Link>
								</div>
							) : (
								'—'
							)}
						</MetaChip>
						<MetaChip label="Phase">{review.phase || '—'}</MetaChip>
					</div>

					{error ? (
						<div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
							{error}
						</div>
					) : null}

					<section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
						<h2 className="text-sm font-semibold text-slate-800">Brief</h2>
						{brief_text ? (
							<div className="mt-3 rounded-lg border border-slate-100 bg-slate-50 p-4 text-sm leading-relaxed text-slate-800 whitespace-pre-wrap">
								{brief_text}
							</div>
						) : (
							<p className="mt-3 text-sm text-slate-500">No review message or upstream summary was attached.</p>
						)}
						{check_results ? (
							<div className="mt-4">
								<h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Checks</h3>
								<CheckResults value={check_results} />
							</div>
						) : null}
						<button
							type="button"
							className="mt-4 text-xs font-semibold text-slate-500 hover:text-slate-800"
							onClick={() => set_show_raw((v) => !v)}
						>
							{show_raw ? 'Hide raw payload' : 'Show raw payload'}
						</button>
						{show_raw ? (
							<pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-slate-50 p-4 text-xs text-slate-600">
								{JSON.stringify(review.payload, null, 2)}
							</pre>
						) : null}
					</section>

					<section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
						<h2 className="text-sm font-semibold text-slate-800">
							Artifacts
							{review.artifacts.length > 0 ? (
								<span className="ml-2 text-xs font-normal text-slate-400">
									{review.artifacts.length}
								</span>
							) : null}
						</h2>
						{review.artifacts.length === 0 ? (
							<p className="mt-3 text-sm text-slate-500">No run artifacts for this review yet.</p>
						) : (
							<div className="mt-3 space-y-2">
								{review.artifacts.map((artifact) => (
									<ArtifactCard
										key={artifact.id}
										artifact={artifact}
										default_open={review.artifacts.length === 1}
									/>
								))}
							</div>
						)}
					</section>

					{review.route_targets && review.route_targets.length > 0 ? (
						<section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
							<h2 className="text-sm font-semibold text-slate-800">Route targets</h2>
							<div className="mt-3 flex flex-wrap gap-2">
								{review.route_targets.map((t) => (
									<span
										key={t}
										className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700"
									>
										{t}
									</span>
								))}
							</div>
						</section>
					) : null}

					{review.notification_groups && review.notification_groups.length > 0 ? (
						<NotificationGroupsPanel groups={review.notification_groups} />
					) : null}

					{/* Claim banner — shown for unclaimed chat reviews with multiple reviewers. */}
					{is_active && review_mode === 'chat' && auth_user ? (
						<ReviewClaimBanner
							reviewer_count={reviewer_count}
							claimed_by={review.claimed_by}
							current_user_id={auth_user.id}
							is_my_claim={is_my_claim}
						/>
					) : null}

					{/* Chat panel — shown for chat-mode reviews. */}
					{review_mode === 'chat' ? (
						<ReviewChatPanel
							review_id={review.id}
							status={review.status}
							is_my_claim={is_my_claim}
							is_other_claim={is_other_claim}
							system_prompt={typeof review.payload?.['system_prompt'] === 'string'
								? review.payload['system_prompt'] as string
								: undefined}
						/>
					) : null}

					{is_decided && review.verdict ? (
						<section className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
							<h2 className="text-sm font-semibold text-emerald-900">Verdict</h2>
							<div className="mt-3 space-y-1 text-sm text-emerald-950">
								<p>
									<span className="font-semibold">Action:</span>{' '}
									{String(review.verdict.action ?? '—')}
								</p>
								{review.verdict.reviewer_name || review.verdict.responded_by ? (
									<p>
										<span className="font-semibold">Reviewer:</span>{' '}
										{String(review.verdict.reviewer_name ?? review.verdict.responded_by ?? '—')}
									</p>
								) : null}
								{review.verdict.comment ? (
									<p className="whitespace-pre-wrap">
										<span className="font-semibold">Comment:</span>{' '}
										{String(review.verdict.comment)}
									</p>
								) : null}
								{review.verdict.decided_at ? (
									<p className="text-xs text-emerald-800/80">
										{String(review.verdict.decided_at)}
									</p>
								) : null}
							</div>
						</section>
					) : null}

					{is_active && is_input_pause && (pause_summary || pause_context.length > 0) ? (
						<section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
							<h2 className="text-sm font-semibold text-slate-800">Why we paused</h2>
							{pause_summary ? (
								<p className="mt-2 text-sm text-slate-700 whitespace-pre-wrap">{pause_summary}</p>
							) : null}
							{pause_context.length > 0 ? (
								<ul className="mt-3 space-y-2">
									{pause_context.map((turn, idx) => (
										<li key={`${turn.role}-${idx}`} className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
											<span className="font-semibold text-slate-500">{turn.role}: </span>
											<span className="whitespace-pre-wrap">{turn.content}</span>
										</li>
									))}
								</ul>
							) : null}
						</section>
					) : null}

					{is_active && inputs_schema.length > 0 ? (
						<section className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-5 shadow-sm">
							<div className="flex items-baseline justify-between">
								<h2 className="text-sm font-semibold text-indigo-900">
									This step needs values
								</h2>
								<span className="text-xs text-indigo-700">
									{inputs_schema.filter((s) => s.required).length} required
								</span>
							</div>
							<p className="mt-1 text-xs text-indigo-800/80">
								Fill the fields below. Values are applied as run inputs on the
								daemon before the phase continues — downstream phases can
								reference them via <code className="rounded bg-white px-1 py-0.5 font-mono text-[11px] text-indigo-900">{`{{inputs.name}}`}</code>.
							</p>
							<div className="mt-4 grid gap-4 sm:grid-cols-2">
								{inputs_schema.map((spec) => (
									<div
										key={spec.name}
										className={spec.type === 'textarea' ? 'sm:col-span-2' : ''}
									>
										<InputField
											spec={spec}
											value={input_values[spec.name] ?? (spec.type === 'boolean' ? false : '')}
											on_change={(v) => set_input_values((prev) => ({ ...prev, [spec.name]: v }))}
										/>
									</div>
								))}
							</div>
						</section>
					) : null}

					{is_active && !my_notification_id ? (
						<section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
							<p className="text-sm text-slate-500">Loading reviewer assignment…</p>
						</section>
				) : null}

				{is_active && my_notification_id ? (
						<section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
							<h2 className="text-sm font-semibold text-slate-800">
								{is_input_pause ? 'Supply inputs' : 'Submit verdict'}
							</h2>
							{auth_user ? (
								<p className="mt-1 text-xs text-slate-500">
									Responding as <span className="font-semibold text-slate-700">{auth_user.username}</span>
								</p>
							) : null}
							{!is_input_pause ? (
								<div className="mt-4 grid gap-4 sm:grid-cols-2">
									<label className="block text-sm text-slate-700 sm:col-span-2">
										Comment (optional)
										<textarea
											value={comment}
											onChange={(e) => set_comment(e.target.value)}
											rows={3}
											className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
											placeholder="Add a comment…"
										/>
									</label>
								</div>
							) : null}
							<div className="mt-4 flex flex-wrap items-center gap-3">
								<button
									type="button"
									disabled={submitting || missing_required}
									onClick={() => void submit_verdict('PASS')}
									title={missing_required ? 'Fill required inputs first' : undefined}
									className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
								>
									{is_input_pause || inputs_schema.length > 0 ? 'Continue with values' : 'Approve'}
								</button>
								{!is_input_pause ? (
									<>
										<button
											type="button"
											disabled={submitting}
											onClick={() => void submit_verdict('REJECT')}
											className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
										>
											Reject
										</button>
										{review.route_targets && review.route_targets.length > 0 ? (
											<div className="flex items-center gap-2">
												<select
													value={route_target}
													onChange={(e) => set_route_target(e.target.value)}
													className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
												>
													{review.route_targets.map((t) => (
														<option key={t} value={t}>{t}</option>
													))}
												</select>
												<button
													type="button"
													disabled={submitting || !route_target || missing_required}
													onClick={() => void submit_verdict(`ROUTE:${route_target}`)}
													title={missing_required ? 'Fill required inputs first' : undefined}
													className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
												>
													Route
												</button>
											</div>
										) : null}
									</>
								) : null}
							</div>
						</section>
					) : null}
				</div>
			)}
		</div>
	);
}
