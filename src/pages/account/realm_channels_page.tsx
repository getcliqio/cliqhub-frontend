import { useOutletContext } from 'react-router';
import type { Realm_outlet_context } from '@/layouts/realm_layout';
import { Channels_tab } from './notification_settings_page';

/**
 * Realm-scoped channels page — renders the shared Channels_tab
 * with the current realm's ID so channels are scoped to the realm.
 */
export function Component() {
    const { realm } = useOutletContext<Realm_outlet_context>();
    return <Channels_tab realm_id={realm.id} />;
}
