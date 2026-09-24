import { useState, type ReactNode } from 'react';

/**
 * Shown once, right after a token is minted. Contains the plaintext
 * secret — the API doesn't store it and won't return it again.
 *
 * When `on_dismiss` is provided the banner becomes a mini
 * safety-modal: the "I have saved this token" checkbox must be
 * ticked before the Done button will fire the dismiss (slice 5.6
 * for user PATs). Callers that intentionally leave the reveal
 * on-screen until an external state change clears it (e.g. realm
 * daemon-token wizard where the reveal disappears once the user
 * closes the wizard) can omit `on_dismiss` and keep the pre-slice
 * behaviour.
 */
export function NewTokenBanner({
	token,
	env_var,
	permissions_summary,
	on_dismiss,
}: {
	token: string;
	env_var?: string;
	/**
	 * Optional summary of what this token can do — org / realm
	 * bindings from the grant. Rendered above the checkbox so users
	 * can double-check they minted the right thing before confirming.
	 */
	permissions_summary?: ReactNode;
	/**
	 * Present = safety-modal mode. Fired when the user has confirmed
	 * they've saved the token. Absent = classic always-visible reveal.
	 */
	on_dismiss?: () => void;
}) {
	const [copied, set_copied] = useState(false);
	const [confirmed, set_confirmed] = useState(false);
	const export_line = env_var ? `export ${env_var}=${token}` : null;
	const dismissible = typeof on_dismiss === 'function';

	function handle_copy(text: string) {
		navigator.clipboard.writeText(text);
		set_copied(true);
		setTimeout(() => set_copied(false), 2000);
	}

	return (
		<div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
			<p className="mb-2 text-xs font-semibold text-amber-700">
				Copy this token now — you won&apos;t be able to see it again.
			</p>
			<div className="flex items-center gap-2">
				<code className="flex-1 break-all rounded-lg bg-white px-3 py-2 text-xs font-mono text-slate-800">
					{token}
				</code>
				<button
					type="button"
					onClick={() => handle_copy(token)}
					className="shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
				>
					{copied ? 'Copied!' : 'Copy'}
				</button>
			</div>
			{export_line && (
				<p className="mt-2 text-[11px] text-amber-800">
					<span className="font-semibold">{env_var}</span>
					{' — '}
					<button
						type="button"
						onClick={() => handle_copy(export_line)}
						className="font-mono underline hover:no-underline"
					>
						copy export line
					</button>
				</p>
			)}

			{permissions_summary ? (
				<div
					data-testid="new-token-permissions-summary"
					className="mt-3 border-t border-amber-200/70 pt-3 text-[11px] text-amber-900"
				>
					{permissions_summary}
				</div>
			) : null}

			{dismissible ? (
				<div className="mt-4 flex items-center justify-between gap-3 border-t border-amber-200/70 pt-3">
					<label className="flex items-center gap-2 text-[11px] font-medium text-amber-900">
						<input
							type="checkbox"
							data-testid="new-token-saved-checkbox"
							checked={confirmed}
							onChange={(e) => set_confirmed(e.target.checked)}
							className="h-3.5 w-3.5 rounded border-amber-400 accent-amber-600"
						/>
						I have saved this token in a secure place.
					</label>
					<button
						type="button"
						data-testid="new-token-done-button"
						disabled={!confirmed}
						onClick={on_dismiss}
						className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-40"
					>
						Done
					</button>
				</div>
			) : null}
		</div>
	);
}
