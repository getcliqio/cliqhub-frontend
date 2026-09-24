import { Outlet, Link } from 'react-router';
import { useAuth } from '@/lib/auth_context';
import { BrowseSidebar } from '@/components/browse_sidebar';
import { Cliq_mark } from '@/components/cliq_mark';

/** Standalone layout for /browse — dark indigo gradient, transparent sidebar. */
export function BrowseLayout() {
    const { user, loading } = useAuth();

    return (
        <div className="flex min-h-screen flex-col bg-gradient-to-br from-slate-900 via-indigo-950 to-indigo-900">
            <header className="flex h-12 shrink-0 items-center justify-between border-b border-white/10 px-5">
                <Link to={user ? '/home' : '/'} className="flex items-center gap-2.5">
                    <Cliq_mark class_name="h-7 w-7 shrink-0" title="cliqhub" />
                    <span className="text-sm font-semibold tracking-tight text-white">cliqhub</span>
                </Link>

                <div className="flex items-center gap-3">
                    {!loading && user && (
                        <Link
                            to="/home"
                            className="text-sm font-medium text-indigo-200 hover:text-white"
                        >
                            Dashboard
                        </Link>
                    )}
                    {!loading && !user && (
                        <>
                            <Link to="/login" className="text-sm font-medium text-indigo-200 hover:text-white">
                                Log in
                            </Link>
                            <Link
                                to="/signup"
                                className="rounded-lg bg-indigo-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-indigo-400"
                            >
                                Sign up
                            </Link>
                        </>
                    )}
                    {!loading && user && (
                        <Link
                            to="/settings"
                            className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${
                                user.role === 'admin'
                                    ? 'bg-amber-400/20 text-amber-300'
                                    : 'bg-indigo-400/20 text-indigo-200'
                            }`}
                            title="Account"
                        >
                            {user.username[0].toUpperCase()}
                        </Link>
                    )}
                </div>
            </header>

            <div className="flex flex-1 overflow-hidden">
                <BrowseSidebar />
                <main className="flex-1 overflow-y-auto px-8 py-6">
                    <Outlet />
                </main>
            </div>
        </div>
    );
}
