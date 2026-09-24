import { Suspense, useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Moon, Sun } from 'lucide-react';
import { useAuth } from '@/lib/auth_context';
import { useTheme } from '@/lib/theme_context';
import { ApiErrorBanner } from '@/components/ui/api_error';
import { Cliq_mark } from '@/components/cliq_mark';

function Login_top_bar() {
	const { resolved, toggle } = useTheme();

	return (
		<header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-5 dark:border-slate-800 dark:bg-slate-900">
			<Link to="/" className="flex items-center gap-2.5">
				<Cliq_mark class_name="h-7 w-7 shrink-0" title="cliqhub" />
				<span className="text-sm font-semibold tracking-tight text-slate-900 dark:text-slate-100">
					cliqhub
				</span>
			</Link>
			<div className="flex items-center gap-3">
				<a
					href="https://getcliq.io"
					target="_blank"
					rel="noopener noreferrer"
					className="hidden text-sm font-medium text-slate-600 hover:text-indigo-600 sm:inline dark:text-slate-300 dark:hover:text-indigo-300"
				>
					Get Cliq
				</a>
				<a
					href="https://docs.getcliq.io"
					target="_blank"
					rel="noopener noreferrer"
					className="hidden text-sm font-medium text-slate-600 hover:text-indigo-600 sm:inline dark:text-slate-300 dark:hover:text-indigo-300"
				>
					Docs
				</a>
				<button
					type="button"
					onClick={toggle}
					className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
					title={resolved === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
					aria-label={resolved === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
				>
					{resolved === 'dark' ? (
						<Sun className="h-4 w-4" strokeWidth={2} />
					) : (
						<Moon className="h-4 w-4" strokeWidth={2} />
					)}
				</button>
			</div>
		</header>
	);
}

/**
 * Marketing pipeline — the story anyone understands:
 * you ask → specialists work → you review → it ships.
 * Light surface, sized to the column (no horizontal clip).
 */
function Login_story_pipeline() {
	const nodes = [
		{ id: 'ask', label: 'Your ask', role: 'describe the work', x: 8, y: 86, fill: '#475569' },
		{ id: 'plan', label: 'Plan', role: 'scopes it', x: 118, y: 28, fill: '#4f46e5' },
		{ id: 'build', label: 'Build', role: 'does the work', x: 118, y: 144, fill: '#6366f1' },
		{ id: 'draft', label: 'Draft', role: 'ready to check', x: 236, y: 86, fill: '#7c3aed' },
		{ id: 'you', label: 'You review', role: 'only when needed', x: 354, y: 86, fill: '#d97706' },
		{ id: 'done', label: 'Done', role: 'ship · notify', x: 472, y: 86, fill: '#059669' },
	] as const;
	const w = 104;
	const h = 52;
	const by_id = Object.fromEntries(nodes.map((n) => [n.id, n]));
	const edges: Array<[string, string]> = [
		['ask', 'plan'],
		['ask', 'build'],
		['plan', 'draft'],
		['build', 'draft'],
		['draft', 'you'],
		['you', 'done'],
	];

	function path_for(from: string, to: string) {
		const a = by_id[from];
		const b = by_id[to];
		const x1 = a.x + w;
		const y1 = a.y + h / 2;
		const x2 = b.x;
		const y2 = b.y + h / 2;
		const cx = (x1 + x2) / 2;
		return `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`;
	}

	return (
		<div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_rgba(15,23,42,0.08)] dark:border-slate-700 dark:bg-slate-900">
			<p className="mb-2 flex items-center gap-2 px-1 text-[10px] font-bold uppercase tracking-[0.16em] text-indigo-600 dark:text-indigo-300">
				<span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
				How a cliq team finishes work
			</p>
			<svg
				viewBox="0 0 584 224"
				className="block h-auto w-full"
				role="img"
				aria-label="From your ask to done — plan, build, review, ship"
			>
				<defs>
					<linearGradient id="story_edge_g" x1="0%" y1="0%" x2="100%" y2="0%">
						<stop offset="0%" stopColor="#6366f1" />
						<stop offset="100%" stopColor="#a855f7" />
					</linearGradient>
					<marker id="story_arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto">
						<path d="M0,0 L10,5 L0,10 z" fill="#a855f7" />
					</marker>
				</defs>

				{edges.map(([from, to], i) => {
					const d = path_for(from, to);
					return (
						<g key={`${from}-${to}`}>
							<path
								d={d}
								stroke="url(#story_edge_g)"
								strokeWidth="2"
								fill="none"
								markerEnd="url(#story_arrow)"
								opacity="0.8"
							/>
							<circle r="3.25" fill="#a855f7">
								<animateMotion dur="2.5s" repeatCount="indefinite" begin={`${0.3 * i}s`} path={d} />
								<animate
									attributeName="opacity"
									values="0;1;1;0"
									keyTimes="0;0.12;0.88;1"
									dur="2.5s"
									repeatCount="indefinite"
									begin={`${0.3 * i}s`}
								/>
							</circle>
						</g>
					);
				})}

				{nodes.map((n) => (
					<g key={n.id}>
						<rect x={n.x} y={n.y} width={w} height={h} rx="11" fill={n.fill} />
						<text
							x={n.x + w / 2}
							y={n.y + 22}
							textAnchor="middle"
							fill="#fff"
							style={{ fontSize: '12px', fontWeight: 700 }}
						>
							{n.label}
						</text>
						<text
							x={n.x + w / 2}
							y={n.y + 38}
							textAnchor="middle"
							fill="rgba(255,255,255,0.78)"
							style={{ fontSize: '9.5px', fontWeight: 500 }}
						>
							{n.role}
						</text>
					</g>
				))}
			</svg>
		</div>
	);
}

function LoginForm() {
	const { user, loading, login } = useAuth();
	const navigate = useNavigate();
	const [searchParams] = useSearchParams();
	const redirect = searchParams.get('redirect') || '/home';

	const [username, set_username] = useState('');
	const [password, set_password] = useState('');
	const [error, set_error] = useState('');
	const [submitting, set_submitting] = useState(false);

	useEffect(() => {
		if (!loading && user) {
			navigate(redirect, { replace: true });
		}
	}, [loading, user, navigate, redirect]);

	async function handle_submit(e: React.FormEvent) {
		e.preventDefault();
		set_error('');
		set_submitting(true);

		const err = await login(username.trim().toLowerCase(), password);
		if (err) {
			set_error(err);
			set_submitting(false);
		}
	}

	if (loading || user) {
		return (
			<div className="flex min-h-screen flex-col">
				<Login_top_bar />
				<div className="flex flex-1 items-center justify-center bg-slate-50 dark:bg-slate-950">
					<p className="text-sm text-slate-400 dark:text-slate-500">Loading...</p>
				</div>
			</div>
		);
	}

	return (
		<div className="flex min-h-screen flex-col">
			<Login_top_bar />

			<main className="relative isolate flex flex-1 flex-col overflow-hidden bg-[radial-gradient(1200px_500px_at_100%_0%,rgba(224,231,255,0.55),transparent_60%),radial-gradient(900px_400px_at_0%_100%,rgba(219,234,254,0.4),transparent_60%),linear-gradient(180deg,#f8fafc_0%,#eff6ff_100%)] dark:bg-[#0f172a] dark:bg-none">
				<div
					aria-hidden
					className="pointer-events-none absolute -left-24 top-20 h-72 w-72 rounded-full bg-indigo-400/15 blur-3xl dark:bg-indigo-500/10"
				/>
				<div
					aria-hidden
					className="pointer-events-none absolute -right-16 bottom-10 h-80 w-80 rounded-full bg-violet-300/20 blur-3xl dark:bg-violet-600/10"
				/>

				<div className="relative mx-auto grid w-full max-w-6xl flex-1 items-center gap-10 px-6 py-12 lg:grid-cols-2 lg:gap-14 lg:py-16">
					<section className="max-w-xl">
						<p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-600 dark:text-indigo-300">
							CliqHub
						</p>
						<h1 className="mt-4 text-4xl font-semibold leading-[1.1] tracking-tight text-slate-900 dark:text-slate-50 sm:text-5xl">
							See your AI work finish — without chasing it.
						</h1>
						<p className="mt-5 max-w-md text-base leading-relaxed text-slate-600 dark:text-slate-300">
							Sign in to start jobs, invite your team, and watch progress live.
							Invite-only for now.
						</p>

						<div className="mt-8">
							<Login_story_pipeline />
						</div>

						<ul className="mt-8 space-y-3 text-sm text-slate-600 dark:text-slate-400">
							<li className="flex items-start gap-2">
								<span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-600 dark:bg-indigo-400" />
								Live status so you know what’s running and what’s done
							</li>
							<li className="flex items-start gap-2">
								<span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-600 dark:bg-indigo-400" />
								Alerts in Slack or email when something needs you
							</li>
							<li className="flex items-start gap-2">
								<span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-600 dark:bg-indigo-400" />
								New here?{' '}
								<a
									href="https://getcliq.io/download"
									className="font-medium text-indigo-700 underline-offset-2 hover:underline dark:text-indigo-300"
								>
									Install cliq
								</a>{' '}
								on your machine first
							</li>
						</ul>
					</section>

					<section className="w-full max-w-md justify-self-center lg:justify-self-end">
						<div className="rounded-[20px] border border-slate-200/90 bg-white p-8 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_rgba(15,23,42,0.06)] dark:border-slate-700 dark:bg-slate-900 dark:shadow-[0_1px_2px_rgba(0,0,0,0.3),0_8px_24px_rgba(0,0,0,0.35)]">
							<div className="mb-6 flex items-center gap-3">
								<Cliq_mark class_name="h-9 w-9 shrink-0" title="cliq" />
								<div>
									<h2 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
										Sign in
									</h2>
									<p className="text-sm text-slate-500 dark:text-slate-400">
										Use your CliqHub username and password.
									</p>
								</div>
							</div>

							<form onSubmit={handle_submit} className="space-y-4">
								<div>
									<label
										htmlFor="username"
										className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300"
									>
										Username
									</label>
									<input
										id="username"
										type="text"
										value={username}
										onChange={(e) => set_username(e.target.value)}
										autoComplete="username"
										autoFocus
										required
										className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/15 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
									/>
								</div>

								<div>
									<label
										htmlFor="password"
										className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300"
									>
										Password
									</label>
									<input
										id="password"
										type="password"
										value={password}
										onChange={(e) => set_password(e.target.value)}
										autoComplete="current-password"
										required
										className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/15 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
									/>
								</div>

								<ApiErrorBanner error={error} />

								<button
									type="submit"
									disabled={submitting || !username.trim() || !password}
									className="w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
								>
									{submitting ? 'Signing in…' : 'Sign in'}
								</button>
							</form>

							<p className="mt-6 text-center text-xs text-slate-500 dark:text-slate-400">
								Need access? Ask a CliqHub admin for an invite.
							</p>
						</div>
					</section>
				</div>

				<footer className="relative border-t border-slate-200/80 bg-white/70 py-5 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-950/60">
					<div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-6 px-6 text-sm text-slate-400 dark:text-slate-500">
						<span>CliqHub</span>
						<a
							href="https://getcliq.io"
							target="_blank"
							rel="noopener noreferrer"
							className="hover:text-indigo-600 dark:hover:text-indigo-300"
						>
							Get Cliq
						</a>
						<a
							href="https://docs.getcliq.io"
							target="_blank"
							rel="noopener noreferrer"
							className="hover:text-indigo-600 dark:hover:text-indigo-300"
						>
							Docs
						</a>
						<Link to="/" className="hover:text-indigo-600 dark:hover:text-indigo-300">
							Home
						</Link>
					</div>
				</footer>
			</main>
		</div>
	);
}

export function Component() {
	return (
		<Suspense
			fallback={
				<div className="flex min-h-screen items-center justify-center bg-slate-50">
					<p className="text-sm text-slate-400">Loading...</p>
				</div>
			}
		>
			<LoginForm />
		</Suspense>
	);
}
