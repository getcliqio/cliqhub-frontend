import type { LucideIcon } from 'lucide-react';
import {
	Building2,
	Compass,
	FileText,
	GitPullRequest,
	Home,
	Map,
	Package,
	Rocket,
	Settings,
	Shield,
	Users,
	UsersRound,
} from 'lucide-react';
import { Link, useLocation } from 'react-router';
import { useAuth } from '@/lib/auth_context';
import { use_sidebar_badges, format_badge } from '@/lib/use_sidebar_badges';

import { DOCS } from '@/lib/docs_links';

interface NavItem {
	href: string;
	label: string;
	icon: LucideIcon;
	/** Optional badge slot — resolved at render time from badge counts. */
	badge_key?: 'pending_reviews';
}

/**
 * Primary nav items. "Organizations" was retired from user-facing
 * nav (2026-09-08) — the concept lives on internally as a token /
 * permission scope, but users now think in terms of realms, so the
 * top-level nav item was noise. Direct navigation to /organizations
 * redirects to /realms (see router.tsx).
 */
function get_primary_items(): NavItem[] {
	return [
		{ href: '/home', label: 'Home', icon: Home },
		{ href: '/realms', label: 'Realms', icon: Map },
		{ href: '/teams', label: 'Teams', icon: UsersRound },
		{ href: '/events', label: 'HUGs and Events', icon: GitPullRequest, badge_key: 'pending_reviews' },
		{ href: '/settings', label: 'Settings', icon: Settings },
	];
}

const ADMIN_ITEMS: NavItem[] = [
	{ href: '/admin/accounts', label: 'Users', icon: Users },
	{ href: '/admin/orgs', label: 'Organizations', icon: Building2 },
	{ href: '/admin/teams', label: 'Teams', icon: Package },
	{ href: '/admin/audit', label: 'Audit Log', icon: Shield },
];

function is_active(pathname: string, href: string): boolean {
	if (pathname === href) return true;
	if (href === '/home') return false;
	if (href === '/settings') {
		return pathname.startsWith('/settings') || pathname.startsWith('/account');
	}
	if (href === '/events') {
		return pathname.startsWith('/events') || pathname.startsWith('/hug') || pathname.startsWith('/reviews');
	}
	if (href === '/teams') {
		return (
			pathname.startsWith('/teams')
			|| pathname.startsWith('/drafts')
			|| pathname.startsWith('/builder')
		);
	}
	if (href === '/realms') {
		return (
			pathname.startsWith('/realms')
			|| pathname.startsWith('/daemons')
			|| pathname.startsWith('/runs')
			|| pathname.startsWith('/logs')
		);
	}
	if (href.startsWith('/admin/')) return pathname.startsWith(href);
	return pathname.startsWith(`${href}/`);
}

function NavLink({
	item,
	pathname,
	badge_count = 0,
}: {
	item: NavItem;
	pathname: string;
	badge_count?: number;
}) {
	const active = is_active(pathname, item.href);
	const Icon = item.icon;
	const badge_text = format_badge(badge_count);

	return (
		<Link
			to={item.href}
			className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
				active
					? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-200'
					: 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100'
			}`}
			aria-label={badge_text ? `${item.label} (${badge_count} pending)` : undefined}
		>
			<Icon
				className={`h-4 w-4 shrink-0 ${active ? 'text-indigo-600 dark:text-indigo-300' : 'text-slate-400 dark:text-slate-500'}`}
				aria-hidden
				strokeWidth={1.75}
			/>
			<span className="flex-1 truncate">{item.label}</span>
			{badge_text ? (
				<span
					className="ml-auto inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold text-white"
					aria-hidden
				>
					{badge_text}
				</span>
			) : null}
		</Link>
	);
}

export function AppSidebar() {
	const { user } = useAuth();
	const { pathname } = useLocation();
	const badges = use_sidebar_badges();
	const is_site_admin = user?.role === 'admin';
	const primary_items = get_primary_items();

	if (!user) return null;

	return (
		<aside className="app-side flex flex-col border-r border-slate-200 bg-white px-3 py-4 dark:border-slate-800 dark:bg-slate-900">
			<div className="mb-5 flex items-center gap-3 px-2">
				<div className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold ${
					is_site_admin
						? 'bg-amber-100 text-amber-700'
						: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200'
				}`}>
					{user.username[0].toUpperCase()}
				</div>
				<div className="min-w-0">
					<p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
						{user.display_name || user.username}
					</p>
					<p className="text-xs text-slate-400 dark:text-slate-500">@{user.username}</p>
					{is_site_admin && (
						<p className="text-[10px] font-semibold uppercase tracking-wider text-amber-600">
							Site Admin
						</p>
					)}
				</div>
			</div>

			<nav className="mb-5 space-y-0.5">
				{primary_items.map((item) => (
					<NavLink
						key={item.href}
						item={item}
						pathname={pathname}
						badge_count={item.badge_key ? badges[item.badge_key] : 0}
					/>
				))}
			</nav>

			{is_site_admin && (
				<div className="border-t border-slate-200 pt-4 dark:border-slate-800">
					<p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-wider text-amber-600">
						Admin
					</p>
					<nav className="space-y-0.5">
						{ADMIN_ITEMS.map((item) => (
							<NavLink key={item.href} item={item} pathname={pathname} />
						))}
					</nav>
				</div>
			)}

		<div className="mt-auto space-y-0.5 border-t border-slate-100 pt-3 dark:border-slate-800">
				<Link
					to="/browse"
					className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-slate-500 hover:bg-slate-50 hover:text-indigo-600 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-indigo-300"
				>
					<Compass className="h-3.5 w-3.5" aria-hidden strokeWidth={1.75} />
					CliqHub Marketplace
				</Link>
				<Link
					to="/getting-started"
					className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-slate-500 hover:bg-slate-50 hover:text-indigo-600 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-indigo-300"
				>
					<Rocket className="h-3.5 w-3.5" aria-hidden strokeWidth={1.75} />
					Getting started
				</Link>
				<a
					href={DOCS.home}
					target="_blank"
					rel="noopener noreferrer"
					className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-slate-500 hover:bg-slate-50 hover:text-indigo-600 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-indigo-300"
				>
					<FileText className="h-3.5 w-3.5" aria-hidden strokeWidth={1.75} />
					Documentation
				</a>
			</div>
		</aside>
	);
}
