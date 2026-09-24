import type { ReactNode } from 'react';
import {
	type Channel_provider,
	USER_CHANNEL_PROVIDERS,
	provider_meta,
} from '@/lib/channel_providers';

interface Channel_provider_form_props {
	provider: Channel_provider;
	name: string;
	fields: Record<string, string>;
	disabled?: boolean;
	on_provider_change: (provider: Channel_provider) => void;
	on_name_change: (name: string) => void;
	on_field_change: (key: string, value: string) => void;
}

function Field({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}) {
	return (
		<label className="block text-xs font-semibold text-slate-600">
			{label}
			<div className="mt-1">{children}</div>
		</label>
	);
}

const input_class =
	'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400';

export function Channel_provider_form({
	provider,
	name,
	fields,
	disabled = false,
	on_provider_change,
	on_name_change,
	on_field_change,
}: Channel_provider_form_props) {
	return (
		<div className="space-y-4">
			<Field label="Name">
				<input
					value={name}
					disabled={disabled}
					onChange={(e) => on_name_change(e.target.value)}
					placeholder="ops-alerts"
					className={input_class}
				/>
			</Field>

			<div>
				<p className="text-xs font-semibold text-slate-600">Provider</p>
				<div className="mt-2 grid gap-2 sm:grid-cols-2">
					{USER_CHANNEL_PROVIDERS.map((meta) => {
						const Icon = meta.icon;
						const active = provider === meta.id;
						return (
							<button
								key={meta.id}
								type="button"
								disabled={disabled}
								onClick={() => on_provider_change(meta.id)}
								className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition ${
									active
										? 'border-indigo-300 bg-indigo-50'
										: 'border-slate-200 bg-white hover:border-slate-300'
								}`}
							>
								<Icon
									className={`mt-0.5 h-4 w-4 shrink-0 ${active ? 'text-indigo-600' : 'text-slate-400'}`}
									strokeWidth={1.75}
									aria-hidden
								/>
								<span>
									<span className={`block text-sm font-semibold ${active ? 'text-indigo-800' : 'text-slate-800'}`}>
										{meta.label}
									</span>
									<span className="mt-0.5 block text-[11px] leading-snug text-slate-500">
										{meta.description}
									</span>
								</span>
							</button>
						);
					})}
				</div>
			</div>

			{provider === 'slack' ? (
				<Field label="Webhook URL">
					<input
						type="url"
						value={fields.webhook_url ?? ''}
						disabled={disabled}
						onChange={(e) => on_field_change('webhook_url', e.target.value)}
						placeholder="https://hooks.slack.com/services/…"
						className={input_class}
					/>
				</Field>
			) : null}

			{provider === 'webhook' ? (
				<Field label="Endpoint URL">
					<input
						type="url"
						value={fields.url ?? ''}
						disabled={disabled}
						onChange={(e) => on_field_change('url', e.target.value)}
						placeholder="https://example.com/hooks/cliq"
						className={input_class}
					/>
				</Field>
			) : null}

			{provider === 'email' ? (
				<div className="space-y-3">
					<p className="rounded-lg border border-slate-100 bg-white px-3 py-2 text-xs text-slate-500">
						Hub sends email for you — only recipients are required.
					</p>
					<Field label="To">
						<input
							type="text"
							value={fields.to ?? ''}
							disabled={disabled}
							onChange={(e) => on_field_change('to', e.target.value)}
							placeholder="ops@example.com, oncall@example.com"
							className={input_class}
						/>
					</Field>
					<Field label="Cc (optional)">
						<input
							type="text"
							value={fields.cc ?? ''}
							disabled={disabled}
							onChange={(e) => on_field_change('cc', e.target.value)}
							placeholder="leads@example.com"
							className={input_class}
						/>
					</Field>
					<Field label="Bcc (optional)">
						<input
							type="text"
							value={fields.bcc ?? ''}
							disabled={disabled}
							onChange={(e) => on_field_change('bcc', e.target.value)}
							placeholder="audit@example.com"
							className={input_class}
						/>
					</Field>
				</div>
			) : null}

			<p className="flex items-center gap-1.5 text-[11px] text-slate-400">
				{(() => {
					const Icon = provider_meta(provider).icon;
					return <Icon className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />;
				})()}
				{provider_meta(provider).label} channel for this realm
			</p>
		</div>
	);
}
