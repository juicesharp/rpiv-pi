---
date: 2026-04-12T04:17:20Z
planner: Claude Code
git_commit: 26f9c58
branch: master
repository: rpiv-pi
topic: "Skill flow pipeline command"
tags: [plan, skill-system, flow-orchestration, pipeline, extension-command]
status: ready
design_source: "thoughts/shared/designs/2026-04-12_03-55-13_skill-flow-pipeline.md"
last_updated: 2026-04-12
last_updated_by: Claude Code
---

# Skill Flow Pipeline Command — Implementation Plan

## Overview

Implement `/pipeline` extension command that orchestrates the skill development pipeline (research-questions -> research). Each step runs in a fresh session via `ctx.newSession()`, with the editor pre-filled with the next skill command. State persists on disk at `.rpiv/pipelines/{instance-id}.json`. Artifact discovery uses directory snapshot diffs. Designed for easy extension to future steps (design, write-plan, implement-plan).

Based on design: `thoughts/shared/designs/2026-04-12_03-55-13_skill-flow-pipeline.md`

## Desired End State

- `/pipeline start [description]` initializes a pipeline, fills editor with `/skill:research-questions [description]`, user presses Enter
- `/pipeline next` discovers the artifact, creates a new session, fills editor with `/skill:research [artifact-path]`, user presses Enter
- `/pipeline next` after final step reports completion with all artifact paths
- `/pipeline status` shows all pipeline instances and their artifacts
- `/pipeline reset` clears pipeline state files
- Pipeline definition is a single array — adding future steps is one object entry

## What We're NOT Doing

- design, write-plan, implement-plan steps (future extension)
- Pipeline branching (alternate paths)
- Configurable pipeline definitions via command args
- LLM-facing tools (no `pipeline_advance` tool)
- Automatic completion detection (user triggers `/pipeline next` manually)
- `pi.sendUserMessage()` usage (broken after newSession)

## Phase 1: Pipeline Command

### Overview

Create `pipeline.ts` with types, pipeline definitions, state I/O, artifact discovery, and all four subcommand handlers (start/next/status/reset). Wire it into `index.ts`. Add `.rpiv/` to `.gitignore`.

### Changes Required:

#### 1. Pipeline command module
**File**: `extensions/rpiv-core/pipeline.ts` (NEW)
**Changes**: Create the full pipeline command module — types, canary pipeline definition, state I/O helpers, artifact discovery via directory snapshot diff, instance ID generation, and handlers for start/next/status/reset subcommands.

```typescript
/**
 * pipeline command — Skill flow orchestration.
 *
 * Automates the manual skill chaining process by managing pipeline state on disk
 * and filling the editor with the next skill command after each session reset.
 * State persists at .rpiv/pipelines/{instance-id}.json. Artifact discovery uses
 * directory snapshots (diff-based) to reliably find each step's output.
 *
 * Subcommands: start, next, status, reset.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PipelineStepDef {
	skill: string;
	artifactDir: string;
	buildArgs: (state: PipelineState) => string;
}

export interface PipelineState {
	id: string;
	pipelineId: string;
	currentStep: number;
	artifacts: Record<string, string>;
	startedAt: string;
	initialArgs: string;
	dirSnapshot: string[];
}

// ---------------------------------------------------------------------------
// Pipeline definitions — single point of extension
// ---------------------------------------------------------------------------

const CANARY_PIPELINE: PipelineStepDef[] = [
	{
		skill: "research-questions",
		artifactDir: "thoughts/shared/questions",
		buildArgs: (state) => state.initialArgs,
	},
	{
		skill: "research",
		artifactDir: "thoughts/shared/research",
		buildArgs: (state) => state.artifacts["research-questions"] ?? "",
	},
];

const PIPELINE_DEFS: Record<string, PipelineStepDef[]> = {
	canary: CANARY_PIPELINE,
};

function getPipelineDef(id: string): PipelineStepDef[] | undefined {
	return PIPELINE_DEFS[id];
}

// ---------------------------------------------------------------------------
// State I/O
// ---------------------------------------------------------------------------

const PIPELINES_DIR = ".rpiv/pipelines";

function pipelinesDir(cwd: string): string {
	return join(cwd, PIPELINES_DIR);
}

function stateFilePath(cwd: string, instanceId: string): string {
	return join(pipelinesDir(cwd), `${instanceId}.json`);
}

function readAllStates(cwd: string): PipelineState[] {
	const dir = pipelinesDir(cwd);
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((f) => f.endsWith(".json"))
		.map((f) => {
			try {
				return JSON.parse(readFileSync(join(dir, f), "utf-8")) as PipelineState;
			} catch {
				return undefined;
			}
		})
		.filter((s): s is PipelineState => s !== undefined);
}

function readActiveStates(cwd: string): PipelineState[] {
	return readAllStates(cwd).filter((s) => {
		const def = getPipelineDef(s.pipelineId);
		return def !== undefined && s.currentStep < def.length;
	});
}

function writeState(cwd: string, state: PipelineState): void {
	const dir = pipelinesDir(cwd);
	mkdirSync(dir, { recursive: true });
	writeFileSync(stateFilePath(cwd, state.id), JSON.stringify(state, null, 2));
}

function clearState(cwd: string, instanceId: string): void {
	const path = stateFilePath(cwd, instanceId);
	if (existsSync(path)) unlinkSync(path);
}

function clearAllStates(cwd: string): number {
	const dir = pipelinesDir(cwd);
	if (!existsSync(dir)) return 0;
	const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
	for (const f of files) unlinkSync(join(dir, f));
	return files.length;
}

// ---------------------------------------------------------------------------
// Artifact discovery — directory snapshot diff
// ---------------------------------------------------------------------------

function snapshotDir(cwd: string, relativeDir: string): string[] {
	const dir = join(cwd, relativeDir);
	if (!existsSync(dir)) return [];
	return readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
}

function findNewArtifacts(cwd: string, relativeDir: string, snapshot: string[]): string[] {
	const current = snapshotDir(cwd, relativeDir);
	const snapshotSet = new Set(snapshot);
	return current
		.filter((f) => !snapshotSet.has(f))
		.map((f) => join(relativeDir, f));
}

// ---------------------------------------------------------------------------
// Instance ID generation
// ---------------------------------------------------------------------------

function generateInstanceId(): string {
	const now = new Date();
	const pad = (n: number, w = 2) => String(n).padStart(w, "0");
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

// ---------------------------------------------------------------------------
// /pipeline start [description]
// ---------------------------------------------------------------------------

async function handleStart(description: string, ctx: ExtensionCommandContext): Promise<void> {
	if (!description) {
		ctx.ui.notify("Usage: /pipeline start [description of what to research]", "warning");
		return;
	}

	const pipelineId = "canary";
	const pipeline = getPipelineDef(pipelineId);
	if (!pipeline || pipeline.length === 0) {
		ctx.ui.notify(`Pipeline definition "${pipelineId}" not found`, "error");
		return;
	}

	const stepDef = pipeline[0];
	const state: PipelineState = {
		id: generateInstanceId(),
		pipelineId,
		currentStep: 0,
		artifacts: {},
		startedAt: new Date().toISOString(),
		initialArgs: description,
		dirSnapshot: snapshotDir(ctx.cwd, stepDef.artifactDir),
	};

	writeState(ctx.cwd, state);

	const skillArgs = stepDef.buildArgs(state);
	ctx.ui.setEditorText(`/skill:${stepDef.skill} ${skillArgs}`);
	ctx.ui.notify(
		`Pipeline "${state.id}" started (1/${pipeline.length}: ${stepDef.skill}). Press Enter to run.`,
		"info",
	);
}

// ---------------------------------------------------------------------------
// /pipeline next [override-path]
// ---------------------------------------------------------------------------

async function handleNext(overridePath: string, ctx: ExtensionCommandContext): Promise<void> {
	const active = readActiveStates(ctx.cwd);

	if (active.length === 0) {
		ctx.ui.notify("No active pipeline. Start one with /pipeline start [description]", "warning");
		return;
	}

	let state: PipelineState;
	if (active.length === 1) {
		state = active[0];
	} else {
		const options = active.map(
			(s) => `${s.id} (step ${s.currentStep + 1}/${getPipelineDef(s.pipelineId)!.length})`,
		);
		const choice = await ctx.ui.select("Multiple active pipelines — select one:", options);
		if (!choice) return;
		const idx = active.findIndex((s) => choice.startsWith(s.id));
		if (idx === -1) return;
		state = active[idx];
	}

	const pipeline = getPipelineDef(state.pipelineId)!;
	const currentStepDef = pipeline[state.currentStep];

	// Discover artifact (or use override)
	let artifactPath: string;
	if (overridePath) {
		artifactPath = overridePath;
	} else {
		const newArtifacts = findNewArtifacts(ctx.cwd, currentStepDef.artifactDir, state.dirSnapshot);

		if (newArtifacts.length === 0) {
			ctx.ui.notify(
				`No new artifacts found in ${currentStepDef.artifactDir}/. ` +
				`Provide the path manually: /pipeline next [path]`,
				"warning",
			);
			return;
		}

		if (newArtifacts.length === 1) {
			artifactPath = newArtifacts[0];
		} else {
			const choice = await ctx.ui.select(
				`Multiple new artifacts in ${currentStepDef.artifactDir}/ — select one:`,
				newArtifacts,
			);
			if (!choice) return;
			artifactPath = choice;
		}
	}

	// Record artifact and advance
	state.artifacts[currentStepDef.skill] = artifactPath;
	state.currentStep++;

	if (state.currentStep < pipeline.length) {
		const nextDef = pipeline[state.currentStep];
		state.dirSnapshot = snapshotDir(ctx.cwd, nextDef.artifactDir);
		writeState(ctx.cwd, state);

		await ctx.newSession();

		const skillArgs = nextDef.buildArgs(state);
		ctx.ui.setEditorText(`/skill:${nextDef.skill} ${skillArgs}`);
		ctx.ui.notify(
			`✓ Artifact: ${artifactPath}\n` +
			`Step ${state.currentStep + 1}/${pipeline.length}: ${nextDef.skill}. Press Enter to run.`,
			"info",
		);
	} else {
		writeState(ctx.cwd, state);
		const artifactLines = Object.entries(state.artifacts)
			.map(([skill, path]) => `  ✓ ${skill} → ${path}`)
			.join("\n");
		ctx.ui.notify(
			`Pipeline "${state.id}" complete!\n\nArtifacts:\n${artifactLines}`,
			"info",
		);
	}
}

// ---------------------------------------------------------------------------
// /pipeline status
// ---------------------------------------------------------------------------

async function handleStatus(ctx: ExtensionCommandContext): Promise<void> {
	const all = readAllStates(ctx.cwd);

	if (all.length === 0) {
		ctx.ui.notify("No pipelines. Start one with /pipeline start [description]", "info");
		return;
	}

	const lines: string[] = [];
	for (const state of all) {
		const pipeline = getPipelineDef(state.pipelineId);
		const total = pipeline?.length ?? 0;
		const isComplete = state.currentStep >= total;
		const status = isComplete ? "complete" : `step ${state.currentStep + 1}/${total}`;
		const currentSkill = !isComplete && pipeline ? pipeline[state.currentStep].skill : "";

		lines.push(`${state.id} [${state.pipelineId}] — ${status}${currentSkill ? ` (${currentSkill})` : ""}`);

		for (const [skill, path] of Object.entries(state.artifacts)) {
			lines.push(`  ✓ ${skill} → ${path}`);
		}
	}

	ctx.ui.notify(lines.join("\n"), "info");
}

// ---------------------------------------------------------------------------
// /pipeline reset [id]
// ---------------------------------------------------------------------------

async function handleReset(instanceId: string, ctx: ExtensionCommandContext): Promise<void> {
	if (instanceId) {
		clearState(ctx.cwd, instanceId);
		ctx.ui.notify(`Pipeline "${instanceId}" cleared`, "info");
		return;
	}

	const all = readAllStates(ctx.cwd);
	if (all.length === 0) {
		ctx.ui.notify("No pipelines to reset", "info");
		return;
	}

	if (all.length === 1) {
		clearState(ctx.cwd, all[0].id);
		ctx.ui.notify(`Pipeline "${all[0].id}" cleared`, "info");
		return;
	}

	const choice = await ctx.ui.select(
		"Select pipeline to reset (or Esc to cancel):",
		["All pipelines", ...all.map((s) => s.id)],
	);
	if (!choice) return;

	if (choice === "All pipelines") {
		const count = clearAllStates(ctx.cwd);
		ctx.ui.notify(`Cleared ${count} pipeline(s)`, "info");
	} else {
		clearState(ctx.cwd, choice);
		ctx.ui.notify(`Pipeline "${choice}" cleared`, "info");
	}
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerPipelineCommand(pi: ExtensionAPI): void {
	pi.registerCommand("pipeline", {
		description: "Orchestrate the skill development pipeline (start/next/status/reset)",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/pipeline requires interactive mode", "error");
				return;
			}

			const trimmed = args.trim();
			const spaceIdx = trimmed.indexOf(" ");
			const subcommand = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
			const subArgs = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1).trim();

			switch (subcommand) {
				case "start":
					return handleStart(subArgs, ctx);
				case "next":
					return handleNext(subArgs, ctx);
				case "status":
					return handleStatus(ctx);
				case "reset":
					return handleReset(subArgs, ctx);
				default:
					ctx.ui.notify(
						"Usage: /pipeline start [description] | next [path] | status | reset [id]",
						"warning",
					);
			}
		},
	});
}
```

#### 2. Extension entry point wiring
**File**: `extensions/rpiv-core/index.ts`
**Changes**: Add import for `registerPipelineCommand` and call it in the registration block.

Before:
```typescript
import { registerAdvisorTool, registerAdvisorCommand } from "./advisor.js";

export default function (pi: ExtensionAPI) {
```

After:
```typescript
import { registerAdvisorTool, registerAdvisorCommand } from "./advisor.js";
import { registerPipelineCommand } from "./pipeline.js";

export default function (pi: ExtensionAPI) {
```

Before:
```typescript
	registerAdvisorTool(pi);
	registerAdvisorCommand(pi);
```

After:
```typescript
	registerAdvisorTool(pi);
	registerAdvisorCommand(pi);
	registerPipelineCommand(pi);
```

#### 3. Gitignore entry
**File**: `.gitignore`
**Changes**: Add `.rpiv/` entry (pipeline state is ephemeral, not project content).

Before:
```
node_modules/
.pi/
```

After:
```
node_modules/
.pi/
.rpiv/
```

### Success Criteria:

#### Automated Verification:
- [x] Extension loads without error: `pi` starts and `/pipeline` is registered
- [x] `grep -r "registerPipelineCommand" extensions/rpiv-core/index.ts` returns a match
- [x] `grep ".rpiv/" .gitignore` returns a match
- [x] `extensions/rpiv-core/pipeline.ts` exists and exports `registerPipelineCommand`

#### Manual Verification:
- [ ] `/pipeline start describe how to implement a new parser` fills editor with `/skill:research-questions describe how to implement a new parser`
- [ ] After running the research-questions skill, `/pipeline next` discovers the artifact, creates a new session, and fills editor with `/skill:research [artifact-path]`
- [ ] `/pipeline status` shows the pipeline instance with step position and artifacts
- [ ] `/pipeline reset` clears the state file from `.rpiv/pipelines/`
- [ ] State file persists across `/new` session resets (it's on disk, not in memory)
- [ ] Multiple concurrent pipelines: starting a second pipeline while one is active works, `/pipeline next` prompts for selection

---

## Testing Strategy

### Automated:
- Extension loads without errors (no build step — jiti transpiles at runtime)
- Pipeline state file is valid JSON after `/pipeline start`

### Manual Testing Steps:
1. Run `/pipeline start describe how to implement a new parser` — verify editor fills with skill command
2. Press Enter to run research-questions skill — verify it executes normally
3. Run `/pipeline next` — verify artifact discovery finds the question file, creates new session, fills editor with research command
4. Press Enter to run research skill — verify it executes normally
5. Run `/pipeline next` — verify pipeline completion message with all artifact paths
6. Run `/pipeline status` — verify it shows the completed pipeline
7. Run `/pipeline reset` — verify state file is removed
8. Test edge cases: `/pipeline next` with no active pipeline, `/pipeline start` with no description

## Performance Considerations

None. Pipeline overhead is trivial fs operations. Skill execution (minutes per step) dominates.

## Migration Notes

Not applicable — new feature, no existing data.

## References

- Design: `thoughts/shared/designs/2026-04-12_03-55-13_skill-flow-pipeline.md`
- Research: `thoughts/shared/research/2026-04-12_02-27-43_skill-flow-chaining.md`
- Questions: `thoughts/shared/questions/2026-04-12_skill-flow-chaining.md`
