/** Realm › Settings — types for `POST /v1/realm_settings/get`. */
export interface Realm_settings_data {
	realm: { id: string; slug: string; name: string; org_slug: string | null };
	you: { role: string | null; is_admin: boolean };
	members: Array<{ member_type: string; member_id: string; username: string | null; role: string; is_you: boolean }>;
	invites: Array<{ invite_id: string; email: string; role: string; expires_at: string | null }>;
	tokens: Array<{ id: string; name: string; created_at: string; last_used_at: string | null }>;
	sections: Record<'members' | 'invites' | 'tokens', { status: 'ok' | 'error'; error: string | null }>;
	partial: boolean;
}

export type Settings_section = 'general' | 'members' | 'tokens' | 'a2a' | 'danger';

export const REALM_ROLES: Array<{ id: string; label: string; hint: string }> = [
	{ id: 'admin', label: 'Admin', hint: 'change settings, members and rules' },
	{ id: 'operator', label: 'Operator', hint: 'run teams and provide input' },
	{ id: 'member', label: 'Member', hint: 'view' },
];
