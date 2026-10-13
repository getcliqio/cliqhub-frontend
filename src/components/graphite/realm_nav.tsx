/**
 * Realm breadcrumb for the pages under a realm (runs, teams, daemons, agents, settings…): no tabs —
 * the realm page itself is the hub, and every section links back to it. Older deep links
 * (settings/a2a, channels…) redirect to these sections.
 */
import { NavLink, useLocation } from 'react-router';
import { ChevronRight } from 'lucide-react';
import { realm_path } from '@/lib/realm_url';
import { Realm_dot } from '@/components/graphite/graphite_shell';
import type { Overview_realm } from '@/lib/overview';

/** Sections under a realm, by their first path segment. */
const SECTIONS: Record<string, string> = {
	runs: 'Runs',
	teams: 'Teams',
	daemons: 'Daemons',
	workspaces: 'Daemons',
	agents: 'Agents',
	settings: 'Settings',
};

export function Realm_nav({ org_slug, slug, realm }: { org_slug: string; slug: string; realm?: Overview_realm | null }) {
	const base = realm_path(org_slug, slug);
	const { pathname } = useLocation();
	const sub = pathname.startsWith(`${base}/`) ? pathname.slice(base.length + 1).split('/')[0] : '';
	const section = SECTIONS[sub] ?? null;
	// On the realm page itself the header says everything; no breadcrumb.
	if (!section) return null;
	return (
		<nav aria-label="Realm sections" className="flex flex-wrap items-center gap-1.5 border-b border-[var(--g-line)] px-7 py-2.5 text-[13px]">
			<NavLink to={`${base}/inbox`} end className="flex items-center gap-1.5 font-medium text-[var(--g-ink-2)] hover:text-[var(--g-ink)]" data-testid="realm-home">
				{realm ? <span data-testid="realm-health" title={`${realm.daemons.online} online`}><Realm_dot realm={realm} /></span> : null}
				{realm?.name || slug}
			</NavLink>
			<ChevronRight aria-hidden className="h-3.5 w-3.5 text-[var(--g-ink-3)]" />
			<NavLink to={`${base}/${sub}`} className={({ isActive }) => `font-medium ${isActive ? 'text-[var(--g-ink)]' : 'text-[var(--g-ink-3)] hover:text-[var(--g-ink)]'}`}>
				{section}
			</NavLink>
		</nav>
	);
}
