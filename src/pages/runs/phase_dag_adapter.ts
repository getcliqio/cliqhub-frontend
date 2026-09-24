/**
 * Adapts the flat `Run_phase_row[]` shape returned by
 * `/v1/runs/get_status` into the `PhaseInfo[]` shape the `DagPanel`
 * consumes.
 *
 * The DAG needs `depends_on` (to draw edges) and `phase_type` (to
 * pick node styling). The phase-list endpoint doesn't guarantee
 * these — some Hub deployments still return the bare
 * `{ phase, status, sequence }` row. When they're missing we
 * synthesize a linear "each phase depends on the previous one"
 * fallback, which renders as a straight top-to-bottom pipeline —
 * accurate for the majority of workflows and never wrong for the
 * minority (because the DAG collapses unmatched deps).
 *
 * Extracted from `run_observability_page.tsx` so the unified run
 * detail page can render the same DAG without duplicating the
 * normaliser.
 */

export interface Raw_phase_row {
	phase?: unknown;
	name?: unknown;
	status?: unknown;
	sequence?: unknown;
	depends_on?: unknown;
	phase_type?: unknown;
	max_iterations?: unknown;
	iteration?: unknown;
}

export interface Dag_phase_info {
	name: string;
	phase_type: string;
	status: string;
	sequence: number;
	depends_on: string[];
	max_iterations?: number;
	iteration?: number;
}

function coerce_name(row: Raw_phase_row): string {
	if (typeof row.name === 'string' && row.name.length > 0) return row.name;
	if (typeof row.phase === 'string' && row.phase.length > 0) return row.phase;
	return '';
}

function coerce_string_array(v: unknown): string[] | undefined {
	if (!Array.isArray(v)) return undefined;
	const out = v.filter((s): s is string => typeof s === 'string' && s.length > 0);
	return out.length === 0 ? undefined : out;
}

export function normalize_phases_for_dag(
	rows: readonly Raw_phase_row[],
): Dag_phase_info[] {
	const out: Dag_phase_info[] = [];
	rows.forEach((row, i, arr) => {
		const name = coerce_name(row);
		if (!name) return;
		const prev_name = i > 0 ? coerce_name(arr[i - 1]) : '';
		const declared = coerce_string_array(row.depends_on);
		const info: Dag_phase_info = {
			name,
			phase_type: typeof row.phase_type === 'string' && row.phase_type.length > 0
				? row.phase_type
				: 'standard',
			status: typeof row.status === 'string' ? row.status : 'pending',
			sequence: typeof row.sequence === 'number' ? row.sequence : i,
			depends_on: declared ?? (prev_name ? [prev_name] : []),
		};
		if (typeof row.max_iterations === 'number') info.max_iterations = row.max_iterations;
		if (typeof row.iteration === 'number') info.iteration = row.iteration;
		out.push(info);
	});
	return out;
}
