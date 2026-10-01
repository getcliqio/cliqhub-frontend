/**
 * Run_artifacts_panel — displays stored artifacts produced during a run.
 *
 * Fetches the artifact list from `/v1/artifacts/get` and polls while
 * the run is live (artifacts may arrive mid-run). Renders nothing when
 * there are no artifacts — no empty-state chrome.
 */

import { useState, useCallback, useEffect } from 'react';
import { Download } from 'lucide-react';

import { useOrgFetch } from '@/lib/org_context';
import { use_poll } from '@/lib/use_poll';

// ─── Types ───────────────────────────────────────────────────────────

interface ArtifactRow {
    artifact_id: string;
    run_id: string;
    phase: string;
    name: string;
    description: string | null;
    mime_type: string;
    size_bytes: number;
    download_url: string;
    created_at: number;
}

interface Run_artifacts_panel_props {
    run_id: string;
    /** Poll for new artifacts while the run is live. */
    live: boolean;
}

// ─── Component ───────────────────────────────────────────────────────

export function Run_artifacts_panel({ run_id, live }: Run_artifacts_panel_props) {
    const auth_fetch = useOrgFetch();
    const [artifacts, set_artifacts] = useState<ArtifactRow[]>([]);
    const [loading, set_loading] = useState(true);
    const [downloading, set_downloading] = useState<Set<string>>(new Set());

    const load = useCallback(async (opts?: { silent?: boolean }) => {
        if (!opts?.silent) set_loading(true);
        try {
            const res = await auth_fetch('/v1/artifacts/get', {
                method: 'POST',
                body: JSON.stringify({ run_id }),
            });
            const data = await res.json() as { ok?: boolean; data?: ArtifactRow[] };
            if (data.ok && Array.isArray(data.data)) {
                set_artifacts(data.data);
            }
        } catch {
            /* best-effort — don't break the page */
        } finally {
            if (!opts?.silent) set_loading(false);
        }
    }, [auth_fetch, run_id]);

    useEffect(() => { void load(); }, [load]);
    use_poll(() => void load({ silent: true }), live ? 10_000 : 60_000, !loading);

    /** Fetch a fresh presigned URL and open in a new tab. */
    async function handle_download(artifact_id: string) {
        set_downloading((prev) => new Set(prev).add(artifact_id));
        try {
            const res = await auth_fetch('/v1/artifacts/get_by_id', {
                method: 'POST',
                body: JSON.stringify({ artifact_id }),
            });
            const data = await res.json() as { ok?: boolean; data?: { download_url?: string } };
            const url = data?.data?.download_url;
            if (url) {
                window.open(url, '_blank');
            }
        } catch {
            /* ignore — user can retry */
        } finally {
            set_downloading((prev) => {
                const next = new Set(prev);
                next.delete(artifact_id);
                return next;
            });
        }
    }

    // Empty state — show a placeholder so the tab pane isn't blank.
    if (loading && artifacts.length === 0) {
        return (
            <div className="flex h-40 items-center justify-center rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                <p className="text-xs text-slate-400">Loading artifacts…</p>
            </div>
        );
    }
    if (artifacts.length === 0) {
        return (
            <div className="flex h-40 items-center justify-center rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                <p className="text-xs text-slate-400">No artifacts for this run</p>
            </div>
        );
    }

    return (
        <div className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="px-4 pt-3 pb-1">
                <h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Artifacts
                </h3>
            </div>
            <table className="w-full text-xs">
                <thead>
                    <tr className="border-b border-slate-100 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:border-slate-800">
                        <th className="px-4 py-2">Name</th>
                        <th className="px-2 py-2">Phase</th>
                        <th className="px-2 py-2 text-right">Size</th>
                        <th className="px-2 py-2 w-20" />
                    </tr>
                </thead>
                <tbody>
                    {artifacts.map((a) => (
                        <tr
                            key={a.artifact_id}
                            className="border-b border-slate-100 last:border-b-0 dark:border-slate-800"
                        >
                            <td className="px-4 py-2">
                                <div className="font-mono font-semibold text-slate-700 dark:text-slate-200">
                                    {a.name}
                                </div>
                                {a.description ? (
                                    <div
                                        className="mt-0.5 max-w-xs truncate text-[10px] text-slate-400"
                                        title={a.description}
                                    >
                                        {a.description}
                                    </div>
                                ) : null}
                            </td>
                            <td className="px-2 py-2 font-mono text-slate-600 dark:text-slate-300">
                                {a.phase}
                            </td>
                            <td className="px-2 py-2 text-right font-mono text-slate-600 dark:text-slate-300">
                                {format_size(a.size_bytes)}
                            </td>
                            <td className="px-2 py-2 text-right">
                                <button
                                    type="button"
                                    onClick={() => void handle_download(a.artifact_id)}
                                    disabled={downloading.has(a.artifact_id)}
                                    title="Download artifact"
                                    className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                                >
                                    <Download className="h-3 w-3" />
                                    {downloading.has(a.artifact_id) ? '…' : 'Download'}
                                </button>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

// ─── Helpers ─────────────────────────────────────────────────────────

/** Format byte count as human-readable size. */
function format_size(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
