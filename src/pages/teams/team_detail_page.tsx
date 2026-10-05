/**
 * Marketplace › one team (Graphite).
 * Signed in: the Graphite team page is the one place a team lives, so go there.
 * Signed out: a read-only view — workflow, install command, roles, requirements.
 * Read: `POST /v1/teams/get_by_id` (optionally `?v=` for an older version).
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router';
import { Check, Copy, Download } from 'lucide-react';
import { useAuth } from '@/lib/auth_context';
import { useOrgFetch } from '@/lib/org_context';
import type { WorkflowPhase } from '@/lib/types';
import { team_href, type Team_phase } from '@/lib/team_page';
import type { TeamDetailData } from '@/components/team_detail_view';
import { Workflow_graph, Workflow_legend } from '@/components/graphite/g_workflow_graph';
import { Md } from '@/components/graphite/g_review';
import { Team_avatar } from '@/pages/teams/teams_graphite_page';

const CARD = 'rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)]';
const H2 = 'border-b border-[var(--g-line)] px-4 py-3 text-[14px] font-semibold';

/** Catalog phase (team.yml shape) → the Graphite graph's phase shape. */
export function to_team_phase(p: WorkflowPhase): Team_phase {
	return {
		name: p.name,
		type: p.type,
		agent: p.agent ?? null,
		depends_on: p.depends_on ?? [],
		review: Boolean(p.review),
		reviewers: null,
		max_iterations: p.max_iterations ?? null,
		commands: (p.commands ?? []).map((c) => c.name),
		sources: (p.sources ?? []).map((s) => s.name),
		targets: (p.target_entries ?? []).map((t) => t.name),
		team: p.team ?? null,
		role: p.role ?? null,
		support: Boolean(p.is_support),
	};
}

function Copy_line({ text }: { text: string }) {
	const [done, set_done] = useState(false);
	return (
		<div className="flex items-center gap-3 rounded-lg border border-[var(--g-line)] bg-[var(--g-bg)] px-3 py-2.5">
			<span aria-hidden className="g-mono text-[12.5px] text-[var(--g-ink-3)]">$</span>
			<code className="g-mono min-w-0 flex-1 truncate text-[13px] text-[var(--g-ink)]">{text}</code>
			<button
				type="button"
				onClick={() => { void navigator.clipboard?.writeText(text); set_done(true); setTimeout(() => set_done(false), 1500); }}
				aria-label="Copy install command"
				className="grid h-7 w-7 place-items-center rounded-md border border-[var(--g-line)] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]"
			>
				{done ? <Check aria-hidden className="h-3.5 w-3.5 text-[var(--g-ok)]" /> : <Copy aria-hidden className="h-3.5 w-3.5" />}
			</button>
		</div>
	);
}

function Public_team({ scope, name, version }: { scope: string; name: string; version: string | undefined }) {
	const api_fetch = useOrgFetch();
	const [, set_search] = useSearchParams();
	const [data, set_data] = useState<TeamDetailData | null>(null);
	const [loading, set_loading] = useState(true);

	useEffect(() => {
		set_loading(true);
		api_fetch('/v1/teams/get_by_id', {
			method: 'POST',
			body: JSON.stringify({ scope: scope === '_' ? null : scope, name, version }),
		})
			.then((res) => res.json())
			.then((d) => set_data(d.ok ? d.data : null))
			.catch(() => set_data(null))
			.finally(() => set_loading(false));
	}, [api_fetch, scope, name, version]);

	const phases = useMemo(() => (data ? [
		...(data.workflow?.phases ?? []),
		...(data.workflow?.support ?? []).map((p) => ({ ...p, is_support: true })),
	].map(to_team_phase) : []), [data]);

	if (loading && !data) return <p role="status" className="py-24 text-center text-[13px] text-[var(--g-ink-3)]">Loading…</p>;
	if (!data) {
		return (
			<div className="py-24 text-center text-[13px] text-[var(--g-ink-3)]">
				<p>This team doesn’t exist or isn’t public.</p>
				<Link to="/browse" className="mt-3 inline-block text-[var(--g-acc)] hover:underline">← Back to the Marketplace</Link>
			</div>
		);
	}

	const shown = version ?? data.latest_version;
	const older = Boolean(shown && data.latest_version && shown !== data.latest_version);
	const full = data.scope ? `@${data.scope}/${data.name}` : data.name;
	const install_cmd = `cliq team install ${full}${older ? `@${shown}` : ''}`;
	const agent_names = Object.keys(data.agents ?? {});

	return (
		<>
			<nav aria-label="Breadcrumb" className="text-[12.5px] text-[var(--g-ink-3)]">
				<Link to="/browse" className="hover:text-[var(--g-ink)]">Marketplace</Link>
				<span aria-hidden className="mx-1.5">›</span>
				<span className="text-[var(--g-ink-2)]">{full}</span>
			</nav>

			<header className="flex flex-wrap items-start gap-4">
				<Team_avatar name={data.name} size={48} />
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-2">
						<h1 className="text-[22px] font-semibold tracking-tight">{data.name}</h1>
						{data.scope ? <span className="g-mono text-[13px] text-[var(--g-ink-3)]">@{data.scope}</span> : null}
						{shown ? (
							data.versions.length > 1 ? (
								<select
									aria-label="Version"
									value={shown}
									onChange={(e) => set_search(e.target.value === data.latest_version ? {} : { v: e.target.value }, { replace: true })}
									className="g-mono h-7 rounded-md border border-[var(--g-line)] bg-[var(--g-bg)] pl-2 text-[12px] text-[var(--g-ink)]"
								>
									{data.versions.map((v) => <option key={v.version} value={v.version}>v{v.version}{v.version === data.latest_version ? ' (latest)' : ''}</option>)}
								</select>
							) : <span className="g-mono rounded-[5px] bg-[var(--g-soft)] px-1.5 py-px text-[12px] text-[var(--g-ink-2)]">v{shown}</span>
						) : null}
						{older ? <span className="rounded-full bg-[var(--g-warn-soft)] px-2 py-0.5 text-[11.5px] font-semibold text-[var(--g-warn-text)]">older version</span> : null}
					</div>
					<p className="mt-1.5 max-w-3xl text-[14px] leading-relaxed text-[var(--g-ink-2)]">{data.description}</p>
					<p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-[var(--g-ink-3)]">
						{data.author ? <span>by {data.author}</span> : null}
						<span className="inline-flex items-center gap-1"><Download aria-hidden className="h-3 w-3" />{data.install_count.toLocaleString()} installs</span>
						{data.license ? <span>{data.license} license</span> : null}
						{data.tags.map((t) => <Link key={t} to={`/browse?tag=${encodeURIComponent(t)}`} className="rounded-md bg-[var(--g-soft)] px-2 py-0.5 hover:text-[var(--g-ink)]">{t}</Link>)}
					</p>
				</div>
				<Link to={`/login?redirect=${encodeURIComponent(team_href(data.scope, data.name))}`} className="rounded-lg bg-[var(--g-acc)] px-3.5 py-1.5 text-[13px] font-semibold text-[var(--g-on-acc)] hover:bg-[var(--g-acc-hover)]">Sign in to install</Link>
			</header>

			<section className={CARD} aria-label="Install">
				<h2 className={H2}>Install from the CLI</h2>
				<div className="space-y-2 p-4">
					<Copy_line text={install_cmd} />
					<p className="text-[12px] text-[var(--g-ink-3)]">Or sign in and install it into a realm, so every daemon there gets it.</p>
				</div>
			</section>

			<section className={CARD} aria-label="Workflow">
				<h2 className={`${H2} flex items-center`}>Workflow<span className="ml-2 text-[12px] font-normal text-[var(--g-ink-3)]">{phases.length} phase{phases.length === 1 ? '' : 's'}</span></h2>
				<div className="overflow-x-auto p-4"><Workflow_graph phases={phases} /></div>
				{phases.length ? <div className="border-t border-[var(--g-line)] px-4 py-2.5"><Workflow_legend phases={phases} /></div> : null}
			</section>

			<div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
				<section className={CARD} aria-label="Roles">
					<h2 className={H2}>Roles<span className="ml-2 text-[12px] font-normal text-[var(--g-ink-3)]">{data.roles.length}</span></h2>
					{data.roles.length ? (
						<div className="divide-y divide-[var(--g-line-2)]">
							{data.roles.map((r) => (
								<details key={r.name} className="group px-4 py-2.5">
									<summary className="cursor-pointer list-none text-[13px] font-medium text-[var(--g-ink)] marker:hidden">
										<span aria-hidden className="mr-2 inline-block text-[var(--g-ink-3)] transition-transform group-open:rotate-90">›</span>{r.name}
									</summary>
									<Md class_name="mt-2 pl-4">{r.content_md}</Md>
								</details>
							))}
						</div>
					) : <p className="px-4 py-6 text-[12.5px] text-[var(--g-ink-3)]">No roles in this version.</p>}
				</section>

				<section className={CARD} aria-label="Requirements">
					<h2 className={H2}>Requirements</h2>
					<dl className="space-y-3 p-4 text-[12.5px]">
						<div><dt className="text-[var(--g-ink-3)]">cliq</dt><dd className="g-mono mt-0.5">{data.cliq_version || 'any'}</dd></div>
						<div><dt className="text-[var(--g-ink-3)]">Tools</dt><dd className="mt-1 flex flex-wrap gap-1.5">{data.tools?.length ? data.tools.map((t) => <span key={t} className="g-mono rounded-md bg-[var(--g-soft)] px-1.5 py-px text-[11.5px]">{t}</span>) : 'none'}</dd></div>
						<div><dt className="text-[var(--g-ink-3)]">Agents</dt><dd className="mt-1 flex flex-wrap gap-1.5">{agent_names.length ? agent_names.map((a) => <span key={a} className="g-mono rounded-md bg-[var(--g-soft)] px-1.5 py-px text-[11.5px]">{a}</span>) : 'built-in only'}</dd></div>
					</dl>
				</section>
			</div>
		</>
	);
}

export function Component() {
	const { scope = '_', name = '' } = useParams();
	const [search] = useSearchParams();
	const { user } = useAuth();
	const version = search.get('v') || undefined;

	if (user) {
		const to = team_href(scope === '_' ? null : scope, name);
		return <Navigate to={version ? `${to}?v=${encodeURIComponent(version)}` : to} replace />;
	}
	return (
		<div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-6 py-6">
			<Public_team scope={scope} name={name} version={version} />
		</div>
	);
}
