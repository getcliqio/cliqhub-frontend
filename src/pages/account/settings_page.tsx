import { useState } from 'react';
import { useAuth, useAuthFetch } from '@/lib/auth_context';
import { validate_display_name, validate_email } from '@/lib/validation';

export function Component({
	section = 'all',
}: {
	section?: 'profile' | 'security' | 'all';
}) {
	const { user, refresh } = useAuth();
	const auth_fetch = useAuthFetch();

	const [display_name, set_display_name] = useState(user?.display_name ?? '');
	const [email, set_email] = useState(user?.email ?? '');
	const [profile_saving, set_profile_saving] = useState(false);
	const [profile_msg, set_profile_msg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

	const [cur_pw, set_cur_pw] = useState('');
	const [new_pw, set_new_pw] = useState('');
	const [confirm_pw, set_confirm_pw] = useState('');
	const [pw_saving, set_pw_saving] = useState(false);
	const [pw_msg, set_pw_msg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

	if (!user) return null;

	const show_profile = section === 'profile' || section === 'all';
	const show_security = section === 'security' || section === 'all';

	const profile_dirty = display_name.trim() !== user.display_name || email.trim() !== user.email;
	const pw_valid = cur_pw.length > 0 && new_pw.length >= 8 && new_pw === confirm_pw;

	async function save_profile() {
		set_profile_saving(true);
		set_profile_msg(null);

		const trimmed_name = display_name.trim();
		const trimmed_email = email.trim();

		const name_err = validate_display_name(trimmed_name);
		if (name_err) {
			set_profile_msg({ type: 'err', text: name_err });
			set_profile_saving(false);
			return;
		}

		const email_err = validate_email(trimmed_email);
		if (email_err) {
			set_profile_msg({ type: 'err', text: email_err });
			set_profile_saving(false);
			return;
		}

		const body: Record<string, string> = {};
		if (trimmed_name !== user!.display_name) body.display_name = trimmed_name;
		if (trimmed_email !== user!.email) body.email = trimmed_email;

		try {
			const res = await auth_fetch('/v1/users/update_profile', {
				method: 'POST',
				body: JSON.stringify(body),
			});
			const data = await res.json();

			if (data.ok) {
				set_profile_msg({ type: 'ok', text: 'Profile updated.' });
				await refresh();
				set_profile_saving(false);
				return;
			}
			set_profile_msg({ type: 'err', text: data.error?.message || 'Update failed' });
		} catch {
			set_profile_msg({ type: 'err', text: 'Network error' });
		}

		set_profile_saving(false);
	}

	async function save_password() {
		set_pw_saving(true);
		set_pw_msg(null);

		try {
			const res = await auth_fetch('/v1/users/change_password', {
				method: 'POST',
				body: JSON.stringify({ current_password: cur_pw, new_password: new_pw }),
			});
			const data = await res.json();

			if (data.ok) {
				set_pw_msg({ type: 'ok', text: 'Password changed.' });
				set_cur_pw('');
				set_new_pw('');
				set_confirm_pw('');
				set_pw_saving(false);
				return;
			}
			set_pw_msg({ type: 'err', text: data.error?.message || 'Password change failed' });
		} catch {
			set_pw_msg({ type: 'err', text: 'Network error' });
		}

		set_pw_saving(false);
	}

	return (
		<div className="space-y-6">
			{show_profile && (
				<div className="max-w-xl rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
					<h2 className="text-sm font-semibold">Profile</h2>
					<div className="mt-4 space-y-3">
						<label className="block text-xs font-medium text-slate-500">
							Display name
							<input
								type="text"
								value={display_name}
								onChange={(e) => set_display_name(e.target.value)}
								className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none"
							/>
						</label>
						<label className="block text-xs font-medium text-slate-500">
							Username
							<input
								type="text"
								value={user.username}
								readOnly
								className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-700"
							/>
						</label>
						<p className="-mt-1 text-xs text-slate-400">Usernames cannot be changed.</p>
						<label className="block text-xs font-medium text-slate-500">
							Email
							<input
								type="email"
								value={email}
								onChange={(e) => set_email(e.target.value)}
								className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none"
							/>
						</label>
						<div className="flex items-center justify-between pt-1 text-sm">
							<span className="text-slate-500">Site role</span>
							<span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600">
								{user.role}
							</span>
						</div>

						{profile_msg && (
							<p className={`text-xs ${profile_msg.type === 'ok' ? 'text-emerald-600' : 'text-red-500'}`}>
								{profile_msg.text}
							</p>
						)}

						<button
							type="button"
							onClick={() => void save_profile()}
							disabled={!profile_dirty || profile_saving}
							className="mt-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
						>
							{profile_saving ? 'Saving…' : 'Save profile'}
						</button>
					</div>
				</div>
			)}

			{show_security && (
				<div className="max-w-xl space-y-4">
					<div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
						<h2 className="text-sm font-semibold">Change password</h2>
						<p className="mt-1 text-xs text-slate-500">
							You’ll stay signed in on this device.
						</p>
						<div className="mt-4 space-y-3">
							<label className="block text-xs font-medium text-slate-500">
								Current password
								<input
									type="password"
									autoComplete="current-password"
									value={cur_pw}
									onChange={(e) => set_cur_pw(e.target.value)}
									className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
									placeholder="••••••••"
								/>
							</label>
							<label className="block text-xs font-medium text-slate-500">
								New password
								<input
									type="password"
									autoComplete="new-password"
									value={new_pw}
									onChange={(e) => set_new_pw(e.target.value)}
									className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
									placeholder="••••••••"
								/>
							</label>
							<label className="block text-xs font-medium text-slate-500">
								Confirm new password
								<input
									type="password"
									autoComplete="new-password"
									value={confirm_pw}
									onChange={(e) => set_confirm_pw(e.target.value)}
									className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
									placeholder="••••••••"
								/>
							</label>
							{confirm_pw.length > 0 && new_pw !== confirm_pw && (
								<p className="text-xs text-red-500">Passwords do not match.</p>
							)}

							{pw_msg && (
								<p className={`text-xs ${pw_msg.type === 'ok' ? 'text-emerald-600' : 'text-red-500'}`}>
									{pw_msg.text}
								</p>
							)}

							<button
								type="button"
								onClick={() => void save_password()}
								disabled={!pw_valid || pw_saving}
								className="mt-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
							>
								{pw_saving ? 'Updating…' : 'Update password'}
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

