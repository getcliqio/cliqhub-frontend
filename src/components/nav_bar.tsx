import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router';
import { Moon, Sun } from 'lucide-react';
import { useAuth } from '@/lib/auth_context';
import { useTheme } from '@/lib/theme_context';

export function NavBar() {
  const { user, loading, logout } = useAuth();
  const { resolved, toggle } = useTheme();
  const [open, setOpen] = useState(false);
  const menu_ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handle_click(e: MouseEvent) {
      if (menu_ref.current && !menu_ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handle_click);
    return () => document.removeEventListener('mousedown', handle_click);
  }, []);

  return (
    <nav className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link to={user ? '/home' : '/'} className="text-xl font-extrabold text-indigo-600 dark:text-indigo-300">
          CliqHub
        </Link>
        <div className="flex items-center gap-4 text-sm font-medium text-slate-600 sm:gap-6 dark:text-slate-300">
          <button
            type="button"
            onClick={toggle}
            aria-label={resolved === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            title={resolved === 'dark' ? 'Light mode' : 'Dark mode'}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {resolved === 'dark' ? <Sun className="h-4 w-4" strokeWidth={2} /> : <Moon className="h-4 w-4" strokeWidth={2} />}
          </button>

          {!loading && !user && (
            <a
              href="https://getcliq.io"
              className="rounded-lg bg-emerald-600 px-5 py-1.5 font-bold text-white transition hover:bg-emerald-700"
              target="_blank"
              rel="noopener noreferrer"
            >
              Get Cliq — it&apos;s free
            </a>
          )}

          {!loading && user && (
            <Link to="/builder" className="rounded-lg bg-indigo-600 px-4 py-1.5 text-white hover:bg-indigo-700">
              Build
            </Link>
          )}

          {!loading && !user && (
            <Link to="/login" className="hover:text-indigo-600 dark:hover:text-indigo-300">
              Log in
            </Link>
          )}

          {!loading && user && (
            <div className="relative" ref={menu_ref}>
              <button
                onClick={() => setOpen(!open)}
                className="flex items-center gap-2 rounded-lg px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                  user.role === 'admin'
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300'
                    : 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300'
                }`}>
                  {user.username[0].toUpperCase()}
                </span>
                <span className="max-w-[100px] truncate">{user.username}</span>
                <svg className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {open && (
                <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-800 dark:bg-slate-900">
                  <div className="border-b border-slate-100 px-4 py-2 dark:border-slate-800">
                    <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">{user.display_name}</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500">@{user.username}</p>
                    {user.role === 'admin' && (
                      <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">Site Admin</p>
                    )}
                  </div>
                  {user.role === 'admin' && (
                    <Link to="/admin" className="block px-4 py-2 text-sm text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-500/10" onClick={() => setOpen(false)}>
                      Admin Panel
                    </Link>
                  )}
                  <Link to="/home" className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800" onClick={() => setOpen(false)}>
                    Home
                  </Link>
                  <Link to="/builder" className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800" onClick={() => setOpen(false)}>
                    Builder
                  </Link>
                  <Link to="/browse" className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800" onClick={() => setOpen(false)}>
                    Browse
                  </Link>
                  <Link to="/teams" className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800" onClick={() => setOpen(false)}>
                    My Teams
                  </Link>
                  <Link to="/tokens" className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800" onClick={() => setOpen(false)}>
                    User tokens
                  </Link>
                  <Link to="/account" className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800" onClick={() => setOpen(false)}>
                    Account
                  </Link>
                  <div className="border-t border-slate-100 dark:border-slate-800">
                    <button
                      onClick={() => { logout(); setOpen(false); }}
                      className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-slate-50 dark:text-red-400 dark:hover:bg-slate-800"
                    >
                      Log out
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
