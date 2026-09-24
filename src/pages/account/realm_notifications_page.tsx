import { useOutletContext } from 'react-router';
import type { Realm_outlet_context } from '@/layouts/realm_layout';
import { Rules_tab } from './notification_settings_page';

/**
 * Realm-scoped notifications page — renders the shared Rules_tab
 * with the current realm's ID, including custom event management.
 */
export function Component() {
    const { realm } = useOutletContext<Realm_outlet_context>();
    return <Rules_tab realm_id={realm.id} />;
}
