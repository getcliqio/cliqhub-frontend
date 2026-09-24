import { describe, it, expect } from 'vitest';
import {
    get_agent_schema,
    has_attribute,
    is_required,
    get_tooltip,
    CONNECTOR_AGENTS,
} from '../src/lib/agent_schema';

describe('agent_schema', () => {

    // ---- standard + LLM agent (default) ----

    describe('standard:default (LLM agent)', () => {
        const schema = get_agent_schema('standard');

        it('requires role', () => {
            expect(has_attribute(schema, 'role')).toBe(true);
            expect(is_required(schema, 'role')).toBe(true);
        });

        it('has optional model', () => {
            expect(has_attribute(schema, 'model')).toBe(true);
            expect(is_required(schema, 'model')).toBe(false);
        });

        it('has optional sources and targets', () => {
            expect(has_attribute(schema, 'sources')).toBe(true);
            expect(is_required(schema, 'sources')).toBe(false);
            expect(has_attribute(schema, 'target_entries')).toBe(true);
            expect(is_required(schema, 'target_entries')).toBe(false);
        });

        it('has optional commands grouped with max_iterations', () => {
            expect(has_attribute(schema, 'commands')).toBe(true);
            expect(is_required(schema, 'commands')).toBe(false);
            expect(has_attribute(schema, 'max_iterations')).toBe(true);
            expect(is_required(schema, 'max_iterations')).toBe(false);
        });

        it('does not have review, team, action, or inputs', () => {
            expect(has_attribute(schema, 'review')).toBe(false);
            expect(has_attribute(schema, 'team')).toBe(false);
            expect(has_attribute(schema, 'action')).toBe(false);
            expect(has_attribute(schema, 'inputs')).toBe(false);
        });

        it('orders required before optional', () => {
            const names = schema.attributes.map(a => a.name);
            expect(names[0]).toBe('role');
        });
    });

    describe('standard:default resolves for named LLM agents', () => {
        it('cursor gets standard:default schema', () => {
            const schema = get_agent_schema('standard', 'cursor');
            expect(has_attribute(schema, 'role')).toBe(true);
            expect(is_required(schema, 'role')).toBe(true);
        });

        it('claude-code gets standard:default schema', () => {
            const schema = get_agent_schema('standard', 'claude-code');
            expect(has_attribute(schema, 'role')).toBe(true);
            expect(has_attribute(schema, 'review')).toBe(false);
        });

        it('openai-api gets standard:default schema', () => {
            const schema = get_agent_schema('standard', 'openai-api');
            expect(has_attribute(schema, 'model')).toBe(true);
        });
    });

    // ---- standard + exec ----

    describe('standard:exec', () => {
        const schema = get_agent_schema('standard', 'exec');

        it('requires commands', () => {
            expect(has_attribute(schema, 'commands')).toBe(true);
            expect(is_required(schema, 'commands')).toBe(true);
        });

        it('has optional max_iterations', () => {
            expect(has_attribute(schema, 'max_iterations')).toBe(true);
            expect(is_required(schema, 'max_iterations')).toBe(false);
        });

        it('does not have role, model, sources, targets, review, team, action, inputs', () => {
            expect(has_attribute(schema, 'role')).toBe(false);
            expect(has_attribute(schema, 'model')).toBe(false);
            expect(has_attribute(schema, 'sources')).toBe(false);
            expect(has_attribute(schema, 'target_entries')).toBe(false);
            expect(has_attribute(schema, 'review')).toBe(false);
            expect(has_attribute(schema, 'team')).toBe(false);
            expect(has_attribute(schema, 'action')).toBe(false);
            expect(has_attribute(schema, 'inputs')).toBe(false);
        });
    });

    // ---- standard + connector ----

    describe('standard:connector (shared schema)', () => {
        const schema = get_agent_schema('standard', 'jira');

        it('requires action', () => {
            expect(has_attribute(schema, 'action')).toBe(true);
            expect(is_required(schema, 'action')).toBe(true);
        });

        it('requires sources', () => {
            expect(has_attribute(schema, 'sources')).toBe(true);
            expect(is_required(schema, 'sources')).toBe(true);
        });

        it('has optional target_entries', () => {
            expect(has_attribute(schema, 'target_entries')).toBe(true);
            expect(is_required(schema, 'target_entries')).toBe(false);
        });

        it('does not have role, model, commands, review, team, inputs, max_iterations', () => {
            expect(has_attribute(schema, 'role')).toBe(false);
            expect(has_attribute(schema, 'model')).toBe(false);
            expect(has_attribute(schema, 'commands')).toBe(false);
            expect(has_attribute(schema, 'max_iterations')).toBe(false);
            expect(has_attribute(schema, 'review')).toBe(false);
            expect(has_attribute(schema, 'team')).toBe(false);
            expect(has_attribute(schema, 'inputs')).toBe(false);
        });
    });

    describe('all connector agents resolve to standard:connector', () => {
        const connectors = [...CONNECTOR_AGENTS];

        for (const name of connectors) {
            it(`${name} requires action and sources, no role`, () => {
                const schema = get_agent_schema('standard', name);
                expect(is_required(schema, 'action')).toBe(true);
                expect(is_required(schema, 'sources')).toBe(true);
                expect(has_attribute(schema, 'role')).toBe(false);
            });
        }
    });

    // ---- standard + curl ----

    describe('standard:curl (no action field)', () => {
        const schema = get_agent_schema('standard', 'curl');

        it('requires sources', () => {
            expect(has_attribute(schema, 'sources')).toBe(true);
            expect(is_required(schema, 'sources')).toBe(true);
        });

        it('does not have action', () => {
            expect(has_attribute(schema, 'action')).toBe(false);
        });

        it('has optional target_entries', () => {
            expect(has_attribute(schema, 'target_entries')).toBe(true);
            expect(is_required(schema, 'target_entries')).toBe(false);
        });

        it('does not have role, model, commands, max_iterations', () => {
            expect(has_attribute(schema, 'role')).toBe(false);
            expect(has_attribute(schema, 'model')).toBe(false);
            expect(has_attribute(schema, 'commands')).toBe(false);
            expect(has_attribute(schema, 'max_iterations')).toBe(false);
        });
    });

    // ---- gate + default (LLM) ----

    describe('gate:default (LLM gate)', () => {
        const schema = get_agent_schema('gate');

        it('requires commands', () => {
            expect(has_attribute(schema, 'commands')).toBe(true);
            expect(is_required(schema, 'commands')).toBe(true);
        });

        it('has optional max_iterations grouped with commands', () => {
            expect(has_attribute(schema, 'max_iterations')).toBe(true);
            expect(is_required(schema, 'max_iterations')).toBe(false);
            const cmd_idx = schema.attributes.findIndex(a => a.name === 'commands');
            const iter_idx = schema.attributes.findIndex(a => a.name === 'max_iterations');
            expect(iter_idx).toBe(cmd_idx + 1);
        });

        it('has optional role and model', () => {
            expect(has_attribute(schema, 'role')).toBe(true);
            expect(is_required(schema, 'role')).toBe(false);
            expect(has_attribute(schema, 'model')).toBe(true);
            expect(is_required(schema, 'model')).toBe(false);
        });

        it('does not have review, sources, targets, team, action, inputs', () => {
            expect(has_attribute(schema, 'review')).toBe(false);
            expect(has_attribute(schema, 'sources')).toBe(false);
            expect(has_attribute(schema, 'target_entries')).toBe(false);
            expect(has_attribute(schema, 'team')).toBe(false);
            expect(has_attribute(schema, 'action')).toBe(false);
            expect(has_attribute(schema, 'inputs')).toBe(false);
        });
    });

    // ---- gate + hug ----

    describe('gate:hug', () => {
        const schema = get_agent_schema('gate', 'hug');

        it('requires review', () => {
            expect(has_attribute(schema, 'review')).toBe(true);
            expect(is_required(schema, 'review')).toBe(true);
        });

        it('has optional commands grouped with max_iterations', () => {
            expect(has_attribute(schema, 'commands')).toBe(true);
            expect(is_required(schema, 'commands')).toBe(false);
            expect(has_attribute(schema, 'max_iterations')).toBe(true);
            expect(is_required(schema, 'max_iterations')).toBe(false);
        });

        it('has optional role', () => {
            expect(has_attribute(schema, 'role')).toBe(true);
            expect(is_required(schema, 'role')).toBe(false);
        });

        it('does not have model, sources, targets, team, action, inputs', () => {
            expect(has_attribute(schema, 'model')).toBe(false);
            expect(has_attribute(schema, 'sources')).toBe(false);
            expect(has_attribute(schema, 'target_entries')).toBe(false);
            expect(has_attribute(schema, 'team')).toBe(false);
            expect(has_attribute(schema, 'action')).toBe(false);
            expect(has_attribute(schema, 'inputs')).toBe(false);
        });
    });

    // ---- team ----

    describe('team:default', () => {
        const schema = get_agent_schema('team');

        it('requires team reference', () => {
            expect(has_attribute(schema, 'team')).toBe(true);
            expect(is_required(schema, 'team')).toBe(true);
        });

        it('has optional inputs', () => {
            expect(has_attribute(schema, 'inputs')).toBe(true);
            expect(is_required(schema, 'inputs')).toBe(false);
        });

        it('has optional role (used as sub-team spec)', () => {
            expect(has_attribute(schema, 'role')).toBe(true);
            expect(is_required(schema, 'role')).toBe(false);
        });

        it('does not have model, commands, max_iterations, sources, targets, review, action', () => {
            expect(has_attribute(schema, 'model')).toBe(false);
            expect(has_attribute(schema, 'commands')).toBe(false);
            expect(has_attribute(schema, 'max_iterations')).toBe(false);
            expect(has_attribute(schema, 'sources')).toBe(false);
            expect(has_attribute(schema, 'target_entries')).toBe(false);
            expect(has_attribute(schema, 'review')).toBe(false);
            expect(has_attribute(schema, 'action')).toBe(false);
        });
    });

    describe('team:team agent resolves same as team:default', () => {
        const schema = get_agent_schema('team', 'team');

        it('requires team reference', () => {
            expect(has_attribute(schema, 'team')).toBe(true);
            expect(is_required(schema, 'team')).toBe(true);
        });

        it('has optional inputs and role', () => {
            expect(has_attribute(schema, 'inputs')).toBe(true);
            expect(has_attribute(schema, 'role')).toBe(true);
        });
    });

    // ---- fallback behaviour ----

    describe('fallback resolution', () => {
        it('unknown agent on standard falls back to standard:default', () => {
            const schema = get_agent_schema('standard', 'unknown-agent');
            expect(has_attribute(schema, 'role')).toBe(true);
            expect(is_required(schema, 'role')).toBe(true);
        });

        it('unknown type falls back to standard:default', () => {
            const schema = get_agent_schema('bogus');
            expect(has_attribute(schema, 'role')).toBe(true);
        });
    });

    // ---- CONNECTOR_AGENTS set ----

    describe('CONNECTOR_AGENTS', () => {
        it('contains all expected connector agents', () => {
            expect(CONNECTOR_AGENTS.has('jira')).toBe(true);
            expect(CONNECTOR_AGENTS.has('confluence')).toBe(true);
            expect(CONNECTOR_AGENTS.has('zendesk')).toBe(true);
            expect(CONNECTOR_AGENTS.has('datadog')).toBe(true);
            expect(CONNECTOR_AGENTS.has('hubspot')).toBe(true);
            expect(CONNECTOR_AGENTS.has('gdrive')).toBe(true);
            expect(CONNECTOR_AGENTS.has('s3')).toBe(true);
            expect(CONNECTOR_AGENTS.has('mesh')).toBe(true);
        });

        it('does not contain LLM or special agents', () => {
            expect(CONNECTOR_AGENTS.has('cursor')).toBe(false);
            expect(CONNECTOR_AGENTS.has('exec')).toBe(false);
            expect(CONNECTOR_AGENTS.has('hug')).toBe(false);
            expect(CONNECTOR_AGENTS.has('team')).toBe(false);
            expect(CONNECTOR_AGENTS.has('curl')).toBe(false);
        });
    });

    // ---- get_tooltip ----

    describe('get_tooltip', () => {
        it('returns non-empty tooltip for every attribute in every schema', () => {
            const test_cases: [string, string | undefined][] = [
                ['standard', undefined],
                ['standard', 'exec'],
                ['standard', 'jira'],
                ['standard', 'curl'],
                ['gate', undefined],
                ['gate', 'hug'],
                ['team', undefined],
            ];

            for (const [type, agent] of test_cases) {
                const schema = get_agent_schema(type, agent);
                for (const attr of schema.attributes) {
                    const tip = get_tooltip(schema, attr.name);
                    expect(tip.length).toBeGreaterThan(0);
                }
            }
        });

        it('returns context-sensitive tooltip for role across schemas', () => {
            const standard_tip = get_tooltip(get_agent_schema('standard'), 'role');
            const gate_tip = get_tooltip(get_agent_schema('gate'), 'role');
            const hug_tip = get_tooltip(get_agent_schema('gate', 'hug'), 'role');
            const team_tip = get_tooltip(get_agent_schema('team'), 'role');

            expect(standard_tip).toContain('briefing');
            expect(gate_tip).toContain('verdict');
            expect(hug_tip).toContain('human reviewer');
            expect(team_tip).toContain('requirement specification');
        });

        it('returns empty string for attribute not in schema', () => {
            const schema = get_agent_schema('standard', 'exec');
            expect(get_tooltip(schema, 'role')).toBe('');
        });
    });
});
