---
date: 2026-04-12
designer: Claude Code
git_commit: 920c276
branch: master
repository: rpiv-pi
topic: "Skill flow pipeline command"
tags: [design, skill-system, flow-orchestration, pipeline, extension-command]
status: complete
research_source: "thoughts/shared/research/2026-04-12_02-27-43_skill-flow-chaining.md"
last_updated: 2026-04-12
last_updated_by: Claude Code
---

# Design: Skill Flow Pipeline Command

## Summary

An extension command `/pipeline` that orchestrates the skill development pipeline (research-questions → research, extensible to design → write-plan → implement-plan). Each step runs in a fresh session via `ctx.newSession()`, with the editor pre-filled with the next skill command. State persists on disk at `.rpiv/pipelines/{instance-id}.json`, supporting concurrent pipeline instances. Artifact discovery uses directory snapshots (diff-based) to reliably find each step's output. All artifact paths accumulate in state for forward propagation to future multi-artifact steps.

## Requirements

- Automate the manual skill chaining process (currently: user reads chain text, types next `/skill:name path`)
- Clear context between pipeline steps via `ctx.newSession()`
- Persist pipeline state on disk (survives session resets)
- Track all produced artifacts for forward propagation
- Preserve original user request/description across steps
- Design for extensibility: adding future steps (design, write-plan, implement-plan) should require only adding entries to the pipeline definition

## Current State Analysis

### Key Discoveries

- `pi.sendUserMessage()` sends to OLD (disposed) session after `ctx.newSession()` — `loader.js:174-175` captures stale `runtime` closure. BROKEN for post-newSession use.
- `ctx.ui.setEditorText()` works after `ctx.newSession()` — UI closures capture InteractiveMode instance, not session. `interactive-mode.js:1317`.
- `ctx.waitForIdle()` resolves via InteractiveMode getter to new session — `interactive-mode.js:906`. WORKS after newSession.
- No auto-submit API exists — official pattern is `setEditorText` + user Enter (`handoff.ts:149`).
- `_expandSkillCommand()` runs during normal `prompt()` with `expandPromptTemplates: true` (the default when user submits) — `agent-session.js:812`. No manual expansion needed.
- `stripFrontmatter` is public export from `@mariozechner/pi-coding-agent` — `index.d.ts:26`. Not needed for this design (native expansion handles it).
- Extension commands registered via `pi.registerCommand()` — follows `advisor.ts:247` pattern.
- jiti transpiles .ts at runtime — no build step (`loader.js:223-233`).

### Patterns to Follow

- Module structure: `advisor.ts` — dedicated file, exports `registerXCommand(pi)`, called from `index.ts`
- Command registration: `pi.registerCommand(name, { description, handler })` — `advisor.ts:284-399`
- UI guard: `if (!ctx.hasUI)` early return — every command in the codebase
- State on disk: JSON file read/write with `fs` — simple, survives `/new`

## Scope

### Building

- `/pipeline start [description]` — initialize pipeline, fill editor for step 1
- `/pipeline next [override-path]` — advance to next step (newSession + artifact discovery + fill editor)
- `/pipeline status` — show current pipeline position and artifacts
- `/pipeline reset` — clear pipeline state
- Canary pipeline definition: research-questions → research (2 steps)
- Pipeline state at `.rpiv/pipelines/.pipeline-state.json`
- Extensible pipeline definition with per-step `buildArgs` for multi-artifact support
- `.gitignore` entry for `.rpiv/`

### Not Building

- design, write-plan, implement-plan steps (future extension — just add entries to pipeline definition)
- Pipeline branching (research → research-solutions → design alternate path)
- Configurable pipeline definitions via command args
- LLM-facing tools (no `pipeline_advance` tool)
- Automatic completion detection (user triggers `/pipeline next` manually)
- `pi.sendUserMessage()` usage (broken after newSession)

## Decisions

### Flow control: setEditorText + user Enter

**Ambiguity**: How to invoke the next skill in a fresh session after `ctx.newSession()`.

**Explored**:
- Option A: `pi.sendUserMessage(expanded)` — calls `prompt()` with `expandPromptTemplates: false` (`agent-session.js:989`), and after newSession the `pi` closure targets the disposed session (`loader.js:174`). BROKEN.
- Option B: `ctx.ui.setEditorText("/skill:name args")` — UI closures capture InteractiveMode instance (`interactive-mode.js:1317`), work after newSession. User presses Enter → native `_expandSkillCommand()` handles expansion. WORKS.

**Decision**: Option B. Each step requires user to press Enter on pre-filled editor. This is the official SDK pattern (handoff example).

### Pipeline definition: code-defined with per-step argBuilder

**Ambiguity**: How to pass arguments to each step, given future steps need multiple artifacts.

**Decision**: Each pipeline step defines a `buildArgs(state)` function that constructs skill arguments from the full accumulated pipeline state. Canary steps use single artifact; future steps can combine multiple artifacts + initialArgs. Pipeline definitions live in code (not serialized), looked up by `pipelineId` from state file.

### State location: .rpiv/pipelines/{instance-id}.json

**Decision**: Each pipeline instance writes to `.rpiv/pipelines/{instance-id}.json` (e.g., `2026-04-12_03-55-13.json`). Supports concurrent pipelines. `.rpiv/` added to `.gitignore` (ephemeral per-run state, not project content).

### Artifact discovery: directory snapshot diff (concurrent-safe)

**Ambiguity**: How to reliably identify which artifact was produced by a specific pipeline step, especially with concurrent pipelines.

**Explored**:
- Option A: Newest file by mtime — fragile with concurrent runs or manual skill invocations.
- Option B: Directory snapshot diff — snapshot file list before step, diff after completion. New files = candidates.

**Decision**: Option B. Before each step, snapshot the artifact directory's `.md` file list into `state.dirSnapshot`. When `/pipeline next` runs, diff current files against snapshot. Single new file = auto-select. Multiple = user selector. Zero = manual path required. Concurrent-safe because each pipeline instance tracks its own pre-step snapshot.

## Architecture

### extensions/rpiv-core/pipeline.ts — NEW

Pipeline command: types, pipeline definitions, state I/O, artifact discovery, subcommand handlers.

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

### extensions/rpiv-core/index.ts:24-38 — MODIFY

Add import and register call for pipeline command.

```typescript
// Add import after line 26 (after advisor import):
import { registerPipelineCommand } from "./pipeline.js";

// Add register call after line 37 (after registerAdvisorCommand):
registerPipelineCommand(pi);
```

### .gitignore — MODIFY

Add `.rpiv/` to gitignore (pipeline state is ephemeral, not project content).

```
.rpiv/
```

## Desired End State

```
# User starts pipeline
> /pipeline start describe how to implement a new parser

Pipeline started (1/2: research-questions). Press Enter to run.

# Editor shows: /skill:research-questions describe how to implement a new parser
# User presses Enter — research-questions skill runs in current session

# After skill completes, user advances
> /pipeline next

✓ Found artifact: thoughts/shared/questions/2026-04-12_04-00-00_new-parser.md
New session created. Step 2/2: research. Press Enter to run.

# Editor shows: /skill:research thoughts/shared/questions/2026-04-12_04-00-00_new-parser.md
# User presses Enter — research skill runs in clean session

# After skill completes
> /pipeline next

Pipeline complete! Artifacts:
  research-questions: thoughts/shared/questions/2026-04-12_04-00-00_new-parser.md
  research: thoughts/shared/research/2026-04-12_04-15-00_new-parser.md

# Or check status at any time
> /pipeline status

Pipeline: canary (2/2 complete)
  ✓ research-questions → thoughts/shared/questions/2026-04-12_...
  ✓ research → thoughts/shared/research/2026-04-12_...
```

## File Map

```
extensions/rpiv-core/pipeline.ts  # NEW — pipeline command: types, state I/O, artifact discovery, subcommand handlers
extensions/rpiv-core/index.ts     # MODIFY — import + register call (2 lines)
.gitignore                        # MODIFY — add .rpiv/ entry (1 line)
```

## Ordering Constraints

- pipeline.ts must exist before index.ts can import it
- .gitignore change is independent, can happen any time
- No event handlers needed — no ordering dependency on session lifecycle

## Verification Notes

- After `/pipeline start`, editor must contain the skill command (verify visually)
- After `/pipeline next`, a fresh session must be created (verify "New session started" behavior)
- State file must persist across `/new` session resets (it's on disk)
- Artifact discovery must ignore files older than pipeline startedAt
- `/pipeline reset` must clean up the state file
- The pipeline definition array is the single point of extension — adding a step is one object

## Performance Considerations

None. Pipeline overhead is trivial fs operations. Skill execution (minutes per step) dominates.

## Migration Notes

Not applicable — new feature, no existing data.

## Pattern References

- `extensions/rpiv-core/advisor.ts:247-259` — tool registration pattern (module structure template)
- `extensions/rpiv-core/advisor.ts:284-399` — command registration with `ctx.ui.custom()` panel
- `handoff.ts:138-150` — `ctx.newSession()` + `ctx.ui.setEditorText()` pattern (official SDK example)
- `extensions/rpiv-core/index.ts:33-37` — registration wiring pattern
- `agent-session.js:812-836` — `_expandSkillCommand()` (native expansion, not replicated)

## Developer Context

**Q: Pipeline scope — include implement-plan or stop at write-plan?**
A: Canary pipeline is research-questions → research (2 steps). Designed for easy extension. Future steps (design, write-plan, implement-plan) will need multiple artifacts from prior steps — the `buildArgs` pattern supports this.

**Q: State file location?**
A: `.rpiv/pipelines/.pipeline-state.json` per developer directive.

**Q: Multi-artifact passing for future steps?**
A: Pipeline state accumulates all artifacts in a Record<string, string> keyed by skill name. Each step's `buildArgs(state)` function can reference any prior artifact. Canary steps use single artifact; future design step would combine research + questions + initialArgs.

## Design History

- Slice 1: Types + State Helpers — approved as generated
- Slice 2: Command Handlers — approved as generated
- Slice 3: Wiring (index.ts + .gitignore) — approved as generated

## References

- Research: `thoughts/shared/research/2026-04-12_02-27-43_skill-flow-chaining.md`
- Questions: `thoughts/shared/questions/2026-04-12_skill-flow-chaining.md`
- SDK example: `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/examples/extensions/handoff.ts`
- SDK example: `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/examples/extensions/send-user-message.ts`
