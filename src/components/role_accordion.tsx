import { useState } from 'react';
import type { RoleDetail } from '@/lib/types';
import { RenderedMarkdown } from '@/components/rendered_markdown';

function extract_first_heading(md: string): string | null {
	const match = md.match(/^#\s+(?:Role:\s*)?(.+)$/m);
	return match ? match[1].trim() : null;
}

function extract_summary(md: string): string | null {
	const lines = md.split('\n');
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('---') && trimmed.length > 20) {
			return trimmed.length > 160 ? trimmed.slice(0, 157) + '...' : trimmed;
		}
	}
	return null;
}

export function RoleAccordion({ roles }: { roles: RoleDetail[] }) {
	const [expanded, setExpanded] = useState<string | null>(null);

	if (!roles || roles.length === 0) return null;

	return (
		<div className="divide-y divide-slate-200 rounded-xl border border-slate-200">
			{roles.map((role) => {
				const heading = extract_first_heading(role.content_md);
				const summary = extract_summary(role.content_md);
				const is_open = expanded === role.name;

				return (
					<div key={role.name}>
						<button
							onClick={() => setExpanded(is_open ? null : role.name)}
							className="flex w-full items-center justify-between px-5 py-4 text-left hover:bg-slate-50"
						>
							<div>
								<span className="font-mono text-base font-bold text-slate-900">{role.name}</span>
								{heading && heading.toLowerCase() !== role.name.toLowerCase() && (
									<span className="ml-2 text-sm text-slate-600">{heading}</span>
								)}
								{!is_open && summary && (
									<p className="mt-1 text-sm text-slate-600">{summary}</p>
								)}
							</div>
							<svg
								className={`h-5 w-5 shrink-0 text-slate-400 transition ${is_open ? 'rotate-180' : ''}`}
								fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
							>
								<path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
							</svg>
						</button>

						{is_open && (
							<div className="border-t border-slate-200 bg-slate-100 px-6 py-5">
								<RenderedMarkdown content={role.content_md} />
							</div>
						)}
					</div>
				);
			})}
		</div>
	);
}
