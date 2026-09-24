import { useState } from 'react';
import { useBuilder } from '@/lib/builder/store';
import { generate_team_zip } from '@/lib/team_export';

export function DownloadButton() {
	const state = useBuilder();
	const [downloading, setDownloading] = useState(false);

	const disabled = !state.team || !state.team.name || state.team.phases.length === 0;

	async function handle_download() {
		if (!state.team || disabled) return;
		setDownloading(true);
		try {
			const blob = await generate_team_zip({
				...state.team,
				roles: state.team.roles.map(r => ({ name: r.name, content: r.content })),
			});
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `${state.team.name}.zip`;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
		} finally {
			setDownloading(false);
		}
	}

	return (
		<button
			onClick={handle_download}
			disabled={disabled || downloading}
			className="rounded-md border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
		>
			{downloading ? 'Downloading...' : 'Download'}
		</button>
	);
}
