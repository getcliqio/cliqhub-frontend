/**
 * Top of every page under a realm: the realm header's one title bar — "{title} in org.realm" — with
 * the Teams · Runs · Settings · Daemons buttons. Older deep links (settings/a2a, channels…) redirect
 * to these sections.
 */
import type { ReactNode } from 'react';
import { Realm_header } from '@/components/graphite/realm_header';
import type { Overview_realm } from '@/lib/overview';

/** @param title - The page's title ("Runs", a run's name…): shown as "{title} in org.realm". */
export function Realm_nav({ org_slug, slug, realm, title = null }: { org_slug: string; slug: string; realm?: Overview_realm | null; title?: ReactNode }) {
	return <Realm_header org_slug={org_slug} slug={slug} realm={realm ?? null} title={title} />;
}
