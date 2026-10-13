/**
 * Top of every page under a realm: the realm header (name, status, Edit details and the
 * Teams · Runs · Settings · Daemons buttons), the same everywhere so it stays put. Older deep links
 * (settings/a2a, channels…) redirect to these sections.
 */
import { Realm_header } from '@/components/graphite/realm_header';
import type { Overview_realm } from '@/lib/overview';

export function Realm_nav({ org_slug, slug, realm }: { org_slug: string; slug: string; realm?: Overview_realm | null }) {
	return <Realm_header org_slug={org_slug} slug={slug} realm={realm ?? null} />;
}
