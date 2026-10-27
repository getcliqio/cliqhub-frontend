/**
 * What a person reads before answering: the prompt and the context blocks — markdown, files (shown
 * inline when they're small text, images or PDFs; always downloadable), check results and an earlier
 * conversation.
 */
import { useEffect, useMemo, useState } from 'react';
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

/** One stored file: its name and size, a preview when it can be shown, and a download link. */
export function Artifact_block({ artifact_id, label }: { artifact_id: string; label?: string }) {
	const auth_fetch = useAuthFetch();
	const [meta, set_meta] = useState<Artifact_meta | null>(null);
	const [text, set_text] = useState<string | null>(null);
	const [failed, set_failed] = useState(false);
	const href = artifact_download_href(artifact_id);

	useEffect(() => {
		let live = true;
		(async () => {
			try {
				const res = await auth_fetch('/v1/artifacts/get_by_id', { method: 'POST', body: JSON.stringify({ artifact_id }) });
				const d = await res.json().catch(() => null) as { ok?: boolean; data?: Partial<Artifact_meta> } | null;
				if (!live) return;
				if (!d?.ok || !d.data) { set_failed(true); return; }
				const m = { name: d.data.name ?? artifact_id, mime_type: d.data.mime_type ?? '', size_bytes: Number(d.data.size_bytes ?? 0) };
				set_meta(m);
				const bucket = artifact_bucket(m.mime_type, m.name);
				if (['markdown', 'json', 'csv', 'text'].includes(bucket) && m.size_bytes <= INLINE_TEXT_BYTES) {
					const body = await fetch(href, { credentials: 'same-origin' });
					if (live && body.ok) set_text(await body.text());
				}
			} catch {
				if (live) set_failed(true);
			}
		})();
		return () => { live = false; };
	}, [artifact_id, auth_fetch, href]);

	const name = label || meta?.name || artifact_id;
	const bucket = meta ? artifact_bucket(meta.mime_type, meta.name) : null;
	return (
		<section className={`overflow-hidden ${PANEL}`} aria-label={`File ${name}`} data-testid="hug-artifact">
			<div className="flex flex-wrap items-center gap-2 border-b border-[var(--g-line)] px-4 py-2">
				<b className="g-mono truncate text-[12.5px]">{name}</b>
				{meta?.size_bytes ? <span className="text-[11.5px] text-[var(--g-ink-3)]">{format_bytes(meta.size_bytes)}</span> : null}
				<a href={href} download={meta?.name} className={`${G_BTN} ml-auto`}>Download</a>
			</div>
			<div className="max-h-[560px] overflow-auto px-4 py-3">
				{failed ? <p className="text-[12.5px] text-[var(--g-ink-3)]">This file can’t be previewed — use Download.</p>
					: !meta ? <div className="h-16 animate-pulse rounded bg-[var(--g-soft)]" aria-busy="true" />
						: bucket === 'image' ? <img src={href} alt={name} className="max-h-[520px] max-w-full rounded border border-[var(--g-line)]" />
							: bucket === 'pdf' ? <iframe src={href} title={name} className="h-[560px] w-full rounded border border-[var(--g-line)] bg-white" />
								: text === null ? <p className="text-[12.5px] text-[var(--g-ink-2)]">Download it to open it.</p>
									: bucket === 'markdown' ? <Md>{text}</Md>
										: bucket === 'csv' ? <Csv_table text={text} />
											: <pre className="g-mono whitespace-pre-wrap break-all text-[12px] leading-[1.55] text-[var(--g-ink-2)]">{bucket === 'json' ? pretty_json(text) ?? text : text}</pre>}
			</div>
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

export function Hug_context({ prompt, blocks }: { prompt: string; blocks: readonly Context_block[] }) {
	return (
		<div className="flex flex-col gap-4">
			<section className={`${PANEL} px-4 py-3.5`} aria-label="Question">
				<Md>{prompt}</Md>
			</section>
			{blocks.map((b, i) => {
				switch (b.type) {
					case 'markdown': return <section key={i} className={`${PANEL} px-4 py-3.5`} aria-label="Context"><Md>{b.text}</Md></section>;
					case 'artifact': return <Artifact_block key={i} artifact_id={b.artifact_id} label={b.label} />;
					case 'checks': return <Checks_block key={i} results={b.results} />;
					case 'transcript': return <Transcript_block key={i} turns={b.turns} />;
					default: return null;
				}
			})}
		</div>
	);
}
