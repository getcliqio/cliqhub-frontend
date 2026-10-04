/**
 * Run detail › Artifacts — the files a run stored. Always shown: "No
 * artifacts" when there are none, the load error when the read failed.
 * Rows come with the run page read (`run_detail/get`); Download asks
 * `artifacts/get_by_id` for a fresh link (stored links expire).
 */
import { useState } from 'react';
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

export function G_run_artifacts({ artifacts, status }: { artifacts: Run_artifact[]; status: Section_status | undefined }) {
	const auth_fetch = useAuthFetch();
	const [busy, set_busy] = useState<string | null>(null);
	const [err, set_err] = useState<string | null>(null);

	async function download(id: string) {
		set_busy(id); set_err(null);
		try {
			const res = await auth_fetch('/v1/artifacts/get_by_id', { method: 'POST', body: JSON.stringify({ artifact_id: id }) });
			const payload = await res.json().catch(() => null);
			const url = payload?.ok ? payload.data?.download_url : null;
			if (url) window.open(url, '_blank', 'noopener');
			else set_err('Couldn’t get a download link. Try again.');
		} catch {
			set_err('Couldn’t get a download link. Try again.');
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
				<ul className="divide-y divide-[var(--g-line-2)]">
					{artifacts.map((a) => (
						<li key={a.artifact_id} className="flex items-center gap-3 px-4 py-2.5" data-testid="artifact-row">
							<div className="min-w-0 flex-1">
								<p className="g-mono truncate text-[12.5px] font-semibold" title={a.name}>{a.name}</p>
								<p className="truncate text-[11.5px] text-[var(--g-ink-3)]">
									<span className="g-mono">{a.phase}</span> · {format_size(a.size_bytes)}{a.description ? ` · ${a.description}` : ''}
								</p>
							</div>
							<button type="button" disabled={busy === a.artifact_id} onClick={() => void download(a.artifact_id)} aria-label={`Download ${a.name}`} className="inline-flex items-center gap-1 rounded-md border border-[var(--g-line)] px-2.5 py-1 text-[12px] font-semibold text-[var(--g-ink-2)] hover:text-[var(--g-ink)] disabled:opacity-50">
								<Download className="h-3.5 w-3.5" />{busy === a.artifact_id ? '…' : 'Download'}
							</button>
						</li>
					))}
				</ul>
			)}
			{err ? <p role="alert" className="border-t border-[var(--g-line-2)] px-4 py-2 text-[12px] text-[var(--g-bad)]">{err}</p> : null}
		</section>
	);
}
