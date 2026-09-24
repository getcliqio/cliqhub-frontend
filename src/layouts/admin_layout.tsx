import { useEffect } from 'react';
import { useNavigate, Outlet } from 'react-router';
import { useAuth } from '@/lib/auth_context';
import { ProductShell } from '@/layouts/product_shell';

/** Site-admin guard — same product shell as the rest of Hub. */
export function AdminLayout() {
	const { user, loading } = useAuth();
	const navigate = useNavigate();

	useEffect(() => {
		if (!loading && (!user || user.role !== 'admin')) {
			navigate('/home', { replace: true });
		}
	}, [loading, user, navigate]);

	if (loading) {
		return (
			<div className="flex min-h-[60vh] items-center justify-center">
				<p className="text-sm text-slate-400">Loading...</p>
			</div>
		);
	}

	if (!user || user.role !== 'admin') return null;

	return (
		<ProductShell>
			<Outlet />
		</ProductShell>
	);
}
