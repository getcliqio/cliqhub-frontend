/**
 * Run detail › a phase's output, read for people: the verdict, the commands it
 * ran, the sources it touched, the sub-team it ran, or the agent's answer (its
 * "I'll …" narration folded into Steps). The BFF reads the stored `{ text,
 * data }` into this view (`phase_outputs` on `run_detail/get`); Raw always
 * shows the stored output exactly as kept, for checking the view.
 */
import { useState } from 'react';
import { Link } from 'react-router';
import { Check, Copy, ExternalLink, X } from 'lucide-react';
import { Md } from '@/components/graphite/g_review';
import type { Phase_output_view, Run_artifact, Run_phase_output } from '@/lib/realm_inbox';

/** Commands listed before "Show all". */
const COMMANDS_SHOWN = 8;

/** The stored output, pretty-printed when it is JSON. */
export function pretty_raw(raw: string): string {
	try {
		return JSON.stringify(JSON.parse(raw), null, 2);
	} catch {
		return raw;
	}
}

/** Every phase output of a run as one JSON file (stored values, parsed when JSON). */
export function download_raw_outputs(run_id: string, outputs: Run_phase_output[]): void {
	const doc = {
		run_id,
		outputs: outputs.map((o) => {
			let output: unknown = o.raw;
			try { output = JSON.parse(o.raw); } catch { /* keep the text */ }
			return { phase: o.phase, artifact_id: o.artifact_id, created_at: o.created_at, complete: o.complete, output };
		}),
	};
	const url = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }));
	const a = document.createElement('a');
	a.href = url;
	a.download = `run-${run_id}-outputs.json`;
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 0);
}

function fmt_ms(ms: number | null): string {
	if (ms == null) return '';
	return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function Verdict({ v }: { v: NonNullable<Phase_output_view['verdict']> }) {
	const pass = v.outcome === 'PASS';
	const fail = v.outcome === 'FAIL' || v.outcome === 'REJECT';
	const tone = pass ? 'bg-[var(--g-ok-soft)] text-[var(--g-ok)]' : fail ? 'bg-[var(--g-bad-soft)] text-[var(--g-bad)]' : 'bg-[var(--g-soft)] text-[var(--g-ink-2)]';
	return (
		<p className="flex flex-wrap items-center gap-2 text-[12.5px]" data-testid="output-verdict">
			<span className={`g-mono rounded px-1.5 py-0.5 text-[11.5px] font-semibold ${tone}`}>{v.outcome}</span>
			{v.reason ? <span className="text-[var(--g-ink-2)]">{v.reason}</span> : null}
		</p>
	);
}

function Commands({ c }: { c: NonNullable<Phase_output_view['commands']> }) {
	const [all, set_all] = useState(false);
	const items = all ? c.items : c.items.slice(0, COMMANDS_SHOWN);
	return (
		<div data-testid="output-commands">
			<ul className="divide-y divide-[var(--g-line-2)] rounded-md border border-[var(--g-line-2)]">
				{items.map((it, i) => (
					<li key={i} className="flex items-center gap-2 px-2.5 py-1.5 text-[12px]" title={it.command}>
						{it.pass
							? <Check aria-label="passed" className="h-3.5 w-3.5 shrink-0 text-[var(--g-ok)]" />
							: <X aria-label="failed" className="h-3.5 w-3.5 shrink-0 text-[var(--g-bad)]" />}
						<span className={`g-mono min-w-0 flex-1 truncate ${it.pass ? 'text-[var(--g-ink-2)]' : 'text-[var(--g-bad)]'}`}>{it.label}…</span>
						<span className="g-mono shrink-0 text-[11px] text-[var(--g-ink-3)]">{it.exit_code != null ? `exit ${it.exit_code}` : ''}{it.duration_ms != null ? ` · ${fmt_ms(it.duration_ms)}` : ''}</span>
					</li>
				))}
			</ul>
			{c.items.length > COMMANDS_SHOWN ? (
				<button type="button" onClick={() => set_all((x) => !x)} className="mt-1 text-[12px] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]">
					{all ? 'Show fewer' : `Show all ${c.items.length}`}
				</button>
			) : null}
			<p className="mt-1 text-[11px] text-[var(--g-ink-3)]">Commands are recorded by their first line; Raw has what was kept.</p>
		</div>
	);
}

function Sources({ s }: { s: Phase_output_view['sources'] }) {
	return (
		<ul className="flex flex-wrap gap-1.5" data-testid="output-sources">
			{s.map((x) => (
				<li key={x.name} className="inline-flex items-center gap-1.5 rounded-md border border-[var(--g-line)] px-2 py-0.5 text-[12px]">
					<span className="g-mono font-semibold">{x.name}</span>
					{x.detail ? <span className="text-[var(--g-ink-3)]">{x.detail}</span> : null}
					{x.url ? <a href={x.url} target="_blank" rel="noreferrer noopener" aria-label={`Open ${x.name}`} className="text-[var(--g-ink-3)] hover:text-[var(--g-ink)]"><ExternalLink className="h-3 w-3" /></a> : null}
				</li>
			))}
		</ul>
	);
}

function Sub_run({ s, run_link }: { s: NonNullable<Phase_output_view['sub_run']>; run_link: (run_id: string) => string }) {
	return (
		<div className="flex flex-col gap-1.5" data-testid="output-sub-run">
			<p className="text-[12.5px]">
				Ran <span className="g-mono font-semibold">{s.team_ref ?? 'a sub-team'}</span> —{' '}
				<Link to={run_link(s.run_id)} className="underline-offset-2 hover:underline">open the sub-run</Link>
			</p>
			<ul className="flex flex-col gap-1">
				{s.phases.map((p) => (
					<li key={p.phase} className="flex items-center gap-2 text-[12px]">
						{p.ok === false ? <X aria-label="failed" className="h-3.5 w-3.5 text-[var(--g-bad)]" /> : p.ok ? <Check aria-label="passed" className="h-3.5 w-3.5" /> : <span className="h-3.5 w-3.5" />}
						<span className="g-mono font-semibold">{p.phase}</span>
						<span className="min-w-0 truncate text-[var(--g-ink-3)]">{p.summary}</span>
					</li>
				))}
			</ul>
		</div>
	);
}

function Raw({ output }: { output: Run_phase_output }) {
	const [copied, set_copied] = useState(false);
	const text = pretty_raw(output.raw);
	return (
		<div data-testid="output-raw">
			<div className="mb-1 flex items-center gap-2 text-[11.5px] text-[var(--g-ink-3)]">
				<span>Stored output{output.complete ? '' : ' — only the start could be read'}</span>
				<button
					type="button"
					aria-label="Copy raw output"
					onClick={async () => {
						try { await navigator.clipboard.writeText(output.raw); set_copied(true); setTimeout(() => set_copied(false), 1200); } catch { /* ignore */ }
					}}
					className="ml-auto inline-flex items-center gap-1 hover:text-[var(--g-ink)]"
				>
					{copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}{copied ? 'Copied' : 'Copy'}
				</button>
			</div>
			<pre className="g-mono max-h-[420px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-[var(--g-line-2)] bg-[var(--g-soft)] p-3 text-[11.5px] text-[var(--g-ink-2)]">{text}</pre>
		</div>
	);
}

/**
 * One phase's output (the latest; earlier ones when the phase ran again),
 * with its handoffs and a Raw view.
 */
export function G_phase_output({ outputs, handoffs = [], run_link }: { outputs: Run_phase_output[]; handoffs?: Run_artifact[]; run_link: (run_id: string) => string }) {
	const [index, set_index] = useState(outputs.length - 1);
	const [raw, set_raw] = useState(false);
	const output = outputs[Math.min(index, outputs.length - 1)];
	if (!output) return null;
	const v = output.view;
	return (
		<div className="flex flex-col gap-2.5 rounded-md border border-[var(--g-line-2)] bg-[var(--g-panel)] p-3" data-testid="phase-output">
			<div className="flex flex-wrap items-center gap-2">
				{outputs.length > 1 ? (
					<span className="flex items-center gap-1 text-[11.5px] text-[var(--g-ink-3)]" role="group" aria-label="Phase attempts">
						Ran {outputs.length}×:
						{outputs.map((o, i) => (
							<button key={o.artifact_id} type="button" aria-pressed={i === index} onClick={() => set_index(i)} className={`g-mono rounded px-1.5 ${i === index ? 'bg-[var(--g-soft)] text-[var(--g-ink)]' : 'hover:text-[var(--g-ink)]'}`}>#{i + 1}</button>
						))}
					</span>
				) : null}
				<button type="button" aria-pressed={raw} onClick={() => set_raw((x) => !x)} className="ml-auto rounded-md border border-[var(--g-line)] px-2 py-0.5 text-[11.5px] font-semibold text-[var(--g-ink-2)] hover:text-[var(--g-ink)]">
					{raw ? 'Formatted' : 'Raw'}
				</button>
			</div>
			{raw ? <Raw output={output} /> : (
				<>
					{v.verdict ? <Verdict v={v.verdict} /> : null}
					{v.sub_run ? <Sub_run s={v.sub_run} run_link={run_link} /> : null}
					{v.commands ? <Commands c={v.commands} /> : null}
					{v.sources.length ? <Sources s={v.sources} /> : null}
					{v.body_markdown && v.kind !== 'verdict' ? <Md class_name="text-[13px]">{v.body_markdown}</Md> : null}
					{v.steps.length ? (
						<details className="text-[12px] text-[var(--g-ink-3)]">
							<summary className="cursor-pointer select-none">Steps ({v.steps.length})</summary>
							<ol className="mt-1 list-decimal pl-5">{v.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
						</details>
					) : null}
					{!output.complete ? <p className="text-[11.5px] text-[var(--g-warn-text)]">Only the start of this output could be read. Raw shows that part.</p> : null}
				</>
			)}
			{handoffs.length ? (
				<ul className="flex flex-col gap-1 border-t border-[var(--g-line-2)] pt-2" data-testid="output-handoffs">
					{handoffs.map((h) => (
						<li key={h.artifact_id} className="text-[12px] text-[var(--g-ink-2)]">
							<span className="font-semibold">Handoff{h.name && h.name !== 'handoff' ? ` · ${h.name}` : ''}:</span> {(h.content_preview ?? '').slice(0, 300)}
						</li>
					))}
				</ul>
			) : null}
		</div>
	);
}
