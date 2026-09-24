import { Outlet } from 'react-router';
import { useAuth } from '@/lib/auth_context';
import { ProductShell } from '@/layouts/product_shell';

export function TeamsLayout() {
	const { user, loading } = useAuth();

	if (loading) {
		return (
			<div className="flex min-h-[60vh] items-center justify-center">
				<p className="text-sm text-slate-400">Loading...</p>
			</div>
		);
	}

	if (user) {
		return (
			<ProductShell>
				<Outlet />
			</ProductShell>
		);
	}

	return <Outlet />;
}
