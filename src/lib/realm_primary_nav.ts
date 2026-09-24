/**
 * Primary realm icon-nav items.
 * Paths are relative to `/realms/:slug`.
 * `icon` matches a lucide-react export name.
 */
export const REALM_PRIMARY_NAV = [
	{ to: 'teams', end: false, label: 'Teams', icon: 'Users' },
	{ to: 'runs', end: false, label: 'Runs', icon: 'Play' },
	{ to: 'daemons', end: false, label: 'Daemons', icon: 'Server' },
	{ to: 'agents', end: false, label: 'Agents', icon: 'Sliders' },
	{ to: 'channels', end: false, label: 'Channels', icon: 'Send' },
	{ to: 'notifications', end: false, label: 'Notifications', icon: 'Bell' },
	{ to: 'settings', end: false, label: 'Settings', icon: 'Settings' },
] as const;

export type Realm_primary_nav_item = (typeof REALM_PRIMARY_NAV)[number];

export function realm_primary_nav_labels(): string[] {
	return REALM_PRIMARY_NAV.map((item) => item.label);
}
