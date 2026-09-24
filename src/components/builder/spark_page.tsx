import { useRef, useState } from 'react';
import { useBuilder, useBuilderDispatch } from '@/lib/builder/store';
import { empty_builder_team } from '@/lib/builder/empty_team';
import { SAMPLE_TEAMS } from '@/lib/builder/sample_teams';
import { parse_team_yml_text } from '@/lib/team_yml_parse';
import { useAuthFetch } from '@/lib/auth_context';
import { HelpTip } from '@/components/ui/help_tip';
import { PAGE_HELP } from '@/lib/page_help';

type StartTab = 'ai' | 'scratch' | 'templates' | 'upload' | 'yaml';

const STAGE_LABELS: Record<string, string> = {
	queued: 'Queued…',
	designing: 'Designing phases…',
	filling_roles: 'Writing role prompts…',
	validating: 'Validating team…',
	done: 'Done',
	error: 'Failed',
};

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

const EXAMPLES = [
	{ label: 'TDD API Team', intent: 'A test-driven development team for building REST APIs with TypeScript, including architecture, testing, implementation, and code review with automated quality gates' },
	{ label: 'Data Pipeline', intent: 'A team for building ETL data pipelines — schema design, extraction logic, transformation rules, loading, and data quality validation' },
	{ label: 'Mobile App', intent: 'A cross-platform mobile app team with UX design, component architecture, implementation, integration testing, and app store preparation' },
	{ label: 'Documentation', intent: 'A technical documentation team that produces API docs, tutorials, and architecture diagrams from existing codebases' },
	{ label: 'Security Audit', intent: 'A security audit team that reviews code for vulnerabilities, checks dependencies, validates auth flows, and produces a security report' },
	{ label: 'DevOps Pipeline', intent: 'A DevOps team for setting up CI/CD pipelines, containerization, infrastructure-as-code, monitoring, and deployment automation' },
];

function tab_class(active: boolean): string {
	if (active) {
		return 'border-indigo-600 text-indigo-700 dark:border-indigo-400 dark:text-indigo-300';
	}
	return 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200';
}

async function read_api_error(res: Response): Promise<string> {
	const text = await res.text();
	try {
		const data = JSON.parse(text) as { error?: { message?: string } | string };
		if (typeof data.error === 'string' && data.error.trim()) return data.error;
		if (data.error && typeof data.error === 'object' && data.error.message) {
			return data.error.message;
		}
	} catch {
		/* non-JSON (gateway timeout HTML, etc.) */
	}
	if (res.status === 504 || res.status === 502) {
		return 'Builder timed out talking to the model — try again, or use From scratch / Templates.';
	}
	if (res.status === 401) {
		return 'Sign in required to use AI generate.';
	}
	if (!text.trim()) {
		return `Request failed (HTTP ${res.status})`;
	}
	return text.slice(0, 200);
}

/**
 * Multi-path builder entry — mirrors desktop CliqHub Builder:
 * From scratch · Templates · Upload · YAML · AI Generate.
 */
export function SparkPage() {
	const state = useBuilder();
	const dispatch = useBuilderDispatch();
	const auth_fetch = useAuthFetch();
	const [tab, set_tab] = useState<StartTab>('ai');
	const [intent, set_intent] = useState('');
	const [yaml_text, set_yaml_text] = useState('');
	const [local_error, set_local_error] = useState<string | null>(null);
	const [generate_stage, set_generate_stage] = useState<string | null>(null);
	const file_ref = useRef<HTMLInputElement>(null);

	function open_team_from_yaml(text: string) {
		const base = empty_builder_team();
		const { team, error } = parse_team_yml_text(text, base);
		if (error) {
			set_local_error(error);
			dispatch({ type: 'SET_ERROR', error });
			return;
		}
		set_local_error(null);
		dispatch({ type: 'SET_ERROR', error: null });
		dispatch({ type: 'SET_TEAM', team, validation: null });
	}

	function start_blank() {
		set_local_error(null);
		dispatch({ type: 'SET_ERROR', error: null });
		dispatch({ type: 'SET_TEAM', team: empty_builder_team(), validation: null });
	}

	async function handle_generate() {
		const text = intent.trim();
		if (!text) return;

		dispatch({ type: 'SET_GENERATING', generating: true });
		set_local_error(null);
		set_generate_stage('queued');

		try {
			const res = await auth_fetch('/v1/teams/build', {
				method: 'POST',
				body: JSON.stringify({ action: 'generate', intent: text }),
			});

			if (!res.ok) {
				const message = await read_api_error(res);
				set_local_error(message);
				dispatch({ type: 'SET_ERROR', error: message });
				return;
			}

			let start: {
				ok?: boolean;
				error?: { message?: string };
				data?: { job_id?: string; stage?: string };
			};
			try {
				start = await res.json();
			} catch {
				const message = 'Invalid response from builder. Try again.';
				set_local_error(message);
				dispatch({ type: 'SET_ERROR', error: message });
				return;
			}

			if (!start.ok || !start.data?.job_id) {
				const message = start.error?.message || 'Failed to start generation';
				set_local_error(message);
				dispatch({ type: 'SET_ERROR', error: message });
				return;
			}

			const job_id = start.data.job_id;
			if (start.data.stage) set_generate_stage(start.data.stage);

			const deadline = Date.now() + 10 * 60 * 1000;
			while (Date.now() < deadline) {
				await sleep(1500);
				const poll = await auth_fetch('/v1/teams/build', {
					method: 'POST',
					body: JSON.stringify({ action: 'status', job_id }),
				});
				if (!poll.ok) {
					const message = await read_api_error(poll);
					set_local_error(message);
					dispatch({ type: 'SET_ERROR', error: message });
					return;
				}

				let body: {
					ok?: boolean;
					data?: {
						status?: string;
						stage?: string;
						team?: unknown;
						validation?: unknown;
						error?: { message?: string };
					};
				};
				try {
					body = await poll.json();
				} catch {
					continue;
				}

				const job = body.data;
				if (!job) continue;
				if (job.stage) set_generate_stage(job.stage);

				if (job.status === 'done' && job.team) {
					dispatch({
						type: 'SET_TEAM',
						team: job.team as never,
						validation: (job.validation as never) ?? null,
					});
					return;
				}

				if (job.status === 'error') {
					const message = job.error?.message || 'Generation failed';
					set_local_error(message);
					dispatch({ type: 'SET_ERROR', error: message });
					return;
				}
			}

			const message = 'Generation is taking too long — try again in a moment.';
			set_local_error(message);
			dispatch({ type: 'SET_ERROR', error: message });
		} catch {
			const message = 'Could not reach builder (network error). Try again, or use From scratch / Templates.';
			set_local_error(message);
			dispatch({ type: 'SET_ERROR', error: message });
		} finally {
			set_generate_stage(null);
			dispatch({ type: 'SET_GENERATING', generating: false });
		}
	}

	function on_file_picked(file: File | undefined) {
		if (!file) return;
		const reader = new FileReader();
		reader.onload = () => {
			const text = typeof reader.result === 'string' ? reader.result : '';
			if (!text.trim()) {
				set_local_error('File is empty');
				return;
			}
			open_team_from_yaml(text);
		};
		reader.onerror = () => set_local_error('Could not read file');
		reader.readAsText(file);
	}

	const error = local_error || state.error;

	return (
		<div className="flex min-h-[60vh] flex-col items-center px-4 py-10">
			<div className="w-full max-w-2xl">
				<div className="mb-6 text-center">
					<div className="inline-flex items-center justify-center gap-2">
						<h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
							Build a team
						</h2>
						<HelpTip label="Builder" docs_href={PAGE_HELP.builder.docs_href}>
							{PAGE_HELP.builder.help}
						</HelpTip>
					</div>
					<p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
						Start with AI, or switch tabs for scratch, templates, upload, or YAML — same canvas.
					</p>
				</div>

				<div className="mb-6 flex flex-wrap justify-center gap-1 border-b border-slate-200 dark:border-slate-700">
					{(
						[
							['ai', 'AI Generate'],
							['scratch', 'From scratch'],
							['templates', 'Templates'],
							['upload', 'Upload'],
							['yaml', 'YAML'],
						] as const
					).map(([id, label]) => (
						<button
							key={id}
							type="button"
							onClick={() => {
								set_tab(id);
								set_local_error(null);
								dispatch({ type: 'SET_ERROR', error: null });
							}}
							className={`border-b-2 px-3 py-2 text-xs font-medium transition ${tab_class(tab === id)}`}
						>
							{label}
						</button>
					))}
				</div>

				{error && (
					<div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
						{error}
					</div>
				)}

				{tab === 'scratch' && (
					<div className="rounded-xl border border-slate-200 bg-white p-6 text-center dark:border-slate-700 dark:bg-slate-900">
						<p className="mb-4 text-sm text-slate-600 dark:text-slate-300">
							Open an empty canvas. Add phases and agents yourself — no AI required.
						</p>
						<button
							type="button"
							onClick={start_blank}
							className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
						>
							Start blank team
						</button>
					</div>
				)}

				{tab === 'templates' && (
					<div className="grid gap-2 sm:grid-cols-2">
						{SAMPLE_TEAMS.map((sample) => (
							<button
								key={sample.label}
								type="button"
								onClick={() => open_team_from_yaml(sample.yaml)}
								className="rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-indigo-300 hover:bg-indigo-50/40 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-indigo-500/40"
							>
								<div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{sample.label}</div>
								<p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{sample.description}</p>
							</button>
						))}
					</div>
				)}

				{tab === 'upload' && (
					<div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center dark:border-slate-600 dark:bg-slate-900">
						<p className="mb-4 text-sm text-slate-600 dark:text-slate-300">
							Upload a <code className="text-xs">team.yml</code> / <code className="text-xs">.yaml</code> file.
						</p>
						<input
							ref={file_ref}
							type="file"
							accept=".yml,.yaml,text/yaml,text/x-yaml"
							className="hidden"
							onChange={(e) => on_file_picked(e.target.files?.[0])}
						/>
						<button
							type="button"
							onClick={() => file_ref.current?.click()}
							className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
						>
							Choose file
						</button>
					</div>
				)}

				{tab === 'yaml' && (
					<div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
						<textarea
							value={yaml_text}
							onChange={(e) => set_yaml_text(e.target.value)}
							placeholder={'name: my-team\ndescription: ...\nphases:\n  - name: start\n    type: standard\n    agent: exec\n'}
							rows={12}
							className="mb-3 w-full resize-y rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs outline-none focus:border-indigo-500 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
						/>
						<button
							type="button"
							disabled={!yaml_text.trim()}
							onClick={() => open_team_from_yaml(yaml_text)}
							className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
						>
							Apply to canvas
						</button>
					</div>
				)}

				{tab === 'ai' && (
					<div>
						<textarea
							value={intent}
							onChange={(e) => set_intent(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void handle_generate();
							}}
							placeholder="e.g. A test-driven development team for building REST APIs with automated code review..."
							rows={3}
							className="mb-3 w-full resize-none rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
							disabled={state.generating}
						/>
						<button
							type="button"
							onClick={() => void handle_generate()}
							disabled={state.generating || !intent.trim()}
							className="mb-4 w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
						>
							{state.generating ? (STAGE_LABELS[generate_stage ?? 'queued'] ?? 'Generating…') : 'Generate team'}
						</button>
						<p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Examples</p>
						<div className="flex flex-wrap gap-2">
							{EXAMPLES.map((ex) => (
								<button
									key={ex.label}
									type="button"
									disabled={state.generating}
									onClick={() => set_intent(ex.intent)}
									className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:border-indigo-300 hover:text-indigo-700 dark:border-slate-600 dark:text-slate-300"
								>
									{ex.label}
								</button>
							))}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
