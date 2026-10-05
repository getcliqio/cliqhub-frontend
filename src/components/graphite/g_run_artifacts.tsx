/**
 * Run detail › Artifacts — everything the run's phases produced, grouped by
 * phase: stored files (Download asks `artifacts/get_by_id` for a fresh link —
 * stored links expire) and run records (phase output, transcript, attached
 * docs — a preview, Read loads the whole text from `artifacts/get_by_id`).
 * Rows come with the run page read (`run_detail/get`). Always shown: "No
 * artifacts" when there are none, the load error when the read failed.
 */
import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { useAuthFetch } from '@/lib/auth_context';
import type { Run_artifact, Section_status } from '@/lib/realm_inbox';

/** Byte count as a short size. */
export function format_size(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** What a record kind is called on the page. */
const KIND_LABEL: Record<string, string> = {
	output: 'Phase output', phase_output: 'Phase output', chat_transcript: 'Transcript', transcript: 'Transcript',
	review: 'Document', design: 'Design', handoff: 'Handoff', file: 'File',
};
export function kind_label(kind: string | undefined): string {
	return KIND_LABEL[kind ?? 'file'] ?? (kind ?? 'File');
}

/** Rows grouped by phase, phases in the order they first produced something. */
export function group_by_phase(artifacts: Run_artifact[]): Array<{ phase: string; items: Run_artifact[] }> {
	const groups = new Map<string, Run_artifact[]>();
	for (const a of artifacts) {
		const key = a.phase || '—';
		groups.set(key, [...(groups.get(key) ?? []), a]);
	}
	return [...groups].map(([phase, items]) => ({ phase, items }));
}

export function G_run_artifacts({ artifacts, status }: { artifacts: Run_artifact[]; status: Section_status | undefined }) {
	const auth_fetch = useAuthFetch();
	const [busy, set_busy] = useState<string | null>(null);
	const [err, set_err] = useState<string | null>(null);
	const [open, set_open] = useState<Record<string, string | true>>({});
	const groups = useMemo(() => group_by_phase(artifacts), [artifacts]);

	async function get_by_id(id: string): Promise<Record<string, unknown> | null> {
		const res = await auth_fetch('/v1/artifacts/get_by_id', { method: 'POST', body: JSON.stringify({ artifact_id: id }) });
		const payload = await res.json().catch(() => null);
		return payload?.ok ? (payload.data as Record<string, unknown>) : null;
	}

	async function download(id: string) {
		set_busy(id); set_err(null);
		try {
			const url = (await get_by_id(id))?.download_url;
			if (typeof url === 'string' && url) window.open(url, '_blank', 'noopener');
			else set_err('Couldn’t get a download link. Try again.');
		} catch {
			set_err('Couldn’t get a download link. Try again.');
		} finally {
			set_busy(null);
		}
	}

	async function read(a: Run_artifact) {
		if (open[a.artifact_id]) { set_open(({ [a.artifact_id]: _, ...rest }) => rest); return; }
		// Short records are whole already; longer ones load their full text.
		if ((a.content_preview ?? '').length < 2000) { set_open((o) => ({ ...o, [a.artifact_id]: a.content_preview ?? '' })); return; }
		set_busy(a.artifact_id); set_err(null);
		try {
			const content = (await get_by_id(a.artifact_id))?.content;
			if (typeof content === 'string') set_open((o) => ({ ...o, [a.artifact_id]: content }));
			else set_err('Couldn’t load it. Try again.');
		} catch {
			set_err('Couldn’t load it. Try again.');
		} finally {
			set_busy(null);
		}
	}

	const failed = status?.status === 'error';
	return (
		<section aria-label="Artifacts" className="rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)]" data-testid="run-artifacts">
			<div className="flex items-center gap-2 border-b border-[var(--g-line-2)] px-4 py-2.5">
				<h2 className="text-[13px] font-semibold">Artifacts</h2>
				{artifacts.length ? <span className="text-[12px] text-[var(--g-ink-3)]">{artifacts.length}</span> : null}
			</div>
			{failed && !artifacts.length ? (
				<p role="status" className="px-4 py-4 text-[12.5px] text-[var(--g-warn-text)]">Couldn’t load artifacts{status?.error ? `: ${status.error}` : ''}.</p>
			) : !artifacts.length ? (
				<p className="px-4 py-4 text-[12.5px] text-[var(--g-ink-3)]">No artifacts for this run.</p>
			) : (
				<div className="divide-y divide-[var(--g-line-2)]">
					{groups.map((g) => (
						<div key={g.phase} role="group" aria-label={`Phase ${g.phase}`} data-testid={`artifact-phase-${g.phase}`}>
							<p className="g-mono px-4 pt-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--g-ink-3)]">{g.phase}</p>
							<ul>
								{g.items.map((a) => {
									const is_file = (a.source ?? 'file') === 'file';
									const text = open[a.artifact_id];
									return (
										<li key={a.artifact_id} className="px-4 py-2" data-testid="artifact-row">
											<div className="flex items-center gap-3">
												<div className="min-w-0 flex-1">
													<p className="g-mono truncate text-[12.5px] font-semibold" title={a.name}>{a.name}</p>
													<p className="truncate text-[11.5px] text-[var(--g-ink-3)]">
														{kind_label(a.kind)} · {format_size(a.size_bytes)}{a.description ? ` · ${a.description}` : ''}
													</p>
												</div>
												{is_file ? (
													<button type="button" disabled={busy === a.artifact_id} onClick={() => void download(a.artifact_id)} aria-label={`Download ${a.name}`} className="inline-flex items-center gap-1 rounded-md border border-[var(--g-line)] px-2.5 py-1 text-[12px] font-semibold text-[var(--g-ink-2)] hover:text-[var(--g-ink)] disabled:opacity-50">
														<Download className="h-3.5 w-3.5" />{busy === a.artifact_id ? '…' : 'Download'}
													</button>
												) : (
													<button type="button" disabled={busy === a.artifact_id} onClick={() => void read(a)} aria-expanded={Boolean(text)} aria-label={`${text ? 'Hide' : 'Read'} ${a.name}`} className="inline-flex items-center rounded-md border border-[var(--g-line)] px-2.5 py-1 text-[12px] font-semibold text-[var(--g-ink-2)] hover:text-[var(--g-ink)] disabled:opacity-50">
														{busy === a.artifact_id ? '…' : text ? 'Hide' : 'Read'}
													</button>
												)}
											</div>
											{typeof text === 'string' ? (
												<pre className="g-mono mt-2 max-h-[420px] overflow-auto whitespace-pre-wrap rounded-md border border-[var(--g-line-2)] bg-[var(--g-soft)] p-3 text-[11.5px] text-[var(--g-ink-2)]" data-testid="artifact-text">{text}</pre>
											) : null}
										</li>
									);
								})}
							</ul>
						</div>
					))}
				</div>
			)}
			{err ? <p role="alert" className="border-t border-[var(--g-line-2)] px-4 py-2 text-[12px] text-[var(--g-bad)]">{err}</p> : null}
		</section>
	);
}
