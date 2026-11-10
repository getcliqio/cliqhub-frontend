/**
 * Hug_host — a hug's frontend in a sandboxed frame on the Hub page (PLAN-hug-widgets §6, §9.3, §11.2).
 *
 * Wraps `host_hug` from `@getcliqio/hug-frontend/host`: the frame (`sandbox="allow-scripts"`, from the content origin),
 * the bridge's checks, and what the frame asks the Hub to do — pick and upload a file into one of the Hug's upload
 * slots (`/v1/artifacts/upload`), read a file it may read (`/v1/artifacts/download`, with the viewer's permissions),
 * download one, open a link (one from the params at once; any other shown first in the Hub's dialog, §6.1). The page owns Submit: it reads the
 * answer's state from `on_state` and sends through the handle in `host_ref`.
 *
 * The frame is made once per Hug and URL; later changes (mode, ending) go through the handle, not a re-render.
 */
import { createContext, useContext, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { host_hug, type AnswerSnapshot, type HostInit, type HugHost, type ReadBudget } from '@getcliqio/hug-frontend/host';
import { G_BTN, G_PRIMARY } from '@/components/graphite/g_agents';
import { useAuthFetch } from '@/lib/auth_context';
import { file_problem, upload_file, type File_ref, type Hug, type Hug_file_slot, type Hug_response } from '@/lib/hug';

type Answer = NonNullable<HostInit['mine']>;

/**
 * The page's read budget (§6.3: reads ≤ 50 MB per Hug page), shared by every frame on it — the answer frame and each
 * response's view frame. Without a provider each frame has its own.
 */
export const Hug_read_budget = createContext<ReadBudget | undefined>(undefined);

/** A response as the bridge carries an answer. */
export function answer_of(r: Hug_response | null): Answer | null {
	if (!r) return null;
	return { values: r.values, ...(r.summary ? { summary: r.summary } : {}), responder: { name: r.responder.name, via: r.via }, responded_at: r.responded_at };
}

const TOKENS = ['bg', 'panel', 'ink', 'ink-2', 'ink-3', 'line', 'acc', 'ok', 'warn', 'bad'] as const;

/**
 * The Hub's colours for the frame: Graphite's tokens as the hug UI kit's (`--g-x` → `--cliq-x`). Graphite defines them
 * on `.theme-graphite`, not the document, so they're read where the frame sits (`at`, inside it).
 */
export function hub_theme(at: Element = document.documentElement): HostInit['theme'] {
	const root = document.documentElement;
	const css = getComputedStyle(at.closest('.theme-graphite') ?? at);
	const tokens: Record<string, string> = {};
	for (const t of TOKENS) {
		const v = css.getPropertyValue(`--g-${t}`).trim();
		if (v) tokens[`--cliq-${t}`] = v;
	}
	return { scheme: root.getAttribute('data-g-theme') === 'light' ? 'light' : 'dark', tokens };
}

/** Let the person pick a file for a slot (the frame can't), checked against the slot before uploading. */
function pick_file(hug_id: string, slot: Hug_file_slot): Promise<File_ref | 'upload_cancelled' | 'file_too_large' | 'file_type' | 'upload_failed'> {
	return new Promise((resolve) => {
		const input = document.createElement('input');
		input.type = 'file';
		if (slot.accept?.length) input.accept = slot.accept.join(',');
		input.addEventListener('change', () => {
			const file = input.files?.[0];
			if (!file) { resolve('upload_cancelled'); return; }
			const problem = file_problem(slot, file);
			if (problem) { resolve(problem.includes('larger than') ? 'file_too_large' : 'file_type'); return; }
			upload_file(hug_id, slot.name, file).done.then(resolve, () => resolve('upload_failed'));
		});
		input.addEventListener('cancel', () => resolve('upload_cancelled'));
		input.click();
	});
}

export interface Hug_host_props {
	hug: Hug;
	content_url: string;
	/** `answer` to edit (from `draft`, else `mine`), `view` to show `viewing`. */
	mode: 'answer' | 'view';
	mine: Hug_response | null;
	viewing: Hug_response | null;
	draft?: Record<string, unknown> | null;
	viewer: { name: string; via: string[] };
	/** Answers below the fold: load the frame when it scrolls into view. */
	loading?: 'eager' | 'lazy';
	/** The host, for Submit and switching modes. */
	host_ref?: MutableRefObject<HugHost | null>;
	on_state?: (s: AnswerSnapshot) => void;
	label?: string;
}

export function Hug_host({ hug, content_url, mode, mine, viewing, draft = null, viewer, loading = 'eager', host_ref, on_state, label }: Hug_host_props) {
	const container = useRef<HTMLDivElement | null>(null);
	const auth_fetch = useAuthFetch();
	const budget = useContext(Hug_read_budget);
	// The latest props for callbacks, without re-making the frame.
	const latest = useRef({ on_state, auth_fetch });
	latest.current = { on_state, auth_fetch };
	// A link the hug asked to open that isn't in its params: shown in the dialog until the person chooses.
	const [link, set_link] = useState<{ url: string; choose: (open: boolean) => void } | null>(null);

	useEffect(() => {
		if (!container.current) return undefined;
		const download_blob = async (ref: File_ref): Promise<Blob | 'read_denied' | 'read_failed'> => {
			try {
				const res = await latest.current.auth_fetch('/v1/artifacts/download', { method: 'POST', body: JSON.stringify({ artifact_id: ref.artifact_id }) });
				if (res.status === 403 || res.status === 404) return 'read_denied';
				return res.ok ? await res.blob() : 'read_failed';
			} catch {
				return 'read_failed';
			}
		};
		const host = host_hug({
			container: container.current,
			src: content_url,
			title: label ?? hug.title,
			loading,
			...(budget ? { read_budget: budget } : {}),
			init: {
				hug: {
					id: hug.id, name: hug.hug?.name ?? '', title: hug.title, ...(hug.summary ? { summary: hug.summary } : {}),
					status: hug.status, expires_at: hug.expires_at, requester: hug.phase,
					run: { id: hug.run_id, name: hug.run_name },
				},
				params: hug.params,
				files: hug.files,
				attachments: hug.attachments.map((a) => ({ ...a, sha256: a.sha256 ?? '' })),
				viewer,
				mine: answer_of(mine),
				viewing: answer_of(viewing),
				draft,
				progress: hug.progress ?? null,
				theme: hub_theme(container.current),
				locale: navigator.language || 'en-US',
				mode,
			} as HostInit,
			upload: (slot) => pick_file(hug.id, slot as Hug_file_slot) as never,
			read: (ref) => download_blob(ref as File_ref) as never,
			download: (ref) => {
				void download_blob(ref as File_ref).then((blob) => {
					if (typeof blob === 'string') return;
					const a = document.createElement('a');
					a.href = URL.createObjectURL(blob);
					a.download = (ref as File_ref).name;
					a.click();
					setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
				});
			},
			open_link: (url, listed) => {
				const go = () => { window.open(url, '_blank', 'noopener,noreferrer'); };
				if (listed) { go(); return undefined; }
				// The host waits for the choice (one link at a time).
				return new Promise<void>((resolve) => {
					set_link({ url, choose: (open) => { set_link(null); if (open) go(); resolve(); } });
				});
			},
			on_state: (s) => latest.current.on_state?.(s),
			on_issue: (issue) => console.warn('[hug]', issue.reason),
		});
		if (host_ref) host_ref.current = host;
		return () => {
			host.destroy();
			if (host_ref?.current === host) host_ref.current = null;
		};
		// The frame is made once per Hug, URL and the answer it starts from; later changes go through the handle.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [hug.id, content_url, viewing?.response_id]);

	return (
		<>
			<div ref={container} className="hug-frame w-full" data-testid="hug-frame" />
			{link ? <Link_dialog url={link.url} on_choose={link.choose} /> : null}
		</>
	);
}

/** "Open this link?" — a link the hug wasn't given, in full, before it opens (§6.1 `open_link`). Escape cancels. */
function Link_dialog({ url, on_choose }: { url: string; on_choose: (open: boolean) => void }) {
	return (
		<div className="fixed inset-0 z-50 grid place-items-center bg-[var(--g-backdrop)] p-4 backdrop-blur-[2px]"
			onKeyDown={(e) => { if (e.key === 'Escape') on_choose(false); }}>
			<div role="alertdialog" aria-modal="true" aria-labelledby="hug-link-title" aria-describedby="hug-link-url" data-testid="hug-link-dialog"
				className="w-full max-w-[520px] rounded-2xl border border-[var(--g-line)] bg-[var(--g-panel)] shadow-[var(--g-pop-shadow)]">
				<div className="border-b border-[var(--g-line)] px-5 py-3.5">
					<b id="hug-link-title" className="text-[16px]">Open this link?</b>
					<p className="mt-0.5 text-[12px] text-[var(--g-ink-3)]">This Hug wants to open a link it wasn’t given. Check where it goes first.</p>
				</div>
				<p id="hug-link-url" className="g-mono break-all px-5 py-4 text-[13px] text-[var(--g-ink)]">{url}</p>
				<div className="flex justify-end gap-2 border-t border-[var(--g-line)] px-5 py-3">
					{/* eslint-disable-next-line jsx-a11y/no-autofocus -- the safe choice gets focus in a confirmation */}
					<button type="button" autoFocus onClick={() => on_choose(false)} className={G_BTN}>Cancel</button>
					<button type="button" onClick={() => on_choose(true)} className={G_PRIMARY}>Open link</button>
				</div>
			</div>
		</div>
	);
}
