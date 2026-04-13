---
date: 2026-04-13T08:38:29-04:00
designer: Claude Code
git_commit: 333949d
branch: master
repository: rpiv-pi
topic: "Pi CLAUDE.md subfolder resolution in guidance.ts + CC hooks legacy cleanup"
tags: [design, guidance-injection, extensions, cleanup]
status: complete
research_source: thoughts/shared/research/2026-04-13_08-24-28_pi-claude-md-subfolder-resolution.md
last_updated: 2026-04-13
last_updated_by: Claude Code
last_updated_note: "Slices 1+2 generated and approved; status finalized."
---

# Design: Pi CLAUDE.md subfolder resolution in guidance.ts

## Summary
Extend `extensions/rpiv-core/guidance.ts`'s per-depth resolver from a single architecture.md lookup to a first-match candidate ladder (**AGENTS.md > CLAUDE.md > architecture.md**), depth 0 skipping the AGENTS/CLAUDE branches because Pi's own `loadProjectContextFiles` already loads `<cwd>/AGENTS.md` or `<cwd>/CLAUDE.md`. Remove the unused Claude Code hook delivery path (`scripts/handlers/` + CC-only helpers in `scripts/lib/`) now that `rpiv-pi` is Pi-only; preserve `scripts/migrate.js` and `skills/migrate-to-guidance/` so CLAUDE.md → shadow-tree conversion remains a one-step user action.

## Requirements
- Surface subfolder `CLAUDE.md` (and `AGENTS.md`) files to Pi's running agent — today they are silently ignored below `cwd`.
- Honor Pi's own per-dir precedence contract: AGENTS.md > CLAUDE.md. Add architecture.md as a fallback unique to this project.
- Preserve existing `.rpiv/guidance/<sub>/architecture.md` behavior unchanged at depths where no CLAUDE.md/AGENTS.md exists.
- Keep the existing lazy `pi.on("tool_call") + sendMessage({display:false})` delivery — no switch to eager `before_agent_start`.
- Preserve all existing session-state discipline: `clearInjectionState()` from `session_start`, `session_compact`, `session_shutdown`; not from `session_tree`.
- Scope the rpiv-pi package to Pi-only: remove dormant CC-hook runtime injection. Conversion tooling (`scripts/migrate.js` + `migrate-to-guidance` skill) must remain intact and functional.
- Every touched file must type-check; labels in injected messages must remain human-readable.

## Current State Analysis
### Key Discoveries
- Pi's `loadProjectContextFiles` at `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/resource-loader.js:48-76` walks **ancestors only** (`resolve(currentDir, "..")` fixed-point) — no descent into cwd's subtree.
- `loadContextFileFromDir` at `resource-loader.js:30-46` picks the first existing of `["AGENTS.md","CLAUDE.md"]` per directory — the per-depth first-match contract we mirror.
- Only conversation-level `ExtensionAPI` channels are reachable for plugins (`pi.sendMessage`, `before_agent_start.message`). The system-prompt seam `agentsFilesOverride` at `resource-loader.d.ts:87-97` is NOT on `ExtensionAPI` (`extensions/types.d.ts:747-761`) — unreachable without an SDK fork.
- `extensions/rpiv-core/guidance.ts:22-51` is a canonical reference — ancestor-walking resolver, session-scoped `Set<string>` dedup, `display:false` injection, three-site state reset at `index.ts:42, 108, 115`. The only missing piece is per-depth multi-candidate resolution.
- Subfolder `CLAUDE.md` files committed at `333949d` (`extensions/rpiv-core/`, `scripts/`, `skills/`, `agents/`, `.pi/agents/`) are all invisible to Pi when launched from repo root.
- `extensions/rpiv-core/CLAUDE.md:74-76` mandates utility modules stay `ExtensionAPI`-free; `resolveGuidance(filePath, projectDir)` already honors this and must keep honoring it.
- The CC-hook delivery path (`scripts/handlers/` + `scripts/lib/{stdin,resolver,session-state}.js`) uses different dedup (SHA-256 markers) and is flagged as "not yet well battle-tested" at root `CLAUDE.md:17-23`. `rpiv-pi` is a Pi-only package; the CC path is dormant legacy widening path-drift.
- `scripts/migrate.js` imports only Node built-ins (no dependency on `scripts/lib/`) and is the sole entry point used by the `migrate-to-guidance` skill — safe to keep standalone while deleting the CC runtime helpers.

## Scope

### Building
- Slice 1: Extend `resolveGuidance` into a per-depth multi-candidate walker; generalize the injected-message heading to `## Project Guidance: <sub> (<file>.md)`; tighten the module docstring (remove orphan "ported from scripts/lib/…" reference).
- Slice 2: Delete `scripts/handlers/` (4 handlers) + `scripts/lib/{stdin,resolver,session-state}.js` (3 helpers). Update `scripts/CLAUDE.md` to migrate.js-only scope. Update root `CLAUDE.md` "Guidance Injection Paths" block to reflect single Pi delivery path.

### Not Building
- No changes to `extensions/rpiv-core/index.ts` — tool_call hook, clearInjectionState wiring, and lifecycle resets are unchanged.
- No switch to eager `before_agent_start` injection (analyzed and rejected — full content re-sent every turn, new cross-turn dedup needed).
- No parallel `claude-md.ts` module (analyzed and rejected — doubles logic, widens coexistence surface).
- No `agentsFilesOverride` usage (requires forking `@mariozechner/pi-coding-agent` to expose the option on `ExtensionAPI`).
- No update to `scripts/migrate.js` or `skills/migrate-to-guidance/SKILL.md` — the conversion path is preserved verbatim.
- No new `customType` — existing `"rpiv-guidance"` covers both CLAUDE.md and architecture.md entries (no renderer discriminates today).
- No renderer or UI change — all injected messages remain `display: false`.

## Decisions

### Shape — extend `guidance.ts` in place
Inherited from research developer checkpoint. One module, one handler, one dedup Set. Rejected: parallel `claude-md.ts` sibling (duplicates logic; coexistence complexity).

### Precedence — AGENTS.md > CLAUDE.md > architecture.md per depth (first-match wins)
Mirrors Pi's own per-dir contract at `resource-loader.js:30-46` (AGENTS.md > CLAUDE.md). `.rpiv/guidance/<sub>/architecture.md` is an rpiv-specific third candidate added after both.

### Depth-0 skip — AGENTS.md and CLAUDE.md only
Pi's `loadContextFileFromDir(cwd)` call at `resource-loader.js:62` (first loop iteration) already renders `<cwd>/AGENTS.md` or `<cwd>/CLAUDE.md` into `# Project Context`. Double-injecting would duplicate tokens and defeat the system-prompt cache. Depth-0 architecture.md is preserved — Pi's loader never sees `.rpiv/guidance/architecture.md`.

### Labels — `## Project Guidance: <sub> (<file>.md)`
Generalized heading covers all three kinds. Examples: `extensions/rpiv-core (CLAUDE.md)`, `scripts (AGENTS.md)`, `scripts (architecture.md)`, `root (architecture.md)`.

### customType — keep `"rpiv-guidance"`
No renderer consumes it today (precedent confirmed in research). New custom type introduced only if future message filtering needs to discriminate.

### Dedup — `injectedGuidance: Set<string>` reused unchanged
Keyed on `relativePath` normalized to forward-slash. CLAUDE.md paths (`scripts/CLAUDE.md`) and architecture.md paths (`.rpiv/guidance/scripts/architecture.md`) are structurally disjoint — keys never collide. Set is cleared on `session_start`/`session_compact`/`session_shutdown` (unchanged from `index.ts:42, 108, 115`).

### Cleanup — remove CC runtime injection; preserve migration tooling
`rpiv-pi` is Pi-only. `scripts/handlers/` + `scripts/lib/{stdin,resolver,session-state}.js` are unwired (no callers in the package). `scripts/migrate.js` is standalone (no `scripts/lib/` imports) and is the sole entry point for the `migrate-to-guidance` skill; it stays.

## Architecture

### extensions/rpiv-core/guidance.ts — MODIFY
Full file rewrite. Replaces the single-candidate resolver loop with a per-depth candidate ladder; adds `GuidanceKind` + `GuidanceFile` types; adds private `formatLabel` for the generalized heading. `clearInjectionState`, `injectedGuidance` Set, and `handleToolCallGuidance` external signature are unchanged.

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

### scripts/handlers/inject-guidance.js — DELETE
CC-only PreToolUse hook. Not invoked from anywhere in the Pi extension; unwired legacy.

### scripts/handlers/post-compact.js — DELETE
CC-only PostCompact hook. Not invoked.

### scripts/handlers/session-start.js — DELETE
CC-only session init. Not invoked.

### scripts/handlers/session-end.js — DELETE
CC-only session cleanup. Not invoked.

### scripts/lib/stdin.js — DELETE
Helper used only by deleted CC handlers.

### scripts/lib/resolver.js — DELETE
Helper used only by the deleted `inject-guidance.js`. `scripts/migrate.js` does NOT import from `scripts/lib/` (verified via grep).

### scripts/lib/session-state.js — DELETE
Helper used only by deleted CC handlers.

### scripts/CLAUDE.md — MODIFY
Full file rewrite. Narrowed scope to `migrate.js` (CLI). Drops CC hooks responsibility, Module Structure entries for deleted files, the hook-handler entry point block, and the "Adding a New Hook Handler" important-if block.

```markdown
# scripts/

## Responsibility
`migrate.js` — the standalone CLI that migrates in-place `CLAUDE.md` files to the
`.rpiv/guidance/` shadow tree format. Actively invoked by the `migrate-to-guidance` skill.

## Dependencies
Node.js built-ins only — `fs`, `path`, `child_process`. Zero npm dependencies.

## Consumers
- **`migrate-to-guidance` skill**: runs `node scripts/migrate.js --project-dir "${CWD}"` directly

## Module Structure
\`\`\`
migrate.js            — Standalone CLI: discovers CLAUDE.md files, maps to .rpiv/guidance/ targets, writes output
\`\`\`

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
```

> Note: in the final on-disk file, the inner ` \`\`\` ` fence around the Module Structure block must be a literal triple-backtick, not the escaped form shown above (escaping is only to keep this artifact's outer fence intact).

### CLAUDE.md — MODIFY
Two surgical edits — Architecture tree line + "Guidance Injection Paths" important-if block.

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

## Desired End State

Launching `pi` from `/Users/sguslystyi/rpiv-pi` and reading a file in a subfolder with a `CLAUDE.md` surfaces it through the existing hidden-message channel:

```
# User Read extensions/rpiv-core/index.ts
# ... Pi resolves file ...
# pi.on("tool_call") fires handleToolCallGuidance
# sendMessage({customType:"rpiv-guidance", display:false, content: ...})

## Project Guidance: extensions/rpiv-core (CLAUDE.md)

# rpiv-core Extension

## Responsibility
The main Pi extension. Registers tools, slash commands, and session lifecycle hooks…

---

## Project Guidance: root (architecture.md)

(only if <cwd>/.rpiv/guidance/architecture.md also exists)
```

Conversion still works:
```
$ pi
> /skill:migrate-to-guidance
# drives: node scripts/migrate.js --project-dir "${CWD}" --dry-run
# then  : node scripts/migrate.js --project-dir "${CWD}" --delete-originals
# Result: all CLAUDE.md → .rpiv/guidance/<sub>/architecture.md
# Pi's extended resolver picks up architecture.md going forward.
```

## File Map
```
extensions/rpiv-core/guidance.ts       # MODIFY — per-depth multi-candidate resolver + generalized labels
scripts/handlers/inject-guidance.js    # DELETE — CC PreToolUse hook (unwired)
scripts/handlers/post-compact.js       # DELETE — CC PostCompact hook (unwired)
scripts/handlers/session-start.js      # DELETE — CC session init (unwired)
scripts/handlers/session-end.js        # DELETE — CC session cleanup (unwired)
scripts/lib/stdin.js                   # DELETE — CC stdin protocol parser
scripts/lib/resolver.js                # DELETE — CC-only resolver
scripts/lib/session-state.js           # DELETE — CC-only marker store
scripts/CLAUDE.md                      # MODIFY — narrow to migrate.js-only scope
CLAUDE.md                              # MODIFY — single Pi delivery path in Guidance Injection Paths block
```

## Ordering Constraints
- Slice 1 and Slice 2 are independent — either can ship first.
- Within Slice 2: delete source files before editing `scripts/CLAUDE.md` and root `CLAUDE.md` (so docs reflect on-disk state).

## Verification Notes
- Type check: `npx tsc --noEmit` (or package's build script) succeeds after Slice 1.
- Smoke: launch `pi` in repo root, `Read extensions/rpiv-core/index.ts` via the read tool, observe one hidden `rpiv-guidance` entry in session branch with `## Project Guidance: extensions/rpiv-core (CLAUDE.md)` heading and expected body.
- Dedup: `Read extensions/rpiv-core/guidance.ts` next — no new guidance injection (Set filters `extensions/rpiv-core/CLAUDE.md`).
- Post-compact refresh: `/compact` then `Read extensions/rpiv-core/index.ts` — guidance re-injects (Set was cleared).
- Branch replay (session_tree): split a session branch — guidance does NOT re-inject (branch-replay reads existing entries; `index.ts:121-124` deliberately does not `clearInjectionState`). Unchanged behavior.
- Migration smoke: `node scripts/migrate.js --project-dir "${CWD}" --dry-run` prints JSON output without runtime errors after Slice 2 deletions.
- Repo sanity: `grep -R "scripts/handlers" .` and `grep -R "scripts/lib" .` return only doc references that Slice 2 rewrites.

## Performance Considerations
- Slice 1 adds at most 2 extra `existsSync` calls per directory depth per `read/edit/write` tool call. Depth ≤ repo depth ≤ small constant in practice; call rate bounded by user tool frequency. Negligible.
- No change to session-prompt cache behavior — injection remains conversation-level (not system-prompt), so `_rebuildSystemPrompt` at `agent-session.js:625-654` is untouched.
- Dedup Set bounds injection to once-per-file-per-session; no per-turn re-send.

## Migration Notes
N/A — no persisted schema. `injectedGuidance` is in-memory-only and is cleared on the same three lifecycle events as today.

## Pattern References
- `extensions/rpiv-core/guidance.ts:22-51` — original single-candidate resolver; the new multi-candidate loop is a direct extension of this shape.
- `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/resource-loader.js:30-46` — Pi's native per-dir first-match precedence (AGENTS.md > CLAUDE.md); the new resolver mirrors this contract.
- `extensions/rpiv-core/index.ts:42, 108, 115` — three-site `clearInjectionState` discipline (unchanged).
- `extensions/rpiv-core/CLAUDE.md:74-76` — "NO ExtensionAPI in utility modules" rule.

## Developer Context
**Q (research, inherited): Which architectural shape?**
A: Extend `guidance.ts` in place. One module, one handler, one dedup Set. No parallel module.

**Q (research, inherited): CLAUDE.md vs architecture.md precedence at same depth?**
A: Per-depth first-match. CLAUDE.md wins at that depth; architecture.md is skipped at that depth only.

**Q (research, inherited): Depth-0 double-injection?**
A: Skip depth-0 for AGENTS.md/CLAUDE.md only. Keep depth-0 for architecture.md (Pi's loader does not see it).

**Q (research, inherited): Honor AGENTS.md?**
A: Yes. AGENTS.md > CLAUDE.md per depth. Future-proofs annotate-inline if it ever emits AGENTS.md.

**Q (design checkpoint, 2026-04-13): Update scripts/lib/resolver.js (CC hooks) in parallel?**
A: No. `rpiv-pi` is Pi-only; CC hooks path is dormant legacy. Broaden scope to DELETE all CC runtime injection instead. Preserve `scripts/migrate.js` + `skills/migrate-to-guidance/` (conversion tooling).

**Q (design checkpoint, 2026-04-13): Ensure CLAUDE.md → shadow-tree conversion still works after cleanup?**
A: Yes — verified. `scripts/migrate.js` is self-contained (Node built-ins only; no `scripts/lib/` imports) and remains the sole entry point used by the `migrate-to-guidance` skill. Conversion stays 1-click.

## Design History
- Slice 1: Extend guidance.ts resolver — approved as generated
- Slice 2: Remove CC hooks legacy + update docs — approved as generated

## References
- Research: `thoughts/shared/research/2026-04-13_08-24-28_pi-claude-md-subfolder-resolution.md`
- Questions source: `thoughts/shared/questions/2026-04-13_08-20-00_pi-claude-md-subfolder-resolution.md`
- Migration precedent: `thoughts/shared/designs/2026-04-10_11-18-29_complete-pi-migration.md`
- Pi SDK (read-only):
  - `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/resource-loader.js:30-76`
  - `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/system-prompt.js:15-106`
  - `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/agent-session.js:625-773`
  - `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/extensions/types.d.ts:400-761`
