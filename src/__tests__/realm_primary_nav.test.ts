import { describe, it, expect } from 'vitest';
import { REALM_PRIMARY_NAV, realm_primary_nav_labels } from '@/lib/realm_primary_nav';

describe('realm_primary_nav', () => {
    it('exposes Teams-first icon nav in order', () => {
        expect(realm_primary_nav_labels()).toEqual([
            'Teams',
            'Runs',
            'Daemons',
            'Agents',
            'Channels',
            'Notifications',
            'Settings',
        ]);
    });

    it('maps Daemons to daemons path', () => {
        const daemons = REALM_PRIMARY_NAV.find((item) => item.label === 'Daemons');
        expect(daemons?.to).toBe('daemons');
    });

    it('maps Settings to settings path (renamed from Security)', () => {
        const settings = REALM_PRIMARY_NAV.find((item) => item.label === 'Settings');
        expect(settings?.to).toBe('settings');
        expect(realm_primary_nav_labels()).not.toContain('Security');
    });

    it('maps Notifications to notifications path (per-realm inbox)', () => {
        const notif = REALM_PRIMARY_NAV.find((item) => item.label === 'Notifications');
        expect(notif?.to).toBe('notifications');
    });

    it('does not include Overview or Logs in primary nav', () => {
        const labels = realm_primary_nav_labels();
        expect(labels).not.toContain('Overview');
        expect(labels).not.toContain('Logs');
    });

    it('each nav item has an icon reference', () => {
        for (const item of REALM_PRIMARY_NAV) {
            expect(item.icon).toBeTruthy();
        }
    });
});
