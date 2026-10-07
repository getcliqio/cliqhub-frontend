/**
 * Admin mode (CliqHub site admins only — `users.role = 'admin'`) — its own
 * sidebar, clearly marked, with one way back to where you were. All pages
 * render in Graphite.
 */
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import {
	ArrowLeft, Boxes, Gauge, Building2, FileClock, FolderTree, Layers, Play, ScrollText, Server, Tags, UsersRound, type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/lib/auth_context';
import { Cliq_mark } from '@/components/cliq_mark';
import { ImpersonationRibbon } from '@/components/impersonation_ribbon';
import { ADMIN_RETURN_KEY } from '@/components/graphite/graphite_shell';
import '@/styles/graphite.css';

export const ADMIN_GROUPS: Array<{ label: string; items: Array<{ to: string; label: string; icon: LucideIcon }> }> = [
	{ label: 'People', items: [
		{ to: '/admin/accounts', label: 'Accounts', icon: UsersRound },
		{ to: '/admin/orgs', label: 'Organizations', icon: Building2 },
	] },
	{ label: 'Fleet', items: [
		{ to: '/admin/realms', label: 'Realms', icon: Layers },
		{ to: '/admin/daemons', label: 'Daemons', icon: Server },
		{ to: '/admin/workspaces', label: 'Workspaces', icon: FolderTree },
	] },
	{ label: 'Catalog', items: [
		{ to: '/admin/teams', label: 'Teams', icon: Boxes },
		{ to: '/admin/scopes', label: 'Scopes', icon: Tags },
	] },
	{ label: 'Activity', items: [
		{ to: '/admin/runs', label: 'Runs', icon: Play },
		{ to: '/admin/logs', label: 'Logs', icon: ScrollText },
		{ to: '/admin/audit', label: 'Audit log', icon: FileClock },
	] },
];

const ADMIN_ACCENT = 'var(--g-orange)';


function read_return(): string {
	try {
		const v = sessionStorage.getItem(ADMIN_RETURN_KEY);
		// Only same-app paths, never back into admin.
		if (v && v.startsWith('/') && !v.startsWith('//') && !v.startsWith('/admin')) return v;
	} catch { /* storage unavailable */ }
	return '/home';
}

export function GraphiteAdminLayout() {
	const { user, loading } = useAuth();
	const navigate = useNavigate();
	const { pathname } = useLocation();
	const [back_to] = useState(read_return);

	useEffect(() => {
		if (!loading && (!user || user.role !== 'admin')) navigate('/home', { replace: true });
	}, [loading, user, navigate]);

	if (loading || !user || user.role !== 'admin') {
		return (
			<div className="theme-graphite g-app flex min-h-screen items-center justify-center" role="status">
				<p className="text-[13px] text-[var(--g-ink-3)]">Loading…</p>
			</div>
		);
	}

	const current = ADMIN_GROUPS.flatMap((g) => g.items).find((i) => pathname === i.to || pathname.startsWith(`${i.to}/`));

	return (
		<div className="theme-graphite g-app flex h-screen flex-col overflow-hidden" data-admin-mode>
			<ImpersonationRibbon />
			<div className="grid min-h-0 flex-1 grid-cols-[252px_minmax(0,1fr)]">
				<aside className="flex min-h-0 flex-col border-r border-[var(--g-warn-line)] bg-[var(--g-input)] px-3 py-4" aria-label="Admin">
					<div className="mb-4 flex items-center gap-2.5 px-2 text-[14.5px] font-semibold tracking-tight">
						<Cliq_mark class_name="h-6 w-6" title="CliqHub" />
						CliqHub
						<span className="ml-auto rounded border px-1.5 text-[10px] font-bold tracking-[0.08em]" style={{ color: ADMIN_ACCENT, borderColor: 'rgba(255,159,90,.45)' }}>ADMIN</span>
					</div>

					<Link
						to={back_to}
						className="mb-3 flex items-center gap-2.5 rounded-[10px] border border-[var(--g-warn-line)] bg-[var(--g-panel)] px-2.5 py-2 hover:border-[var(--g-warn-line)]"
						data-testid="admin-back"
					>
						<span className="grid h-7 w-7 place-items-center rounded-md border border-[var(--g-line)]"><ArrowLeft className="h-4 w-4" aria-hidden /></span>
						<span className="min-w-0">
							<span className="block text-[10px] uppercase tracking-[0.08em] text-[var(--g-ink-3)]">Leave admin</span>
							<b className="block text-[13px] font-semibold">Back to my work</b>
						</span>
					</Link>

					<nav className="min-h-0 flex-1 overflow-y-auto">
						<NavLink
							to="/admin"
							end
							className={({ isActive }) => `mb-1 flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] font-medium ${isActive ? 'bg-[var(--g-hover)] text-[var(--g-ink)]' : 'text-[var(--g-ink-2)] hover:bg-[var(--g-soft)] hover:text-[var(--g-ink)]'}`}
							style={({ isActive }) => (isActive ? { boxShadow: `inset 2px 0 0 ${ADMIN_ACCENT}` } : undefined)}
						>
							<Gauge aria-hidden className="h-4 w-4 opacity-70" strokeWidth={1.8} />
							Home
						</NavLink>
						{ADMIN_GROUPS.map((g) => (
							<div key={g.label} className="mb-2">
								<div className="px-2.5 pb-1 pt-3 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--g-ink-3)]">{g.label}</div>
								{g.items.map((it) => {
									const Icon = it.icon;
									return (
										<NavLink
											key={it.to}
											to={it.to}
											className={({ isActive }) => `flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] font-medium ${isActive ? 'bg-[var(--g-hover)] text-[var(--g-ink)]' : 'text-[var(--g-ink-2)] hover:bg-[var(--g-soft)] hover:text-[var(--g-ink)]'}`}
											style={({ isActive }) => (isActive ? { boxShadow: `inset 2px 0 0 ${ADMIN_ACCENT}` } : undefined)}
										>
											<Icon aria-hidden className="h-4 w-4 opacity-70" strokeWidth={1.8} />
											{it.label}
										</NavLink>
									);
								})}
							</div>
						))}
					</nav>

					<p className="border-t border-[var(--g-warn-line)] px-2.5 pt-2.5 text-[11.5px] text-[var(--g-ink-3)]">
						Signed in as <b className="text-[var(--g-ink)]">{user.username}</b> · site admin
					</p>
				</aside>

				<div className="flex min-h-0 flex-col">
					<header className="flex h-14 shrink-0 items-center gap-1.5 border-b border-[var(--g-warn-line)] px-7 text-[13px]">
						<nav aria-label="Breadcrumb" className="flex items-center gap-1.5">
							<Link to="/admin" className="font-medium text-[var(--g-ink-3)] hover:text-[var(--g-ink)]">Admin</Link>
							{current ? <><span aria-hidden className="text-[var(--g-ink-4)]">›</span><span className="font-semibold" aria-current="page">{current.label}</span></> : null}
						</nav>
					</header>
					<main className="min-h-0 flex-1 overflow-y-auto">
						<div className="mx-auto max-w-[1360px] px-7 py-6">
							<Outlet />
						</div>
					</main>
				</div>
			</div>
		</div>
	);
}
