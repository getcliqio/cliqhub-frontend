/**
 * `/browse/*` (Graphite) — the public team catalog.
 *
 * Signed in: inside the normal Graphite shell (Build › Marketplace in the
 * sidebar). Signed out: the landing page's slim top bar and footer, same
 * tokens, so the catalog reads as one product either way.
 */
import { Link, Outlet } from 'react-router';
import { useAuth } from '@/lib/auth_context';
import { use_overview } from '@/lib/overview';
import { Cliq_mark } from '@/components/cliq_mark';
import { Graphite_shell } from '@/components/graphite/graphite_shell';
import '@/styles/graphite.css';

function Signed_in_frame() {
	const overview = use_overview();
	return (
		<Graphite_shell data={overview.data} title="Marketplace">
			<Outlet />
		</Graphite_shell>
	);
}

function Public_frame() {
	return (
		<div className="theme-graphite flex min-h-screen flex-col">
			<header className="border-b border-[var(--g-line)]">
				<div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-4">
					<Link to="/" className="flex items-center gap-2.5 text-[15px] font-semibold tracking-tight"><Cliq_mark class_name="h-7 w-7" title="CliqHub" />CliqHub</Link>
					<nav aria-label="Site" className="ml-auto flex items-center gap-5 text-[13.5px] text-[var(--g-ink-2)]">
						<Link to="/browse" aria-current="page" className="font-medium text-[var(--g-ink)]">Marketplace</Link>
						<a href="https://docs.getcliq.io" target="_blank" rel="noopener noreferrer" className="hover:text-[var(--g-ink)]">Docs</a>
						<Link to="/login" className="whitespace-nowrap rounded-lg bg-[var(--g-acc)] px-3.5 py-1.5 font-semibold text-[var(--g-on-acc)] hover:bg-[var(--g-acc-hover)]">Sign in</Link>
					</nav>
				</div>
			</header>
			<main className="flex-1">
				<Outlet />
			</main>
			<footer className="border-t border-[var(--g-line)] py-6 text-center text-[12.5px] text-[var(--g-ink-3)]">
				CliqHub · <a href="https://getcliq.io" target="_blank" rel="noopener noreferrer" className="hover:text-[var(--g-ink)]">Get Cliq</a> · <a href="https://docs.getcliq.io" target="_blank" rel="noopener noreferrer" className="hover:text-[var(--g-ink)]">Docs</a>
			</footer>
		</div>
	);
}

export function Marketplace_layout() {
	const { user, loading } = useAuth();
	if (loading) {
		return (
			<div className="theme-graphite flex min-h-screen items-center justify-center" role="status">
				<p className="text-[13px] text-[var(--g-ink-3)]">Loading…</p>
			</div>
		);
	}
	return user ? <Signed_in_frame /> : <Public_frame />;
}
