import { useEffect } from 'react';
import { useNavigate, useLocation, Outlet } from 'react-router';
import { useAuth } from '@/lib/auth_context';
import { ProductShell } from '@/layouts/product_shell';

/** Authenticated product shell (top bar + sidebar + content). */
export function AppLayout() {
	const { user, loading } = useAuth();
	const navigate = useNavigate();
	const { pathname } = useLocation();

	useEffect(() => {
		if (!loading && !user) {
			navigate('/login?redirect=' + encodeURIComponent(pathname), { replace: true });
		}
	}, [loading, user, navigate, pathname]);

	if (loading) {
		return (
			<div className="flex min-h-[60vh] items-center justify-center">
				<p className="text-sm text-slate-400">Loading...</p>
			</div>
		);
	}

	if (!user) return null;

	return (
		<ProductShell>
			<Outlet />
		</ProductShell>
	);
}
