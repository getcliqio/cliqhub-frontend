import { useState } from 'react';

export function CopyButton({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);

	async function handle_copy() {
		await navigator.clipboard.writeText(text);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	}

	return (
		<button
			onClick={handle_copy}
			title="Copy to clipboard"
			className="rounded-lg p-1.5 text-indigo-400 transition hover:bg-indigo-100 hover:text-indigo-700"
		>
			{copied ? (
				<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
					<path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
				</svg>
			) : (
				<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
					<rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
					<path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
				</svg>
			)}
		</button>
	);
}
