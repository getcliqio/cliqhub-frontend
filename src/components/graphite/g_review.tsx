/**
 * Review packet building blocks (Graphite): markdown, artifact viewer,
 * packet form fields, checks, and the reviewer ↔ agent chat.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Maximize2, Minimize2 } from 'lucide-react';
import { useAuthFetch } from '@/lib/auth_context';
import { ChannelUserPicker } from '@/components/channel_user_picker';
import {
	artifact_bucket, data_url, download_artifact, format_bytes, parse_csv, pretty_json,
	type Check_row, type Field_spec, type Field_value, type Review_artifact,
} from '@/lib/review_packet';
import { G_BTN, G_INPUT } from '@/components/graphite/g_agents';

/** Markdown with GitHub tables/task lists. Raw HTML is not rendered (react-markdown default). */
export function Md({ children, class_name = '' }: { children: string; class_name?: string }) {
	return (
		<div className={`g-md ${class_name}`}>
			<ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children: c }) => <a href={href} target="_blank" rel="noreferrer noopener">{c}</a> }}>{children}</ReactMarkdown>
		</div>
	);
}

const KIND_TONE: Record<string, string> = { design: '#b69cff', review: '#ff7ad9', handoff: '#2dd4bf', output: '#3ecf8e' };

function Csv_table({ text }: { text: string }) {
	const rows = useMemo(() => parse_csv(text), [text]);
	if (!rows.length) return <p className="text-[12.5px] text-[var(--g-ink-3)]">(empty)</p>;
	const [head, ...body] = rows;
	return (
		<div className="overflow-auto">
			<table className="w-full text-[12.5px]">
				<thead><tr>{head.map((h, i) => <th key={i} className="border-b border-[var(--g-line)] px-3 py-1.5 text-left font-semibold text-[var(--g-ink-3)]">{h}</th>)}</tr></thead>
				<tbody>{body.map((r, i) => <tr key={i} className="border-b border-[var(--g-line-2)]">{r.map((c, j) => <td key={j} className="whitespace-nowrap px-3 py-1.5 text-[var(--g-ink-2)]">{c}</td>)}</tr>)}</tbody>
			</table>
			{rows.length >= 500 ? <p className="px-3 py-2 text-[11.5px] text-[var(--g-ink-3)]">First 500 rows — download for the rest.</p> : null}
		</div>
	);
}

function Numbered({ text }: { text: string }) {
	const lines = text.split('\n');
	return (
		<pre className="g-mono overflow-auto text-[12px] leading-[1.55]">
			{lines.map((l, i) => <div key={i} className="flex"><span className="w-10 shrink-0 select-none pr-3 text-right text-[var(--g-ink-3)] opacity-60">{i + 1}</span><span className="whitespace-pre-wrap break-all text-[var(--g-ink-2)]">{l || ' '}</span></div>)}
		</pre>
	);
}

/** One artifact body. `source` shows the raw text for renderable kinds. */
export function Artifact_body({ a, source }: { a: Review_artifact; source: boolean }) {
	const bucket = artifact_bucket(a.mime_type, a.name);
	const text = a.content ?? a.content_preview ?? '';
	const json = useMemo(() => (bucket === 'json' ? pretty_json(text) : null), [bucket, text]);
	if (!text) return <p className="text-[12.5px] italic text-[var(--g-ink-3)]">(empty)</p>;
	if (bucket === 'image') {
		const src = data_url(a, 'image/png');
		return src ? <div className="grid place-items-center"><img src={src} alt={a.name} className="max-h-[520px] max-w-full rounded border border-[var(--g-line)]" /></div> : <Numbered text={text} />;
	}
	if (bucket === 'pdf') {
		const src = data_url(a, 'application/pdf');
		return src ? <iframe src={src} title={a.name} className="h-[560px] w-full rounded border border-[var(--g-line)] bg-white" /> : <p className="text-[12.5px] text-[var(--g-ink-3)]">This PDF can’t be previewed inline — use Download.</p>;
	}
	if (source) return <Numbered text={json ?? text} />;
	if (bucket === 'markdown') return <Md>{text}</Md>;
	if (bucket === 'json') return <pre className="g-mono overflow-auto whitespace-pre text-[12px] leading-[1.55] text-[var(--g-ink-2)]">{json ?? text}</pre>;
	if (bucket === 'csv') return <Csv_table text={text} />;
	// html and plain text are shown as text — never executed.
	return <Numbered text={text} />;
}

/** File list + viewer. Rendered/Source toggle for markdown/JSON/CSV; copy, download, full screen. */
export function Artifact_viewer({ artifacts }: { artifacts: Review_artifact[] }) {
	const sorted = useMemo(() => [...artifacts].sort((x, y) => (x.sequence ?? 0) - (y.sequence ?? 0)), [artifacts]);
	const [sel, set_sel] = useState(0);
	const [source, set_source] = useState(false);
	const [full, set_full] = useState(false);
	const [copied, set_copied] = useState(false);
	const a = sorted[Math.min(sel, sorted.length - 1)];
	if (!a) return null;
	const bucket = artifact_bucket(a.mime_type, a.name);
	const can_toggle = bucket === 'markdown' || bucket === 'json' || bucket === 'csv';
	const text = a.content ?? a.content_preview ?? '';
	async function copy() {
		try { await navigator.clipboard.writeText(bucket === 'json' ? pretty_json(text) ?? text : text); set_copied(true); setTimeout(() => set_copied(false), 1500); } catch { /* clipboard unavailable */ }
	}
	return (
		<div className={full ? 'fixed inset-4 z-50 flex flex-col overflow-hidden rounded-[12px] border border-[var(--g-line)] bg-[var(--g-panel)] shadow-2xl' : 'grid md:grid-cols-[220px_minmax(0,1fr)]'} data-testid="artifact-viewer">
			{!full ? (
				<ul className="border-b border-[var(--g-line)] p-2 md:border-b-0 md:border-r" aria-label="Artifacts">
					{sorted.map((x, i) => (
						<li key={String(x.id)}>
							<button type="button" onClick={() => { set_sel(i); set_source(false); }} aria-current={i === sel} className={`w-full rounded-[7px] px-2.5 py-2 text-left ${i === sel ? 'bg-[var(--g-soft)] shadow-[inset_2px_0_0_var(--g-acc)]' : 'hover:bg-[var(--g-soft)]'}`}>
								<div className="g-mono truncate text-[12.5px] text-[var(--g-ink)]">{x.name}</div>
								<div className="flex items-center gap-1.5 text-[11px] text-[var(--g-ink-3)]">
									{x.kind ? <span style={{ color: KIND_TONE[x.kind] }}>{x.kind}</span> : null}
									<span>{artifact_bucket(x.mime_type, x.name)}</span>
									{x.content ? <span>· {format_bytes(x.content.length)}</span> : null}
								</div>
							</button>
						</li>
					))}
				</ul>
			) : null}
			<div className="flex min-w-0 flex-1 flex-col">
				<div className="flex flex-wrap items-center gap-2 border-b border-[var(--g-line)] px-4 py-2">
					<b className="g-mono mr-2 truncate text-[12.5px]">{a.name}</b>
					{a.phase ? <span className="text-[11.5px] text-[var(--g-ink-3)]">from {a.phase}</span> : null}
					<span className="ml-auto flex items-center gap-1.5">
						{can_toggle ? (
							<span role="group" aria-label="View" className="mr-1 flex overflow-hidden rounded-md border border-[var(--g-line)] text-[12px]">
								<button type="button" aria-pressed={!source} onClick={() => set_source(false)} className={`px-2.5 py-1 ${!source ? 'bg-[var(--g-soft)] text-[var(--g-ink)]' : 'text-[var(--g-ink-3)]'}`}>Rendered</button>
								<button type="button" aria-pressed={source} onClick={() => set_source(true)} className={`px-2.5 py-1 ${source ? 'bg-[var(--g-soft)] text-[var(--g-ink)]' : 'text-[var(--g-ink-3)]'}`}>Source</button>
							</span>
						) : null}
						{bucket !== 'image' && bucket !== 'pdf' ? <button type="button" onClick={() => void copy()} className={G_BTN}>{copied ? 'Copied' : 'Copy'}</button> : null}
						<button type="button" onClick={() => download_artifact(a)} className={G_BTN}>Download</button>
						<button type="button" onClick={() => set_full((v) => !v)} aria-label={full ? 'Exit full screen' : 'Full screen'} className={G_BTN}>{full ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}</button>
					</span>
				</div>
				<div className={`overflow-auto px-4 py-3 ${full ? 'flex-1' : 'max-h-[560px]'}`}><Artifact_body a={a} source={source} /></div>
			</div>
		</div>
	);
}

export function Checks({ rows }: { rows: Check_row[] }) {
	if (!rows.length) return null;
	const passed = rows.filter((r) => r.ok).length;
	return (
		<section className="rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)]" aria-label="Checks">
			<h2 className="flex items-center gap-2 border-b border-[var(--g-line)] px-4 py-3 text-[14px] font-semibold">Checks <span className="text-[12px] font-normal text-[var(--g-ink-3)]">{passed} of {rows.length} passed</span></h2>
			<ul>{rows.map((r, i) => (
				<li key={i} className="flex items-start gap-3 border-b border-[var(--g-line-2)] px-4 py-2.5 last:border-b-0">
					<div className="min-w-0 flex-1"><div className="text-[13px]">{r.name}</div>{r.detail ? <div className="text-[12px] text-[var(--g-ink-3)]">{r.detail}</div> : null}</div>
					<span className={`rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${r.ok ? 'bg-[var(--g-ok-soft)] text-[var(--g-ok)]' : 'bg-[var(--g-bad-soft)] text-[var(--g-bad)]'}`}>{r.ok ? '✓ pass' : '✕ fail'}</span>
				</li>
			))}</ul>
		</section>
	);
}

/** One packet form field. */
export function Field_input({ f, value, on_change, invalid }: { f: Field_spec; value: Field_value; on_change: (v: Field_value) => void; invalid?: boolean }) {
	const label = <span className="text-[12.5px] text-[var(--g-ink-2)]">{f.label || f.name}{f.required ? <span className="ml-1 text-[var(--g-bad)]">*</span> : null}</span>;
	const help = f.help ? <span className="text-[11.5px] text-[var(--g-ink-3)]">{f.help}</span> : null;
	const cls = `${G_INPUT} w-full ${invalid ? 'border-[var(--g-bad-line)]' : ''}`;
	const id = `field-${f.name}`;
	if (f.type === 'boolean') {
		const on = value === true || value === 'true';
		return (
			<div className="flex items-start gap-3">
				<button type="button" role="switch" aria-checked={on} aria-labelledby={`${id}-l`} onClick={() => on_change(!on)} className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors ${on ? 'bg-[var(--g-acc)]' : 'bg-[var(--g-line)]'}`}>
					<span className={`absolute top-0.5 h-4 w-4 rounded-full bg-[#0c0d0f] transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
				</button>
				<div className="flex flex-col gap-0.5"><span id={`${id}-l`}>{label}</span>{help}</div>
			</div>
		);
	}
	if (f.type === 'select' && f.choices?.length) {
		const v = typeof value === 'string' ? value : '';
		return (
			<div className="flex flex-col gap-1.5">
				<span id={`${id}-l`}>{label}</span>
				{f.choices.length <= 5 ? (
					<div role="radiogroup" aria-labelledby={`${id}-l`} className="flex flex-wrap gap-1.5">
						{f.choices.map((c) => <button key={c} type="button" role="radio" aria-checked={v === c} onClick={() => on_change(c)} className={`rounded-full border px-3 py-1 text-[12.5px] ${v === c ? 'border-[var(--g-acc-line)] bg-[var(--g-acc-soft)] text-[var(--g-ink)]' : 'border-[var(--g-line)] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]'}`}>{c}</button>)}
					</div>
				) : (
					<select aria-labelledby={`${id}-l`} value={v} onChange={(e) => on_change(e.target.value)} className={cls}>
						<option value="">— choose —</option>
						{f.choices.map((c) => <option key={c} value={c}>{c}</option>)}
					</select>
				)}
				{help}
			</div>
		);
	}
	if (f.type === 'channel') {
		const selected = typeof value === 'string' ? value.split(',').map((s) => s.trim()).filter(Boolean) : [];
		return (
			<div className="flex flex-col gap-1.5">
				{label}
				<div className="rounded-lg bg-white/95 p-1 text-slate-900"><ChannelUserPicker selected={selected} on_change={(next) => on_change(next.join(','))} placeholder={f.placeholder || 'Search users or channels…'} /></div>
				{help}
			</div>
		);
	}
	return (
		<label className="flex flex-col gap-1.5" htmlFor={id}>
			{label}
			{f.type === 'textarea'
				? <textarea id={id} rows={4} value={typeof value === 'string' ? value : ''} onChange={(e) => on_change(e.target.value)} placeholder={f.placeholder} className={cls} />
				: <input id={id} type={f.type === 'number' ? 'number' : 'text'} value={typeof value === 'string' ? value : ''} onChange={(e) => on_change(e.target.value)} placeholder={f.placeholder} className={`${cls} ${f.type === 'number' ? 'max-w-[180px]' : ''}`} />}
			{help}
		</label>
	);
}

interface Chat_message { id: string; role: 'user' | 'assistant' | string; text: string; created_at: string }

/** Reviewer ↔ agent chat (chat-mode reviews). Polls every 3s while open; first message claims the review. */
export function Review_chat({ review_id, open, locked_by_other, on_first_message }: { review_id: string; open: boolean; locked_by_other: boolean; on_first_message?: () => void }) {
	const auth_fetch = useAuthFetch();
	const [msgs, set_msgs] = useState<Chat_message[]>([]);
	const [draft, set_draft] = useState('');
	const [busy, set_busy] = useState(false);
	const [err, set_err] = useState<string | null>(null);
	const end = useRef<HTMLDivElement>(null);
	const load = useCallback(async () => {
		try {
			const res = await auth_fetch('/v1/reviews/get_messages', { method: 'POST', body: JSON.stringify({ review_id }) });
			const d = await res.json();
			if (d?.ok) set_msgs((d.data?.messages ?? d.data ?? []) as Chat_message[]);
		} catch { /* retry on next poll */ }
	}, [auth_fetch, review_id]);
	useEffect(() => { void load(); }, [load]);
	useEffect(() => {
		if (!open) return undefined;
		const t = setInterval(() => void load(), 3000);
		return () => clearInterval(t);
	}, [open, load]);
	useEffect(() => { end.current?.scrollIntoView?.({ block: 'nearest' }); }, [msgs.length]);
	async function send() {
		const text = draft.trim();
		if (!text) return;
		set_busy(true); set_err(null);
		try {
			const res = await auth_fetch('/v1/reviews/send_message', { method: 'POST', body: JSON.stringify({ review_id, text }) });
			const d = await res.json().catch(() => null);
			if (!res.ok || !d?.ok) { set_err(typeof d?.error === 'string' ? d.error : d?.error?.message ?? 'Could not send.'); return; }
			set_draft('');
			if (!msgs.some((m) => m.role === 'user')) on_first_message?.();
			await load();
		} catch { set_err('Network error — try again.'); } finally { set_busy(false); }
	}
	return (
		<section className="flex flex-col rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)]" aria-label="Conversation">
			<h2 className="border-b border-[var(--g-line)] px-4 py-3 text-[14px] font-semibold">Conversation <span className="text-[12px] font-normal text-[var(--g-ink-3)]">{msgs.length} message{msgs.length === 1 ? '' : 's'}</span></h2>
			<div className="flex max-h-[420px] flex-col gap-3 overflow-auto px-4 py-3">
				{msgs.length === 0 ? <p className="text-[12.5px] text-[var(--g-ink-3)]">No messages yet.</p> : null}
				{msgs.map((m) => (
					<div key={m.id} className={`rounded-lg px-3 py-2 ${m.role === 'user' ? 'ml-6 bg-[var(--g-acc-soft)]' : 'mr-6 bg-[var(--g-soft)]'}`}>
						<div className="mb-0.5 text-[11px] text-[var(--g-ink-3)]">{m.role === 'user' ? 'reviewer' : 'agent'} · {new Date(m.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</div>
						<Md class_name="text-[13px]">{m.text}</Md>
					</div>
				))}
				<div ref={end} />
			</div>
			{open ? (
				<form className="flex gap-2 border-t border-[var(--g-line)] p-3" onSubmit={(e) => { e.preventDefault(); void send(); }}>
					<input aria-label="Message" value={draft} onChange={(e) => set_draft(e.target.value)} disabled={locked_by_other} placeholder={locked_by_other ? 'Another reviewer is handling this chat' : 'Reply… (your first message claims this review)'} className={`${G_INPUT} flex-1`} />
					<button type="submit" disabled={busy || !draft.trim() || locked_by_other} className={G_BTN}>Send</button>
				</form>
			) : <p className="border-t border-[var(--g-line)] px-4 py-2.5 text-[12px] text-[var(--g-ink-3)]">Read-only — this review is closed.</p>}
			{err ? <p role="alert" className="px-4 pb-3 text-[12.5px] text-[var(--g-bad)]">{err}</p> : null}
		</section>
	);
}
