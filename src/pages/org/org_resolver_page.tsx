/**
 * /org[?tab=…] — Manage › Organization without an org in the URL.
 * One org (or `?org=slug`) → straight to /orgs/:id keeping ?tab; several → pick one.
 */
import { Link, Navigate, useSearchParams } from 'react-router';
import { use_overview } from '@/lib/overview';
import { Graphite_shell } from '@/components/graphite/graphite_shell';
import { Avatar } from '@/components/graphite/g_admin';

export function Component() {
	const overview = use_overview();
	const [sp] = useSearchParams();
	const orgs = overview.data?.orgs ?? [];
	const tab = sp.get('tab');
	const suffix = tab ? `?tab=${encodeURIComponent(tab)}` : '';
	const wanted = sp.get('org');
	const hit = wanted ? orgs.find((o) => o.slug === wanted || o.id === wanted) : orgs.length === 1 ? orgs[0] : null;
	if (hit) return <Navigate to={`/orgs/${hit.id}${suffix}`} replace />;
	const managed = orgs.filter((o) => o.role === 'owner' || o.role === 'admin');
	const rest = orgs.filter((o) => !managed.includes(o));
	return (
		<Graphite_shell data={overview.data} title="Organization">
			<div className="flex max-w-[640px] flex-col gap-4 px-7 py-6">
				<div><h1 className="text-[22px] font-semibold tracking-tight">Choose an organization</h1><p className="mt-1 text-[13px] text-[var(--g-ink-3)]">Members, roles, scopes and A2A are set per organization.</p></div>
				{!overview.data ? <div className="h-[160px] animate-pulse rounded-[10px] bg-[var(--g-panel)]" aria-busy="true" aria-label="Loading" /> : null}
				{overview.data && !orgs.length ? <p className="text-[13px] text-[var(--g-ink-3)]">You’re not in any organization yet.</p> : null}
				{[['You manage', managed], ['Member of', rest]].map(([label, list]) => (list as typeof orgs).length ? (
					<section key={label as string} aria-label={label as string} className="flex flex-col gap-1.5">
						<div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--g-ink-3)]">{label as string}</div>
						{(list as typeof orgs).map((o) => (
							<Link key={o.id} to={`/orgs/${o.id}${suffix}`} className="flex items-center gap-3 rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)] px-4 py-3 hover:border-[var(--g-acc-line)]" data-testid={`pick-org-${o.slug}`}>
								<Avatar name={o.display_name || o.slug} size={28} />
								<b className="font-semibold">{o.display_name || o.slug}</b>
								<span className="text-[12.5px] text-[var(--g-ink-3)]">{o.role} · {o.realms.length} realm{o.realms.length === 1 ? '' : 's'}</span>
								<span className="ml-auto text-[var(--g-ink-3)]">→</span>
							</Link>
						))}
					</section>
				) : null)}
			</div>
		</Graphite_shell>
	);
}
