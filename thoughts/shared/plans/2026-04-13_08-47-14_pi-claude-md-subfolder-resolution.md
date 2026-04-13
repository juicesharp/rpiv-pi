---
date: 2026-04-13T08:47:14-04:00
planner: Claude Code
git_commit: 333949d
branch: master
repository: rpiv-pi
topic: "Pi CLAUDE.md subfolder resolution in guidance.ts + CC hooks legacy cleanup"
tags: [plan, guidance-injection, extensions, cleanup]
status: ready
design_source: "thoughts/shared/designs/2026-04-13_08-38-29_pi-claude-md-subfolder-resolution.md"
last_updated: 2026-04-13
last_updated_by: Claude Code
---

# Pi CLAUDE.md Subfolder Resolution Implementation Plan

## Overview

Extend `extensions/rpiv-core/guidance.ts` to surface subfolder `CLAUDE.md` / `AGENTS.md` files (currently invisible to Pi) by upgrading its per-depth resolver from a single architecture.md lookup to a first-match candidate ladder (AGENTS.md > CLAUDE.md > architecture.md). Depth 0 skips AGENTS.md/CLAUDE.md because Pi's own `loadProjectContextFiles` already loads `<cwd>/AGENTS.md` or `<cwd>/CLAUDE.md`. Concurrently, remove the dormant Claude Code hook delivery path (`scripts/handlers/` + CC-only helpers in `scripts/lib/`) since `rpiv-pi` is a Pi-only package; preserve `scripts/migrate.js` and the `migrate-to-guidance` skill so CLAUDE.md → shadow-tree conversion remains a one-step user action.

Design source: `thoughts/shared/designs/2026-04-13_08-38-29_pi-claude-md-subfolder-resolution.md`

## Desired End State

Launching `pi` from `/Users/sguslystyi/rpiv-pi` and reading a file in a subfolder with a `CLAUDE.md` surfaces it through the existing hidden-message channel. Heading format: `## Project Guidance: <sub> (<file>.md)` — e.g. `extensions/rpiv-core (CLAUDE.md)`, `scripts (architecture.md)`, `root (architecture.md)`.

Conversion still works via `pi /skill:migrate-to-guidance`, which drives `node scripts/migrate.js --project-dir "${CWD}"` (standalone, Node built-ins only).

The CC-hook runtime injection path is gone: `scripts/handlers/` and the three CC-only helpers in `scripts/lib/` no longer exist on disk; root `CLAUDE.md` and `scripts/CLAUDE.md` reflect the single Pi delivery path.

## What We're NOT Doing

- No changes to `extensions/rpiv-core/index.ts` — tool_call hook, `clearInjectionState` wiring, and lifecycle resets unchanged.
- No switch to eager `before_agent_start` injection (rejected — full content re-sent every turn).
- No parallel `claude-md.ts` module (rejected — doubles logic).
- No `agentsFilesOverride` usage (requires forking `@mariozechner/pi-coding-agent`).
- No update to `scripts/migrate.js` or `skills/migrate-to-guidance/SKILL.md` — the conversion path is preserved verbatim.
- No new `customType` — existing `"rpiv-guidance"` covers all entries.
- No renderer or UI change — all injected messages remain `display: false`.

---

## Phase 1: Extend `guidance.ts` resolver

### Overview
Replace the single-candidate resolver loop in `extensions/rpiv-core/guidance.ts` with a per-depth candidate ladder (AGENTS.md > CLAUDE.md > architecture.md). Depth 0 skips AGENTS/CLAUDE (Pi already loads them). Add `GuidanceKind` + `GuidanceFile` types and a private `formatLabel` helper for the generalized heading. `clearInjectionState`, `injectedGuidance` Set, and `handleToolCallGuidance` external signature are unchanged.

### Changes Required:

#### 1. Guidance resolver rewrite
**File**: `extensions/rpiv-core/guidance.ts`
**Changes**: Full file rewrite — extends per-depth resolver with multi-candidate ladder; adds `GuidanceKind` + `GuidanceFile` types; adds private `formatLabel`; tightens the module docstring (drops orphan "ported from scripts/lib/…" reference).

```typescript
/**
 * Guidance injection — resolves and injects subfolder guidance files.
 *
 * At each directory depth from project root down to the touched file's
 * directory, picks the first existing of:
 *   AGENTS.md > CLAUDE.md > .rpiv/guidance/<sub>/architecture.md
 *
 * Depth 0 (project root) skips AGENTS.md/CLAUDE.md because Pi's own
 * resource-loader (loadContextFileFromDir at resource-loader.js:30-46)
 * already loads <cwd>/AGENTS.md or <cwd>/CLAUDE.md into the system
 * prompt's # Project Context block. Depth 0 still checks
 * <cwd>/.rpiv/guidance/architecture.md — Pi's loader does not see that
 * path.
 *
 * `resolveGuidance` is pure logic with no ExtensionAPI references
 * (utility-module rule from extensions/rpiv-core/CLAUDE.md). Side
 * effects (sendMessage, in-memory dedup Set) live in
 * `handleToolCallGuidance` and `clearInjectionState`.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, sep, isAbsolute, join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// ---------------------------------------------------------------------------
// Guidance Resolution
// ---------------------------------------------------------------------------

type GuidanceKind = "agents" | "claude" | "architecture";

interface GuidanceFile {
	/** Forward-slash-normalized path from project root — stable dedup key. */
	relativePath: string;
	absolutePath: string;
	content: string;
	kind: GuidanceKind;
}

/**
 * Resolve guidance files for a given file path.
 *
 * Walks from project root to the file's directory. At each depth, picks
 * the first existing of AGENTS.md > CLAUDE.md > architecture.md (Pi's
 * own per-dir precedence at resource-loader.js:30-46, extended with
 * architecture.md as a third candidate). Depth 0 only checks
 * architecture.md — Pi's loader already handles <cwd>/AGENTS.md and
 * <cwd>/CLAUDE.md.
 *
 * Returns files root-first (general → specific), at most one per depth.
 */
export function resolveGuidance(filePath: string, projectDir: string): GuidanceFile[] {
	const fileDir = dirname(filePath);
	const relativeDir = relative(projectDir, fileDir);

	// Guard: file is outside project root
	if (relativeDir.startsWith("..") || isAbsolute(relativeDir)) {
		return [];
	}

	const parts = relativeDir ? relativeDir.split(sep) : [];
	const results: GuidanceFile[] = [];

	for (let depth = 0; depth <= parts.length; depth++) {
		const subPath = parts.slice(0, depth).join(sep);

		// Per-depth candidate ladder. First-match wins.
		const candidates: Array<{ relative: string; kind: GuidanceKind }> = [];

		// Depth 0: skip AGENTS/CLAUDE — Pi's loader handles <cwd> already.
		if (depth > 0) {
			candidates.push({ relative: join(subPath, "AGENTS.md"), kind: "agents" });
			candidates.push({ relative: join(subPath, "CLAUDE.md"), kind: "claude" });
		}
		candidates.push({
			relative: subPath
				? join(".rpiv", "guidance", subPath, "architecture.md")
				: join(".rpiv", "guidance", "architecture.md"),
			kind: "architecture",
		});

		for (const candidate of candidates) {
			const absolute = join(projectDir, candidate.relative);
			if (existsSync(absolute)) {
				results.push({
					relativePath: candidate.relative.split(sep).join("/"),
					absolutePath: absolute,
					content: readFileSync(absolute, "utf-8"),
					kind: candidate.kind,
				});
				break; // first-match wins at this depth
			}
		}
	}

	return results;
}

// ---------------------------------------------------------------------------
// Session State
// ---------------------------------------------------------------------------

/** In-memory set of injected guidance paths per session. */
const injectedGuidance = new Set<string>();

export function clearInjectionState() {
	injectedGuidance.clear();
}

// ---------------------------------------------------------------------------
// Tool-call Handler
// ---------------------------------------------------------------------------

/**
 * Handle guidance injection on tool_call events for read/edit/write.
 * Sends hidden messages via pi.sendMessage as a side effect.
 */
export function handleToolCallGuidance(
	event: { toolName: string; input: Record<string, unknown> },
	ctx: { cwd: string },
	pi: ExtensionAPI,
): void {
	if (!["read", "edit", "write"].includes(event.toolName)) return;

	const filePath = (event.input as any).file_path ?? (event.input as any).path;
	if (!filePath) return;

	const resolved = resolveGuidance(filePath, ctx.cwd);
	if (resolved.length === 0) return;

	const newFiles = resolved.filter((g) => !injectedGuidance.has(g.relativePath));
	if (newFiles.length === 0) return;

	// Mark before sendMessage — idempotence > reliability.
	for (const g of newFiles) {
		injectedGuidance.add(g.relativePath);
	}

	const contextParts = newFiles.map(
		(g) => `## Project Guidance: ${formatLabel(g)}\n\n${g.content}`,
	);

	pi.sendMessage({
		customType: "rpiv-guidance",
		content: contextParts.join("\n\n---\n\n"),
		display: false,
	});
}

/**
 * Format a guidance file's heading label.
 *   extensions/rpiv-core/AGENTS.md          → "extensions/rpiv-core (AGENTS.md)"
 *   scripts/CLAUDE.md                       → "scripts (CLAUDE.md)"
 *   .rpiv/guidance/scripts/architecture.md  → "scripts (architecture.md)"
 *   .rpiv/guidance/architecture.md          → "root (architecture.md)"
 */
function formatLabel(g: GuidanceFile): string {
	if (g.kind === "architecture") {
		const stripped = g.relativePath.replace(/^\.rpiv\/guidance\//, "");
		const sub = stripped === "architecture.md"
			? ""
			: stripped.replace(/\/architecture\.md$/, "");
		return `${sub || "root"} (architecture.md)`;
	}
	const fileName = g.kind === "agents" ? "AGENTS.md" : "CLAUDE.md";
	const idx = g.relativePath.lastIndexOf("/");
	const sub = idx > 0 ? g.relativePath.slice(0, idx) : "";
	return `${sub || "root"} (${fileName})`;
}
```

### Success Criteria:

#### Automated Verification:
- [~] Type check passes: `npx tsc --noEmit -p extensions/rpiv-core/tsconfig.json` (or repo-wide build script) — N/A: no tsconfig/tsc in repo; Pi consumes `.ts` directly
- [x] No callers of `resolveGuidance` outside `guidance.ts` need signature updates: `grep -rn "resolveGuidance" extensions/` returns only matches in `guidance.ts`
- [x] `handleToolCallGuidance` external signature unchanged: `grep -n "handleToolCallGuidance" extensions/rpiv-core/index.ts` still resolves cleanly

#### Manual Verification:
- [ ] Launch `pi` in repo root, then `Read extensions/rpiv-core/index.ts` via the read tool — observe one hidden `rpiv-guidance` entry in the session branch with `## Project Guidance: extensions/rpiv-core (CLAUDE.md)` heading and the expected body
- [ ] Dedup: `Read extensions/rpiv-core/guidance.ts` next — no new guidance injection (Set filters `extensions/rpiv-core/CLAUDE.md`)
- [ ] Post-compact refresh: run `/compact`, then `Read extensions/rpiv-core/index.ts` — guidance re-injects (Set was cleared)
- [ ] Branch replay: split a session branch — guidance does NOT re-inject (branch-replay reads existing entries; `index.ts:121-124` deliberately does not `clearInjectionState`)
- [ ] If `<cwd>/.rpiv/guidance/architecture.md` exists, depth-0 still emits `root (architecture.md)`

---

## Phase 2: Remove CC hooks legacy + update docs

### Overview
Delete the dormant Claude Code hook runtime path: 4 handlers in `scripts/handlers/` + 3 helpers in `scripts/lib/`. Narrow `scripts/CLAUDE.md` to migrate.js-only scope. Update root `CLAUDE.md` to reflect the single Pi delivery path. `scripts/migrate.js` and `skills/migrate-to-guidance/` are preserved (verified standalone — Node built-ins only, no `scripts/lib/` imports).

**Within-phase ordering**: delete the source files first, then edit `scripts/CLAUDE.md` and root `CLAUDE.md` so docs reflect on-disk state.

### Changes Required:

#### 1. Delete CC hook runtime files
**Files**:
- `scripts/handlers/inject-guidance.js` — DELETE (CC PreToolUse hook, unwired)
- `scripts/handlers/post-compact.js` — DELETE (CC PostCompact hook, unwired)
- `scripts/handlers/session-start.js` — DELETE (CC session init, unwired)
- `scripts/handlers/session-end.js` — DELETE (CC session cleanup, unwired)
- `scripts/lib/stdin.js` — DELETE (used only by deleted handlers)
- `scripts/lib/resolver.js` — DELETE (used only by deleted handlers; `migrate.js` does NOT import it)
- `scripts/lib/session-state.js` — DELETE (used only by deleted handlers)

**Changes**: Remove all 7 files. After deletion, `scripts/lib/` will be empty — remove the directory if no other files were added.

#### 2. Narrow `scripts/CLAUDE.md` to migrate.js scope
**File**: `scripts/CLAUDE.md`
**Changes**: Full file rewrite — drops CC hooks responsibility, Module Structure entries for deleted files, the hook-handler entry point block, and the "Adding a New Hook Handler" important-if block.

~~~markdown
# scripts/

## Responsibility
`migrate.js` — the standalone CLI that migrates in-place `CLAUDE.md` files to the
`.rpiv/guidance/` shadow tree format. Actively invoked by the `migrate-to-guidance` skill.

## Dependencies
Node.js built-ins only — `fs`, `path`, `child_process`. Zero npm dependencies.

## Consumers
- **`migrate-to-guidance` skill**: runs `node scripts/migrate.js --project-dir "${CWD}"` directly

## Module Structure
```
migrate.js            — Standalone CLI: discovers CLAUDE.md files, maps to .rpiv/guidance/ targets, writes output
```

## Architectural Boundaries
- **migrate.js writes all-or-nothing** — collects all target paths before writing; deletes originals only after all writes succeed
- **No npm dependencies** — keeps the migration tool runnable without `npm install`
- **stdout = JSON, stderr = diagnostics** — final report is machine-readable JSON on stdout; progress lines go to stderr with `[rpiv:migrate]` prefix

<important if="you are adding a new standalone CLI script to this layer">
## Adding a CLI Utility Script
1. Create `scripts/my-name.js`; write a `parseArgs(argv)` function for manual `argv` parsing (no third-party parser)
2. Use `// --- Section Name ---` comment dividers between logical phases
3. Write a `function main()` (sync) or `async function main()` (if async I/O needed)
4. Progress output: `process.stderr.write('[rpiv:my-name] …\n')`
5. Final machine-readable result: `process.stdout.write(JSON.stringify(report, null, 2))` — pretty-printed; all report fields always present, no optional keys
6. Call `main()` at the bottom; add `.catch` only for async main
</important>
~~~

#### 3. Root `CLAUDE.md` — two surgical edits
**File**: `CLAUDE.md`
**Changes**: Update the Architecture tree line for `scripts/` and replace the "Guidance Injection Paths" `<important>` block with the single-path version.

**Edit 1 — Architecture tree line** (within the existing fenced tree block):
```diff
- ├── scripts/                — migrate.js CLI + Claude Code hooks delivery for .rpiv/guidance/
+ ├── scripts/                — migrate.js CLI for CLAUDE.md → .rpiv/guidance/ migration
```

**Edit 2 — `<important>` block, full replacement**:
```markdown
<important if="you are modifying guidance injection behavior">
## Guidance Injection
`extensions/rpiv-core/guidance.ts` — single Pi delivery path. `pi.on("tool_call")` resolves per-depth at most one of `AGENTS.md > CLAUDE.md > .rpiv/guidance/<sub>/architecture.md` (depth 0 skips AGENTS/CLAUDE — Pi's own resource-loader handles `<cwd>` already). Injects each new file via `pi.sendMessage({ display: false })`; in-process `Set` dedups across the session; cleared on `session_start`/`session_compact`/`session_shutdown`.
</important>
```

### Success Criteria:

#### Automated Verification:
- [x] All 7 files removed: `ls scripts/handlers/ 2>/dev/null` returns empty / "No such file or directory"; `ls scripts/lib/ 2>/dev/null` returns empty / "No such file or directory"
- [x] No source code references remain: `grep -rn "scripts/handlers" . --include="*.ts" --include="*.js" --include="*.json"` returns no matches in active code (doc references in `scripts/CLAUDE.md` and root `CLAUDE.md` should also be gone post-edit)
- [x] No source code references remain: `grep -rn "scripts/lib" . --include="*.ts" --include="*.js" --include="*.json"` returns no matches in active code
- [x] `scripts/migrate.js` still has zero `scripts/lib/` imports: `grep -n "require\|import" scripts/migrate.js` shows only Node built-ins (`fs`, `path`, `child_process`)
- [x] Migration smoke: `node scripts/migrate.js --project-dir "$(pwd)" --dry-run` exits 0 and prints valid JSON on stdout
- [x] Root `CLAUDE.md` no longer contains "Claude Code hooks delivery": `grep -n "Claude Code hooks delivery" CLAUDE.md` returns no matches
- [x] Root `CLAUDE.md` no longer contains the dual-path `<important if="you are modifying guidance injection behavior">` block referencing `scripts/handlers/`: `grep -n "scripts/handlers" CLAUDE.md` returns no matches
- [x] `scripts/CLAUDE.md` "Module Structure" no longer lists `handlers/` or `lib/`: `grep -nE "handlers/|lib/" scripts/CLAUDE.md` returns no matches

#### Manual Verification:
- [ ] Re-read `scripts/CLAUDE.md` end-to-end — narrative flows; no orphan references to deleted modules; "Adding a New Hook Handler" block is gone
- [ ] Re-read root `CLAUDE.md` — the architecture tree and Guidance Injection block both reflect single-path Pi delivery
- [ ] Run `pi /skill:migrate-to-guidance` against a sandbox copy of the repo (or any project with stray `CLAUDE.md` files) — conversion completes without errors, originals deleted, `.rpiv/guidance/<sub>/architecture.md` written
- [ ] Confirm `scripts/lib/` directory was removed if empty (no leftover empty dir)

---

## Testing Strategy

### Automated:
- TypeScript type check after Phase 1: `npx tsc --noEmit -p extensions/rpiv-core/tsconfig.json`
- Repo-wide grep checks after Phase 2: no surviving references to `scripts/handlers` or `scripts/lib` outside this plan document
- Migration smoke (`node scripts/migrate.js --dry-run`) after Phase 2 deletions

### Manual Testing Steps:
1. Launch `pi` in `/Users/sguslystyi/rpiv-pi`
2. Issue `Read extensions/rpiv-core/index.ts` via the read tool — observe one `## Project Guidance: extensions/rpiv-core (CLAUDE.md)` hidden entry
3. Issue `Read extensions/rpiv-core/guidance.ts` — observe NO new guidance injection (dedup confirmed)
4. Run `/compact`, then re-issue `Read extensions/rpiv-core/index.ts` — observe re-injection (state cleared)
5. Split a session branch via `session_tree` — observe NO re-injection (branch-replay should not clear state)
6. Run `pi /skill:migrate-to-guidance` against a sandbox repo — verify CLAUDE.md → architecture.md conversion still completes successfully

## Performance Considerations

- Phase 1 adds at most 2 extra `existsSync` calls per directory depth per `read/edit/write` tool call. Depth ≤ repo depth ≤ small constant in practice; call rate bounded by user tool frequency. Negligible.
- No change to system-prompt cache behavior — injection remains conversation-level (not system-prompt), so `_rebuildSystemPrompt` at `agent-session.js:625-654` is untouched.
- Dedup Set bounds injection to once-per-file-per-session; no per-turn re-send.

## Migration Notes

N/A — no persisted schema. `injectedGuidance` is in-memory-only and is cleared on the same three lifecycle events as today (`session_start`, `session_compact`, `session_shutdown`).

## References

- Design: `thoughts/shared/designs/2026-04-13_08-38-29_pi-claude-md-subfolder-resolution.md`
- Research: `thoughts/shared/research/2026-04-13_08-24-28_pi-claude-md-subfolder-resolution.md`
- Questions: `thoughts/shared/questions/2026-04-13_08-20-00_pi-claude-md-subfolder-resolution.md`
- Migration precedent: `thoughts/shared/designs/2026-04-10_11-18-29_complete-pi-migration.md`
- Pi SDK (read-only):
  - `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/resource-loader.js:30-76`
  - `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/extensions/types.d.ts:400-761`
