/**
 * Realm › the realm's own address (/o/:org/realms/:slug and the old …/inbox). There's no overview
 * page: a realm opens on its Teams (the realm layout carries its header, left nav and signals).
 * Navigation state rides along so the token shown once after New realm still shows.
 *
 * Also home to Blocking_error, the shared "couldn't load / no access / doesn't exist" state.
 */
import { Link, Navigate, useLocation, useParams } from 'react-router';
import { AlertTriangle, Lock, SearchX } from 'lucide-react';

/** BFF codes for “the BFF and Core are on different versions”. */
export const VERSION_SKEW_CODES = new Set(['upstream_route_missing', 'upstream_version_mismatch']);

export function Blocking_error({ http_status, error, on_retry, what, code = null }: { http_status: number | null; error: string; on_retry: () => void; what: string; code?: string | null }) {
	if (code && VERSION_SKEW_CODES.has(code)) {
		return (
			<div role="alert" data-testid="version-skew" className="mx-auto mt-10 max-w-[520px] rounded-xl border border-[var(--g-warn-line,var(--g-line))] bg-[var(--g-warn-soft)] p-6 text-center">
				<AlertTriangle aria-hidden className="mx-auto h-6 w-6 text-[var(--g-warn-text)]" />
				<p className="mt-2 text-[14px] font-semibold">The app and Core are out of sync</p>
				<p className="mt-1 text-[13px] text-[var(--g-ink-2)]">This {what} needs a newer Core than the one running. Restart or update Core, then try again.</p>
				<p className="g-mono mt-2 break-words text-[11.5px] text-[var(--g-ink-3)]">{error}</p>
				<button type="button" onClick={on_retry} className="mt-4 rounded-lg border border-[var(--g-line)] px-4 py-1.5 text-[13px] font-semibold">Try again</button>
			</div>
		);
	}
	if (http_status === 403) {
		return (
			<div role="alert" className="mx-auto mt-10 max-w-[460px] rounded-xl border border-[var(--g-line)] bg-[var(--g-panel)] p-6 text-center">
				<Lock aria-hidden className="mx-auto h-7 w-7 text-[var(--g-ink-3)]" />
				<p className="mt-3 text-[14px] font-semibold">You don’t have access to this {what}</p>
				<p className="mt-1 text-[13px] text-[var(--g-ink-3)]">Ask a realm admin to add you, or switch to a realm you’re a member of.</p>
				<Link to="/home" className="mt-4 inline-block rounded-lg border border-[var(--g-line)] px-4 py-1.5 text-[13px] font-semibold">Back to overview</Link>
			</div>
		);
	}
	if (http_status === 404) {
		return (
			<div role="alert" className="mx-auto mt-10 max-w-[460px] rounded-xl border border-[var(--g-line)] bg-[var(--g-panel)] p-6 text-center">
				<SearchX aria-hidden className="mx-auto h-7 w-7 text-[var(--g-ink-3)]" />
				<p className="mt-3 text-[14px] font-semibold">This {what} doesn’t exist</p>
				<p className="mt-1 text-[13px] text-[var(--g-ink-3)]">{error}</p>
				<Link to="/home" className="mt-4 inline-block rounded-lg border border-[var(--g-line)] px-4 py-1.5 text-[13px] font-semibold">Back to overview</Link>
			</div>
		);
	}
	return (
		<div role="alert" className="mx-auto mt-10 max-w-[460px] rounded-xl border border-[var(--g-bad-line)] bg-[var(--g-bad-soft)] p-6 text-center">
			<AlertTriangle aria-hidden className="mx-auto h-6 w-6 text-[var(--g-bad)]" />
			<p className="mt-2 text-[14px] font-semibold">Couldn’t load this {what}</p>
			<p className="mt-1 text-[13px] text-[var(--g-ink-3)]">{error}</p>
			<button type="button" onClick={on_retry} className="mt-4 rounded-lg border border-[var(--g-line)] px-4 py-1.5 text-[13px] font-semibold">Try again</button>
		</div>
	);
}

export function Component() {
	const { org = '', slug = '' } = useParams();
	const location = useLocation();
	return <Navigate to={`/o/${encodeURIComponent(org)}/realms/${encodeURIComponent(slug)}/teams`} replace state={location.state} />;
}
