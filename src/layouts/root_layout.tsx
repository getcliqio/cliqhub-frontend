import { Outlet, useLocation } from 'react-router';
import { AuthProvider, useAuth } from '@/lib/auth_context';
import { OrgProvider } from '@/lib/org_context';
import { ThemeProvider } from '@/lib/theme_context';
import { NavBar } from '@/components/nav_bar';
import { Pitch_overlay } from '@/components/pitch_overlay';

function is_marketing_path(pathname: string): boolean {
	if (pathname === '/') return true;
	if (pathname.startsWith('/signup')) return true;
	return false;
}

function is_auth_gate_path(pathname: string): boolean {
	return pathname.startsWith('/login');
}

function RootChrome() {
	const { user, loading } = useAuth();
	const { pathname } = useLocation();

	// Login owns its own product-themed chrome (matches dashboard shell).
	if (is_auth_gate_path(pathname)) {
		return <Outlet />;
	}

	// Logged-in product surfaces (and builder) own their own chrome.
	const use_marketing_chrome =
		loading || !user || is_marketing_path(pathname);

	if (!use_marketing_chrome) {
		return <Outlet />;
	}

	return (
		<div className="flex min-h-screen flex-col">
			<NavBar />
			<main className="flex-1">
				<Outlet />
			</main>
			<footer className="mt-auto border-t border-slate-200 bg-white py-8 dark:border-slate-800 dark:bg-slate-950">
				<div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-6 px-6 text-sm text-slate-400 dark:text-slate-500">
					<span>CliqHub</span>
					<a href="https://getcliq.io" target="_blank" rel="noopener noreferrer" className="hover:text-indigo-600 dark:hover:text-indigo-300">Get Cliq</a>
					<a href="https://docs.getcliq.io" target="_blank" rel="noopener noreferrer" className="hover:text-indigo-600 dark:hover:text-indigo-300">Docs</a>
				</div>
			</footer>
		</div>
	);
}

export function RootLayout() {
	return (
		<ThemeProvider>
			<AuthProvider>
				<OrgProvider>
					<RootChrome />
					<Pitch_overlay />
				</OrgProvider>
			</AuthProvider>
		</ThemeProvider>
	);
}
