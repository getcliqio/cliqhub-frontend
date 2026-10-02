/**
 * Invite building blocks (Graphite): status pills for orgs, members and
 * accounts; the "email sent, or copy this link" outcome; the Waiting-for-owner
 * banner; the org / realm invite hook, which sends `invitations/create`
 * (sending to a pending invite again is the same call); and the org invite form.
 */
import { useState, type FormEvent, type ReactNode } from 'react';
import { Mail } from 'lucide-react';
import { as_deleted_details, type Deleted_details, type Member_status, type Org_status, type User_status } from '@/lib/admin';
import { ORG_INVITE_ROLES, day_month, looks_like_email, role_label, type Invite_create_data, type Org_invite_role } from '@/lib/invites';
import { Pill } from '@/components/graphite/g_admin';
import { G_BTN, G_INPUT, G_PRIMARY, use_post } from '@/components/graphite/g_agents';
import { Deleted_notice } from '@/components/graphite/g_reactivate';

const ORG_STATUS: Record<Org_status, { tone: 'ok' | 'warn' | 'muted'; label: string }> = {
	active: { tone: 'ok', label: 'Active' },
	waiting_for_owner: { tone: 'warn', label: 'Waiting for owner' },
	deleted: { tone: 'muted', label: 'Deleted' },
};
const MEMBER_STATUS: Record<Member_status, { tone: 'ok' | 'warn' | 'muted'; label: string }> = {
	active: { tone: 'ok', label: 'Active' },
	pending: { tone: 'warn', label: 'Pending' },
	deleted: { tone: 'muted', label: 'Deleted' },
};
const ACCOUNT_STATUS: Record<User_status, { tone: 'ok' | 'run' | 'bad' | 'muted'; label: string }> = {
	invited: { tone: 'run', label: 'Invited' },
	active: { tone: 'ok', label: 'Active' },
	suspended: { tone: 'bad', label: 'Suspended' },
	deleted: { tone: 'muted', label: 'Deleted' },
};

export function Org_status_pill({ status }: { status: Org_status }) {
	const m = ORG_STATUS[status] ?? ORG_STATUS.active;
	return <Pill tone={m.tone}>{m.label}</Pill>;
}

export function Member_status_pill({ status }: { status: Member_status }) {
	const m = MEMBER_STATUS[status] ?? MEMBER_STATUS.active;
	return <Pill tone={m.tone}>{m.label}</Pill>;
}

export function Account_status_pill({ status }: { status: User_status }) {
	const m = ACCOUNT_STATUS[status] ?? ACCOUNT_STATUS.active;
	return <Pill tone={m.tone}>{m.label}</Pill>;
}

/**
 * Says an email went out, or — when email isn't set up (`email_sent: false`) —
 * shows the link with a Copy button so the admin can send it themselves.
 */
export function Sent_or_link({ email_sent, url, sent, children }: { email_sent: boolean; url: string | null; sent: ReactNode; children?: ReactNode }) {
	const [copied, set_copied] = useState(false);
	async function copy(text: string) {
		try { await navigator.clipboard.writeText(text); set_copied(true); setTimeout(() => set_copied(false), 1500); } catch { /* clipboard unavailable */ }
	}
	if (email_sent || !url) {
		return <div role="status" data-testid="sent-result" className="w-full rounded-[10px] border border-[rgba(62,207,142,.35)] bg-[var(--g-ok-soft)] px-3.5 py-2.5 text-[12.5px]">{sent}{children}</div>;
	}
	return (
		<div role="status" data-testid="link-fallback" className="flex w-full flex-col gap-2 rounded-[10px] border border-[rgba(255,178,36,.4)] bg-[var(--g-warn-soft)] px-3.5 py-2.5 text-[12.5px]">
			<p>Email isn’t set up, so nothing was sent. Copy this link and send it yourself:</p>
			<div className="flex flex-wrap gap-2">
				<code className="g-mono min-w-0 flex-1 truncate rounded-lg border border-[var(--g-line)] bg-[var(--g-bg)] px-3 py-1.5 text-[12px]" data-testid="fallback-url">{url}</code>
				<button type="button" onClick={() => void copy(url)} className={G_BTN}>{copied ? 'Copied' : 'Copy link'}</button>
			</div>
			{children}
		</div>
	);
}

/** "Waiting for owner": the org exists, its owner hasn't accepted the invite (`pending_owner_invite`) yet. */
export function Waiting_owner_banner({ invite }: { invite: { email: string; expires_at: string } | null }) {
	return (
		<div role="status" data-testid="waiting-owner" className="flex flex-wrap items-center gap-3 rounded-[10px] border border-[rgba(255,178,36,.4)] bg-[var(--g-warn-soft)] px-4 py-3">
			<Mail aria-hidden className="h-4 w-4 text-[var(--g-warn-text)]" />
			<div className="min-w-0 flex-1">
				<b className="text-[13.5px]">Waiting for owner</b>
				<p className="text-[12.5px] text-[var(--g-ink-2)]">
					{invite ? <><b>{invite.email}</b> was invited to own this org and hasn’t accepted yet. The invite expires {day_month(invite.expires_at)}.</> : 'The owner hasn’t accepted the invite yet.'}
				</p>
			</div>
		</div>
	);
}

type Invite_outcome =
	| { kind: 'sent'; data: Invite_create_data }
	| { kind: 'error'; text: string }
	| { kind: 'deleted'; email: string; role: string; details: Deleted_details | null };

/** Where an invite goes: an org, or a realm (whose org it also joins). */
export type Invite_target = { target_type: 'org'; org_id: string } | { target_type: 'realm'; realm_id: string };

/**
 * Sends org or realm invites through `invitations/create` and keeps the
 * outcome: sent / sent again (or the copy-link fallback), "already a member",
 * or the deleted-account prompt. `send` is also "Send again" for a pending
 * invite; `on_sent` gets the created invite.
 */
export function use_invite(target: Invite_target, on_sent: (data: Invite_create_data) => Promise<void>) {
	const post = use_post();
	const [busy, set_busy] = useState(false);
	const [outcome, set_outcome] = useState<Invite_outcome | null>(null);
	async function send(email: string, role: string, reactivate = false): Promise<boolean> {
		set_busy(true); set_outcome(null);
		const r = await post('/v1/invitations/create', { ...target, email, role, ...(reactivate ? { reactivate: true } : {}) });
		set_busy(false);
		if (!r.ok) {
			if (r.code === 'deleted') set_outcome({ kind: 'deleted', email, role, details: as_deleted_details(r.details) });
			else if (r.code === 'already_member') set_outcome({ kind: 'error', text: `${email} is already a member.` });
			else set_outcome({ kind: 'error', text: r.error });
			return false;
		}
		const data = r.data as Invite_create_data;
		set_outcome({ kind: 'sent', data });
		await on_sent(data);
		return true;
	}
	const view = outcome == null ? null
		: outcome.kind === 'sent' ? (
			<Sent_or_link email_sent={outcome.data.email_sent} url={outcome.data.invite_url} sent={<>{outcome.data.resent ? 'Invite sent again to' : 'Invite sent to'} <b>{outcome.data.email}</b>.</>} />
		) : outcome.kind === 'deleted' ? (
			<Deleted_notice name={outcome.email} details={outcome.details} busy={busy} on_reactivate={() => void send(outcome.email, outcome.role, true)} on_cancel={() => set_outcome(null)} />
		) : <p role="alert" className="w-full text-[12.5px] text-[var(--g-bad)]">{outcome.text}</p>;
	return { busy, send, view };
}

type Invite = ReturnType<typeof use_invite>;

/** Email + role + Invite, then the outcome. `owner` is offered only to org owners and site admins. */
export function Org_invite_form({ invite, can_invite_owner }: { invite: Invite; can_invite_owner: boolean }) {
	const [email, set_email] = useState('');
	const [role, set_role] = useState<Org_invite_role>('member');
	const roles = ORG_INVITE_ROLES.filter((r) => r !== 'owner' || can_invite_owner);
	async function submit(e: FormEvent) {
		e.preventDefault();
		if (await invite.send(email.trim(), role)) set_email('');
	}
	return (
		<div className="flex flex-col gap-2">
			<form onSubmit={(e) => void submit(e)} aria-label="Invite" className="flex flex-wrap items-center gap-2">
				<input aria-label="Email to invite" type="email" value={email} onChange={(e) => set_email(e.target.value)} placeholder="name@company.com" className={`${G_INPUT} w-[280px]`} />
				<select aria-label="Invite as" value={role} onChange={(e) => set_role(e.target.value as Org_invite_role)} className={`${G_INPUT} w-[130px]`}>
					{roles.map((r) => <option key={r} value={r}>{role_label(r)}</option>)}
				</select>
				<button type="submit" disabled={invite.busy || !looks_like_email(email)} className={G_PRIMARY}>Invite</button>
			</form>
			{invite.view}
		</div>
	);
}
