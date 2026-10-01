import { useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { useAuth } from '@/lib/auth_context';
import '@/styles/graphite.css';

/**
 * Auth gate for Graphite pages. Each page renders its own `Graphite_shell`
 * (it needs page data for the sidebar), so this layout only guards access.
 */
export function GraphiteLayout() {
	const { user, loading } = useAuth();
	const navigate = useNavigate();
	const { pathname, search } = useLocation();

	useEffect(() => {
		if (!loading && !user) navigate('/login?redirect=' + encodeURIComponent(pathname + search), { replace: true });
	}, [loading, user, navigate, pathname, search]);

	if (loading || !user) {
		return (
			<div className="theme-graphite flex min-h-screen items-center justify-center" role="status">
				<p className="text-[13px] text-[var(--g-ink-3)]">Loading…</p>
			</div>
		);
	}
	return <Outlet />;
}
