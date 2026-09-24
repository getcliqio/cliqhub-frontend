/**
 * Per-agent attribute schema for the builder UI.
 * Drives which sections appear in the phase editor, their order,
 * required/optional status, and context-sensitive tooltip text.
 *
 * Keep in sync with cliq workflow/types.ts and agent implementations.
 * Reference: cliqhub/design/DESIGN-builder-phase-schema.md
 *
 * Rules (from cliq orchestrator + parser):
 *   - type: team → requires `team` ref, optional `inputs`, `role`.
 *   - type: gate + agent: hug → requires `review`. Optional commands, max_iterations, role.
 *   - type: gate + LLM agent → requires `commands`. Optional max_iterations, role, model.
 *   - type: standard + exec → requires `commands`. Optional max_iterations. No role, no model.
 *   - type: standard + LLM agent → requires `role`. Optional model, commands, max_iterations, sources, target_entries.
 *   - type: standard + connector → requires `action`, `sources`. Optional target_entries. No role.
 *   - type: standard + curl → requires `sources`. Optional target_entries. No role, no action.
 *   - `review` block is ONLY valid on gate + hug.
 *   - `team` field is ONLY valid on type: team.
 */

export type AttributeName =
    | 'commands'
    | 'max_iterations'
    | 'model'
    | 'role'
    | 'review'
    | 'sources'
    | 'target_entries'
    | 'action'
    | 'team'
    | 'inputs';

export interface AttributeDef {
    name: AttributeName;
    required: boolean;
    tooltip: string;
    /** Semantic group key — coupled attributes share a group and stay adjacent. */
    group?: string;
}

export interface AgentSchema {
    /** Attributes in display order: required first, then optional, respecting groups. */
    attributes: AttributeDef[];
}

/** Connector agents that use action + sources/targets, no LLM role. */
export const CONNECTOR_AGENTS = new Set([
    'jira', 'confluence', 'zendesk', 'datadog',
    'hubspot', 'gdrive', 's3', 'mesh',
]);

// ---- Tooltip text ----

const TOOLTIPS = {

    role_standard: 'The briefing and instructions for the AI agent. Defines identity, objectives, deliverables, and constraints. Stored in roles/<phase-name>.md.',
    role_gate: 'Evaluation criteria for the gate agent. Should include verdict instructions (PASS / ROUTE / ESCALATE). The orchestrator auto-injects the verdict protocol.',
    role_hug: 'Evaluation guidance shown to the human reviewer alongside artifacts. Should describe what "good" looks like and when to approve, request changes, or escalate.',
    role_team: 'The requirement specification passed to the sub-team. NOT agent instructions — write as an actionable spec describing what the sub-team should accomplish.',

    commands_standard: 'Shell commands run as pre/post hooks around the agent. Results are logged but don\'t block the agent.',
    commands_exec: 'The phase\'s primary work. Commands run sequentially — this is all the phase does. No agent involvement.',
    commands_gate: 'Evidence checks (e.g. npm test, npm run lint). Results are passed to the gate agent for verdict evaluation.',
    commands_hug: 'Evidence checks run before the human reviewer sees the phase. Results are shown alongside artifacts to provide context.',

    max_iterations_exec: 'Number of times to retry commands on failure before escalating.',
    max_iterations_gate: 'Maximum verdict loop iterations. Each iteration executes commands again and re-evaluates. Default 3, max 5.',

    model_standard: 'Override the LLM model for this phase (e.g. gpt-4o, claude-sonnet-4, gemini-2.5-pro). If unset, the agent uses its default model.',
    model_gate: 'Override the LLM model for the gate evaluation agent. Useful for using a stronger model for quality judgments.',

    sources_standard: 'External data fetched via a connector pre-hook before the agent runs. Content lands in .cliq/pull/<name>/.',
    sources_connector: 'Data source entries to fetch. Each has a URL (HTTP, gdrive://, jira://) and a name for local storage.',
    sources_curl: 'URLs to fetch. Content is downloaded and stored locally for downstream phases.',

    target_entries_standard: 'External destinations where results are pushed via a connector post-hook after the agent completes.',
    target_entries_connector: 'Write destinations. Each entry maps a local file to a remote URI (gdrive://, gdoc://, sharepoint://). Modes: create, append, replace.',
    target_entries_curl: 'Destinations to POST/PUT results to after fetch completes.',

    action: 'The connector operation to perform. Examples: get_issue (jira), create_page (confluence), query_metrics (datadog), upload (s3).',

    review: 'Human review configuration block. Contains: reviewer (who reviews — maps to hug settings), artifacts (files/dirs shown to reviewer), timeout (max wait time), remind_every (reminder interval).',

    team: 'Scoped reference to the sub-team to launch (e.g. @acme/security-audit, @local/feature-dev). Must be an installed team.',

    inputs: 'Key-value pairs passed to the sub-team at launch time. Values support templates: $(inputs.*) (parent inputs), $(dirs.*) (directory paths).',

} as const;

// ---- Schema definitions ----

const SCHEMAS: Record<string, AgentSchema> = {

    /** Standard phase with LLM agent (cursor, claude-code, gemini, codex, *-api). */
    'standard:default': {
        attributes: [
            { name: 'role', required: true, tooltip: TOOLTIPS.role_standard },
            { name: 'model', required: false, tooltip: TOOLTIPS.model_standard },
            { name: 'commands', required: false, tooltip: TOOLTIPS.commands_standard, group: 'commands_group' },
            { name: 'max_iterations', required: false, tooltip: TOOLTIPS.max_iterations_exec, group: 'commands_group' },
            { name: 'sources', required: false, tooltip: TOOLTIPS.sources_standard },
            { name: 'target_entries', required: false, tooltip: TOOLTIPS.target_entries_standard },
        ],
    },

    /** Standard phase with exec agent — shell commands only, no LLM. */
    'standard:exec': {
        attributes: [
            { name: 'commands', required: true, tooltip: TOOLTIPS.commands_exec, group: 'commands_group' },
            { name: 'max_iterations', required: false, tooltip: TOOLTIPS.max_iterations_exec, group: 'commands_group' },
        ],
    },

    /** Standard phase with a connector agent (jira, confluence, etc.). */
    'standard:connector': {
        attributes: [
            { name: 'action', required: true, tooltip: TOOLTIPS.action },
            { name: 'sources', required: true, tooltip: TOOLTIPS.sources_connector },
            { name: 'target_entries', required: false, tooltip: TOOLTIPS.target_entries_connector },
        ],
    },

    /** Standard phase with curl — HTTP fetch, no action field. */
    'standard:curl': {
        attributes: [
            { name: 'sources', required: true, tooltip: TOOLTIPS.sources_curl },
            { name: 'target_entries', required: false, tooltip: TOOLTIPS.target_entries_curl },
        ],
    },

    /** Gate phase with LLM agent — automated quality gate. */
    'gate:default': {
        attributes: [
            { name: 'commands', required: true, tooltip: TOOLTIPS.commands_gate, group: 'commands_group' },
            { name: 'max_iterations', required: false, tooltip: TOOLTIPS.max_iterations_gate, group: 'commands_group' },
            { name: 'role', required: false, tooltip: TOOLTIPS.role_gate },
            { name: 'model', required: false, tooltip: TOOLTIPS.model_gate },
        ],
    },

    /** Gate phase with hug agent — human-in-the-loop review. */
    'gate:hug': {
        attributes: [
            { name: 'review', required: true, tooltip: TOOLTIPS.review },
            { name: 'commands', required: false, tooltip: TOOLTIPS.commands_hug, group: 'commands_group' },
            { name: 'max_iterations', required: false, tooltip: TOOLTIPS.max_iterations_gate, group: 'commands_group' },
            { name: 'role', required: false, tooltip: TOOLTIPS.role_hug },
        ],
    },

    /** Team phase — delegates to a sub-team. */
    'team:default': {
        attributes: [
            { name: 'team', required: true, tooltip: TOOLTIPS.team },
            { name: 'inputs', required: false, tooltip: TOOLTIPS.inputs },
            { name: 'role', required: false, tooltip: TOOLTIPS.role_team },
        ],
    },
};

// Alias: explicit `agent: team` resolves to same schema as default
SCHEMAS['team:team'] = SCHEMAS['team:default'];


/**
 * Resolve the attribute schema for a given phase type + agent combination.
 *
 * Lookup order:
 *   1. Exact match: ${type}:${agent}
 *   2. Connector fallback: if agent is in CONNECTOR_AGENTS → standard:connector
 *   3. Type default: ${type}:default
 *   4. Ultimate fallback: standard:default
 */
export function get_agent_schema(type: string, agent?: string): AgentSchema {

    if (agent) {
        const specific = SCHEMAS[`${type}:${agent}`];
        if (specific) return specific;

        if (CONNECTOR_AGENTS.has(agent)) {
            return SCHEMAS['standard:connector'];
        }
    }

    const type_default = SCHEMAS[`${type}:default`];
    if (type_default) return type_default;

    return SCHEMAS['standard:default'];
}

/** Check whether an attribute is present in a schema. */
export function has_attribute(schema: AgentSchema, name: AttributeName): boolean {
    return schema.attributes.some(a => a.name === name);
}

/** Check whether an attribute is required in a schema. */
export function is_required(schema: AgentSchema, name: AttributeName): boolean {
    return schema.attributes.some(a => a.name === name && a.required);
}

/** Get the tooltip text for a specific attribute in a schema. */
export function get_tooltip(schema: AgentSchema, name: AttributeName): string {
    const attr = schema.attributes.find(a => a.name === name);
    return attr?.tooltip ?? '';
}
