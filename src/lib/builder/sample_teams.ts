/** Desktop Quick Start templates (ported from removed Electron BuilderPage). */
export const SAMPLE_TEAMS: { label: string; description: string; yaml: string }[] = [
	{
		label: 'Hello World',
		description: 'Simplest possible team — one phase, one agent.',
		yaml: `name: "@cliq/hello-world"
description: "A minimal single-phase team for testing."
version: "1.0.0"
phases:
  - name: greet
    type: standard
    agent: exec
`,
	},
	{
		label: 'Gate Review',
		description: 'Two phases with a gate — work then approve.',
		yaml: `name: "@cliq/gate-review"
description: "A simple approve/reject gate after a work phase."
version: "1.0.0"
phases:
  - name: draft
    type: standard
    agent: exec
  - name: approve
    type: gate
    agent: hug
    depends_on: [draft]
`,
	},
	{
		label: 'Linear Pipeline',
		description: 'Three sequential phases — plan, build, verify.',
		yaml: `name: "@cliq/linear-pipeline"
description: "A sequential three-step pipeline."
version: "1.0.0"
phases:
  - name: plan
    type: standard
    agent: exec
  - name: build
    type: standard
    agent: exec
    depends_on: [plan]
  - name: verify
    type: standard
    agent: exec
    depends_on: [build]
`,
	},
	{
		label: 'Parallel Fan-Out',
		description: 'Fan-out pattern — one phase feeds two parallel branches.',
		yaml: `name: "@cliq/parallel-fan-out"
description: "Parallel execution with a merge step."
version: "1.0.0"
phases:
  - name: split
    type: standard
    agent: exec
  - name: branch-a
    type: standard
    agent: exec
    depends_on: [split]
  - name: branch-b
    type: standard
    agent: exec
    depends_on: [split]
  - name: merge
    type: standard
    agent: exec
    depends_on: [branch-a, branch-b]
`,
	},
	{
		label: 'Sub-Team Recursion',
		description: 'A team phase that delegates to another installed team.',
		yaml: `name: "@cliq/recursive-demo"
description: "Demonstrates team-phase recursion."
version: "1.0.0"
phases:
  - name: prepare
    type: standard
    agent: exec
  - name: delegate
    type: team
    team: "@cliq/hello-world"
    depends_on: [prepare]
  - name: finalize
    type: gate
    agent: hug
    depends_on: [delegate]
`,
	},
];
