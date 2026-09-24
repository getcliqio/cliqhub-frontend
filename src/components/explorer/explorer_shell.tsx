import type { FormEvent, ReactNode } from 'react';
import type { Time_preset } from './use_explorer_params';

const PRESETS: ReadonlyArray<{ id: Time_preset; label: string }> = [
	{ id: '1h', label: '1h' },
	{ id: '6h', label: '6h' },
	{ id: '24h', label: '24h' },
	{ id: '7d', label: '7d' },
	{ id: 'all', label: 'All' },
];

interface Explorer_shell_props {
	query: string;
	on_query_change: (value: string) => void;
	on_submit_query: (value: string) => void;
	query_placeholder?: string;
	time: Time_preset;
	on_time_change: (preset: Time_preset) => void;
	live?: boolean;
	on_live_change?: (on: boolean) => void;
	on_refresh?: () => void;
	sidebar?: ReactNode;
	children: ReactNode;
	toolbar_extra?: ReactNode;
}

export function Explorer_shell({
	query,
	on_query_change,
	on_submit_query,
	query_placeholder = 'Filter…',
	time,
	on_time_change,
	live,
	on_live_change,
	on_refresh,
	sidebar,
	children,
	toolbar_extra,
}: Explorer_shell_props) {
	function on_submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		on_submit_query(query);
	}

	return (
		<div className="space-y-4">
			<form
				onSubmit={on_submit}
				className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3"
			>
				<input
					value={query}
					onChange={(e) => on_query_change(e.target.value)}
					placeholder={query_placeholder}
					aria-label="Search"
					className="min-w-[12rem] flex-1 rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm"
				/>
				<div className="flex flex-wrap items-center gap-1" role="group" aria-label="Time range">
					{PRESETS.map((p) => (
						<button
							key={p.id}
							type="button"
							onClick={() => on_time_change(p.id)}
							className={`rounded-md px-2.5 py-1.5 text-xs font-semibold ${
								time === p.id
									? 'bg-indigo-600 text-white'
									: 'border border-slate-200 text-slate-600 hover:bg-slate-50'
							}`}
						>
							{p.label}
						</button>
					))}
				</div>
				{on_live_change ? (
					<label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
						<input
							type="checkbox"
							checked={live === true}
							onChange={(e) => on_live_change(e.target.checked)}
							className="accent-indigo-600"
						/>
						Live
					</label>
				) : null}
				{on_refresh ? (
					<button
						type="button"
						onClick={on_refresh}
						className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
					>
						Refresh
					</button>
				) : null}
				<button
					type="submit"
					className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
				>
					Apply
				</button>
				{toolbar_extra}
			</form>

			<div className="flex flex-col gap-4 lg:flex-row">
				{sidebar}
				<div className="min-w-0 flex-1">{children}</div>
			</div>
		</div>
	);
}
