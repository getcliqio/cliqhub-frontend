/**
 * Invitations — wire types for the BFF routes invitations/create,
 * invitations/get_by_token and invitations/accept, the invite rows that
 * `org_page/get` carries, and small display helpers shared by the invite screens.
 */

/** Roles an org invite can carry (`operator` is a realm role). */
export const ORG_INVITE_ROLES = ['member', 'admin', 'owner'] as const;
export type Org_invite_role = typeof ORG_INVITE_ROLES[number];

export type Invite_status = 'pending' | 'accepted' | 'declined' | 'revoked' | 'expired';
export type Invite_kind = 'org' | 'realm' | 'owner';

/** `invitations/create` response (sending to a pending invite again answers `resent: true`). */
export interface Invite_create_data {
	invite_id: string;
	status: 'pending';
	email: string;
	role: string;
	expires_at: string;
	resent: boolean;
	email_sent: boolean;
	/** Set only when the email could not be sent. */
	invite_url: string | null;
}

/** One pending invite of `org_page/get`. */
export interface Invite_row {
	invite_id: string;
	email: string;
	role: string;
	kind: Invite_kind;
	status: Invite_status;
	inviter: { id: string; display_name: string } | null;
	send_count: number;
	last_sent_at: string | null;
	expires_at: string;
	created_at: string;
}

/** `invitations/get_by_token` — the public preview behind the email link. */
export interface Invite_preview {
	invite_id: string;
	kind: Invite_kind;
	status: Invite_status;
	/** The org (a realm invite's parent org). */
	org: { slug: string; display_name: string };
	realm: { slug: string; display_name: string } | null;
	role: string;
	inviter: { display_name: string } | null;
	invitee_email: string;
	/** false → the page offers the new-account form. */
	account_exists: boolean;
	expires_at: string;
}

/**
 * `invitations/accept` response. `user.username` is the account's username:
 * a reactivated invitee keeps the one they had, whatever the form sent.
 */
export type Invite_accept_data =
	| {
		decision: 'accept';
		/** `created`: the invited account was activated by this accept. */
		user: { id: string; username: string; status: 'active'; created: boolean };
		/** The org joined (a realm invite also joins the realm's org). */
		org: { id: string; slug: string };
		realm: { id: string; slug: string } | null;
		membership: { role: string; status: string };
	}
	| { decision: 'decline' };

/** "Member", "Owner", … */
export function role_label(role: string): string {
	return role ? role[0].toUpperCase() + role.slice(1) : role;
}

/** "16 Oct" (or "16 Oct 2027" outside the current year). */
export function day_month(iso: string | null | undefined, now: Date = new Date()): string {
	if (!iso) return '—';
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '—';
	const opts: Intl.DateTimeFormatOptions = d.getFullYear() === now.getFullYear()
		? { day: 'numeric', month: 'short' }
		: { day: 'numeric', month: 'short', year: 'numeric' };
	return d.toLocaleDateString('en-GB', opts);
}

/** Loose email check for enabling "Invite … by email". */
export function looks_like_email(v: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}
