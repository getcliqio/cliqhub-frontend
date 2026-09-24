import { useEffect } from 'react';
import { useNavigate, useLocation, Outlet } from 'react-router';
import { useAuth } from '@/lib/auth_context';
import { AppSidebar } from '@/components/app_sidebar';

export function AccountLayout() {
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
		<div className="mx-auto flex max-w-6xl gap-8 px-6 py-10">
			<AppSidebar />
			<div className="min-w-0 flex-1"><Outlet /></div>
		</div>
	);
}
