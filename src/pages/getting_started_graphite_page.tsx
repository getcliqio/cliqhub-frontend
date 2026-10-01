/**
 * Getting started (Graphite) — a checklist that ticks itself.
 *
 * Data: one `POST /v1/getting_started/get` (BFF composes orgs → realms,
 * daemons, realm rosters and runs). Nothing is ticked by hand.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowRight, Check, Copy, PartyPopper, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { use_overview } from '@/lib/overview';
import { use_bff_read } from '@/lib/use_bff_read';
import type { Getting_started_data, Getting_started_realm_ref } from '@/lib/getting_started';
import { realm_path } from '@/lib/realm_url';
import { Graphite_shell } from '@/components/graphite/graphite_shell';

function Cmd({ text }: { text: string }) {
	const [copied, set_copied] = useState(false);
	return (
		<div className="g-mono mt-2.5 flex items-start gap-2 rounded-md border border-[var(--g-line)] bg-[var(--g-bg)] px-3 py-2 text-[12px] text-[var(--g-ink-2)]">
			<pre className="min-w-0 flex-1 whitespace-pre-wrap break-all">{text}</pre>
			<button
				type="button"
				aria-label="Copy command"
				onClick={async () => {
					try { await navigator.clipboard.writeText(text); set_copied(true); setTimeout(() => set_copied(false), 1200); } catch { /* ignore */ }
				}}
				className="shrink-0 text-[var(--g-ink-3)] hover:text-[var(--g-ink)]"
			>
				{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
			</button>
		</div>
	);
}

interface Step_def {
	key: 'cli' | 'daemon' | 'team' | 'run';
	title: string;
	done: boolean;
	hint: string;
	done_text: ReactNode;
	body?: ReactNode;
	action?: { label: string; to: string };
}

function realm_label(r: Getting_started_realm_ref | null): string {
	return r ? `${r.org_slug} › ${r.slug}` : '';
}

export function steps_for(d: Getting_started_data): Step_def[] {
	const home = d.realm;
	return [
		{
			key: 'cli',
			title: 'Install and connect the CLI',
			done: d.cli.done,
			hint: 'Install cliq, run the one-time setup, then log in to this Hub.',
			done_text: 'Connected — your CLI has enrolled a daemon.',
			body: <Cmd text={'curl -fsSL https://getcliq.io/cliq/install | bash\ncliq setup\ncliq login'} />,
		},
		{
			key: 'daemon',
			title: 'Start a daemon',
			done: d.daemon.done,
			hint: 'The daemon runs your teams on your machine or server.',
			done_text: <>{d.daemon.online} of {d.daemon.total} daemon{d.daemon.total === 1 ? '' : 's'} online{d.daemon.realm ? <> · in <span className="g-mono">{realm_label(d.daemon.realm)}</span></> : null}.</>,
			body: <Cmd text="cliqd" />,
			action: home ? { label: 'See daemons', to: `${realm_path(home.org_slug, home.slug)}/daemons` } : undefined,
		},
		{
			key: 'team',
			title: 'Install a team',
			done: d.team.done,
			hint: 'Find a team in Marketplace (try @cliq/hello-world) — or one of your own under Teams — and install it into a realm.',
			done_text: d.team.realm ? <>Installed in <span className="g-mono">{realm_label(d.team.realm)}</span>.</> : 'A team has been installed.',
			action: { label: 'Open Marketplace', to: '/browse' },
		},
		{
			key: 'run',
			title: 'Run it',
			done: d.run.done,
			hint: 'Open the realm, choose the team and press Run. This ticks when your first run appears.',
			done_text: d.run.realm && d.run.run_id
				? <>First run: <Link className="text-[var(--g-acc)] hover:underline" to={`${realm_path(d.run.realm.org_slug, d.run.realm.slug)}/runs/${encodeURIComponent(d.run.run_id)}`}>open it</Link>.</>
				: 'You’ve run a team.',
			action: (d.team.realm ?? home) ? { label: 'Open realm teams', to: `${realm_path((d.team.realm ?? home)!.org_slug, (d.team.realm ?? home)!.slug)}/teams` } : undefined,
		},
	];
}

export function Getting_started_view({ data }: { data: Getting_started_data }) {
	const steps = steps_for(data);
	const current = steps.findIndex((s) => !s.done);
	const all_done = current === -1;
	const pct = Math.round((data.done_count / data.total) * 100);

	return (
		<div className="flex max-w-[860px] flex-col gap-[18px]">
			<div>
				<h1 className="text-[24px] font-semibold tracking-[-0.02em]">Getting started</h1>
				<p className="mt-1 text-[13.5px] text-[var(--g-ink-3)]">
					From zero to your first run in {data.total} steps.{' '}
					<b className="text-[var(--g-acc)]" data-testid="gs-progress">{data.done_count} of {data.total} done.</b>
				</p>
				<div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--g-soft)]" role="progressbar" aria-valuemin={0} aria-valuemax={data.total} aria-valuenow={data.done_count} aria-label="Setup progress">
					<div className="h-full bg-[var(--g-acc)] transition-[width]" style={{ width: `${pct}%` }} />
				</div>
			</div>

			{data.partial ? (
				<p role="status" className="text-[12.5px] text-[var(--g-warn-text)]">Some of your orgs couldn’t be checked, so a finished step may still show as open.</p>
			) : null}

			{all_done ? (
				<div className="flex items-center gap-3 rounded-[10px] border border-[rgba(62,207,142,.35)] bg-[var(--g-ok-soft)] px-4 py-3 text-[13.5px]">
					<PartyPopper aria-hidden className="h-5 w-5 text-[var(--g-ok)]" />
					<span><b>You’re set up.</b> This guide now lives in your account menu.</span>
					<Link to="/home" className="ml-auto rounded-md bg-[var(--g-acc)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--g-on-acc)]">Go to Overview</Link>
				</div>
			) : null}

			<ol className="overflow-hidden rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)]">
				{steps.map((s, i) => {
					const is_now = i === current;
					return (
						<li
							key={s.key}
							data-testid={`gs-step-${s.key}`}
							data-state={s.done ? 'done' : is_now ? 'current' : 'todo'}
							className={`flex items-start gap-3.5 border-b border-[var(--g-line-2)] px-4 py-4 last:border-b-0 ${is_now ? 'bg-[rgba(212,255,63,.04)] shadow-[inset_2px_0_0_var(--g-acc)]' : ''}`}
						>
							<span
								aria-hidden
								className={`grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full text-[12px] font-bold ${s.done ? 'bg-[var(--g-ok)] text-[var(--g-on-acc)]' : is_now ? 'border-2 border-[var(--g-acc)] text-[var(--g-acc)]' : 'border border-[var(--g-line)] text-[var(--g-ink-3)]'}`}
							>
								{s.done ? <Check className="h-3.5 w-3.5" /> : i + 1}
							</span>
							<div className="min-w-0 flex-1">
								<p className={`text-[14px] font-semibold ${s.done ? 'text-[var(--g-ink-2)]' : ''}`}>
									<span className="sr-only">{s.done ? 'Done: ' : is_now ? 'Next: ' : 'To do: '}</span>
									{s.title}
								</p>
								<p className="mt-0.5 text-[12.5px] text-[var(--g-ink-3)]">{s.done ? s.done_text : s.hint}</p>
								{!s.done && s.body ? s.body : null}
							</div>
							{s.action && (is_now || s.done) ? (
								<Link
									to={s.action.to}
									className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-semibold ${is_now ? 'bg-[var(--g-acc)] text-[var(--g-on-acc)] hover:bg-[var(--g-acc-hover)]' : 'border border-[var(--g-line)] hover:bg-[var(--g-soft)]'}`}
								>
									{s.action.label}
									<ArrowRight aria-hidden className="h-3 w-3" />
								</Link>
							) : null}
						</li>
					);
				})}
			</ol>
			<p className="text-[12.5px] text-[var(--g-ink-3)]">
				Steps tick themselves from your daemons, realm teams and runs — refresh after you finish one.
			</p>
		</div>
	);
}

export function Component() {
	const overview = use_overview();
	const gs = use_bff_read<Getting_started_data>('/v1/getting_started/get', {}, { refresh_ms: 15_000, fallback_error: 'Could not check your setup.' });
	return (
		<Graphite_shell
			data={overview.data}
			title="Getting started"
			actions={
				<button type="button" onClick={() => void gs.reload()} aria-label="Refresh" title="Refresh" className="grid h-8 w-8 place-items-center rounded-lg border border-[var(--g-line)] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]">
					<RefreshCw className="h-3.5 w-3.5" />
				</button>
			}
		>
			<div className="px-7 py-6">
				{gs.status === 'loading' ? <div className="h-[420px] max-w-[860px] animate-pulse rounded-[10px] bg-[var(--g-panel)]" aria-busy="true" aria-label="Checking your setup" /> : null}
				{gs.status === 'error' && !gs.data ? (
					<div role="alert" className="max-w-[460px] rounded-xl border border-[var(--g-bad-line)] bg-[var(--g-bad-soft)] p-5">
						<p className="text-[14px] font-semibold">Couldn’t check your setup</p>
						<p className="mt-1 text-[13px] text-[var(--g-ink-3)]">{gs.error}</p>
						<button type="button" onClick={() => void gs.reload()} className="mt-3 rounded-lg border border-[var(--g-line)] px-4 py-1.5 text-[13px] font-semibold">Try again</button>
					</div>
				) : null}
				{gs.data ? <Getting_started_view data={gs.data} /> : null}
			</div>
		</Graphite_shell>
	);
}
