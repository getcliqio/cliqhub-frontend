/**
 * getHugs inside CliqHub's page (PLAN-gethugs-partner-ux.md §4): the person's Hugs — or one Hug — in a frame that fills
 * the page, signed in by a statement for getHugs' embed (which only CliqHub's app may frame). The frame tells this page
 * its height (the frame takes it), where the person is (the address follows, so reload and back work) and when they
 * answer (the HUGs badge is asked again at once); getHugs takes CliqHub's theme, when it opens and as it changes. "Open in getHugs" is the way out when a browser won't keep the
 * embed signed in: getHugs' own page, signed in, with the way back to this one (§3).
 */
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { ExternalLink } from 'lucide-react';
import { useAuth, useAuthFetch } from '@/lib/auth_context';
import { gethugs_embed_url, gethugs_open_url, notify_hugs_changed } from '@/lib/hug';

/** The smallest the frame is before getHugs says its height. */
const MIN_HEIGHT = 640;

/** CliqHub's theme now (Graphite's `data-g-theme`), which getHugs' embed takes. */
function cliq_theme(): 'light' | 'dark' {
	return document.documentElement.dataset.gTheme === 'light' ? 'light' : 'dark';
}

/** The embed's address with CliqHub's theme (`?theme=`, before the statement's `#`). */
export function with_theme(url: string, theme: 'light' | 'dark'): string {
	const at = url.indexOf('#');
	const [base, hash] = at < 0 ? [url, ''] : [url.slice(0, at), url.slice(at)];
	return `${base}${base.includes('?') ? '&' : '?'}theme=${theme}${hash}`;
}

/** The address this page shows for where the person is in getHugs: `…/hugs` or `…/hugs/<id>` (scope kept). */
export function hugs_address(pathname: string, hug_id: string | null): string {
	const base = pathname.replace(/\/hugs(?:\/[^/]*)?\/?$/, '/hugs');
	return hug_id ? `${base}/${encodeURIComponent(hug_id)}` : base;
}

export function Gethugs_frame({ target, open_url }: { target: { hug_id: string } | { org_id: string }; open_url: string }) {
	const { gethugs_app_url } = useAuth();
	const auth_fetch = useAuthFetch();
	const [src, set_src] = useState<string | null>(null);
	const [failed, set_failed] = useState(false);
	const [height, set_height] = useState(MIN_HEIGHT);
	const frame = useRef<HTMLIFrameElement>(null);
	const key = 'hug_id' in target ? `hug:${target.hug_id}` : `org:${target.org_id}`;
	/** getHugs' own page, signed in, with the way back here (else `open_url`, where getHugs asks them to sign in). */
	const open_in_gethugs = (e: MouseEvent) => {
		e.preventDefault();
		void gethugs_open_url(auth_fetch, target, open_url).then((url) => window.location.assign(url));
	};

	useEffect(() => {
		let live = true;
		set_src(null);
		set_failed(false);
		void gethugs_embed_url(auth_fetch, target).then((url) => {
			if (!live) return;
			// getHugs takes CliqHub's theme, so it looks like part of this page.
			if (url) set_src(with_theme(url, cliq_theme()));
			else set_failed(true);
		});
		return () => { live = false; };
	// One sign-in per target: the statement works once.
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [key]);

	useEffect(() => {
		if (!gethugs_app_url) return undefined;
		const origin = new URL(gethugs_app_url).origin;
		const on_message = (e: MessageEvent) => {
			// Only getHugs' frame, never another window or origin.
			if (e.origin !== origin || e.source !== frame.current?.contentWindow) return;
			const m = e.data as { source?: string; type?: string; height?: unknown; hug_id?: unknown };
			if (m?.source !== 'gethugs') return;
			if (m.type === 'height' && typeof m.height === 'number' && m.height > 0) set_height(Math.max(MIN_HEIGHT, Math.min(m.height, 20_000)));
			else if (m.type === 'answered') notify_hugs_changed();
			else if (m.type === 'navigated') {
				const next = hugs_address(window.location.pathname, typeof m.hug_id === 'string' ? m.hug_id : null);
				if (next !== window.location.pathname) window.history.replaceState(window.history.state, '', next + window.location.search);
			}
		};
		window.addEventListener('message', on_message);
		// CliqHub's theme changes: getHugs follows (only to getHugs' origin).
		const theme = new MutationObserver(() => {
			frame.current?.contentWindow?.postMessage({ source: 'gethugs-host', type: 'theme', theme: cliq_theme() }, origin);
		});
		theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-g-theme'] });
		return () => {
			window.removeEventListener('message', on_message);
			theme.disconnect();
		};
	}, [gethugs_app_url]);

	return (
		<div className="flex flex-col gap-2 px-7 py-5" data-testid="gethugs-frame">
			<div className="flex items-center justify-end">
				<a href={open_url} onClick={open_in_gethugs} className="inline-flex items-center gap-1.5 text-[12.5px] text-[var(--g-ink-3)] hover:text-[var(--g-ink)] hover:underline" data-testid="open-in-gethugs">
					Open in getHugs <ExternalLink aria-hidden className="h-3.5 w-3.5" />
				</a>
			</div>
			{failed ? (
				<p className="rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)] px-5 py-4 text-[13px] text-[var(--g-ink-2)]" role="status" data-testid="gethugs-unavailable">
					Your Hugs can't be shown here right now. <a href={open_url} onClick={open_in_gethugs} className="underline">Open them in getHugs</a>.
				</p>
			) : src ? (
				<iframe
					ref={frame}
					src={src}
					title="Your Hugs in getHugs"
					style={{ height }}
					className="w-full rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)]"
					allow="clipboard-write"
					data-testid="gethugs-iframe"
				/>
			) : (
				<div className="h-[240px] animate-pulse rounded-[10px] bg-[var(--g-panel)]" aria-busy="true" aria-label="Loading" />
			)}
		</div>
	);
}
