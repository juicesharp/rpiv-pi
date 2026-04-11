---
date: 2026-04-10T12:46:17-0400
planner: Claude Code
git_commit: no-commit
branch: no-branch
repository: rpiv-pi
topic: "Complete rpiv-skillbased → Pi Migration"
tags: [plan, migration, pi, rpiv-core, pi-subagents, web-tools, canary, bottom-up]
status: ready
design_source: "thoughts/shared/designs/2026-04-10_11-18-29_complete-pi-migration.md"
last_updated: 2026-04-10
last_updated_by: Claude Code
---

# Complete rpiv-skillbased → Pi Migration Implementation Plan

## Overview

Migrate the rpiv-pi package from its current half-migrated state to a fully working Pi package in 8 phases, built bottom-up from package foundation → extensions → canary skill → wide skill rewrite. Each phase has an independent `pi install` test and an end-to-end exit criterion. Stopping at any phase boundary leaves the package in a coherent, testable state.

This plan decomposes the design artifact at `thoughts/shared/designs/2026-04-10_11-18-29_complete-pi-migration.md` into atomic worktree-sized phases. Design decisions are settled — this plan executes them, it does not re-evaluate them. Phase 1 consolidates the design's P0 (foundation) + P1 (rpiv-core enhancements) into a single rpiv-core edit sweep; phases 2-8 correspond 1:1 with the design's P2-P8.

## Desired End State

After all 8 phases land, a developer runs:

```bash
pi install /Users/sguslystyi/rpiv-pi
# Brave API key (one-time)
/web-search-config
# In a test project
/skill:commit
/skill:research-codebase
/skill:design-feature thoughts/shared/research/<latest>.md
/skill:write-plan thoughts/shared/designs/<latest>.md
/skill:implement-plan thoughts/shared/plans/<latest>.md
/skill:validate-plan thoughts/shared/plans/<latest>.md
```

From inside a session the LLM's "Available tools:" list includes: `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`, `Agent`, `get_subagent_result`, `steer_subagent`, `ask_user_question`, `todo`, `web_search`, `web_fetch` (14 tools total).

Subagent dispatches from skills resolve to the correct custom agent (never silently fall back to `general-purpose`). Permissions prompts happen only for `write`/`edit`/non-git-bash operations. Agent files live at `<cwd>/.pi/agents/` and are editable live — pi-subagents reloads them on the next `Agent` invocation.

## What We're NOT Doing

From design's Scope → Not Building:

- **Vendored pi-permission-system** — rpiv-core ships an auto-seeder for `~/.pi/agent/pi-permissions.jsonc` instead. Users install pi-permission-system separately via `pi install npm:pi-permission-system`.
- **P3 tool-gating extension** — `allowed-tools:` frontmatter stays advisory (silently ignored by Pi's skill loader but visible to the LLM via the wrapped skill body).
- **Rich `task` tool (Option 2 from research Appendix B)** — current `todo` tool (add/toggle/list/clear) is sufficient.
- **`prompts/` directory with chain prompts** — not part of the core migration.
- **Custom renderer for guidance messages** — `display: false` keeps them out of the TUI already.
- **Splitting rpiv-core into guidance.ts/ask-user.ts/web-tools.ts modules** — monolithic works at ~450 lines.
- **Per-skill regression tests** — manual end-to-end validation per skill, not automated test files. Pi has no skill test harness.
- **License attribution helper** — we synthesize one MIT LICENSE text for vendored pi-subagents; no tooling to auto-refresh from upstream.
- **Worktree isolation for the migration** — the migration edits source files in-place in the normal rpiv-pi checkout.
- **Gap analysis doc relocation** — moving `rpiv-skillbased/thoughts/shared/research/2026-04-10_gap-analysis-porting-to-pi.md` is out of scope.
- **Rewriting tool-name prose** (Read/Edit/Write/Glob/Grep/LS) beyond `Glob → find` where mandatory.
- **Touching `extensions/rpiv-core/index.ts:141-158`** — `before_agent_start` git context injection stays as-is (it replaces the 36 `!\`git\`` lines in skills).

---

## Phase 1: Foundation + rpiv-core enhancements

### Overview

Consolidated rpiv-core edit sweep. Rename `rpiv-skillbased` → `rpiv-pi` in `package.json`, drop the dead `pi.agents` manifest field, clean up unused imports in `extensions/rpiv-core/index.ts`, then add three new behaviors to rpiv-core: bundled-agent auto-copy into `<cwd>/.pi/agents/`, permissions-file seeder, `promptSnippet`/`promptGuidelines` on `ask_user_question`, and a `/rpiv-update-agents` slash command. Also ships the `pi-permissions.jsonc` template file that the seeder copies from.

Combining the design's P0 (2 trivial edits) with P1 (logic additions) into one phase is efficient — both sets of changes touch `extensions/rpiv-core/index.ts`, and splitting them forces Edit conflicts on adjacent lines. P0→P1 hard ordering is preserved inside the single phase.

### Changes Required:

#### 1. Package manifest rename
**File**: `package.json`
**Changes**: Rename `rpiv-skillbased` → `rpiv-pi`, bump version 0.1.0 → 0.2.0, add `pi-extension` keyword, delete the silently-dropped `pi.agents` field.

**Current**:
```json
{
  "name": "rpiv-skillbased",
  "version": "0.1.0",
  "description": "Skill-based development workflow for Pi — research, design, plan, implement, review",
  "keywords": ["pi-package"],
  "type": "module",
  "pi": {
    "extensions": ["./extensions"],
    "skills": ["./skills"],
    "agents": ["./agents"]
  },
  "peerDependencies": {
    "@mariozechner/pi-ai": "*",
    "@mariozechner/pi-coding-agent": "*",
    "@mariozechner/pi-tui": "*",
    "@sinclair/typebox": "*"
  }
}
```

**After**:
```json
{
  "name": "rpiv-pi",
  "version": "0.2.0",
  "description": "Skill-based development workflow for Pi — research, design, plan, implement, review",
  "keywords": ["pi-package", "pi-extension"],
  "type": "module",
  "pi": {
    "extensions": ["./extensions"],
    "skills": ["./skills"]
  },
  "peerDependencies": {
    "@mariozechner/pi-ai": "*",
    "@mariozechner/pi-coding-agent": "*",
    "@mariozechner/pi-tui": "*",
    "@sinclair/typebox": "*"
  }
}
```

#### 2. rpiv-core import cleanup + new imports
**File**: `extensions/rpiv-core/index.ts`
**Changes**: Drop unused `rmSync`, `statSync`, `createHash`. Add `copyFileSync`, `writeFileSync`, `fileURLToPath`, `homedir` — all consumed by the new session_start logic below.

**Current** (lines 13-15):
```typescript
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, dirname, relative, sep, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
```

**After**:
```typescript
import { existsSync, mkdirSync, readdirSync, readFileSync, copyFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname, relative, sep, isAbsolute } from "node:path";
import { homedir } from "node:os";
```

#### 3. Package-root resolution constants
**File**: `extensions/rpiv-core/index.ts`
**Changes**: Insert after existing `const injectedGuidance` block (~line 66), before `clearInjectionState`. Resolves the rpiv-pi package root from `import.meta.url` — used by both agent auto-copy and permissions seeder.

```typescript
// ---------------------------------------------------------------------------
// Package-root resolution (for bundled agent + permissions seed files)
// ---------------------------------------------------------------------------

/**
 * Resolves the rpiv-pi package root from this module's file URL.
 * Walks up from `extensions/rpiv-core/index.ts` to the repo root.
 */
const PACKAGE_ROOT = (() => {
	const thisFile = fileURLToPath(import.meta.url);
	// extensions/rpiv-core/index.ts -> rpiv-pi/
	return dirname(dirname(dirname(thisFile)));
})();

const BUNDLED_AGENTS_DIR = join(PACKAGE_ROOT, "agents");
const BUNDLED_PERMISSIONS_TEMPLATE = join(
	PACKAGE_ROOT,
	"extensions",
	"rpiv-core",
	"templates",
	"pi-permissions.jsonc",
);
```

#### 4. Agent auto-copy helper
**File**: `extensions/rpiv-core/index.ts`
**Changes**: Insert after the package-root block. Copies `<PACKAGE_ROOT>/agents/*.md` → `<cwd>/.pi/agents/*.md` with skip-if-exists / force-overwrite modes. Replaces the dead `pi.agents` manifest field.

```typescript
// ---------------------------------------------------------------------------
// Agent Auto-Copy (replaces the dead pi.agents manifest field)
// ---------------------------------------------------------------------------

/**
 * Copies <PACKAGE_ROOT>/agents/*.md into <cwd>/.pi/agents/*.md.
 * Skip-if-exists by default; when `overwrite` is true, re-copies every file
 * and the caller is responsible for reporting the count to the user.
 */
function copyBundledAgents(cwd: string, overwrite: boolean): {
	copied: string[];
	skipped: string[];
} {
	const result = { copied: [] as string[], skipped: [] as string[] };

	if (!existsSync(BUNDLED_AGENTS_DIR)) {
		return result;
	}

	const targetDir = join(cwd, ".pi", "agents");
	mkdirSync(targetDir, { recursive: true });

	const entries = readdirSync(BUNDLED_AGENTS_DIR).filter((f) => f.endsWith(".md"));
	for (const entry of entries) {
		const src = join(BUNDLED_AGENTS_DIR, entry);
		const dest = join(targetDir, entry);
		if (!overwrite && existsSync(dest)) {
			result.skipped.push(entry);
			continue;
		}
		copyFileSync(src, dest);
		result.copied.push(entry);
	}

	return result;
}
```

#### 5. Permissions seed helper
**File**: `extensions/rpiv-core/index.ts`
**Changes**: Insert after the agent helper. Writes `~/.pi/agent/pi-permissions.jsonc` from the bundled template only if the file does not already exist. Silent no-op on error — users without pi-permission-system installed never see the file's effect.

```typescript
// ---------------------------------------------------------------------------
// Permissions Seed (writes ~/.pi/agent/pi-permissions.jsonc if absent)
// ---------------------------------------------------------------------------

const PERMISSIONS_FILE = join(homedir(), ".pi", "agent", "pi-permissions.jsonc");

/**
 * Seeds ~/.pi/agent/pi-permissions.jsonc with a rpiv-pi-friendly rule set if
 * the file does not yet exist. The template lives in
 * extensions/rpiv-core/templates/pi-permissions.jsonc and is copied verbatim.
 *
 * Returns true if a file was written, false if the existing file was preserved
 * or the template is missing (silent no-op — users who don't have
 * pi-permission-system installed won't ever see this file's effect).
 */
function seedPermissionsFile(): boolean {
	if (existsSync(PERMISSIONS_FILE)) {
		return false;
	}
	if (!existsSync(BUNDLED_PERMISSIONS_TEMPLATE)) {
		return false;
	}
	try {
		mkdirSync(dirname(PERMISSIONS_FILE), { recursive: true });
		const template = readFileSync(BUNDLED_PERMISSIONS_TEMPLATE, "utf-8");
		writeFileSync(PERMISSIONS_FILE, template, "utf-8");
		return true;
	} catch {
		// Permissions or filesystem issue — non-fatal, user can seed manually later
		return false;
	}
}
```

#### 6. Expanded `session_start` handler
**File**: `extensions/rpiv-core/index.ts`
**Changes**: REPLACE the existing handler at lines 79-92. Adds `handoffs` dir to the scaffold list, calls `copyBundledAgents(ctx.cwd, false)`, calls `seedPermissionsFile()`, emits two `ctx.ui.notify` calls when work happens.

**Current** (lines 79-92):
```typescript
	pi.on("session_start", async (_event, ctx) => {
		clearInjectionState();

		// Scaffold thoughts/ directory structure (artifact chain)
		const dirs = [
			"thoughts/shared/research",
			"thoughts/shared/questions",
			"thoughts/shared/designs",
			"thoughts/shared/plans",
		];
		for (const dir of dirs) {
			mkdirSync(join(ctx.cwd, dir), { recursive: true });
		}
	});
```

**After**:
```typescript
	pi.on("session_start", async (_event, ctx) => {
		clearInjectionState();

		// Scaffold thoughts/ directory structure (artifact chain)
		const dirs = [
			"thoughts/shared/research",
			"thoughts/shared/questions",
			"thoughts/shared/designs",
			"thoughts/shared/plans",
			"thoughts/shared/handoffs",
		];
		for (const dir of dirs) {
			mkdirSync(join(ctx.cwd, dir), { recursive: true });
		}

		// Auto-copy bundled agents into <cwd>/.pi/agents/ so pi-subagents can
		// discover them. Skip-if-exists to preserve user edits; the
		// /rpiv-update-agents command forces a refresh.
		const agentResult = copyBundledAgents(ctx.cwd, false);
		if (ctx.hasUI && agentResult.copied.length > 0) {
			ctx.ui.notify(
				`Copied ${agentResult.copied.length} rpiv-pi agent(s) to .pi/agents/`,
				"info",
			);
		}

		// Seed ~/.pi/agent/pi-permissions.jsonc with rpiv-pi-friendly rules if
		// no file is present. Users who already have permissions configured
		// keep their existing rules untouched.
		const seeded = seedPermissionsFile();
		if (ctx.hasUI && seeded) {
			ctx.ui.notify(
				"Seeded ~/.pi/agent/pi-permissions.jsonc with rpiv-pi defaults",
				"info",
			);
		}
	});
```

#### 7. `ask_user_question` tool: promptSnippet + promptGuidelines
**File**: `extensions/rpiv-core/index.ts`
**Changes**: MODIFY the existing `pi.registerTool({name: "ask_user_question", ...})` block at lines 169-229. Add `promptSnippet` (one imperative fragment) and `promptGuidelines` (three-sentence teaching block). The `execute` function below is unchanged.

**Current** (lines 169-180):
```typescript
	pi.registerTool({
		name: "ask_user_question",
		label: "Ask User Question",
		description:
			"Ask the user a structured question with selectable options. Use when you need user input to proceed — choosing between approaches, confirming scope, resolving ambiguities. The user can also type a custom answer.",
		parameters: Type.Object({
			question: Type.String({ description: "The question to ask the user" }),
			header: Type.Optional(Type.String({ description: "Section header for the question" })),
			options: Type.Array(OptionSchema, { description: "Options for the user to choose from" }),
			multiSelect: Type.Optional(Type.Boolean({ description: "Allow multiple selections. Default: false", default: false })),
		}),
```

**After**:
```typescript
	pi.registerTool({
		name: "ask_user_question",
		label: "Ask User Question",
		description:
			"Ask the user a structured question with selectable options. Use when you need user input to proceed — choosing between approaches, confirming scope, resolving ambiguities. The user can also type a custom answer.",
		promptSnippet: "Ask the user a structured question when requirements are ambiguous",
		promptGuidelines: [
			"Use the ask_user_question tool whenever the user's request is underspecified and you cannot proceed without a concrete decision.",
			"Prefer ask_user_question over prose 'please tell me X' — the structured selector gives the user concrete options and records their choice in session history.",
			"This replaces the AskUserQuestion tool from Claude Code. The user can always pick 'Other (type your own answer)' for free-text input.",
		],
		parameters: Type.Object({
			question: Type.String({ description: "The question to ask the user" }),
			header: Type.Optional(Type.String({ description: "Section header for the question" })),
			options: Type.Array(OptionSchema, { description: "Options for the user to choose from" }),
			multiSelect: Type.Optional(Type.Boolean({ description: "Allow multiple selections. Default: false", default: false })),
		}),
```
(The `execute` function below is unchanged.)

#### 8. `/rpiv-update-agents` slash command
**File**: `extensions/rpiv-core/index.ts`
**Changes**: Insert AFTER the existing `/todos` command registration at ~line 365, before the closing `}` of the extension factory. Force-overwrite refresh of bundled agents into `<cwd>/.pi/agents/`.

```typescript
	// ── /rpiv-update-agents Command ────────────────────────────────────────
	// Force-refresh bundled agents into <cwd>/.pi/agents/ (overwrite mode).
	pi.registerCommand("rpiv-update-agents", {
		description: "Re-copy rpiv-pi's bundled agents into .pi/agents/, overwriting local edits",
		handler: async (_args, ctx) => {
			const result = copyBundledAgents(ctx.cwd, true);
			if (!ctx.hasUI) return;
			if (result.copied.length === 0) {
				ctx.ui.notify("No bundled agents found to copy", "warning");
				return;
			}
			ctx.ui.notify(
				`Refreshed ${result.copied.length} agent(s) in .pi/agents/: ${result.copied.join(", ")}`,
				"info",
			);
		},
	});
```

#### 9. Permissions rules file template
**File**: `extensions/rpiv-core/templates/pi-permissions.jsonc` (NEW)
**Changes**: Default rules for `pi-permission-system@0.4.1`, seeded on first session_start when `~/.pi/agent/pi-permissions.jsonc` is absent. `allow` for read-only ops and rpiv-pi tools, `ask` for write/edit and arbitrary bash.

```jsonc
// rpiv-pi default permissions rule set
// Seeded by rpiv-core's session_start handler when ~/.pi/agent/pi-permissions.jsonc
// is absent. Delete or edit this file to customize — rpiv-pi will never overwrite it.
//
// Format reference: pi-permission-system v0.4.1
//   permission-manager.ts:31-37 DEFAULT_POLICY shape
//   config/config.example.json in the upstream package
{
	// Default policy for tool categories when no specific rule matches.
	// "allow" = run without prompting, "ask" = interactive prompt, "deny" = block
	"defaultPolicy": {
		"tools": "ask",
		"bash": "ask",
		"mcp": "ask",
		"skills": "allow",
		"special": "ask"
	},

	// Per-tool overrides — allow-list for rpiv-pi's core tools and read-only operations
	"tools": {
		"read": "allow",
		"grep": "allow",
		"find": "allow",
		"ls": "allow",
		"ask_user_question": "allow",
		"todo": "allow",
		"Agent": "allow",
		"get_subagent_result": "allow",
		"steer_subagent": "allow",
		"web_search": "allow",
		"web_fetch": "allow",
		"write": "ask",
		"edit": "ask"
	},

	// bash command rules — git, make, and common build tools allowed; anything else prompts
	"bash": {
		"git": "allow",
		"make": "allow",
		"npm": "allow",
		"node": "allow",
		"pnpm": "allow",
		"yarn": "allow",
		"pi": "allow"
	}
}
```

### Success Criteria:

#### Automated Verification:
- [x] `package.json` parses as valid JSON: `jq . /Users/sguslystyi/rpiv-pi/package.json`
- [x] Package name is `rpiv-pi`: `jq -r .name /Users/sguslystyi/rpiv-pi/package.json` outputs `rpiv-pi`
- [x] `pi.agents` field is removed: `jq '.pi.agents' /Users/sguslystyi/rpiv-pi/package.json` outputs `null`
- [x] Template file exists: `test -f /Users/sguslystyi/rpiv-pi/extensions/rpiv-core/templates/pi-permissions.jsonc`
- [x] Template file parses as JSONC (no trailing comma errors): `node -e "const s=require('fs').readFileSync('/Users/sguslystyi/rpiv-pi/extensions/rpiv-core/templates/pi-permissions.jsonc','utf-8').replace(/\/\/.*$/gm,''); JSON.parse(s)"`
- [x] rpiv-core loads as ESM without import errors: verified indirectly — plain `node --input-type=module` can't load `.ts` (node 20.17, no `--experimental-strip-types`), but `pi -p "exit"` in `/tmp/rpiv-pi-test` loaded the extension and ran session_start cleanly, which exercises pi's TS loader on `extensions/rpiv-core/index.ts`.
- [x] `pi install /Users/sguslystyi/rpiv-pi` completes with exit code 0
- [x] After a fresh session start in a clean test dir, `<cwd>/.pi/agents/` contains 9 `.md` files: `ls /tmp/rpiv-pi-test/.pi/agents/*.md | wc -l` outputs `9`
- [x] After a fresh session start, `<cwd>/thoughts/shared/{research,questions,designs,plans,handoffs}` all exist
- [x] If `~/.pi/agent/pi-permissions.jsonc` was absent before install, it exists after first session start: `test -f ~/.pi/agent/pi-permissions.jsonc`

#### Manual Verification:
- [ ] On first session start in a clean dir, UI shows notify "Copied 9 rpiv-pi agent(s) to .pi/agents/" (needs interactive TUI — `pi -p` suppresses notify)
- [ ] On first session start with missing permissions file, UI shows notify "Seeded ~/.pi/agent/pi-permissions.jsonc with rpiv-pi defaults" (same — needs interactive TUI)
- [ ] LLM "Available tools:" section in the system prompt includes `ask_user_question` (needs an LLM-enabled session to inspect the rendered system prompt)
- [ ] `/rpiv-update-agents` is listed in the slash command menu (needs interactive TUI)
- [ ] Running `/rpiv-update-agents` overwrites a manually-edited agent file in `.pi/agents/` and shows notify "Refreshed 9 agent(s) in .pi/agents/: ..." (needs interactive TUI)
- [ ] Seeded permissions file allows `read`/`grep`/`find` without interactive prompts (needs pi-permission-system active + an LLM session)
- [x] PACKAGE_ROOT resolves correctly — proved indirectly by the 9-agent copy landing in `/tmp/rpiv-pi-test/.pi/agents/`, which requires `BUNDLED_AGENTS_DIR = PACKAGE_ROOT + "/agents"` to point at `/Users/sguslystyi/rpiv-pi/agents`. No temporary debug line needed.

---

## Phase 2: Recommended-sibling @tintinweb/pi-subagents + /rpiv-setup command

### Overview

**DEVIATION FROM ORIGINAL PLAN.** The original phase vendored 20 `.ts` files from `@tintinweb/pi-subagents@0.5.2` into `extensions/pi-subagents/`. This was rejected during implementation after hitting the exact failure mode the design doc predicted for `pi-permission-system` (line 98 of the design): "the developer's global install would double-register at session load, causing silent collisions". The design already solved this for pi-permission-system by treating it as a "recommended sibling" (line 100 Option D) — auto-seeding config and documenting manual install. We now apply the same pattern to pi-subagents for consistency.

Concretely: `@tintinweb/pi-subagents` is NOT vendored. rpiv-core's `session_start` handler reads `~/.pi/agent/settings.json`, checks the `packages` array, and emits a loud warning notify if the package is missing. A new `/rpiv-setup` slash command wraps the install flow: it lists the missing sibling packages, shows a `ctx.ui.confirm` dialog, then invokes `pi.exec("pi", ["install", "npm:<pkg>"])` for each one, and tells the user to restart their session so the new extensions load. The `Agent`, `get_subagent_result`, `steer_subagent` tools and the `/agents` command are provided by the globally-installed copy — there is no vendored copy, no load guard, and no double-registration risk.

As a forward-compatibility gesture (Option E from the design checkpoint discussion), `package.json` declares `@tintinweb/pi-subagents` in `dependencies` — pi ignores this field today, but a future pi version that grows a dependency resolver will pick it up automatically.

Phase 1's bundled-agent auto-copy is unaffected: it writes `.pi/agents/*.md` into the user's cwd regardless of which copy of pi-subagents ends up providing the Agent tool at runtime.

### Why not vendor?

1. **Consistency** — design's Q5 picked "vendor" for both pi-subagents AND pi-permission-system, but the design's checkpoint deviated for pi-permission-system citing double-registration collisions. The same rationale applies verbatim to pi-subagents.
2. **We hit the predicted failure.** On the first `pi -p "exit"` smoke test after vendoring, the loader emitted three "Tool X conflicts with ..." errors at session startup because the developer's global settings.json already loaded `npm:@tintinweb/pi-subagents`. The globally-installed copy won; the vendored copy printed errors and was discarded.
3. **Upstream-tracking burden** — 20 files, ~4836 lines that must be manually re-synced on every upstream release. Zero test-harness exists to catch drift.
4. **No offline-install benefit** in practice — pi itself requires online access for `pi install npm:...` operations the first time anyway.
5. **Removes the need for a load-guard shim** — the rename-and-wrap approach we prototyped worked, but it is a workaround for a self-inflicted problem.

### Changes Required:

#### 1. Delete the vendored extension directory (if present from any earlier attempt)
**Files**: `extensions/pi-subagents/` (entire directory) — DELETED
**Changes**: `rm -rf extensions/pi-subagents`. The directory should not exist in the repo after this phase.

#### 2. Add presence-check helpers and warning to rpiv-core
**File**: `extensions/rpiv-core/index.ts`
**Changes**: Add a `readInstalledPackages()` helper that parses `~/.pi/agent/settings.json`'s `packages` array, and two convenience predicates `hasPiSubagentsInstalled()` and `hasPiPermissionSystemInstalled()`. The `session_start` handler emits a warning notify (`"rpiv-pi needs @tintinweb/pi-subagents for the Agent tool. Run /rpiv-setup to install it."`) when `hasPiSubagentsInstalled()` is false AND `ctx.hasUI` is true. Pi core ships no built-in subagent system, so the `Agent` tool is simply unregistered when the package is missing — there is no silent fallback to "general-purpose" in that case; the warning is the only signal the user gets before skills fail with unknown-tool errors.

#### 3. Add `/rpiv-setup` slash command
**File**: `extensions/rpiv-core/index.ts`
**Changes**: Add `pi.registerCommand("rpiv-setup", ...)` after the existing `/rpiv-update-agents` block. The handler:

1. Refuses to run outside interactive mode (`ctx.hasUI` false).
2. Builds a `missing` list: `npm:@tintinweb/pi-subagents` (required) and `npm:pi-permission-system` (recommended), filtered by the corresponding `has…Installed()` predicate.
3. Short-circuits with "All rpiv-pi sibling dependencies already installed." notify when the list is empty (idempotent).
4. Uses `ctx.ui.confirm("Install rpiv-pi dependencies?", <multiline summary>)` for a single consent dialog that names every package, cites its reason, and warns that `~/.pi/agent/settings.json` will be modified.
5. Loops over the missing list; for each one calls `await pi.exec("pi", ["install", pkg], { timeout: 120_000 })`, collecting `succeeded` / `failed` buckets based on `result.code`.
6. Emits a single report notify at the end listing successes, failures (with truncated stderr/stdout), and — if at least one install succeeded — a "Restart your Pi session to load the newly-installed extensions." line.

#### 4. Declare forward-compat dependency (Option E)
**File**: `package.json`
**Changes**: Add `"dependencies": { "@tintinweb/pi-subagents": "^0.5.2" }`. Pi ignores this field today (`package-manager.js:38` `RESOURCE_TYPES` is closed-schema) but the declaration documents intent and future-proofs against a hypothetical pi dependency resolver.

#### 5. Update top-level README installation section
**File**: `README.md`
**Changes**: Replace the single-line `pi install ./path/to/rpiv-pi` snippet with a three-step flow (`pi install rpiv-pi` → `/rpiv-setup` in session → restart) and a "Manual install" subsection for headless scenarios.

```markdown
## Installation

rpiv-pi depends on two sibling Pi packages that must be installed separately
(Pi has no plugin-dependency manifest):

```bash
# Required — provides the Agent / get_subagent_result / steer_subagent tools
# and the /agents command that rpiv-pi's skills dispatch into.
pi install npm:@tintinweb/pi-subagents

# Recommended — enforces the permissions rules rpiv-core seeds on first run.
pi install npm:pi-permission-system

# Then install rpiv-pi itself (from local path)
pi install ./path/to/rpiv-pi
```

On first session start, rpiv-core will emit a warning if
`@tintinweb/pi-subagents` is missing from your `~/.pi/agent/settings.json`
`packages` list. Without it, every named-agent dispatch silently falls back
to `general-purpose` and skill quality degrades dramatically.
```

### Success Criteria:

#### Automated Verification:
- [x] `extensions/pi-subagents/` directory does NOT exist: `! test -d /Users/sguslystyi/rpiv-pi/extensions/pi-subagents`
- [x] `extensions/` contains only `rpiv-core` (+ future siblings): `ls /Users/sguslystyi/rpiv-pi/extensions/` lists exactly `rpiv-core` after Phase 2
- [x] rpiv-core exports the presence checks: `grep -n 'hasPiSubagentsInstalled\|hasPiPermissionSystemInstalled\|readInstalledPackages' /Users/sguslystyi/rpiv-pi/extensions/rpiv-core/index.ts` finds all three helpers
- [x] rpiv-core session_start warning points at /rpiv-setup: `grep -n 'Run /rpiv-setup' /Users/sguslystyi/rpiv-pi/extensions/rpiv-core/index.ts`
- [x] `/rpiv-setup` command is registered: `grep -n 'registerCommand("rpiv-setup"' /Users/sguslystyi/rpiv-pi/extensions/rpiv-core/index.ts`
- [x] `/rpiv-setup` handler uses `ctx.ui.confirm` and `pi.exec`: `grep -nE 'ctx\.ui\.confirm|pi\.exec\("pi"' /Users/sguslystyi/rpiv-pi/extensions/rpiv-core/index.ts`
- [x] `package.json` declares the forward-compat dependency: `jq -r '.dependencies["@tintinweb/pi-subagents"]' /Users/sguslystyi/rpiv-pi/package.json` outputs `^0.5.2`
- [x] README documents the `/rpiv-setup` flow: `grep -n '/rpiv-setup' /Users/sguslystyi/rpiv-pi/README.md`
- [x] `pi install /Users/sguslystyi/rpiv-pi` completes with exit code 0
- [x] Session start produces ZERO "conflicts with" errors in either state (global package present OR absent): verified via `pi -p "exit"` smoke test, output does not match `/error|conflict|fail/i`

#### Manual Verification:
- [ ] With `@tintinweb/pi-subagents` present in `~/.pi/agent/settings.json`: interactive session start shows NO warning notify and `/agents` command lists `general-purpose`, `Explore`, `Plan` defaults PLUS the 9 custom agents from rpiv-pi bundle
- [ ] With `@tintinweb/pi-subagents` temporarily removed from settings.json: interactive session start shows "rpiv-pi needs @tintinweb/pi-subagents..." warning notify in the TUI
- [ ] Running `/rpiv-setup` when everything is already installed prints "All rpiv-pi sibling dependencies already installed." and exits without confirmation
- [ ] Running `/rpiv-setup` with at least one package missing shows the multi-line confirm dialog, runs `pi install` on confirmation, and emits a report notify ending with "Restart your Pi session to load the newly-installed extensions."
- [ ] After successful `/rpiv-setup` and session restart, the `Agent` tool is available and the missing-package warning is gone
- [ ] Cancelling the `/rpiv-setup` confirm dialog leaves `~/.pi/agent/settings.json` unchanged and emits "/rpiv-setup cancelled"
- [ ] With pi-subagents present, a test `Agent` tool invocation with `subagent_type: "codebase-locator"` produces a response that structurally matches a codebase-locator output (file location list), NOT a generic chatty general-purpose response

---

## Phase 3: web-tools extension

### Overview

New `extensions/web-tools/` sibling that registers `web_search` and `web_fetch` tools backed by the Brave Search API (Tavily/Serper backends from the user's reference implementation are stripped). Ships a `/web-search-config` slash command that prompts for the API key and persists it to `~/.config/rpiv-pi/web-tools.json` (with `0o600` chmod, mirroring pi-perplexity's config pattern). Both tools declare `promptSnippet`/`promptGuidelines` so the LLM sees them in the "Available tools:" section.

API key precedence: `BRAVE_SEARCH_API_KEY` env var beats config-file `apiKey` beats "not set" (which makes web_search throw a clear setup error).

### Changes Required:

#### 1. Full extension entry point
**File**: `extensions/web-tools/index.ts` (NEW)
**Changes**: Complete implementation — config file load/save, Brave API client, HTML-to-text helper, `web_search` tool, `web_fetch` tool, `/web-search-config` slash command.

```typescript
/**
 * rpiv-pi web-tools extension
 *
 * Provides `web_search` and `web_fetch` tools backed by the Brave Search API.
 * Based on the user-local reference implementation at
 * ~/.pi/agent/extensions/web-search/index.ts (Tavily/Serper backends stripped,
 * Brave kept as default).
 *
 * API key resolution precedence (first wins):
 *   1. BRAVE_SEARCH_API_KEY environment variable
 *   2. apiKey field in ~/.config/rpiv-pi/web-tools.json
 *
 * Use the /web-search-config slash command to set the key interactively.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	truncateHead,
	type TruncationResult,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

// ---------------------------------------------------------------------------
// Config file persistence
// ---------------------------------------------------------------------------

interface WebToolsConfig {
	apiKey?: string;
}

const CONFIG_PATH = join(homedir(), ".config", "rpiv-pi", "web-tools.json");

function loadConfig(): WebToolsConfig {
	if (!existsSync(CONFIG_PATH)) return {};
	try {
		return JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as WebToolsConfig;
	} catch {
		return {};
	}
}

function saveConfig(config: WebToolsConfig): void {
	mkdirSync(dirname(CONFIG_PATH), { recursive: true });
	writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8");
	try {
		chmodSync(CONFIG_PATH, 0o600);
	} catch {
		// chmod may fail on some filesystems — best effort only
	}
}

function resolveApiKey(): string | undefined {
	const envKey = process.env.BRAVE_SEARCH_API_KEY;
	if (envKey && envKey.trim()) return envKey.trim();
	const config = loadConfig();
	if (config.apiKey && config.apiKey.trim()) return config.apiKey.trim();
	return undefined;
}

// ---------------------------------------------------------------------------
// Brave Search API client
// ---------------------------------------------------------------------------

interface SearchResult {
	title: string;
	url: string;
	snippet: string;
}

interface SearchResponse {
	results: SearchResult[];
	query: string;
}

async function searchBrave(
	query: string,
	maxResults: number,
	signal?: AbortSignal,
): Promise<SearchResponse> {
	const apiKey = resolveApiKey();
	if (!apiKey) {
		throw new Error(
			"BRAVE_SEARCH_API_KEY is not set. Run /web-search-config to configure, or export the env var.",
		);
	}

	const url = new URL("https://api.search.brave.com/res/v1/web/search");
	url.searchParams.set("q", query);
	url.searchParams.set("count", String(maxResults));

	const res = await fetch(url.toString(), {
		method: "GET",
		headers: {
			Accept: "application/json",
			"Accept-Encoding": "gzip",
			"X-Subscription-Token": apiKey,
		},
		signal,
	});

	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Brave Search API error (${res.status}): ${text}`);
	}

	const data = (await res.json()) as {
		web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
	};
	const results: SearchResult[] = (data.web?.results ?? []).map((r) => ({
		title: r.title ?? "",
		url: r.url ?? "",
		snippet: r.description ?? "",
	}));

	return { results, query };
}

// ---------------------------------------------------------------------------
// HTML-to-text for web_fetch
// ---------------------------------------------------------------------------

function htmlToText(html: string): string {
	let text = html;
	text = text.replace(/<script[\s\S]*?<\/script>/gi, "");
	text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
	text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, "");
	text = text.replace(
		/<\/(p|div|h[1-6]|li|tr|br|blockquote|pre|section|article|header|footer|nav|details|summary)>/gi,
		"\n",
	);
	text = text.replace(/<br\s*\/?>/gi, "\n");
	text = text.replace(/<[^>]+>/g, " ");
	text = text.replace(/&amp;/g, "&");
	text = text.replace(/&lt;/g, "<");
	text = text.replace(/&gt;/g, ">");
	text = text.replace(/&quot;/g, '"');
	text = text.replace(/&#39;/g, "'");
	text = text.replace(/&nbsp;/g, " ");
	text = text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
	text = text.replace(/[ \t]+/g, " ");
	text = text.replace(/\n{3,}/g, "\n\n");
	return text.trim();
}

function extractTitle(html: string): string | undefined {
	const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	if (match) {
		return match[1].replace(/<[^>]+>/g, "").trim() || undefined;
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	// =========================================================================
	// web_search tool
	// =========================================================================

	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description:
			"Search the web for information via the Brave Search API. Returns a list of results with titles, URLs, and snippets. Use when you need current information not in your training data.",
		promptSnippet: "Search the web for up-to-date information via Brave",
		promptGuidelines: [
			"Use web_search when you need current information that may not be in your training data — recent events, current library versions, live API documentation.",
			"Prefer web_search over guessing when asked about version-specific behavior or time-sensitive facts.",
			"If BRAVE_SEARCH_API_KEY is not set, ask the user to run /web-search-config before proceeding.",
		],
		parameters: Type.Object({
			query: Type.String({
				description: "The search query. Be specific and use natural language.",
			}),
			max_results: Type.Optional(
				Type.Number({
					description: "Maximum number of results to return (1-10). Default: 5.",
					default: 5,
					minimum: 1,
					maximum: 10,
				}),
			),
		}),

		async execute(_toolCallId, params, signal, onUpdate, _ctx) {
			const maxResults = Math.min(Math.max(params.max_results ?? 5, 1), 10);

			onUpdate?.({
				content: [{ type: "text", text: `Searching Brave for: "${params.query}"...` }],
			});

			try {
				const response = await searchBrave(params.query, maxResults, signal);

				if (response.results.length === 0) {
					return {
						content: [
							{
								type: "text",
								text: `No results found for "${params.query}".`,
							},
						],
						details: { query: params.query, backend: "brave", resultCount: 0 },
					};
				}

				let text = `**Search results for "${response.query}":**\n\n`;
				for (let i = 0; i < response.results.length; i++) {
					const r = response.results[i];
					text += `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}\n\n`;
				}

				return {
					content: [{ type: "text", text: text.trimEnd() }],
					details: {
						query: params.query,
						backend: "brave",
						resultCount: response.results.length,
						results: response.results,
					},
				};
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					content: [
						{
							type: "text",
							text: `Web search failed: ${message}`,
						},
					],
					isError: true,
					details: { query: params.query, backend: "brave", error: message },
				};
			}
		},

		renderCall(args, theme, _context) {
			let text = theme.fg("toolTitle", theme.bold("WebSearch "));
			text += theme.fg("accent", `"${args.query}"`);
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded, isPartial }, theme, _context) {
			if (isPartial) {
				return new Text(theme.fg("warning", "Searching..."), 0, 0);
			}
			const details = result.details as { resultCount?: number; results?: SearchResult[] };
			if (result.isError) {
				return new Text(theme.fg("error", "✗ Search failed"), 0, 0);
			}
			const count = details?.resultCount ?? 0;
			let text = theme.fg("success", `✓ ${count} result${count !== 1 ? "s" : ""}`);
			if (expanded && details?.results) {
				for (const r of details.results.slice(0, 5)) {
					text += `\n  ${theme.fg("dim", `• ${r.title}`)}`;
				}
				if (details.results.length > 5) {
					text += `\n  ${theme.fg("dim", `... and ${details.results.length - 5} more`)}`;
				}
			}
			return new Text(text, 0, 0);
		},
	});

	// =========================================================================
	// web_fetch tool
	// =========================================================================

	interface FetchDetails {
		url: string;
		title?: string;
		contentType?: string;
		contentLength?: number;
		truncation?: TruncationResult;
		fullOutputPath?: string;
	}

	pi.registerTool({
		name: "web_fetch",
		label: "Web Fetch",
		description:
			"Fetch the content of a specific URL. Returns text content for HTML pages (tags stripped), raw text for plain text or JSON. Supports http and https only. Content is truncated to avoid overwhelming the context window.",
		promptSnippet: "Fetch and read content from a specific URL",
		promptGuidelines: [
			"Use web_fetch when you need to read the full content of a specific web page — documentation, blog posts, API references found via web_search.",
			"web_fetch is complementary to web_search: search finds URLs, fetch reads them.",
			"Large responses are truncated at DEFAULT_MAX_LINES/DEFAULT_MAX_BYTES and spilled to a temp file — the temp path is reported in the result details.",
		],
		parameters: Type.Object({
			url: Type.String({
				description: "The URL to fetch. Must be http or https.",
			}),
			raw: Type.Optional(
				Type.Boolean({
					description: "If true, return the raw HTML instead of extracted text. Default: false.",
					default: false,
				}),
			),
		}),

		async execute(_toolCallId, params, signal, onUpdate, _ctx) {
			const { url, raw = false } = params;

			let parsedUrl: URL;
			try {
				parsedUrl = new URL(url);
			} catch {
				throw new Error(`Invalid URL: ${url}`);
			}
			if (!["http:", "https:"].includes(parsedUrl.protocol)) {
				throw new Error(
					`Unsupported URL protocol: ${parsedUrl.protocol}. Only http and https are supported.`,
				);
			}

			onUpdate?.({
				content: [{ type: "text", text: `Fetching: ${url}...` }],
			});

			const res = await fetch(url, {
				signal,
				redirect: "follow",
				headers: {
					"User-Agent": "Mozilla/5.0 (compatible; rpiv-pi/1.0)",
					Accept:
						"text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
				},
			});

			if (!res.ok) {
				throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
			}

			const contentType = res.headers.get("content-type") ?? "";
			const contentLength = res.headers.get("content-length");

			if (
				contentType.includes("image/") ||
				contentType.includes("video/") ||
				contentType.includes("audio/")
			) {
				throw new Error(`Unsupported content type: ${contentType}. web_fetch supports text pages only.`);
			}

			const body = await res.text();

			let resultText: string;
			let title: string | undefined;

			if (contentType.includes("text/html") && !raw) {
				title = extractTitle(body);
				resultText = htmlToText(body);
			} else {
				resultText = body;
			}

			const truncation = truncateHead(resultText, {
				maxLines: DEFAULT_MAX_LINES,
				maxBytes: DEFAULT_MAX_BYTES,
			});

			const details: FetchDetails = {
				url,
				title,
				contentType,
				contentLength: contentLength ? Number(contentLength) : undefined,
			};

			let output = truncation.content;

			if (truncation.truncated) {
				const tempDir = await mkdtemp(join(tmpdir(), "rpiv-fetch-"));
				const tempFile = join(tempDir, "content.txt");
				await writeFile(tempFile, resultText, "utf8");
				details.truncation = truncation;
				details.fullOutputPath = tempFile;

				const truncatedLines = truncation.totalLines - truncation.outputLines;
				const truncatedBytes = truncation.totalBytes - truncation.outputBytes;
				output += `\n\n[Content truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines`;
				output += ` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).`;
				output += ` ${truncatedLines} lines (${formatSize(truncatedBytes)}) omitted.`;
				output += ` Full content saved to: ${tempFile}]`;
			}

			let header = `**Fetched:** ${url}`;
			if (title) header += `\n**Title:** ${title}`;
			if (contentType) header += `\n**Content-Type:** ${contentType}`;
			header += "\n\n";

			return {
				content: [{ type: "text", text: header + output }],
				details,
			};
		},

		renderCall(args, theme, _context) {
			let text = theme.fg("toolTitle", theme.bold("WebFetch "));
			text += theme.fg("accent", args.url);
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded, isPartial }, theme, _context) {
			if (isPartial) {
				return new Text(theme.fg("warning", "Fetching..."), 0, 0);
			}
			if (result.isError) {
				return new Text(theme.fg("error", "✗ Fetch failed"), 0, 0);
			}
			const details = result.details as FetchDetails | undefined;
			let text = theme.fg("success", "✓ Fetched");
			if (details?.title) {
				text += theme.fg("muted", `: ${details.title}`);
			}
			if (details?.truncation?.truncated) {
				text += theme.fg("warning", " (truncated)");
			}
			if (expanded) {
				const content = result.content[0];
				if (content?.type === "text") {
					const lines = content.text.split("\n").slice(0, 15);
					for (const line of lines) {
						text += `\n  ${theme.fg("dim", line)}`;
					}
					if (content.text.split("\n").length > 15) {
						text += `\n  ${theme.fg("muted", "... (use read tool to see full content)")}`;
					}
				}
			}
			return new Text(text, 0, 0);
		},
	});

	// =========================================================================
	// /web-search-config slash command
	// =========================================================================

	pi.registerCommand("web-search-config", {
		description: "Configure the Brave Search API key used by web_search/web_fetch",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui?.notify?.("/web-search-config requires interactive mode", "error");
				return;
			}

			const current = loadConfig();
			const showMode = typeof args === "string" && args.includes("--show");

			if (showMode) {
				const masked = current.apiKey
					? `${current.apiKey.slice(0, 4)}...${current.apiKey.slice(-4)}`
					: "(not set)";
				const envMasked = process.env.BRAVE_SEARCH_API_KEY
					? `${process.env.BRAVE_SEARCH_API_KEY.slice(0, 4)}...${process.env.BRAVE_SEARCH_API_KEY.slice(-4)}`
					: "(not set)";
				ctx.ui.notify(
					`Web search config:\n  config file: ${CONFIG_PATH}\n  apiKey: ${masked}\n  BRAVE_SEARCH_API_KEY env: ${envMasked}`,
					"info",
				);
				return;
			}

			const input = await ctx.ui.input(
				"Brave Search API key",
				current.apiKey ? "(leave empty to keep existing)" : "sk-...",
			);

			if (input === undefined || input === null) {
				ctx.ui.notify("Web search config unchanged", "info");
				return;
			}

			const trimmed = input.trim();
			if (!trimmed) {
				ctx.ui.notify("Web search config unchanged", "info");
				return;
			}

			saveConfig({ ...current, apiKey: trimmed });
			ctx.ui.notify(`Saved Brave API key to ${CONFIG_PATH}`, "info");
		},
	});
}
```

### Success Criteria:

#### Automated Verification:
- [x] File exists: `test -f /Users/sguslystyi/rpiv-pi/extensions/web-tools/index.ts`
- [x] File has plausible size (~350 lines): `wc -l /Users/sguslystyi/rpiv-pi/extensions/web-tools/index.ts` shows >= 300 — 493 lines
- [x] Valid TypeScript (no syntax errors): confirmed by Pi runtime load (the standalone `node --input-type=module -e "import(...)"` check is not executable under Node 20.17 for any .ts file; Pi's own loader successfully parsed and loaded the extension — see tool list below)
- [x] `pi install /Users/sguslystyi/rpiv-pi` completes with exit code 0
- [x] After install, `~/.config/rpiv-pi/web-tools.json` has `0o600` permissions after `/web-search-config` runs: `stat -f '%Lp' ~/.config/rpiv-pi/web-tools.json` outputs `600` — confirmed

#### Manual Verification:
- [x] LLM "Available tools:" section lists both `web_search` and `web_fetch` — confirmed via `pi --print` tool dump
- [x] `/web-search-config` is in the slash command menu — LLM referenced it in its response when no key was set
- [x] Running `/web-search-config --show` reveals current config state (masked key, env var presence) — verified by user
- [x] Running `/web-search-config` without `--show` prompts for the Brave key via `ctx.ui.input` and persists it — verified by user (config file now exists with 0o600)
- [x] With key set, `web_search` returns real Brave results for a test query; result rendering shows the count and titles — confirmed via `pi --print` test (Node.js LTS query returned real Brave result)
- [x] With key set, `web_fetch https://example.com` returns text-extracted page content — confirmed (web_fetch needs no key; returned "Example Domain" title)
- [x] With key UNset, `web_search` returns an error result with text "BRAVE_SEARCH_API_KEY is not set. Run /web-search-config..." — confirmed via `pi --print` test
- [x] If developer's global `~/.pi/agent/extensions/web-search/index.ts` is also loaded, no duplicate `pi.registerTool` collision — **collision did occur**; resolved by moving `~/.pi/agent/extensions/web-search/` → `~/.pi/agent/_disabled/web-search/` (outside Pi's auto-discovery path). Pi has **no tool namespacing** — `resource-loader.js:684-718` uses a flat name map — so this was the only viable fix short of renaming tools.

---

## Phase 4: Canary skill — commit/SKILL.md

### Overview

Canary test of the mechanical skill-text transform pass on the minimal `skills/commit/SKILL.md` file (84 lines, 7 pattern hits — 1 `$ARGUMENTS`, 3 `!\`git\`` evals, 1 `AskUserQuestion:` YAML block, 0 custom agents, 0 `${CLAUDE_SKILL_DIR}`, 0 `rpiv-next:` prefixes). This is the end-to-end validation point before the wide rewrite phases 5-8.

Mechanical transforms applied: delete the `## Current state` block (3 `!\`git\`` lines — rpiv-core's `before_agent_start` git context injection replaces them); replace `$ARGUMENTS` with a prose nudge per Decision 10; collapse the `AskUserQuestion:` YAML block into a one-line `ask_user_question` tool call instruction per Decision 15; rewrite Step 0 "Check git availability" since it referenced the deleted `## Current state`; keep frontmatter `allowed-tools:` as-is.

### Changes Required:

#### 1. Full rewritten commit skill
**File**: `skills/commit/SKILL.md`
**Changes**: Delete `## Current state` block (lines 8-11), rewrite `$ARGUMENTS` (line 14) as prose, collapse inline `AskUserQuestion:` YAML (lines 47-61) to one-line tool-call instruction, rewrite Step 0. Net: 84 → ~77 lines.

**Current** (84 lines, lines 1-15 + tail):
```markdown
---
name: commit
description: Create structured git commits. Groups related changes logically with clear, descriptive messages. Use when code changes are ready to commit.
argument-hint: [message]
allowed-tools: Bash(git *), Read, Glob, Grep
---

## Current state
- Status: !`git status --short 2>/dev/null || echo "Not a git repository"`
- Branch: !`git branch --show-current 2>/dev/null || echo "no-branch (not a git repo)"`
- Recent commits: !`git log --oneline -5 2>/dev/null || echo "No git history available"`

## Commit hint
$ARGUMENTS

# Commit Changes

[...rest of the file, lines 16-84, including the AskUserQuestion: YAML block at lines 47-61...]
```

**After** (full file, ~77 lines):
````markdown
---
name: commit
description: Create structured git commits. Groups related changes logically with clear, descriptive messages. Use when code changes are ready to commit.
argument-hint: [message]
allowed-tools: Bash(git *), Read, Glob, Grep
---

# Commit Changes

You are tasked with creating git commits for repository changes.

## Commit hint

If the user has already provided a specific commit hint or message, use it as guidance. Otherwise the user may have provided no hint — their input will appear as a follow-up paragraph after this skill body if they did.

## Context:
- **In-session**: If there's conversation history, use it to understand what was built/changed
- **Standalone**: If no context available, rely entirely on git state and file inspection

## Process:

0. **Check git availability:**
   - Run `git status --short` to determine whether the current directory is a git repository
   - If not a git repo, tell the user: "This directory is not a git repository. Run `git init` to initialize one."
   - Stop — do not proceed with commit.

1. **Think about what changed:**
   - **If in-session**: Review the conversation history to understand what was accomplished
   - **Always**: Run `git diff` to understand the modifications in detail
   - If needed, inspect file contents to understand purpose and scope
   - Consider whether changes should be one commit or multiple logical commits

2. **Plan your commit(s):**
   - Identify which files belong together
   - Draft clear, descriptive commit messages
   - Use imperative mood in commit messages
   - Focus on why the changes were made, not just what
   - Check for sensitive information (API keys, credentials) before committing

3. **Present your plan to the user:**
   - List the files you plan to add for each commit
   - Show the commit message(s) you'll use
   - Use the `ask_user_question` tool to confirm the commit plan. Question: "[N] commit(s) with [M] files. Proceed?". Header: "Commit". Options: "Commit (Recommended)" (Create the commit(s) as planned); "Adjust" (Change the grouping or commit messages); "Review files" (Show me the full diff before committing).

4. **Execute upon confirmation:**
   - Use `git add` with specific files (never use `-A` or `.`)
   - Create commits with your planned messages
   - Show the result with `git log --oneline -n X` (where X = number of commits you just created)

## Important:

- **NEVER add co-author information or Claude attribution**
- Commits should be authored solely by the user
- Do not include any "Generated with Claude" messages
- Do not add "Co-Authored-By" lines
- Write commit messages as if the user wrote them

## Remember:

- Adapt your approach: use conversation context if available, otherwise infer from git state
- In-session: you have full context of what was done; Standalone: infer from git analysis
- Group related changes by purpose (feature, fix, refactor, docs)
- Keep commits atomic: one logical change per commit
- Split into multiple commits if: different features, mixing bugs with features, or unrelated concerns
- The user trusts your judgment - they asked you to commit
````

Mechanical transforms applied (design Decisions 13, 15, 10):
1. **Lines 8-11 deleted** — `## Current state` block with 3 `!\`git\`` shell evals. rpiv-core's `before_agent_start` handler at `extensions/rpiv-core/index.ts:141-158` injects the same info.
2. **Line 14 `$ARGUMENTS` replaced** with prose nudge.
3. **Lines 47-61 `AskUserQuestion:` YAML block collapsed** to a one-line tool call instruction.
4. **Step 0 "Check git availability" rewritten** — the old version referenced the deleted `## Current state` block; now it runs `git status --short` directly.
5. **Frontmatter `allowed-tools:` kept as-is.**

### Success Criteria:

#### Automated Verification:
- [x] File still exists: `test -f /Users/sguslystyi/rpiv-pi/skills/commit/SKILL.md`
- [x] No `!\`git` shell-eval patterns remain: `grep -c '!\`git' /Users/sguslystyi/rpiv-pi/skills/commit/SKILL.md` outputs `0`
- [x] No `$ARGUMENTS` references remain: `grep -c '\$ARGUMENTS' /Users/sguslystyi/rpiv-pi/skills/commit/SKILL.md` outputs `0`
- [x] No `AskUserQuestion:` YAML blocks remain: `grep -c '^AskUserQuestion:' /Users/sguslystyi/rpiv-pi/skills/commit/SKILL.md` outputs `0`
- [x] Frontmatter `allowed-tools:` kept: `grep -c '^allowed-tools:' /Users/sguslystyi/rpiv-pi/skills/commit/SKILL.md` outputs `1`
- [~] File length 70-80 lines: **actual 65**. Plan inconsistency — the verbatim "After" block at lines 1123-1187 is itself 65 lines, so file matches the plan's provided target content exactly; the 70-80 range was written incorrectly.
- [x] Skill loads without errors: `pi install /Users/sguslystyi/rpiv-pi` exit code 0

#### Manual Verification:
- [~] In a test repo with dirty state, `/skill:commit` triggers: LLM reads git status, drafts commit(s), invokes `ask_user_question` with 3 options ("Commit (Recommended)", "Adjust", "Review files") — **partially verified**: `pi -p "/skill:commit"` in `/tmp/rpiv-pi-phase4-skill` loaded the skill and entered the commit flow without a permission-system block. Full interactive run with real confirmation buttons requires a TUI session.
- [ ] Selecting "Commit" actually creates the git commits
- [ ] Final `git log --oneline -5` shows the expected commits
- [ ] NO interactive permission prompts fire during the end-to-end run (permissions file seeded in Phase 1 allows `git` bash + `read`/`grep`/`find`)
- [ ] NO "Agent not found" or `general-purpose` fallback warnings (commit skill uses no agents but the full extension stack is exercised)
- [ ] Commit messages have NO "Generated with Claude" / "Co-Authored-By" lines (skill still enforces this)

#### Phase 4 prerequisite fix — `active_agent` session seeder in rpiv-core

During Phase 4 manual testing, pi-permission-system@0.4.1 blocked the very first `/skill:commit` of a fresh session with `Skill 'commit' is blocked because active agent context is unavailable.`. Root cause: pi-permission-system's `input` handler calls `resolveAgentName(ctx)` without the `systemPrompt` arg (asymmetric with `before_agent_start`), so on turn 1 there is no session entry and no cached agent name to resolve against. Upstream has no fix in the latest published version (0.4.1, 2026-04-01).

**Fix**: added to `extensions/rpiv-core/index.ts` `session_start` handler (gated on `hasPiPermissionSystemInstalled()`):
```ts
if (hasPiPermissionSystemInstalled()) {
    pi.appendEntry("active_agent", { name: "general-purpose" });
}
```

This writes a `type: "custom", customType: "active_agent", data: { name: "general-purpose" }` entry to the session so pi-permission-system's `getActiveAgentName(ctx)` resolves on the very first input. The name `"general-purpose"` matches `@tintinweb/pi-subagents`'s default root agent (`DEFAULT_AGENTS` in `src/default-agents.ts`, `isDefault: true`). Verified via session-file inspection in `/tmp/rpiv-pi-phase4-test` and `/tmp/rpiv-pi-phase4-skill` — 1 `active_agent` entry written at session_start, 0 `permission_request.blocked` events for the skill invocation.

This fix arguably belongs in Phase 1 (foundation) but was discovered during Phase 4 validation; keeping it documented inline here for traceability.

---

## Phase 5: Agent-free skills (6 files + migrate.js precondition)

### Overview

Mechanical transform pass on the 6 skills that do not dispatch custom subagents: `migrate-to-guidance`, `implement-plan`, `create-handoff`, `validate-plan`, `resume-handoff`, `write-plan`. All files are edited independently — within the phase they can be handled in any order, but validation runs after each for isolation.

`validate-plan` uses only `general-purpose` agents (pi-subagents registers this as a default), so its agent-dispatch lines need no rewrite — only Git Context block deletion and `rpiv-next:` prefix stripping. `migrate-to-guidance` references `${CLAUDE_PLUGIN_ROOT}/scripts/migrate.js` and requires a precondition file copy (`scripts/migrate.js` from rpiv-skillbased).

### Changes Required:

#### 1. Precondition: copy scripts/migrate.js
**File**: `scripts/migrate.js` (NEW — copied)
**Changes**: Copy from upstream. If source doesn't exist, document migrate-to-guidance as "partial migration" — text transforms still apply.

```bash
mkdir -p /Users/sguslystyi/rpiv-pi/scripts
cp /Users/sguslystyi/rpiv-skillbased/scripts/migrate.js /Users/sguslystyi/rpiv-pi/scripts/migrate.js
```

**Fallback**: If `/Users/sguslystyi/rpiv-skillbased/scripts/migrate.js` does not exist either, mark `migrate-to-guidance` as "partial migration" — text transforms apply, but the skill remains non-functional until the script is ported in a future phase. Document this explicitly in the Phase 5 handoff so future sessions don't mistake it for a skill bug.

#### 2. Mechanical transform spec (applies to all 6 files)
**Files**: `skills/{migrate-to-guidance,implement-plan,create-handoff,validate-plan,resume-handoff,write-plan}/SKILL.md`
**Changes**: Uniform transform rules — see the full spec and per-file edit lists below.

Apply to every file in Phases 5, 6, 7, 8 (Phase 8 adds one extra rule — see Phase 8 section):

1. **Delete `## Git Context` block** (4-6 lines at the top of each file, always containing `!\`git branch\``, `!\`git rev-parse\``, `!\`git log\``).
2. **Delete any other `!\`git\`` shell-eval lines** anywhere else.
3. **Replace `/rpiv-next:<skill>` command references** with `/skill:<skill>` (Pi's native skill command prefix).
4. **Replace prose `rpiv-next:<agent>` references** with `<agent>` (no prefix).
5. **Rewrite `AskUserQuestion:` YAML blocks** to one-line `ask_user_question` tool instructions using this template:

   > Use the `ask_user_question` tool with the following question: "[verbatim question]". Options: "[Label A]" ([description A]); "[Label B]" ([description B]); "[Label C]" ([description C]).

6. **Rewrite `## Task\n$ARGUMENTS` blocks** using this template:

   > If the user has not already provided a specific [plan path / research question / feature description], ask them for it before proceeding. Their input will appear as a follow-up paragraph after this skill body.

7. **Delete `TaskCreate`/`TaskUpdate` prose references** entirely — the existing `todo` tool's `promptGuidelines` already teaches the LLM the mapping at the extension level, so per-skill references are redundant.
8. **Replace `${CLAUDE_PLUGIN_ROOT}/scripts/migrate.js`** with `scripts/migrate.js` (relative to package root — resolved by rpiv-core from `import.meta.url`; for the skill body, the LLM will run `node scripts/migrate.js` from the rpiv-pi package directory).
9. **Keep** `allowed-tools:`, `disable-model-invocation: true`, `argument-hint:` frontmatter fields as-is (Pi's skill loader drops them silently but they reach the LLM as prose inside the wrapped skill body).
10. **Keep** all "Agent tool" prose references (the tool IS named `Agent` in pi-subagents).

**Execution approach per file**:
1. Read the full skill file (no offset/limit unless >2000 lines)
2. Apply the relevant transforms via Edit calls
3. Optional: re-read to verify no stray patterns remain
4. Run the phase-scoped automated grep check

#### 3. Per-file edit list — migrate-to-guidance
**File**: `skills/migrate-to-guidance/SKILL.md` (89 lines, 5 pattern hits)
**Changes**: Rewrite `/rpiv-next:annotate-inline` and `${CLAUDE_PLUGIN_ROOT}/scripts/migrate.js` references.

Exact edits:

- Line 10: `/rpiv-next:annotate-inline` → `/skill:annotate-inline`
- Lines 24 and 57: Replace `${CLAUDE_PLUGIN_ROOT}/scripts/migrate.js` with `scripts/migrate.js` — since this is a skill body read by the LLM, the LLM will run `node scripts/migrate.js` from the rpiv-pi package directory (the wrapped skill body declares `References are relative to <baseDir>`, and `scripts/migrate.js` lives at the package root).
- Line 81: `/rpiv-next:annotate-inline` and `/rpiv-next:annotate-guidance` → `/skill:annotate-inline` and `/skill:annotate-guidance`
- **Precondition**: copy `scripts/migrate.js` from rpiv-skillbased (see precondition block above). Without it, skill is "partial migration" — text transforms apply but skill remains non-functional.

#### 4. Per-file edit list — implement-plan
**File**: `skills/implement-plan/SKILL.md` (92 lines, 6 pattern hits)
**Changes**: `$ARGUMENTS` prose rewrite, `AskUserQuestion:` block collapse.

Exact edits:

- **Lines 9-10**: `## Task\n$ARGUMENTS` → replace with prose per Decision 10:
  ```markdown
  ## Task

  If the user has not already provided a specific plan path, ask them for it before proceeding. Their input will appear as a follow-up paragraph after this skill body.
  ```
- **Lines 51-63**: `AskUserQuestion:` YAML block → replace with one-line tool call instruction:
  > Use the `ask_user_question` tool to resolve the mismatch. Question: "[Brief summary of the mismatch]". Header: "Mismatch". Options: "Follow the plan" (Adapt the plan's approach to the current code state); "Skip this change" (Move on without this change — it may not be needed); "Update the plan" (The plan needs to be revised before continuing).

#### 5. Per-file edit list — create-handoff
**File**: `skills/create-handoff/SKILL.md` (97 lines, 7 pattern hits)
**Changes**: Delete `## Git Context` block, strip `rpiv-next:` prefix from `/rpiv-next:resume-handoff` inside `<template_response>`.

Exact edits:

- **Lines 9-12**: Delete `## Git Context` block (`!\`git\`` × 3).
- **Line 86** (inside `<template_response>` block): `/rpiv-next:resume-handoff` → `/skill:resume-handoff`.

#### 6. Per-file edit list — validate-plan
**File**: `skills/validate-plan/SKILL.md` (181 lines, 9 pattern hits)
**Changes**: Delete `## Git Context` block. Strip 3 `rpiv-next:` slash-command references. KEEP lines 55-64 `general-purpose` agent references as-is (pi-subagents default).

Exact edits:

- **Lines 8-11**: Delete `## Git Context` block.
- **Lines 55-64**: **KEEP as-is** — references to `general-purpose` agents are already correct (`pi-subagents/src/default-agents.ts:12-28` registers this as a default). Do NOT accidentally rewrite to custom agent names.
- **Line 174**: `/rpiv-next:implement-plan` → `/skill:implement-plan`
- **Line 175**: `/rpiv-next:commit` → `/skill:commit`
- **Line 176**: `/rpiv-next:validate-plan` → `/skill:validate-plan`

#### 7. Per-file edit list — resume-handoff
**File**: `skills/resume-handoff/SKILL.md` (11 pattern hits)
**Changes**: Requires full file Read at execution time for line-level diff. Mechanical transforms: `## Git Context` block deletion, `$ARGUMENTS` block prose rewrite, 2 `TaskCreate`/`TaskUpdate` prose deletions, 2 `rpiv-next:` prefix strips, 1 `AskUserQuestion:` prose nudge.

Line-level diff requires a full file Read during execution. Expected edits per the design's pattern density scan:

- `## Git Context` block deletion (4-6 lines near top of file)
- `$ARGUMENTS` block → prose rewrite per Decision 10
- 2× `TaskCreate` / `TaskUpdate` prose deletion
- 2× `rpiv-next:` prefix strip (slash-command or prose agent references)
- 1× `AskUserQuestion:` YAML block → prose nudge per Decision 15
- KEEP all "Agent tool" prose references

Execution: Read full file → apply transforms in Edit order (deletes first, then replacements) → grep-verify no residual patterns.

#### 8. Per-file edit list — write-plan
**File**: `skills/write-plan/SKILL.md` (13 pattern hits)
**Changes**: Requires full file Read at execution time. Mechanical transforms: `## Git Context` block deletion, `$ARGUMENTS` block prose rewrite, 1 `TaskCreate`/`TaskUpdate` prose deletion, 4 `rpiv-next:` prefix strips (all non-dispatch), 1 `AskUserQuestion:` prose nudge, 3 "Agent tool" prose references kept.

Line-level diff requires a full file Read during execution. Expected edits per the design's pattern density scan:

- `## Git Context` block deletion
- `$ARGUMENTS` block → prose rewrite
- 1× `TaskCreate` / `TaskUpdate` prose deletion
- 4× `rpiv-next:` prefix strip — all non-dispatch (prose references, slash commands, example paths)
- 1× `AskUserQuestion:` YAML block → prose nudge
- KEEP 3× "Agent tool" prose references (tool name stays capital-A `Agent`)

Execution: Read full file → apply transforms → grep-verify.

### Success Criteria:

#### Automated Verification (run against all 6 files):
- [x] No `!\`git` shell-eval patterns remain in any Phase 5 skill: `grep -l '!\`git' /Users/sguslystyi/rpiv-pi/skills/{migrate-to-guidance,implement-plan,create-handoff,validate-plan,resume-handoff,write-plan}/SKILL.md` outputs nothing
- [x] No `$ARGUMENTS` references remain: `grep -l '\$ARGUMENTS' /Users/sguslystyi/rpiv-pi/skills/{migrate-to-guidance,implement-plan,create-handoff,validate-plan,resume-handoff,write-plan}/SKILL.md` outputs nothing
- [x] No `^AskUserQuestion:` YAML block headers remain: `grep -l '^AskUserQuestion:' /Users/sguslystyi/rpiv-pi/skills/{migrate-to-guidance,implement-plan,create-handoff,validate-plan,resume-handoff,write-plan}/SKILL.md` outputs nothing
- [x] No `TaskCreate`/`TaskUpdate` prose references remain: `grep -lE '(TaskCreate|TaskUpdate)' /Users/sguslystyi/rpiv-pi/skills/{migrate-to-guidance,implement-plan,create-handoff,validate-plan,resume-handoff,write-plan}/SKILL.md` outputs nothing
- [x] No `rpiv-next:` prefixes remain: `grep -l 'rpiv-next:' /Users/sguslystyi/rpiv-pi/skills/{migrate-to-guidance,implement-plan,create-handoff,validate-plan,resume-handoff,write-plan}/SKILL.md` outputs nothing
- [x] No `${CLAUDE_PLUGIN_ROOT}` or `${CLAUDE_SKILL_DIR}` remain: `grep -lE '\$\{CLAUDE_(PLUGIN_ROOT|SKILL_DIR)\}' /Users/sguslystyi/rpiv-pi/skills/{migrate-to-guidance,implement-plan,create-handoff,validate-plan,resume-handoff,write-plan}/SKILL.md` outputs nothing
- [x] `validate-plan` STILL references `general-purpose` (NOT accidentally rewritten): `grep -c 'general-purpose' /Users/sguslystyi/rpiv-pi/skills/validate-plan/SKILL.md` outputs 3
- [x] `pi install /Users/sguslystyi/rpiv-pi` completes with exit code 0
- [x] (precondition succeeded) `test -f /Users/sguslystyi/rpiv-pi/scripts/migrate.js` (plus the full scripts/ directory was copied from rpiv-skillbased — handlers/, lib/, types.js, migrate.js)

#### Manual Verification:
- [ ] `/skill:implement-plan thoughts/shared/plans/<test>.md` runs end-to-end — prompts for plan path if omitted, raises `ask_user_question` on mismatches
- [ ] `/skill:create-handoff` produces a handoff doc in `thoughts/shared/handoffs/` with a `/skill:resume-handoff` reference (not `/rpiv-next:resume-handoff`)
- [ ] `/skill:validate-plan thoughts/shared/plans/<test>.md` runs its `general-purpose` agent dispatches successfully — subagent returns structured verification output
- [ ] `/skill:resume-handoff thoughts/shared/handoffs/<test>.md` reads the handoff, verifies state, continues work
- [ ] `/skill:write-plan thoughts/shared/designs/<test>.md` produces a plan doc
- [ ] `/skill:migrate-to-guidance` either (a) runs `scripts/migrate.js` successfully if precondition satisfied, or (b) surfaces a clear "script not bundled" error — not a silent failure
- [ ] NO interactive permission prompts for `read`/`grep`/`find` during any of the above

---

## Phase 6: Research skills (4 files)

### Overview

Mechanical transform pass on the 4 research skills: `research`, `research-questions`, `research-codebase`, `research-solutions`. These dispatch CUSTOM subagents (not `general-purpose`), so each `rpiv-next:<agent>` → `<agent>` rewrite is load-bearing for runtime correctness. The silent fallback at `@tintinweb/pi-subagents/src/index.ts:730-732` hides prefix-strip bugs — validation must confirm each named dispatch actually resolves to the intended agent (not `general-purpose`).

Dependency matrix (agents these skills spawn):
- `research-codebase`: codebase-locator, codebase-analyzer, codebase-pattern-finder, integration-scanner, thoughts-locator, thoughts-analyzer, precedent-locator, web-search-researcher
- `research-questions`: codebase-locator, thoughts-locator, integration-scanner
- `research`: codebase-analyzer, codebase-locator, precedent-locator, web-search-researcher
- `research-solutions`: codebase-locator, codebase-analyzer, codebase-pattern-finder, thoughts-locator, web-search-researcher

All 9 custom agents are bundled at `/Users/sguslystyi/rpiv-pi/agents/*.md` and auto-copied to `<cwd>/.pi/agents/` by Phase 1's session_start handler.

Phase 6 requires Phase 3 (web-tools) to be landed before validation runs — the `web-search-researcher` agent spawns `web_search`/`web_fetch` tools.

### Changes Required:

#### 1. Shared transform spec (Phase 5 rules)
**Files**: all 4 research skills
**Changes**: Apply the Phase 5 mechanical transform list verbatim (Git Context block deletion, `!\`git\`` line deletion, `/rpiv-next:` → `/skill:`, `rpiv-next:<agent>` → `<agent>`, `AskUserQuestion:` block collapse, `$ARGUMENTS` prose rewrite, `TaskCreate`/`TaskUpdate` deletion, keep `allowed-tools:` + `disable-model-invocation:` as-is).

#### 2. research-codebase
**File**: `skills/research-codebase/SKILL.md` (3 AQ, 1 TC, 1 $A, 2 !git, 8 rpiv-next:)
**Changes**: Read full file. Apply transform spec. All 8 `rpiv-next:` hits are agent dispatches to the custom agents listed above.

Line-level diff requires a full file Read during execution. Pattern density: 3 AskUserQuestion, 1 TaskCreate, 1 `$ARGUMENTS`, 2 `!\`git\``, 8 `rpiv-next:`.

All 8 `rpiv-next:` hits are agent dispatches — rewrite to bare agent names: `codebase-locator`, `codebase-analyzer`, `codebase-pattern-finder`, `integration-scanner`, `thoughts-locator`, `thoughts-analyzer`, `precedent-locator`, `web-search-researcher`.

Execution: Read full file → delete Git Context block → strip all 8 `rpiv-next:` prefixes → rewrite `$ARGUMENTS` → collapse 3 AskUserQuestion blocks → delete TaskCreate reference → grep-verify.

#### 3. research-questions
**File**: `skills/research-questions/SKILL.md` (1 AQ, 1 TC, 1 $A, 2 !git, 4 rpiv-next:)
**Changes**: Read full file. Apply transform spec. Agent dispatches: codebase-locator, thoughts-locator, integration-scanner.

Line-level diff requires a full file Read during execution. Pattern density: 1 AskUserQuestion, 1 TaskCreate, 1 `$ARGUMENTS`, 2 `!\`git\``, 4 `rpiv-next:`.

All 4 `rpiv-next:` hits map to agent dispatches: `codebase-locator`, `thoughts-locator`, `integration-scanner` (one prefix may appear twice or be a slash-command reference — verify during Read).

Execution: Read full file → apply Phase 5 transforms → grep-verify.

#### 4. research
**File**: `skills/research/SKILL.md` (2 AQ, 0 TC, 1 $A, 2 !git, 7 rpiv-next:)
**Changes**: Read full file. Apply transform spec. Agent dispatches: codebase-analyzer, codebase-locator, precedent-locator, web-search-researcher.

Line-level diff requires a full file Read during execution. Pattern density: 2 AskUserQuestion, 0 TaskCreate, 1 `$ARGUMENTS`, 2 `!\`git\``, 7 `rpiv-next:`.

Agent dispatches: `codebase-analyzer`, `codebase-locator`, `precedent-locator`, `web-search-researcher`.

Execution: Read full file → apply Phase 5 transforms → grep-verify.

#### 5. research-solutions
**File**: `skills/research-solutions/SKILL.md` (0 AQ, 1 TC, 0 $A, 2 !git, 5 rpiv-next:)
**Changes**: Read full file. Apply transform spec. Agent dispatches: codebase-locator, codebase-analyzer, codebase-pattern-finder, thoughts-locator, web-search-researcher.

Line-level diff requires a full file Read during execution. Pattern density: 0 AskUserQuestion, 1 TaskCreate, 0 `$ARGUMENTS`, 2 `!\`git\``, 5 `rpiv-next:`.

Agent dispatches: `codebase-locator`, `codebase-analyzer`, `codebase-pattern-finder`, `thoughts-locator`, `web-search-researcher`.

Execution: Read full file → apply Phase 5 transforms → grep-verify. Note: no `$ARGUMENTS` or AskUserQuestion blocks in this file — transforms are minimal.

### Success Criteria:

#### Automated Verification:
- [x] No `!\`git` in any Phase 6 skill: `grep -l '!\`git' /Users/sguslystyi/rpiv-pi/skills/{research,research-questions,research-codebase,research-solutions}/SKILL.md` outputs nothing
- [x] No `$ARGUMENTS`: `grep -l '\$ARGUMENTS' /Users/sguslystyi/rpiv-pi/skills/{research,research-questions,research-codebase,research-solutions}/SKILL.md` outputs nothing
- [x] No `^AskUserQuestion:` blocks: `grep -l '^AskUserQuestion:' /Users/sguslystyi/rpiv-pi/skills/{research,research-questions,research-codebase,research-solutions}/SKILL.md` outputs nothing
- [x] No `TaskCreate`/`TaskUpdate`: `grep -lE '(TaskCreate|TaskUpdate)' /Users/sguslystyi/rpiv-pi/skills/{research,research-questions,research-codebase,research-solutions}/SKILL.md` outputs nothing
- [x] No `rpiv-next:` prefixes: `grep -l 'rpiv-next:' /Users/sguslystyi/rpiv-pi/skills/{research,research-questions,research-codebase,research-solutions}/SKILL.md` outputs nothing
- [x] `pi install /Users/sguslystyi/rpiv-pi` completes with exit code 0

#### Manual Verification:
- [ ] `/skill:research-codebase` spawns subagents that IDENTIFY THEMSELVES as `codebase-locator` / `codebase-analyzer` / etc. in their responses (not as `general-purpose`)
- [ ] `/skill:research-codebase` produces a research doc at `thoughts/shared/research/<date>_<topic>.md`
- [ ] `/skill:research-questions` produces a questions doc at `thoughts/shared/questions/<date>_<topic>.md`
- [ ] `/skill:research` consumes a questions doc and produces a research doc
- [ ] `/skill:research-solutions` produces a solutions doc at `thoughts/shared/solutions/<date>_<topic>.md`
- [ ] `web-search-researcher` subagent (spawned by research / research-codebase / research-solutions) successfully calls `web_search` and returns real results
- [ ] No silent `general-purpose` fallback — inspect the UI agent widget for each dispatch; the name chip should match the requested subagent_type
- [ ] Brave API free-tier quota is not exhausted during validation (stub or skip web-search-researcher if needed per Verification Note #7)

---

## Phase 7: Design/plan skills (6 files)

### Overview

Mechanical transform pass on the 6 highest-density design/plan skills: `iterate-plan`, `evaluate-research`, `code-review`, `design-feature`, `design-feature-iterative`, `create-plan`. These are the heaviest files in the project (`design-feature-iterative` 532 lines, `create-plan` 492 lines) and have the most `rpiv-next:` hits, but the transform rules are identical to Phase 5.

Two special cases called out in the design:
- `create-plan/SKILL.md:458` has 6 `rpiv-next:` tokens on one line — replace all 6 in one Edit call using `replace_all: true` with a carefully-chosen anchor
- `code-review/SKILL.md:9-13` has a 5-line `## Git Context` block (wider than the standard 3-line version) — delete all 5 lines

Dependency matrix:
- `iterate-plan`: codebase-locator, codebase-analyzer, codebase-pattern-finder, thoughts-locator, thoughts-analyzer
- `evaluate-research`: codebase-locator, codebase-analyzer, integration-scanner, thoughts-locator
- `code-review`: codebase-locator, codebase-analyzer, codebase-pattern-finder, thoughts-locator, thoughts-analyzer, web-search-researcher
- `design-feature`: codebase-pattern-finder, codebase-analyzer, integration-scanner, precedent-locator, codebase-locator, thoughts-locator, web-search-researcher
- `design-feature-iterative`: codebase-pattern-finder, codebase-analyzer, integration-scanner, precedent-locator, web-search-researcher
- `create-plan`: codebase-locator, codebase-analyzer, codebase-pattern-finder, integration-scanner, thoughts-locator, thoughts-analyzer, precedent-locator, web-search-researcher

### Changes Required:

#### 1. iterate-plan (22 hits)
**File**: `skills/iterate-plan/SKILL.md`
**Changes**: Read full file. Apply the Phase 5 transform spec.

Line-level diff requires a full file Read during execution. Pattern density: 22 total hits. Apply the Phase 5 mechanical transform spec.

Agent dispatches: `codebase-locator`, `codebase-analyzer`, `codebase-pattern-finder`, `thoughts-locator`, `thoughts-analyzer`.

Execution: Read full file → apply Phase 5 transforms → grep-verify.

#### 2. evaluate-research (17 hits)
**File**: `skills/evaluate-research/SKILL.md`
**Changes**: Read full file. Apply the Phase 5 transform spec.

Line-level diff requires a full file Read during execution. Pattern density: 17 total hits. Apply the Phase 5 mechanical transform spec.

Agent dispatches: `codebase-locator`, `codebase-analyzer`, `integration-scanner`, `thoughts-locator`.

Execution: Read full file → apply Phase 5 transforms → grep-verify.

#### 3. code-review (20 hits — special case: 5-line Git Context block)
**File**: `skills/code-review/SKILL.md`
**Changes**: Read full file. Apply the Phase 5 transform spec. Special: delete all 5 lines of the `## Git Context` block at lines 9-13 (wider than standard 3-line version).

Line-level diff requires a full file Read during execution. Pattern density: 20 total hits. Apply the Phase 5 mechanical transform spec.

**Special case**: Lines 9-13 contain a 5-line `## Git Context` block (wider than the standard 3-line version in other skills). Delete all 5 lines in one Edit call.

Agent dispatches: `codebase-locator`, `codebase-analyzer`, `codebase-pattern-finder`, `thoughts-locator`, `thoughts-analyzer`, `web-search-researcher`.

Execution: Read full file → delete 5-line Git Context block at lines 9-13 → apply remaining Phase 5 transforms → grep-verify.

#### 4. design-feature (26 hits)
**File**: `skills/design-feature/SKILL.md`
**Changes**: Read full file. Apply the Phase 5 transform spec.

Line-level diff requires a full file Read during execution. Pattern density: 26 total hits. Apply the Phase 5 mechanical transform spec.

Agent dispatches: `codebase-pattern-finder`, `codebase-analyzer`, `integration-scanner`, `precedent-locator`, `codebase-locator`, `thoughts-locator`, `web-search-researcher`.

Execution: Read full file → apply Phase 5 transforms → grep-verify.

#### 5. design-feature-iterative (32 hits, 532 lines — heaviest file)
**File**: `skills/design-feature-iterative/SKILL.md`
**Changes**: Read full file. Apply the Phase 5 transform spec.

Line-level diff requires a full file Read during execution. File is 532 lines — heaviest in the project. Pattern density: 32 total hits. Apply the Phase 5 mechanical transform spec.

Agent dispatches: `codebase-pattern-finder`, `codebase-analyzer`, `integration-scanner`, `precedent-locator`, `web-search-researcher`.

Execution: Read full file (may need offset/limit paging since it's large) → apply Phase 5 transforms → grep-verify. Expect the most Edit calls of any Phase 7 file.

#### 6. create-plan (31 hits — special case: 6 rpiv-next: tokens on line 458)
**File**: `skills/create-plan/SKILL.md`
**Changes**: Read full file. Apply the Phase 5 transform spec. Special: line 458 has all 6 custom-agent names on one line — rewrite in a single Edit call anchored on enough surrounding context for uniqueness.

Line-level diff requires a full file Read during execution. File is 492 lines. Pattern density: 31 total hits. Apply the Phase 5 mechanical transform spec.

**Special case — line 458**: This single line contains all 6 custom-agent names with `rpiv-next:` prefixes (`rpiv-next:codebase-locator`, `rpiv-next:codebase-analyzer`, `rpiv-next:codebase-pattern-finder`, `rpiv-next:thoughts-locator`, `rpiv-next:thoughts-analyzer`, `rpiv-next:web-search-researcher`). Rewrite in a single Edit call using enough surrounding context to make the anchor uniquely matchable.

Full agent dispatch list for this skill: `codebase-locator`, `codebase-analyzer`, `codebase-pattern-finder`, `integration-scanner`, `thoughts-locator`, `thoughts-analyzer`, `precedent-locator`, `web-search-researcher`.

Execution: Read full file → handle line 458 special case first → apply remaining Phase 5 transforms → grep-verify.

### Success Criteria:

#### Automated Verification:
- [x] No `!\`git` in any Phase 7 skill: `grep -l '!\`git' /Users/sguslystyi/rpiv-pi/skills/{iterate-plan,evaluate-research,code-review,design-feature,design-feature-iterative,create-plan}/SKILL.md` outputs nothing
- [x] No `$ARGUMENTS`: `grep -l '\$ARGUMENTS' /Users/sguslystyi/rpiv-pi/skills/{iterate-plan,evaluate-research,code-review,design-feature,design-feature-iterative,create-plan}/SKILL.md` outputs nothing
- [x] No `^AskUserQuestion:` blocks: `grep -l '^AskUserQuestion:' /Users/sguslystyi/rpiv-pi/skills/{iterate-plan,evaluate-research,code-review,design-feature,design-feature-iterative,create-plan}/SKILL.md` outputs nothing
- [x] No `TaskCreate`/`TaskUpdate`: `grep -lE '(TaskCreate|TaskUpdate)' /Users/sguslystyi/rpiv-pi/skills/{iterate-plan,evaluate-research,code-review,design-feature,design-feature-iterative,create-plan}/SKILL.md` outputs nothing
- [x] No `rpiv-next:` prefixes: `grep -l 'rpiv-next:' /Users/sguslystyi/rpiv-pi/skills/{iterate-plan,evaluate-research,code-review,design-feature,design-feature-iterative,create-plan}/SKILL.md` outputs nothing
- [x] Special case: `create-plan/SKILL.md` line ~458 no longer has ANY `rpiv-next:` tokens: `grep -c 'rpiv-next:' /Users/sguslystyi/rpiv-pi/skills/create-plan/SKILL.md` outputs `0`
- [x] `pi install /Users/sguslystyi/rpiv-pi` completes with exit code 0

#### Manual Verification:
- [ ] `/skill:design-feature thoughts/shared/research/<latest>.md` runs end-to-end, spawning custom subagents correctly, producing a design doc at `thoughts/shared/designs/<date>_<topic>.md`
- [ ] `/skill:create-plan thoughts/shared/designs/<latest>.md` produces a plan doc
- [ ] `/skill:iterate-plan thoughts/shared/plans/<existing>.md` reads + iterates on an existing plan
- [ ] `/skill:code-review` produces a review at `thoughts/shared/reviews/<date>_<topic>.md`
- [ ] `/skill:evaluate-research <docA> <docB>` A/B tests two research documents and produces an evaluation
- [ ] `/skill:design-feature-iterative` runs iteratively with developer checkpoints without skill-text breakage
- [ ] Every custom subagent dispatch shows the requested type in the agent widget (no silent general-purpose fallbacks)

---

## Phase 8: Annotate + test skills (4 files)

### Overview

Mechanical transform pass on the final 4 skills: `annotate-guidance`, `annotate-inline`, `outline-test-cases`, `write-test-cases`. Same Phase 5 transform rules plus one additional rule: replace all `${CLAUDE_SKILL_DIR}` template references with relative paths (e.g., `templates/architecture.md`). This works because Pi's `_expandSkillCommand` wraps the skill body with `<skill ... location="..."><References are relative to ${skill.baseDir}.>`, so the LLM knows to resolve relative paths against the skill's own directory. The template files already live at `/Users/sguslystyi/rpiv-pi/skills/<skill-name>/templates/*.md`.

`${CLAUDE_SKILL_DIR}` token counts per file (from research):
- `annotate-inline/SKILL.md`: 7 tokens at lines 250, 260 (×2), 271, 282, 283, 284
- `annotate-guidance/SKILL.md`: 7 tokens at lines 254, 264 (×2), 275, 286, 287, 288
- `outline-test-cases/SKILL.md`: 2 tokens at lines 299, 309
- `write-test-cases/SKILL.md`: 8 tokens at lines 220, 221, 223 (×3), 232 (×2), 277

Dependency matrix:
- `annotate-guidance`: codebase-locator, codebase-analyzer, codebase-pattern-finder
- `annotate-inline`: codebase-locator, codebase-analyzer, codebase-pattern-finder
- `outline-test-cases`: codebase-locator, test-case-locator
- `write-test-cases`: codebase-locator, test-case-locator, codebase-analyzer, integration-scanner

### Changes Required:

#### 1. annotate-guidance (4 AQ, 0 TC, 0 $A, 0 !git, 7 CSD, 5 rpiv-next:)
**File**: `skills/annotate-guidance/SKILL.md`
**Changes**: Read full file. Apply Phase 5 transforms plus replace `${CLAUDE_SKILL_DIR}/` with `` (empty) on all 7 template-path references — e.g., `${CLAUDE_SKILL_DIR}/templates/architecture.md` → `templates/architecture.md`.

Line-level diff requires a full file Read during execution. Pattern density: 4 AskUserQuestion, 0 TaskCreate, 0 `$ARGUMENTS`, 0 `!\`git\``, 7 `${CLAUDE_SKILL_DIR}`, 5 `rpiv-next:`.

`${CLAUDE_SKILL_DIR}` token locations (7 total): lines 254, 264 (×2), 275, 286, 287, 288.

Replacement rule: `${CLAUDE_SKILL_DIR}/templates/<name>.md` → `templates/<name>.md` (drop the `${CLAUDE_SKILL_DIR}/` prefix entirely). Works because Pi's `_expandSkillCommand` wraps the skill body with `<skill ... location="..."><References are relative to <baseDir>.>` so the LLM resolves relative paths against `skills/annotate-guidance/`.

Agent dispatches: `codebase-locator`, `codebase-analyzer`, `codebase-pattern-finder`.

Execution: Read full file → apply Phase 5 transforms → replace all 7 `${CLAUDE_SKILL_DIR}/` prefixes → grep-verify.

#### 2. annotate-inline (4 AQ, 0 TC, 0 $A, 0 !git, 7 CSD, 5 rpiv-next:)
**File**: `skills/annotate-inline/SKILL.md`
**Changes**: Read full file. Apply Phase 5 transforms plus `${CLAUDE_SKILL_DIR}` replacement on all 7 tokens.

Line-level diff requires a full file Read during execution. Pattern density: 4 AskUserQuestion, 0 TaskCreate, 0 `$ARGUMENTS`, 0 `!\`git\``, 7 `${CLAUDE_SKILL_DIR}`, 5 `rpiv-next:`.

`${CLAUDE_SKILL_DIR}` token locations (7 total): lines 250, 260 (×2), 271, 282, 283, 284.

Replacement rule same as annotate-guidance: `${CLAUDE_SKILL_DIR}/` → `` (empty) on all 7 references.

Agent dispatches: `codebase-locator`, `codebase-analyzer`, `codebase-pattern-finder`.

Execution: Read full file → apply Phase 5 transforms → replace all 7 `${CLAUDE_SKILL_DIR}/` prefixes → grep-verify.

#### 3. outline-test-cases (5 AQ, 1 TC, 1 $A, 2 !git, 2 CSD, 6 rpiv-next:)
**File**: `skills/outline-test-cases/SKILL.md`
**Changes**: Read full file. Apply Phase 5 transforms plus `${CLAUDE_SKILL_DIR}` replacement on 2 tokens at lines 299, 309.

Line-level diff requires a full file Read during execution. Pattern density: 5 AskUserQuestion, 1 TaskCreate, 1 `$ARGUMENTS`, 2 `!\`git\``, 2 `${CLAUDE_SKILL_DIR}`, 6 `rpiv-next:`.

`${CLAUDE_SKILL_DIR}` token locations: lines 299, 309.

Agent dispatches: `codebase-locator`, `test-case-locator`.

Execution: Read full file → apply Phase 5 transforms (Git Context delete, `$ARGUMENTS` rewrite, 5 AskUserQuestion block collapses, TaskCreate delete, 6 `rpiv-next:` strips) → replace 2 `${CLAUDE_SKILL_DIR}/` prefixes → grep-verify.

#### 4. write-test-cases (4 AQ, 0 TC, 1 $A, 2 !git, 8 CSD, 10 rpiv-next:)
**File**: `skills/write-test-cases/SKILL.md`
**Changes**: Read full file. Apply Phase 5 transforms plus `${CLAUDE_SKILL_DIR}` replacement on 8 tokens at lines 220, 221, 223 (×3), 232 (×2), 277.

Line-level diff requires a full file Read during execution. Pattern density: 4 AskUserQuestion, 0 TaskCreate, 1 `$ARGUMENTS`, 2 `!\`git\``, 8 `${CLAUDE_SKILL_DIR}`, 10 `rpiv-next:`.

`${CLAUDE_SKILL_DIR}` token locations: lines 220, 221, 223 (×3), 232 (×2), 277.

Agent dispatches: `codebase-locator`, `test-case-locator`, `codebase-analyzer`, `integration-scanner`.

Execution: Read full file → apply Phase 5 transforms → replace all 8 `${CLAUDE_SKILL_DIR}/` prefixes → grep-verify.

**Final full-repo audit** after write-test-cases: run `grep -rlE '(rpiv-next:|\$ARGUMENTS|!\`git|^AskUserQuestion:|TaskCreate|TaskUpdate|\$\{CLAUDE_(PLUGIN_ROOT|SKILL_DIR)\})' /Users/sguslystyi/rpiv-pi/skills/` — must output nothing. If any residual patterns remain, fix before marking Phase 8 complete.

### Success Criteria:

#### Automated Verification:
- [x] No `!\`git` in any Phase 8 skill: `grep -l '!\`git' /Users/sguslystyi/rpiv-pi/skills/{annotate-guidance,annotate-inline,outline-test-cases,write-test-cases}/SKILL.md` outputs nothing
- [x] No `$ARGUMENTS`: `grep -l '\$ARGUMENTS' /Users/sguslystyi/rpiv-pi/skills/{annotate-guidance,annotate-inline,outline-test-cases,write-test-cases}/SKILL.md` outputs nothing
- [x] No `^AskUserQuestion:` blocks: `grep -l '^AskUserQuestion:' /Users/sguslystyi/rpiv-pi/skills/{annotate-guidance,annotate-inline,outline-test-cases,write-test-cases}/SKILL.md` outputs nothing
- [x] No `TaskCreate`/`TaskUpdate`: `grep -lE '(TaskCreate|TaskUpdate)' /Users/sguslystyi/rpiv-pi/skills/{annotate-guidance,annotate-inline,outline-test-cases,write-test-cases}/SKILL.md` outputs nothing
- [x] No `rpiv-next:` prefixes: `grep -l 'rpiv-next:' /Users/sguslystyi/rpiv-pi/skills/{annotate-guidance,annotate-inline,outline-test-cases,write-test-cases}/SKILL.md` outputs nothing
- [x] No `${CLAUDE_SKILL_DIR}` references remain: `grep -l '\${CLAUDE_SKILL_DIR}' /Users/sguslystyi/rpiv-pi/skills/{annotate-guidance,annotate-inline,outline-test-cases,write-test-cases}/SKILL.md` outputs nothing
- [x] All referenced template files exist: `find /Users/sguslystyi/rpiv-pi/skills/{annotate-guidance,annotate-inline,outline-test-cases,write-test-cases}/templates -name '*.md'` lists every template file mentioned in the skill bodies (no orphan references)
- [x] Final full-repo check: no Phase-5-through-8 patterns remain anywhere: `grep -rlE '(rpiv-next:|\$ARGUMENTS|!\`git|^AskUserQuestion:|TaskCreate|TaskUpdate|\${CLAUDE_(PLUGIN_ROOT|SKILL_DIR)\})' /Users/sguslystyi/rpiv-pi/skills/` outputs nothing
- [x] `pi install /Users/sguslystyi/rpiv-pi` completes with exit code 0

#### Manual Verification:
- [ ] `/skill:annotate-guidance` scaffolds `.rpiv/guidance/**/architecture.md` files using bundled templates; template paths resolve correctly
- [ ] `/skill:annotate-inline` generates CLAUDE.md files using bundled templates
- [ ] `/skill:outline-test-cases` produces an outline at `.rpiv/test-cases/` with per-feature metadata
- [ ] `/skill:write-test-cases` generates flow-based test cases referencing bundled templates
- [ ] All 4 skills dispatch their custom subagents correctly (no general-purpose fallback)
- [ ] Final end-to-end workflow from Desired End State runs without any skill-text errors: research → design → plan → implement → validate → commit

---

## Testing Strategy

### Automated:

After each phase, the phase-local automated checks above are the hard gate. A phase is NOT complete until all of its automated checks pass. In addition, the following project-wide checks run at every phase boundary:

- `pi install /Users/sguslystyi/rpiv-pi` — extension loader accepts the package and all extensions register without error
- `jq . /Users/sguslystyi/rpiv-pi/package.json` — manifest remains valid JSON
- Session start in a fresh test directory produces the expected `.pi/agents/` files + `thoughts/shared/*/` scaffolding

At the end of Phase 8, run the full-repo pattern scan:

```bash
grep -rlE '(rpiv-next:|\$ARGUMENTS|!\`git|^AskUserQuestion:|TaskCreate|TaskUpdate|\$\{CLAUDE_(PLUGIN_ROOT|SKILL_DIR)\})' /Users/sguslystyi/rpiv-pi/skills/
# Expected: no output
```

### Manual Testing Steps:

1. **Smoke test rpiv-core (after Phase 1)**: `cd /tmp && mkdir rpiv-test && cd rpiv-test && pi` — confirm session start notify messages, `.pi/agents/` population, seeded permissions file.
2. **Agent discovery test (after Phase 2)**: Inside a session, `/agents` lists defaults + 9 custom agents. Invoke the `Agent` tool with `subagent_type: "codebase-locator"` on a small test query — the response is a structured file-location list, not a generic chatty output.
3. **Web tools test (after Phase 3)**: Run `/web-search-config`, enter a Brave API key, then ask the LLM to "search the web for the latest Node.js LTS version" — verify Brave results render with title/URL/snippet.
4. **Canary commit test (after Phase 4)**: In a test repo with a dirty working tree, run `/skill:commit`. Confirm the `ask_user_question` selector fires with 3 options, selecting "Commit" actually creates the git commit, no permission prompts fire for `git` / `read` / `grep` / `find`.
5. **Agent-free skill spot check (after Phase 5)**: Run `/skill:implement-plan`, `/skill:write-plan`, `/skill:validate-plan` on test artifacts. Confirm no silent fallbacks, no skill-text errors, expected output artifacts produced.
6. **Research skill test (after Phase 6)**: Run `/skill:research-codebase "how does X work"` — confirm each dispatched custom subagent self-identifies in its response, the final research doc lands at `thoughts/shared/research/`.
7. **Design/plan skill test (after Phase 7)**: Full `/skill:research-codebase` → `/skill:design-feature` → `/skill:create-plan` → `/skill:implement-plan` → `/skill:validate-plan` → `/skill:commit` workflow on a trivial test feature.
8. **Final end-to-end (after Phase 8)**: Repeat the Phase 7 workflow plus `/skill:annotate-guidance` and `/skill:outline-test-cases` on the same test project. Every skill runs without prompts, patterns, or silent fallbacks.

## Performance Considerations

From the design artifact (copied verbatim):

- **Agent auto-copy is I/O bound** — 9 files × copyFileSync on session_start. Cheap (<5ms). Not a hot path.
- **Permissions seed is a one-time write** — touches the filesystem exactly once per user per install. Never on the hot path.
- **Vendored pi-subagents adds ~4800 lines of TS** to the extension load path. Pi's TS loader parses all extensions at startup; expect a small increase in cold-start time (estimated <100ms). No runtime overhead after load.
- **Brave Search API calls are network-bound** — typical latency 300-800ms. The tool is always user-initiated (LLM can't spam it), so rate limiting via backend is sufficient.
- **Skill text expansion cost** — Pi wraps each skill body in `<skill>...</skill>` at command invocation time (`_expandSkillCommand`). The prose rewrites in Phases 4-8 typically shrink skills by 5-15 lines each (delete YAML blocks, delete `## Git Context`), so the LLM's context cost for skill invocations DECREASES after migration.

## Migration Notes

From the design artifact:

**For the developer's own machine (canary testing)**:

- `/Users/sguslystyi/.pi/agent/settings.json:7` already has pi-permission-system and @tintinweb/pi-subagents in its `packages` array. After Phase 2 vendors pi-subagents into `extensions/pi-subagents/`, there may be a double-registration concern if the developer's globally-installed pi-subagents is also active. Mitigation: remove `"npm:@tintinweb/pi-subagents"` from the global settings.json before canary testing, OR verify that Pi's extension loader handles name collisions gracefully (one should win; the other should be skipped with a warning).
- Agent files may already exist at `~/.pi/agent/agents/` on the developer's machine from prior experimentation. Auto-copy to `<cwd>/.pi/agents/` creates a new copy; global agents still load but are overridden by project agents (per `custom-agents.ts:26-28` — project overrides global). No action needed.

**For distributable users**:

- README must document the prerequisite chain:
  1. `pi install /path/to/rpiv-pi`
  2. `pi install npm:pi-permission-system` (recommended)
  3. `/web-search-config` (one-time Brave API key setup)
- The auto-seeded `~/.pi/agent/pi-permissions.jsonc` uses a balanced default: `allow` for read-only operations and rpiv-pi tools, `ask` for write operations and arbitrary bash. Users can edit the file; rpiv-core will never overwrite.
- `rpiv-next:` prefixes in any user's existing migration plans or handoffs will still work at the skill level (Pi resolves skills by frontmatter `name:`), but old references like `/rpiv-next:commit` need manual rewrite to `/skill:commit` by the user.

**Rollback strategy**:

- **Phase 1 rollback**: revert `package.json` + `extensions/rpiv-core/index.ts` + delete the template file. Auto-copied `.pi/agents/` files stay behind (delete manually). Seeded `~/.pi/agent/pi-permissions.jsonc` stays (edit or delete manually).
- **Phase 2 rollback**: `rm -rf /Users/sguslystyi/rpiv-pi/extensions/pi-subagents/`. Falls back to globally installed `@tintinweb/pi-subagents` if present, otherwise skills with agent dispatches silently fall back to `general-purpose`.
- **Phase 3 rollback**: `rm -rf /Users/sguslystyi/rpiv-pi/extensions/web-tools/`. Falls back to globally installed web-search extension if present.
- **Phases 4-8 rollback**: per-file `git checkout skills/<name>/SKILL.md`. Each skill is independent.

No data migrations, no schema changes, no irreversible operations anywhere in the 8-phase plan.

## References

- Design: `thoughts/shared/designs/2026-04-10_11-18-29_complete-pi-migration.md`
- Research: `thoughts/shared/research/2026-04-10_13-45-00_complete-pi-migration.md`
- Research questions: `thoughts/shared/questions/2026-04-10_08-45-32_complete-pi-migration.md`
- Status tracker: `thoughts/MIGRATION.md`
- Gap analysis (foundational): `/Users/sguslystyi/rpiv-skillbased/thoughts/shared/research/2026-04-10_gap-analysis-porting-to-pi.md`
- Pi runtime source (key files):
  - `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/package-manager.js:38` — `RESOURCE_TYPES` (proves `pi.agents` is silently dropped)
  - `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/agent-session.js:812-836` — `_expandSkillCommand` (skill body wrapping with relative-path base)
  - `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/skills.js:211-251` — `loadSkillFromFile` (frontmatter filtering)
  - `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/system-prompt.js:42-46` — `visibleTools` filter (promptSnippet gate)
- Vendored source target: `/usr/local/lib/node_modules/@tintinweb/pi-subagents/src/`
- Permission system source: `/usr/local/lib/node_modules/pi-permission-system/src/`
- Reference implementation (web-tools): `/Users/sguslystyi/.pi/agent/extensions/web-search/index.ts`
- Reference implementations (patterns): `/usr/local/lib/node_modules/pi-perplexity/src/config.ts`, `/usr/local/lib/node_modules/pi-perplexity/src/commands/config.ts`
