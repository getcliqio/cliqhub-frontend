/**
 * Every page inside a realm sits in the realm layout (components/graphite/realm_header.tsx): the
 * realm's header, its left nav (Teams · Runs · Daemons · Settings, with signals) and the page beside
 * it. Older deep links (settings/a2a, channels…) redirect to these sections.
 */
import type { ReactNode } from 'react';
import { Realm_header } from '@/components/graphite/realm_header';
import type { Overview_realm } from '@/lib/overview';

/**
 * @param item - The open run / team / daemon / workspace, nested under its section in the left nav.
 * @param off - Render just the page (a page that is only sometimes inside a realm, e.g. a team).
 */
export function Realm_nav({ org_slug, slug, realm, item = null, off = false, children = null }: {
	org_slug: string; slug: string; realm?: Overview_realm | null; item?: ReactNode; off?: boolean; children?: ReactNode;
}) {
	if (off) return <>{children}</>;
	return <Realm_header org_slug={org_slug} slug={slug} realm={realm ?? null} item={item}>{children}</Realm_header>;
}
