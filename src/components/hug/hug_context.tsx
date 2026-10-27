/**
 * What a person reads before answering: the context blocks — markdown, files (one compact list, a
 * row per file with Preview, open-in-a-new-tab and download icons; Preview opens the file in a dialog), check results
 * and an earlier conversation.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, ExternalLink } from 'lucide-react';
import { useAuthFetch } from '@/lib/auth_context';
import { Md } from '@/components/graphite/g_md';
import { G_BTN } from '@/components/graphite/g_agents';
import { artifact_bucket, artifact_download_href, format_bytes, parse_csv, pretty_json } from '@/lib/artifact_view';
import type { Context_block } from '@/lib/hug';

/** Text files up to this size are shown inline. */
const INLINE_TEXT_BYTES = 512 * 1024;

const PANEL = 'rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)]';

interface Artifact_meta { name: string; mime_type: string; size_bytes: number }

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
		</div>
	);
}

/**
 * A stored file's preview: images inline, PDFs from an in-memory copy (Core sends every file as an
 * attachment, which a frame would download rather than show), small text files rendered. The body
 * is fetched only once the preview opens.
 */
function File_preview({ href, name, meta }: { href: string; name: string; meta: Artifact_meta }) {
	const [text, set_text] = useState<string | null>(null);
	const [pdf_url, set_pdf_url] = useState<string | null>(null);
	const [failed, set_failed] = useState(false);
	const bucket = artifact_bucket(meta.mime_type, meta.name);
	const textual = ['markdown', 'json', 'csv', 'text'].includes(bucket) && meta.size_bytes <= INLINE_TEXT_BYTES;

	useEffect(() => {
		set_text(null); set_pdf_url(null); set_failed(false);
		if (!textual && bucket !== 'pdf') return;
		let live = true;
		let url: string | null = null;
		fetch(href, { credentials: 'same-origin' }).then(async (body) => {
			if (!body.ok) throw new Error(String(body.status));
			if (bucket === 'pdf') {
				url = URL.createObjectURL(new Blob([await body.arrayBuffer()], { type: 'application/pdf' }));
				if (live) set_pdf_url(url); else URL.revokeObjectURL(url);
			} else {
				const t = await body.text();
				if (live) set_text(t);
			}
		}).catch(() => { if (live) set_failed(true); });
		return () => { live = false; if (url) URL.revokeObjectURL(url); };
	}, [href, textual, bucket]);

	const loading = <div className="h-16 animate-pulse rounded bg-[var(--g-soft)]" aria-busy="true" />;
	if (failed) return <p className="text-[12.5px] text-[var(--g-ink-3)]">This file couldn’t be loaded — use Download.</p>;
	if (bucket === 'image') return <img src={href} alt={name} className="mx-auto max-h-[72vh] max-w-full rounded border border-[var(--g-line)]" />;
	if (bucket === 'pdf') return pdf_url ? <iframe src={pdf_url} title={name} className="h-[72vh] w-full rounded border border-[var(--g-line)] bg-white" /> : loading;
	if (!textual) return <p className="text-[12.5px] text-[var(--g-ink-2)]">This file can’t be previewed — use Download.</p>;
	if (text === null) return loading;
	if (bucket === 'markdown') return <Md>{text}</Md>;
	if (bucket === 'csv') return <Csv_table text={text} />;
	return <pre className="g-mono whitespace-pre-wrap break-all text-[12px] leading-[1.55] text-[var(--g-ink-2)]">{bucket === 'json' ? pretty_json(text) ?? text : text}</pre>;
}

interface File_item { artifact_id: string; label?: string; meta: Artifact_meta | null; failed: boolean }

const file_name = (f: File_item) => f.label || f.meta?.name || f.artifact_id;

function Download_link({ file }: { file: File_item }) {
	const name = file_name(file);
	return (
		<a href={artifact_download_href(file.artifact_id)} download={file.meta?.name} aria-label={`Download ${name}`} title="Download"
			className="inline-grid h-7 w-7 place-items-center rounded-md border border-[var(--g-line)] text-[var(--g-ink-2)] hover:text-[var(--g-ink)]">
			<Download className="h-3.5 w-3.5" />
		</a>
	);
}

const RASTER = /\.(png|jpe?g|gif|webp)$/i;

/**
 * The type a file opens with in a new tab, or null when it mustn't: the tab shows an in-memory copy
 * on CliqHub's origin, so only types that can't run script open (no HTML, no SVG); text opens as plain text.
 */
function new_tab_type(meta: Artifact_meta | null): string | null {
	if (!meta) return null;
	const bucket = artifact_bucket(meta.mime_type, meta.name);
	if (bucket === 'pdf') return 'application/pdf';
	if (bucket === 'image') return RASTER.test(meta.name) && !/svg/i.test(meta.mime_type) ? meta.mime_type || 'image/png' : null;
	if (['markdown', 'json', 'csv', 'text'].includes(bucket)) return 'text/plain;charset=utf-8';
	return null;
}

/** Opens the file in a new tab (opened on the click, so popup blockers allow it, then filled once fetched). */
function Open_tab_button({ file }: { file: File_item }) {
	const type = new_tab_type(file.meta);
	if (!type) return null;
	const name = file_name(file);
	const open = async () => {
		const tab = window.open('', '_blank');
		if (!tab) return;
		tab.opener = null;
		try {
			const body = await fetch(artifact_download_href(file.artifact_id), { credentials: 'same-origin' });
			if (!body.ok) throw new Error(String(body.status));
			const url = URL.createObjectURL(new Blob([await body.arrayBuffer()], { type }));
			tab.location.href = url;
			setTimeout(() => URL.revokeObjectURL(url), 60_000);
		} catch {
			tab.close();
		}
	};
	return (
		<button type="button" onClick={() => void open()} aria-label={`Open ${name} in a new tab`} title="Open in new tab"
			className="inline-grid h-7 w-7 place-items-center rounded-md border border-[var(--g-line)] text-[var(--g-ink-2)] hover:text-[var(--g-ink)]">
			<ExternalLink className="h-3.5 w-3.5" />
		</button>
	);
}

/** One file at a time, in a large dialog: ‹ › (or the arrow keys) step through the files, Esc closes. */
function Preview_dialog({ files, index, on_index, on_close }: { files: readonly File_item[]; index: number; on_index: (i: number) => void; on_close: () => void }) {
	const close_ref = useRef<HTMLButtonElement>(null);
	const file = files[index]!;
	const name = file_name(file);
	const many = files.length > 1;
	const step = useCallback((d: number) => on_index((index + d + files.length) % files.length), [index, files.length, on_index]);

	useEffect(() => { close_ref.current?.focus(); }, []);
	useEffect(() => {
		const on_key = (e: KeyboardEvent) => {
			if (e.key === 'Escape') on_close();
			else if (many && e.key === 'ArrowRight') step(1);
			else if (many && e.key === 'ArrowLeft') step(-1);
		};
		window.addEventListener('keydown', on_key);
		return () => window.removeEventListener('keydown', on_key);
	}, [on_close, step, many]);

	return (
		<div className="fixed inset-0 z-50 grid place-items-center bg-[var(--g-backdrop)] p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) on_close(); }}>
			<div role="dialog" aria-modal="true" aria-label={`Preview ${name}`} className="flex max-h-[92vh] w-full max-w-[1100px] flex-col overflow-hidden rounded-2xl border border-[var(--g-line)] bg-[var(--g-panel)] shadow-[var(--g-pop-shadow)]">
				<div className="flex items-center gap-2 border-b border-[var(--g-line)] px-4 py-3">
					<b className="g-mono min-w-0 truncate text-[13px]">{name}</b>
					{file.meta?.size_bytes ? <span className="text-[11.5px] text-[var(--g-ink-3)]">{format_bytes(file.meta.size_bytes)}</span> : null}
					<span className="ml-auto flex items-center gap-2">
						{many ? <>
							<button type="button" aria-label="Previous file" className={G_BTN} onClick={() => step(-1)}>‹</button>
							<span className="text-[11.5px] text-[var(--g-ink-3)]">{index + 1} of {files.length}</span>
							<button type="button" aria-label="Next file" className={G_BTN} onClick={() => step(1)}>›</button>
						</> : null}
						<Open_tab_button file={file} />
						<Download_link file={file} />
						<button ref={close_ref} type="button" aria-label="Close" onClick={on_close} className="px-1 text-[var(--g-ink-3)]">✕</button>
					</span>
				</div>
				<div className="min-h-0 flex-1 overflow-auto px-5 py-4">
					{file.meta ? <File_preview key={file.artifact_id} href={artifact_download_href(file.artifact_id)} name={name} meta={file.meta} />
						: <p className="text-[12.5px] text-[var(--g-ink-3)]">This file can’t be previewed — use Download.</p>}
				</div>
			</div>
		</div>
	);
}

/** The attached files, one compact row each (name, size, Preview, download). Nothing is previewed until asked. */
function Files_block({ files: specs }: { files: ReadonlyArray<{ artifact_id: string; label?: string }> }) {
	const auth_fetch = useAuthFetch();
	const [files, set_files] = useState<File_item[]>(() => specs.map((f) => ({ ...f, meta: null, failed: false })));
	const [open, set_open] = useState<number | null>(null);
	const ids = specs.map((f) => f.artifact_id).join(',');

	useEffect(() => {
		let live = true;
		set_files(specs.map((f) => ({ ...f, meta: null, failed: false })));
		specs.forEach(async (f, i) => {
			let meta: Artifact_meta | null = null;
			try {
				const res = await auth_fetch('/v1/artifacts/get_by_id', { method: 'POST', body: JSON.stringify({ artifact_id: f.artifact_id }) });
				const d = await res.json().catch(() => null) as { ok?: boolean; data?: Partial<Artifact_meta> } | null;
				if (d?.ok && d.data) meta = { name: d.data.name ?? f.artifact_id, mime_type: d.data.mime_type ?? '', size_bytes: Number(d.data.size_bytes ?? 0) };
			} catch { /* shown as can't be previewed */ }
			if (live) set_files((prev) => prev.map((p, j) => (j === i ? { ...p, meta, failed: !meta } : p)));
		});
		return () => { live = false; };
	}, [ids, auth_fetch]); // keyed by the ids: a new array of the same files doesn't reload them

	const close = useCallback(() => set_open(null), []);
	return (
		<section className={`overflow-hidden ${PANEL}`} aria-label="Files">
			<h2 className="border-b border-[var(--g-line)] px-4 py-3 text-[14px] font-semibold">Files <span className="text-[12px] font-normal text-[var(--g-ink-3)]">{files.length}</span></h2>
			<ul>{files.map((f, i) => (
				<li key={`${f.artifact_id}-${i}`} className="flex flex-wrap items-center gap-2 border-b border-[var(--g-line-2)] px-4 py-2 last:border-b-0" aria-label={`File ${file_name(f)}`} data-testid="hug-artifact">
					<b className="g-mono min-w-0 truncate text-[12.5px]">{file_name(f)}</b>
					{f.meta?.size_bytes ? <span className="text-[11.5px] text-[var(--g-ink-3)]">{format_bytes(f.meta.size_bytes)}</span> : null}
					{f.failed ? <span className="text-[11.5px] text-[var(--g-ink-3)]">can’t be previewed</span> : null}
					<span className="ml-auto flex items-center gap-2">
						{f.meta ? <button type="button" className={G_BTN} aria-haspopup="dialog" onClick={() => set_open(i)}>Preview</button> : null}
						<Open_tab_button file={f} />
						<Download_link file={f} />
					</span>
				</li>
			))}</ul>
			{open !== null ? <Preview_dialog files={files} index={open} on_index={set_open} on_close={close} /> : null}
		</section>
	);
}

function Checks_block({ results }: { results: Array<{ name: string; ok: boolean; summary?: string }> }) {
	const passed = results.filter((r) => r.ok).length;
	return (
		<section className={PANEL} aria-label="Checks">
			<h2 className="flex items-center gap-2 border-b border-[var(--g-line)] px-4 py-3 text-[14px] font-semibold">Checks <span className="text-[12px] font-normal text-[var(--g-ink-3)]">{passed} of {results.length} passed</span></h2>
			<ul>{results.map((r, i) => (
				<li key={i} className="flex items-start gap-3 border-b border-[var(--g-line-2)] px-4 py-2.5 last:border-b-0">
					<div className="min-w-0 flex-1"><div className="text-[13px]">{r.name}</div>{r.summary ? <div className="text-[12px] text-[var(--g-ink-3)]">{r.summary}</div> : null}</div>
					<span className={`rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${r.ok ? 'bg-[var(--g-ok-soft)] text-[var(--g-ok)]' : 'bg-[var(--g-bad-soft)] text-[var(--g-bad)]'}`}>{r.ok ? '✓ pass' : '✕ fail'}</span>
				</li>
			))}</ul>
		</section>
	);
}

function Transcript_block({ turns }: { turns: Array<{ role: string; content: string }> }) {
	return (
		<section className={`${PANEL} px-4 py-3`} aria-label="Conversation">
			<h2 className="mb-2 text-[14px] font-semibold">Conversation</h2>
			<ol className="flex flex-col gap-2.5">{turns.map((t, i) => <li key={i}><div className="text-[11px] uppercase tracking-[0.06em] text-[var(--g-ink-3)]">{t.role}</div><Md class_name="text-[13px]">{t.content}</Md></li>)}</ol>
		</section>
	);
}

/** What the requester attached for the person to read — files, notes, checks, a conversation. Nothing when there is none. */
export function Hug_context({ blocks }: { blocks: readonly Context_block[] }) {
	if (!blocks.length) return null;
	// Files are listed together, where the first one was.
	const files = blocks.flatMap((b) => (b.type === 'artifact' ? [{ artifact_id: b.artifact_id, label: b.label }] : []));
	const first_file = blocks.findIndex((b) => b.type === 'artifact');
	return (
		<section className="flex flex-col gap-3" aria-label="Context">
			<h2 className="text-[14px] font-semibold">Context</h2>
			{blocks.map((b, i) => {
				switch (b.type) {
					case 'markdown': return <section key={i} className={`${PANEL} px-4 py-3.5`} aria-label="Note"><Md>{b.text}</Md></section>;
					case 'artifact': return i === first_file ? <Files_block key={i} files={files} /> : null;
					case 'checks': return <Checks_block key={i} results={b.results} />;
					case 'transcript': return <Transcript_block key={i} turns={b.turns} />;
					default: return null;
				}
			})}
		</section>
	);
}
