/**
 * The app's error page: shown instead of React Router's developer screen when a page throws
 * while rendering or loading. Says what happened in plain words, offers Reload / Go home, and
 * lets the person copy the details (message, page, stack) to send to us.
 */
import { useState } from 'react';
import { isRouteErrorResponse, useLocation, useRouteError } from 'react-router';

function describe(err: unknown): { title: string; message: string; stack: string | null } {
	if (isRouteErrorResponse(err)) {
		return err.status === 404
			? { title: 'This page doesn’t exist', message: 'The link may be old, or the page moved.', stack: null }
			: { title: `Something went wrong (${err.status})`, message: String(err.statusText || err.data || ''), stack: null };
	}
	if (err instanceof Error) return { title: 'Something went wrong on this page', message: err.message, stack: err.stack ?? null };
	return { title: 'Something went wrong on this page', message: String(err ?? ''), stack: null };
}

export function Route_error() {
	const err = useRouteError();
	const location = useLocation();
	const [copied, set_copied] = useState(false);
	const { title, message, stack } = describe(err);
	const details = [`Page: ${location.pathname}${location.search}`, `Error: ${message}`, stack ? `\n${stack}` : ''].join('\n');
	const copy = async () => {
		try { await navigator.clipboard.writeText(details); set_copied(true); } catch { set_copied(false); }
	};
	return (
		<main role="alert" data-testid="route-error" className="flex min-h-screen items-center justify-center bg-[var(--g-bg,#0b0c0e)] px-4 text-[var(--g-ink,#e8e8ea)]">
			<div className="w-full max-w-[520px] rounded-[12px] border border-[var(--g-line,#2a2c31)] bg-[var(--g-panel,#131417)] p-6">
				<h1 className="text-[18px] font-semibold">{title}</h1>
				<p className="mt-1.5 text-[13.5px] text-[var(--g-ink-2,#b4b6bc)]">The rest of CliqHub is fine — reload to try again, or go back home.</p>
				{message ? <pre className="g-mono mt-4 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-[var(--g-bg,#0b0c0e)] px-3 py-2 text-[12px] text-[var(--g-bad,#ff6b6b)]">{message}</pre> : null}
				<div className="mt-5 flex flex-wrap gap-2">
					<button type="button" onClick={() => window.location.reload()} className="inline-flex h-8 items-center rounded-md bg-[var(--g-acc,#7c6cf6)] px-3 text-[12.5px] font-semibold text-[var(--g-on-acc,#fff)]">Reload</button>
					<a href="/home" className="inline-flex h-8 items-center rounded-md border border-[var(--g-line,#2a2c31)] px-3 text-[12.5px] font-semibold">Go home</a>
					<button type="button" onClick={() => void copy()} className="inline-flex h-8 items-center rounded-md border border-[var(--g-line,#2a2c31)] px-3 text-[12.5px] font-semibold">{copied ? 'Copied' : 'Copy details'}</button>
				</div>
			</div>
		</main>
	);
}
