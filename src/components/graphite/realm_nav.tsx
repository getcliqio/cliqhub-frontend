/**
 * Realm sub-navigation for realm pages. Older deep links (settings/a2a, channels…)
 * redirect to these sections.
 */
import { daemon_summary } from '@/lib/overview';
import { NavLink } from 'react-router';
import { realm_path } from '@/lib/realm_url';
import { Realm_dot } from '@/components/graphite/graphite_shell';
import type { Overview_realm } from '@/lib/overview';

/** Realm sections, in tab order. */
const GRAPHITE: Array<{ sub: string; label: string }> = [
	{ sub: 'inbox', label: 'Inbox' },
	{ sub: 'runs', label: 'Runs' },
	{ sub: 'teams', label: 'Teams' },
	{ sub: 'daemons', label: 'Daemons' },
	{ sub: 'agents', label: 'Agents' },
	{ sub: 'settings', label: 'Settings' },
];

export function Realm_nav({ org_slug, slug, realm }: { org_slug: string; slug: string; realm?: Overview_realm | null }) {
	const base = realm_path(org_slug, slug);
	return (
		<nav aria-label="Realm sections" className="flex flex-wrap items-center gap-1 border-b border-[var(--g-line)] px-7">
			{realm ? (
				<span className="mr-2 flex items-center gap-1.5 text-[12px] text-[var(--g-ink-3)]" data-testid="realm-health">
					<Realm_dot realm={realm} />
					{daemon_summary(realm.daemons)}
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
	);
}
