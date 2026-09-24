import { Link } from 'react-router';

export function Component() {
    return (
        <div className="flex min-h-[70vh] items-center justify-center px-6">
            <div className="w-full max-w-sm text-center">
                <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-50">
                    <svg className="h-8 w-8 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                    </svg>
                </div>
                <h1 className="mb-3 text-2xl font-extrabold text-slate-900">Invite Only</h1>
                <p className="mb-8 text-sm leading-relaxed text-slate-500">
                    CliqHub is currently in private beta. Accounts are created by invitation.
                    If you already have an account, log in below.
                </p>
                <Link
                    to="/login"
                    className="inline-block rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700"
                >
                    Log in
                </Link>
            </div>
        </div>
    );
}
