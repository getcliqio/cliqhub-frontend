/**
 * Realm sub-navigation for realm pages. Older deep links (settings/a2a, channels…)
 * redirect to these sections.
 */
import { NavLink, useLocation } from 'react-router';
import { realm_path } from '@/lib/realm_url';
import { Realm_dot } from '@/components/graphite/graphite_shell';
import type { Overview_realm } from '@/lib/overview';

/** Realm sections, in tab order. */
const GRAPHITE: Array<{ sub: string; label: string; about?: string }> = [
	{ sub: 'inbox', label: 'Inbox' },
	{ sub: 'runs', label: 'Runs', about: 'Every run in this realm — what’s running, what needs someone, and what failed. Start a new run or open one to see each phase.' },
	{ sub: 'teams', label: 'Teams', about: 'The teams this realm can run, and how many of its daemons have each one installed. Add teams from your org or the Marketplace.' },
	{ sub: 'daemons', label: 'Daemons', about: 'The machines that run this realm’s teams. Connect a new one, see which are online, and which teams each has installed.' },
	{ sub: 'agents', label: 'Agents' },
	{ sub: 'settings', label: 'Settings', about: 'Who belongs to this realm, how its notifications go out, and how other systems can start runs here.' },
];

export function Realm_nav({ org_slug, slug, realm }: { org_slug: string; slug: string; realm?: Overview_realm | null }) {
	const base = realm_path(org_slug, slug);
	const { pathname } = useLocation();
	// What the section is for, on the section's own page (not on a run or daemon inside it).
	const about = GRAPHITE.find((g) => pathname.replace(/\/$/, '') === `${base}/${g.sub}`)?.about ?? null;
	return (
		<>
		<nav aria-label="Realm sections" className="flex flex-wrap items-center gap-1 border-b border-[var(--g-line)] px-7">
			{realm ? (
				<span className="mr-2 flex items-center gap-1.5 text-[12px] text-[var(--g-ink-3)]" data-testid="realm-health">
					<Realm_dot realm={realm} />
					{realm.daemons.total === 0 ? 'no daemons' : `${realm.daemons.online}/${realm.daemons.total} daemons`}
				</span>
			) : null}
			{GRAPHITE.map((g) => (
				<NavLink
					key={g.sub}
					to={`${base}/${g.sub}`}
					end={g.sub === 'inbox'}
					className={({ isActive }) => `-mb-px border-b-2 px-3 py-2.5 text-[13px] font-medium ${isActive ? 'border-[var(--g-acc)] text-[var(--g-ink)]' : 'border-transparent text-[var(--g-ink-3)] hover:text-[var(--g-ink)]'}`}
				>
					{g.label}
				</NavLink>
			))}
		</nav>
		{about ? <p className="px-7 pt-4 text-[13px] text-[var(--g-ink-3)]" data-testid="realm-about">{about}</p> : null}
		</>
	);
}
