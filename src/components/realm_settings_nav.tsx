import { Link, useLocation } from 'react-router';

function settings_subnav_class(is_active: boolean): string {
	return `block rounded-lg px-3 py-2 text-sm transition ${
		is_active
			? 'bg-indigo-50 font-semibold text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200'
			: 'font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100'
	}`;
}

function danger_subnav_class(is_active: boolean): string {
	return `block rounded-lg px-3 py-2 text-sm transition ${
		is_active
			? 'bg-red-50 font-semibold text-red-700 dark:bg-red-500/20 dark:text-red-300'
			: 'font-medium text-red-500 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-900/20 dark:hover:text-red-300'
	}`;
}

/** Left-rail nav shared by realm Settings pages. */
export function Realm_settings_nav({ base_path }: { base_path: string }) {
	const { pathname } = useLocation();
	const is_members = pathname.includes('/settings/security/members')
		|| (pathname.includes('/settings/security') && !pathname.includes('/tokens'));
	const is_tokens = pathname.includes('/settings/security/tokens');
	const is_a2a = pathname.includes('/settings/a2a');
	const is_danger = pathname.includes('/settings/danger');

	return (
		<nav
			aria-label="Realm settings"
			className="w-full shrink-0 md:sticky md:top-0 md:w-52 md:self-start"
		>
			<p className="mb-1 px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
				Settings
			</p>
			<div className="flex flex-row gap-1 md:flex-col">
				<Link
					to={`${base_path}/settings/security/members`}
					className={settings_subnav_class(is_members && !is_a2a)}
				>
					Members
				</Link>
				<Link
					to={`${base_path}/settings/security/tokens`}
					className={settings_subnav_class(is_tokens)}
				>
					Tokens
				</Link>
				<Link
					to={`${base_path}/settings/a2a`}
					className={settings_subnav_class(is_a2a)}
				>
					A2A
				</Link>
				<div className="mt-3 border-t border-slate-200 pt-3 dark:border-slate-700">
					<Link
						to={`${base_path}/settings/danger`}
						className={danger_subnav_class(is_danger)}
					>
						Danger Zone
					</Link>
				</div>
			</div>
		</nav>
	);
}
