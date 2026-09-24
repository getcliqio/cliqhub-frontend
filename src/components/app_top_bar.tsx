import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router';
import { Sun, Moon, ChevronDown, Check, Palette } from 'lucide-react';
import { useAuth } from '@/lib/auth_context';
import { useOrg, type OrgInfo } from '@/lib/org_context';
import { useTheme } from '@/lib/theme_context';
import { use_sidebar_badges, format_badge } from '@/lib/use_sidebar_badges';
import { Cliq_mark } from '@/components/cliq_mark';

/** Org picker — appears only when user belongs to 2+ orgs. */
function OrgSwitcher() {
	const { current_org, orgs, is_multi_org, is_personal, switch_org } = useOrg();
	const { user } = useAuth();
	const navigate = useNavigate();
	const [open, set_open] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		function handle_click(e: MouseEvent) {
			if (ref.current && !ref.current.contains(e.target as Node)) set_open(false);
		}
		document.addEventListener('mousedown', handle_click);
		return () => document.removeEventListener('mousedown', handle_click);
	}, []);

	if (!is_multi_org || !current_org) return null;

	/** Display label: personal org shows user's display name, shared orgs show org name. */
	function label(org: OrgInfo): string {
		if (org.slug === user?.username) return user?.display_name ?? org.slug;
		return org.display_name;
	}

	return (
		<div className="relative" ref={ref}>
			<button
				type="button"
				onClick={() => set_open(!open)}
				className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
			>
				<span className="text-slate-400 dark:text-slate-500">Organization:</span>
				<span className="max-w-[180px] truncate font-semibold">{label(current_org)}</span>
				<ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
			</button>
			{open && (
				<div className="absolute left-0 top-9 z-50 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
					{orgs.map(org => (
						<button
							key={org.id}
							type="button"
							onClick={() => {
								switch_org(org.id);
								set_open(false);
								navigate('/home');
							}}
							className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
						>
							{org.id === current_org.id
								? <Check className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
								: <span className="h-3.5 w-3.5" />
							}
							<span className="truncate">{label(org)}</span>
							{org.slug === user?.username && (
								<span className="ml-auto text-[10px] text-slate-400">personal</span>
							)}
						</button>
					))}
				</div>
			)}
		</div>
	);
}

/** Compact 48px product top bar — matches hub-ux-prototype. */
export function AppTopBar() {
	const { user, logout } = useAuth();
	const { resolved, toggle, palette, toggle_palette } = useTheme();
	const badges = use_sidebar_badges();
	const [open, set_open] = useState(false);
	const menu_ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		function handle_click(e: MouseEvent) {
			if (menu_ref.current && !menu_ref.current.contains(e.target as Node)) {
				set_open(false);
			}
		}
		document.addEventListener('mousedown', handle_click);
		return () => document.removeEventListener('mousedown', handle_click);
	}, []);

	if (!user) return null;

	return (
		<header className="flex h-12 items-center justify-between gap-4 border-b border-slate-200 bg-white px-5 dark:border-slate-800 dark:bg-slate-900">
			<div className="flex min-w-0 items-center gap-3">
				<Link to="/home" className="flex items-center gap-2.5">
					<Cliq_mark class_name="h-7 w-7 shrink-0" title="cliqhub" />
					<span className="text-sm font-semibold tracking-tight text-slate-900 dark:text-slate-100">cliqhub</span>
				</Link>
				{user.role === 'admin' && (
					<span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700">
						Site admin
					</span>
				)}
				<OrgSwitcher />
			</div>

			<div className="flex items-center gap-3">


				<button
					type="button"
					onClick={toggle_palette}
					className={`flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-2 text-[11px] font-semibold uppercase tracking-wider hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800 ${
						palette === 'measureone'
							? 'text-indigo-700 dark:text-indigo-300'
							: 'text-slate-500 dark:text-slate-300'
					}`}
					title={palette === 'measureone' ? 'Switch to default palette' : 'Switch to MeasureOne palette (preview)'}
					aria-label={palette === 'measureone' ? 'Switch to default palette' : 'Switch to MeasureOne palette'}
				>
					<Palette className="h-3.5 w-3.5" strokeWidth={2} />
					<span>{palette === 'measureone' ? 'M1' : 'Def'}</span>
				</button>

				<button
					type="button"
					onClick={toggle}
					className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
					title={resolved === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
					aria-label={resolved === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
				>
					{resolved === 'dark' ? <Sun className="h-4 w-4" strokeWidth={2} /> : <Moon className="h-4 w-4" strokeWidth={2} />}
				</button>

				<Link
					to="/events?tab=all"
					className="relative flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
					title={badges.unread_notifications
						? `Notifications (${badges.unread_notifications} new)`
						: 'Notifications'}
					aria-label={badges.unread_notifications
						? `Notifications (${badges.unread_notifications} new)`
						: 'Notifications'}
				>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
						<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
						<path d="M13.73 21a2 2 0 0 1-3.46 0" />
					</svg>
					{badges.unread_notifications > 0 ? (
						<span
							className="absolute -right-1 -top-1 inline-flex min-w-[1rem] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white ring-2 ring-white dark:ring-slate-900"
							aria-hidden
						>
							{format_badge(badges.unread_notifications)}
						</span>
					) : null}
				</Link>

				<div className="relative" ref={menu_ref}>
					<button
						type="button"
						onClick={() => set_open(!open)}
						aria-label={`Account menu for ${user.username}`}
						className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${
							user.role === 'admin'
								? 'bg-amber-100 text-amber-700'
								: 'bg-indigo-100 text-indigo-700'
						}`}
						title="Settings"
					>
						{user.username[0].toUpperCase()}
					</button>
					{open && (
						<div className="absolute right-0 top-10 z-50 w-48 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
							<div className="border-b border-slate-100 px-4 py-2 dark:border-slate-800">
								<p className="text-xs font-semibold text-slate-900 dark:text-slate-100">{user.display_name || user.username}</p>
								<p className="text-xs text-slate-400 dark:text-slate-500">@{user.username}</p>
							</div>
							<Link
								to="/settings"
								className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
								onClick={() => set_open(false)}
							>
								Settings
							</Link>
							{user.role === 'admin' && (
								<Link
									to="/admin"
									className="block px-4 py-2 text-sm text-amber-700 hover:bg-amber-50 dark:hover:bg-slate-800"
									onClick={() => set_open(false)}
								>
									Admin
								</Link>
							)}
							<button
								type="button"
								onClick={() => { logout(); set_open(false); }}
								className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-slate-50 dark:hover:bg-slate-800"
							>
								Log out
							</button>
						</div>
					)}
				</div>
			</div>
		</header>
	);
}
