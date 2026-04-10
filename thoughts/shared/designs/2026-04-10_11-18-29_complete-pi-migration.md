---
date: 2026-04-10T11:18:29-0400
designer: Claude Code
git_commit: no-commit
branch: no-branch
repository: rpiv-pi
topic: "Complete rpiv-skillbased → Pi Migration (bottom-up phased)"
tags: [design, migration, pi, rpiv-core, pi-subagents, web-tools, agents, canary, bottom-up]
status: complete
research_source: "thoughts/shared/research/2026-04-10_13-45-00_complete-pi-migration.md"
last_updated: 2026-04-10
last_updated_by: Claude Code
---

# Design: Complete rpiv-skillbased → Pi Migration (bottom-up phased)

## Summary

Migrate the rpiv-pi package from its current half-migrated state to a fully working Pi package by building outward from the lowest layer (package foundation) to the highest (agent-dependent skills). Nine phases, each with a standalone `pi install` test and an end-to-end exit criterion — you can stop at any phase boundary and the package is still in a coherent, testable state.

The architectural core: rpiv-core gets three new behaviors (promptSnippet for ask_user_question, session_start agent-file auto-copy into `<cwd>/.pi/agents/`, permissions-file auto-seed into `~/.pi/agent/pi-permissions.jsonc`). `@tintinweb/pi-subagents@0.5.2` is vendored into `extensions/pi-subagents/` as raw source. A new sibling `extensions/web-tools/` registers `web_search`/`web_fetch` (Brave-only) with a `/web-search-config` slash command. Skill text is then rewritten canary-first (commit → agent-free skills → agent-dependent skills) using a mechanical transform pass over all 21 SKILL.md files.

## Requirements

From the research artifact and developer checkpoint:

- Distributable Pi package — end user runs `pi install /path/to/rpiv-pi` and everything works
- `@tintinweb/pi-subagents@0.5.2` vendored into the repo (research Q5 decision)
- `pi-permission-system@0.4.1` NOT vendored — declared as recommended sibling; rpiv-core seeds a sensible rules file instead (deviation from research Q5, resolved in this design's checkpoint)
- `web_search` and `web_fetch` tools backed by Brave Search API (Tavily/Serper dropped)
- API-key onboarding via `/web-search-config` slash command (mirrors pi-perplexity pattern)
- All 21 skills pi-compatible: `rpiv-next:` prefix stripped, `AskUserQuestion:` YAML blocks prose-ified, `TaskCreate`/`TaskUpdate` references deleted, `$ARGUMENTS` rewritten as prose, `!`git`` shell-eval removed, `${CLAUDE_SKILL_DIR}` + `${CLAUDE_PLUGIN_ROOT}` replaced with vendored-path resolution
- 9 custom agent `.md` files discoverable via `<cwd>/.pi/agents/` (auto-copied at session_start)
- Canary validation before wide rewrite: `commit/SKILL.md` first, end-to-end
- Bottom-up phase ordering — each layer testable in isolation before the next builds on it
- Preserve existing rpiv-core guidance-injection and git-context-injection behaviors unchanged

## Current State Analysis

### Key Discoveries (from research + code-reading in design Step 2)

- `extensions/rpiv-core/index.ts:169-229` — `ask_user_question` tool is registered WITHOUT `promptSnippet`/`promptGuidelines`. Per `dist/core/system-prompt.js:42-46`, that means the LLM never sees it in the "Available tools:" section. The `todo` tool at `rpiv-core/index.ts:263-342` has both fields and is the template to copy.
- `package.json:2` says `"name": "rpiv-skillbased"` — mismatched with the repo directory name `rpiv-pi`.
- `package.json:10` declares `"agents": ["./agents"]`, but `package-manager.js:38` only reads `["extensions","skills","prompts","themes"]`. The field is silently dropped. The 9 `.md` files in `/Users/sguslystyi/rpiv-pi/agents/` have no runtime effect today.
- `@tintinweb/pi-subagents` (globally installed at `/usr/local/lib/node_modules/@tintinweb/pi-subagents/`) reads agents from `<cwd>/.pi/agents/*.md` and `~/.pi/agent/agents/*.md` only (`custom-agents.ts:21-28`). Neither directory exists in the current workspace.
- The silent fallback at `@tintinweb/pi-subagents/src/index.ts:730-732` resolves unknown `subagent_type` values to `general-purpose`. Every `rpiv-next:codebase-locator` dispatch today hits this fallback with zero diagnostic output.
- `@tintinweb/pi-subagents/src/index.ts:728` calls `reloadCustomAgents()` before every `Agent` tool invocation — any `.md` file copied into `.pi/agents/` after session start IS discoverable on the very next spawn. Confirms the auto-copy design works.
- `@tintinweb/pi-subagents/src/index.ts:553-554` names the tool `Agent` (capital A). The 24 "Agent tool" prose references in skills are **already correct** — no tool-name rewrite needed.
- `@tintinweb/pi-subagents/src/index.ts:1462` line count; 20 `.ts` files total across `src/` + `src/ui/`, ~4836 lines. Ships no LICENSE file — declared MIT in `package.json:6` only.
- `@tintinweb/pi-subagents/src/agent-types.ts:8` and `src/types.ts:5` import types from `@mariozechner/pi-agent-core` — a package that is NOT installed. At runtime the type imports are erased by Pi's TS loader (that's why it works today); at `tsc --noCheck` (which is how Pi's extension loader runs) they never block loading.
- `pi-permission-system@0.4.1/src/permission-manager.ts:22, 31-37` — rules file path is hardcoded to `~/.pi/agent/pi-permissions.jsonc`, and when that file is missing, `DEFAULT_POLICY = {tools: "ask", bash: "ask", mcp: "ask", skills: "ask", special: "ask"}`. "ask" triggers an interactive prompt per tool call.
- `pi-perplexity/src/config.ts` lives at `/usr/local/lib/node_modules/pi-perplexity/src/config.ts` — shows the canonical JSON-config pattern with `join(homedir(), ".config", "pi-perplexity", "config.json")`, `0o600` chmod, and a `resolveSearchDefaults(params, env, config, default)` precedence chain. Model after this for `/web-search-config`.
- `~/.pi/agent/extensions/web-search/index.ts:240, 380` is the reference web_search/web_fetch implementation (~552 lines) with Tavily/Serper/Brave backends. We will vendor a stripped version (Brave only, ~350 lines).
- `skills/commit/SKILL.md` — 84 lines, 7 pattern hits (1 `$ARGUMENTS` L14, 3 `!`git`` L9-11, 1 `AskUserQuestion:` block L47-61, 1 `allowed-tools` L5), no agents, no `${CLAUDE_SKILL_DIR}`, no `rpiv-next:`. True minimal canary.
- `skills/migrate-to-guidance/SKILL.md` uses `${CLAUDE_PLUGIN_ROOT}` (not `${CLAUDE_SKILL_DIR}`) at lines 24 and 57. Research doc missed this pattern name.
- `skills/validate-plan/SKILL.md:55-64` — only uses `general-purpose` agent prose (NOT named `rpiv-next:` dispatches). Since pi-subagents registers `general-purpose` as a default, the only rewrite needed here is the Git Context lines 8-13. Simpler than the research dependency matrix implied.
- `/Users/sguslystyi/.pi/agent/settings.json:6-10` lists `pi-permission-system` in `packages`, so pi-permission-system IS active in the developer's current session. Canary testing on this machine uses the globally-installed copy; vendoring is unnecessary for testing.
- Pi's extension loader discovers extensions inside a scanned directory by convention. `extensions/rpiv-core/index.ts` is found today; `extensions/pi-subagents/index.ts` and `extensions/web-tools/index.ts` will be found the same way after vendoring.
- All relative imports inside `@tintinweb/pi-subagents/src/*.ts` use the `./foo.js` ESM convention (NodeNext). Pi's TS loader handles this natively.

## Scope

### Building

- **Phase 0 — Foundation**: `package.json` rename + field cleanup, dead-import cleanup in rpiv-core
- **Phase 1 — rpiv-core enhancements**: `promptSnippet`/`promptGuidelines` on `ask_user_question`, `session_start` auto-copy for agents into `<cwd>/.pi/agents/`, `session_start` seeder for `~/.pi/agent/pi-permissions.jsonc`, new `/rpiv-update-agents` slash command
- **Phase 2 — Vendor @tintinweb/pi-subagents**: Copy 20 `.ts` files from `/usr/local/lib/node_modules/@tintinweb/pi-subagents/src/` into `extensions/pi-subagents/`, synthesize MIT LICENSE, no source modifications
- **Phase 3 — New `extensions/web-tools/`**: Brave-only `web_search` + `web_fetch` with `promptSnippet`/`promptGuidelines`, `/web-search-config` slash command, `~/.config/rpiv-pi/web-tools.json` persistence
- **Phase 4 — Canary skill `commit/SKILL.md`**: Full mechanical rewrite (84 → ~76 lines), end-to-end validation via actual commit on a test repo
- **Phase 5 — Agent-free skills (6 files)**: `migrate-to-guidance`, `implement-plan`, `create-handoff`, `validate-plan`, `resume-handoff`, `write-plan`
- **Phase 6 — Research skills (4 files)**: `research`, `research-questions`, `research-codebase`, `research-solutions`
- **Phase 7 — Design/plan skills (7 files)**: `create-plan`, `iterate-plan`, `design-feature`, `design-feature-iterative`, `evaluate-research`, `code-review`
- **Phase 8 — Annotate + test skills (4 files)**: `annotate-guidance`, `annotate-inline`, `outline-test-cases`, `write-test-cases`

### Not Building

- **Vendored pi-permission-system** — checkpoint decision deviated from research Q5. rpiv-core ships an auto-seeder instead; users install pi-permission-system separately via `pi install npm:pi-permission-system`. (Why: developer already has it globally, vendoring adds upstream-tracking burden for zero testing benefit, and the out-of-box permissions-file seed is the real load-bearing piece.)
- **P3 tool-gating extension** — research §G, MIGRATION.md §11. `allowed-tools:` frontmatter stays advisory (silently ignored by Pi's skill loader but visible to the LLM via the wrapped skill body). Enforceable gating is a future pass.
- **Rich `task` tool (Option 2)** — research Appendix B. Current `todo` tool (add/toggle/list/clear) is sufficient. No dependency graph, no `in_progress` status, no owners.
- **`prompts/` directory with chain prompts** — MIGRATION.md §16. Not part of the core migration.
- **Custom renderer for guidance messages** — MIGRATION.md §14. `display: false` keeps them out of the TUI already; the rendering improvement is cosmetic.
- **Splitting rpiv-core into guidance.ts/ask-user.ts/web-tools.ts modules** — MIGRATION.md §15. Monolithic works at ~450 lines; splitting is premature.
- **Per-skill regression tests** — every skill gets a manual end-to-end validation, not an automated test file. Pi has no skill test harness today.
- **License attribution helper** — we synthesize one MIT LICENSE text for the vendored pi-subagents; no tooling to auto-refresh from upstream.
- **Worktree isolation for the migration** — the migration edits source files in-place in the normal rpiv-pi checkout.
- **Gap analysis doc relocation** — research Open Question listed `rpiv-skillbased/thoughts/shared/research/2026-04-10_gap-analysis-porting-to-pi.md` as a dangling reference; moving it is out of scope here.
- **Rewriting tool-name prose** (Read/Edit/Write/Glob/Grep/LS) beyond `Glob → find` (which IS mandatory in 5 files). The case-sensitive mismatch of "Read" vs "read" is tolerated — the LLM resolves both.
- **Touching `extensions/rpiv-core/index.ts:141-158`** — `before_agent_start` git context injection stays as-is. It replaces the 36 `!`git`` lines in skills; no further changes needed.

## Decisions

### Decision 1 — Permission system handling (auto-seed, no vendor)

**Ambiguity**: `pi-permission-system@0.4.1` DEFAULT_POLICY is `"ask"` (`permission-manager.ts:31-37`), meaning every tool call prompts interactively when `~/.pi/agent/pi-permissions.jsonc` is missing. Research Q5 said "vendor the source", but vendoring without solving the default-policy problem produces a broken out-of-box experience where canary testing hangs on prompts.

**Explored**:
- Option A: Auto-seed `~/.pi/agent/pi-permissions.jsonc` via rpiv-core session_start, skip if file exists — `pi-permission-system/src/extension-config.ts:67-83` shows the `ensurePermissionSystemConfig` pattern, copy that shape
- Option B: Vendor pi-permission-system AND auto-seed — but the developer's global install would double-register at session load, causing silent collisions at `pi.registerCommand("permission-system", ...)` time
- Option C: Vendor with `yoloMode:true` — disables permission enforcement, contradicts "final version should use pi-permissions with restrictions"
- Option D: Defer vendoring entirely, declare pi-permission-system as recommended sibling

**Decision**: **Option A + D combined** — auto-seed the rules file in rpiv-core, do NOT vendor the package, document it as recommended in README. Developer verification on canary works with their existing global install. For distributable users, `pi install npm:pi-permission-system` is a one-command prerequisite documented in README. This means only pi-subagents gets vendored in Phase 2 (not both as research Q5 suggested).

### Decision 2 — Bottom-up phase structure (9 phases)

**Decision**: P0 Foundation → P1 rpiv-core enhancements → P2 vendor pi-subagents → P3 web-tools extension → P4 canary commit skill → P5 agent-free skills → P6 research skills → P7 design/plan skills → P8 annotate + test skills. Each phase has an independent `pi install` test + end-to-end exit criterion. Developer confirmed at checkpoint.

### Decision 3 — `migrate-to-guidance`'s `${CLAUDE_PLUGIN_ROOT}` pattern

**Ambiguity**: Research doc tracked `${CLAUDE_SKILL_DIR}` in 4 files but missed that `migrate-to-guidance/SKILL.md:24,57` uses `${CLAUDE_PLUGIN_ROOT}` (a different variable).

**Decision**: Treat both identically. Replace with `extensions/rpiv-core/scripts/migrate.js` (relative to package root, resolved via the same `import.meta.url`-derived path rpiv-core uses for agent auto-copy). Note: the `scripts/migrate.js` file does NOT yet exist in rpiv-pi — only in `rpiv-skillbased`. Phase 5 copies it over as part of the `migrate-to-guidance` skill migration.

### Decision 4 — `validate-plan` uses only generic `general-purpose` agent

**Decision**: Discovery from the canary pattern scan — `validate-plan/SKILL.md:55-64` references `general-purpose` agents only, not `rpiv-next:codebase-analyzer`-style custom names. Since `pi-subagents/src/default-agents.ts:12-28` registers `general-purpose` as a first-class default, NO rewrite is needed for these lines. `validate-plan` migration is mechanical (Git Context block deletion, `rpiv-next:` prefix strip on L174-176).

### Decision 5 — Agent auto-copy: skip-if-exists with forced refresh command

**Decision**: `session_start` handler in rpiv-core copies `<package-dir>/agents/*.md` → `<cwd>/.pi/agents/*.md` only when the destination file does NOT exist. Preserves user edits across sessions. A new `/rpiv-update-agents` slash command forces overwrite for explicit version-parity refresh. Mirrors `ensurePermissionSystemConfig`'s idiom at `pi-permission-system/src/extension-config.ts:67-83`.

### Decision 6 — Package rename: `rpiv-skillbased` → `rpiv-pi`

**Decision**: Rename via `package.json:2`. Research Open Question #7 flagged the three-way naming mismatch (`package.json` says `rpiv-skillbased`, skills say `rpiv-next:`, repo dir is `rpiv-pi`). Aligning to `rpiv-pi` matches the repo directory basename — the most authoritative identifier — and the rename coincides with stripping `rpiv-next:` prefixes from skills, so there's no cross-contamination.

### Decision 7 — Vendored pi-subagents layout: flattened to match rpiv-core convention

**Decision**: Copy `@tintinweb/pi-subagents/src/*.ts` directly into `extensions/pi-subagents/` (flat), with `src/ui/*.ts` preserved as `extensions/pi-subagents/ui/*.ts`. This matches rpiv-core's existing convention (`extensions/rpiv-core/index.ts` lives directly in the extension dir). Pi's auto-discovery finds `extensions/pi-subagents/index.ts` the same way it finds `extensions/rpiv-core/index.ts` today. Relative imports (`./agent-runner.js`, `./ui/agent-widget.js`) continue to resolve. Upstream sync operation becomes: `cp @tintinweb/pi-subagents/src/*.ts extensions/pi-subagents/ && cp -r @tintinweb/pi-subagents/src/ui extensions/pi-subagents/ui`.

### Decision 8 — Vendored pi-subagents LICENSE: synthesized MIT text

**Decision**: The published @tintinweb/pi-subagents tarball ships no LICENSE file (verified in Step 2). `package.json:6` declares `"license": "MIT"` and `package.json:5` declares `"author": "tintinweb"`. We write a standard MIT template with copyright attribution to the original author, plus a pointer to the upstream repo. Stored at `extensions/pi-subagents/LICENSE`.

### Decision 9 — `ask_user_question` promptSnippet wording

**Decision**: Match the house style from Pi's built-in tools (`dist/core/tools/*.js`: short imperative fragment, no trailing period). Exact text: `"Ask the user a structured question when requirements are ambiguous"`. `promptGuidelines`: three sentences teaching when to use it, mirroring the `todo` tool pattern at `rpiv-core/index.ts:268-273`.

### Decision 10 — `$ARGUMENTS` prose replacement template

**Decision**: Replace `## Task\n$ARGUMENTS` blocks with a prose nudge that explains Pi's actual behavior: "If the user has not already provided a specific [plan path / research question / feature description], ask them for it before proceeding. Their input will appear as a follow-up paragraph after this skill body." This preserves the user-input anchor without relying on an interpolation token Pi doesn't support.

### Decision 11 — `allowed-tools:` frontmatter: keep everywhere

**Decision**: Research §G confirmed Pi's skill loader silently drops every frontmatter key except `description`, `name`, and `disable-model-invocation`. However, the LLM still reads the skill body (which is wrapped into `<skill>...</skill>` by `_expandSkillCommand`), so frontmatter text reaches the model as prose. `allowed-tools:` becomes advisory documentation the LLM can use for self-guidance. **Keep in all 11 skills that declare it.** No rewrites.

### Decision 12 — `disable-model-invocation: true` kept as-is

**Decision**: Pi honors this at `dist/core/skills.js:241`. Keep the two instances (`implement-plan`, `create-handoff`) unchanged.

### Decision 13 — Shell-eval `!`git ...`` removal: delete, don't rewrite

**Decision**: All 36 `!`git`` lines across 16 skills live in identical `## Git Context` blocks at the top of each file. Delete those blocks entirely (the 5-to-6 line `## Git Context` header + bullets). rpiv-core's `before_agent_start` handler at `extensions/rpiv-core/index.ts:141-158` already injects the same information as a hidden message; the skill body no longer needs to request it.

### Decision 14 — `rpiv-next:` prefix stripping: mechanical regex

**Decision**: Global replace `rpiv-next:(\w+)` → `$1` across all 19 SKILL.md files that mention it. Special cases:
- `/rpiv-next:<skill>` slash-command references (e.g. `/rpiv-next:resume-handoff thoughts/...`) → `/skill:<skill> thoughts/...` (Pi uses `/skill:` prefix for its skill commands)
- Prose "the `rpiv-next:codebase-locator` agent" → "the `codebase-locator` agent"
- Frontmatter `tools:` fields on agents are already stripped (the research confirmed those are cosmetic for extension-inherited tools)

### Decision 15 — `AskUserQuestion:` YAML block rewrite template

**Decision**: With `promptSnippet` + `promptGuidelines` on `ask_user_question` (Phase 1), the LLM learns the tool's purpose at the extension level. Each of the 42 inline YAML blocks collapses to a one-line prose nudge:

> Use the `ask_user_question` tool with the following question: "[verbatim question]". Options: "[Label A]" ([description A]); "[Label B]" ([description B]); "[Label C]" ([description C]).

The LLM reads this, synthesizes a structured call to `ask_user_question`, and the tool handler (`rpiv-core/index.ts:181-228`) renders the select menu. No per-skill schema duplication.

### Decision 16 — `TaskCreate`/`TaskUpdate` references: delete, don't replace

**Decision**: The existing `todo` tool at `rpiv-core/index.ts:263-342` has a `promptGuidelines` array at lines 269-273 that ends with *"This replaces TaskCreate/TaskUpdate from other systems."* — the LLM already learns the mapping at the extension level. The 13 skill-body references are redundant. **Delete them entirely.** No "Use the todo tool instead" prose replacement needed.

## Architecture

This section contains the full implementation code for every phase, in strict bottom-up order. Each file is either NEW (full content), MODIFY (current → after blocks), or COPY (shell command manifest).

---

### Phase 0 — Foundation

Exit criterion: `pi install /Users/sguslystyi/rpiv-pi` loads without errors, `package.json` linted clean.

#### `package.json` — MODIFY

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

Changes:
- `name`: `rpiv-skillbased` → `rpiv-pi`
- `version`: `0.1.0` → `0.2.0` (migration is a substantive change)
- `keywords`: add `pi-extension` alongside existing `pi-package`
- `pi.agents` field deleted (it was silently dropped by Pi's loader anyway; removing the dead declaration)

#### `extensions/rpiv-core/index.ts` — MODIFY (dead-import cleanup)

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

Changes:
- `rmSync`, `statSync`, `createHash` dropped — unused in the current file
- `copyFileSync`, `writeFileSync` added — used by the Phase 1 auto-copier
- `fileURLToPath` added — used by Phase 1 for package-root resolution
- `homedir` added — used by Phase 1 for `~/.pi/agent/pi-permissions.jsonc` path

(The rest of rpiv-core is untouched in Phase 0 — all functional changes are in Phase 1.)

---

### Phase 1 — rpiv-core enhancements

Exit criterion: after `pi install` + session start in a clean directory:
1. `<cwd>/.pi/agents/codebase-locator.md` exists (auto-copied)
2. `~/.pi/agent/pi-permissions.jsonc` exists (auto-seeded, if missing beforehand)
3. LLM sees `ask_user_question` in the system prompt's "Available tools:" section
4. `/rpiv-update-agents` command is registered and forces overwrite

#### `extensions/rpiv-core/index.ts` — MODIFY (full file after Phase 1 changes)

Section 1 — Package-root resolution constants. **Insert after existing `const injectedGuidance` block (~line 66), before the `clearInjectionState` function:**

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

Section 2 — Agent auto-copy helper. **Insert after the block above:**

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

Section 3 — Permissions seed helper. **Insert after the agent helper:**

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

Section 4 — `session_start` handler extension. **REPLACE the existing `session_start` handler at lines 79-92 with this expanded version:**

Current (lines 79-92):
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

After:
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

Section 5 — `ask_user_question` tool registration gets promptSnippet + promptGuidelines. **REPLACE the existing `pi.registerTool({name: "ask_user_question", ...})` block at lines 169-229 with this expanded version. The only additions are lines 173a-178a below; everything else is preserved verbatim.**

Current lines 169-180:
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

After:
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

(The `execute` function below the parameters block is unchanged.)

Section 6 — `/rpiv-update-agents` command. **Insert AFTER the existing `/todos` command registration at line 365, BEFORE the closing `}` of the extension factory:**

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

#### `extensions/rpiv-core/templates/pi-permissions.jsonc` — NEW

One-line purpose: Default rules file for `pi-permission-system@0.4.1`, seeded on first session_start.

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

---

### Phase 2 — Vendor @tintinweb/pi-subagents

Exit criterion: after `pi install`, `/agents` slash command lists `general-purpose`, `Explore`, `Plan`, PLUS the 9 custom agents from the rpiv-pi bundle; a test `Agent` tool invocation with `subagent_type: "codebase-locator"` resolves correctly (not to the silent `general-purpose` fallback).

Phase 2 is a pure file-copy operation. The vendored source is used verbatim — no modifications.

#### File copy manifest

Run these commands from `/Users/sguslystyi/rpiv-pi/`:

```bash
# Create the vendored extension directory structure
mkdir -p extensions/pi-subagents/ui

# Copy top-level src/*.ts (18 files)
cp /usr/local/lib/node_modules/@tintinweb/pi-subagents/src/agent-manager.ts extensions/pi-subagents/
cp /usr/local/lib/node_modules/@tintinweb/pi-subagents/src/agent-runner.ts extensions/pi-subagents/
cp /usr/local/lib/node_modules/@tintinweb/pi-subagents/src/agent-types.ts extensions/pi-subagents/
cp /usr/local/lib/node_modules/@tintinweb/pi-subagents/src/context.ts extensions/pi-subagents/
cp /usr/local/lib/node_modules/@tintinweb/pi-subagents/src/cross-extension-rpc.ts extensions/pi-subagents/
cp /usr/local/lib/node_modules/@tintinweb/pi-subagents/src/custom-agents.ts extensions/pi-subagents/
cp /usr/local/lib/node_modules/@tintinweb/pi-subagents/src/default-agents.ts extensions/pi-subagents/
cp /usr/local/lib/node_modules/@tintinweb/pi-subagents/src/env.ts extensions/pi-subagents/
cp /usr/local/lib/node_modules/@tintinweb/pi-subagents/src/group-join.ts extensions/pi-subagents/
cp /usr/local/lib/node_modules/@tintinweb/pi-subagents/src/index.ts extensions/pi-subagents/
cp /usr/local/lib/node_modules/@tintinweb/pi-subagents/src/invocation-config.ts extensions/pi-subagents/
cp /usr/local/lib/node_modules/@tintinweb/pi-subagents/src/memory.ts extensions/pi-subagents/
cp /usr/local/lib/node_modules/@tintinweb/pi-subagents/src/model-resolver.ts extensions/pi-subagents/
cp /usr/local/lib/node_modules/@tintinweb/pi-subagents/src/output-file.ts extensions/pi-subagents/
cp /usr/local/lib/node_modules/@tintinweb/pi-subagents/src/prompts.ts extensions/pi-subagents/
cp /usr/local/lib/node_modules/@tintinweb/pi-subagents/src/skill-loader.ts extensions/pi-subagents/
cp /usr/local/lib/node_modules/@tintinweb/pi-subagents/src/types.ts extensions/pi-subagents/
cp /usr/local/lib/node_modules/@tintinweb/pi-subagents/src/worktree.ts extensions/pi-subagents/

# Copy src/ui/*.ts (2 files)
cp /usr/local/lib/node_modules/@tintinweb/pi-subagents/src/ui/agent-widget.ts extensions/pi-subagents/ui/
cp /usr/local/lib/node_modules/@tintinweb/pi-subagents/src/ui/conversation-viewer.ts extensions/pi-subagents/ui/

# Verify 20 .ts files landed
find extensions/pi-subagents -name "*.ts" | wc -l  # expected: 20
```

Total: 20 `.ts` files, ~4836 lines. All imports are either Node stdlib, peerDeps already declared in rpiv-pi's `package.json`, or the two type-only `@mariozechner/pi-agent-core` references that are safely erased at runtime by Pi's TS loader.

#### `extensions/pi-subagents/LICENSE` — NEW (synthesized MIT)

One-line purpose: Attribution for the vendored upstream source.

```
MIT License

Copyright (c) 2025 tintinweb

This extension bundles source code from @tintinweb/pi-subagents v0.5.2:
  https://github.com/tintinweb/pi-subagents

The upstream package declares the MIT license in its package.json but
ships no LICENSE file in the published npm tarball. This file is a
standard MIT License text with attribution to the original author.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

#### `extensions/pi-subagents/README.md` — NEW

One-line purpose: Upstream-tracking note for the vendored source.

```markdown
# extensions/pi-subagents/

Vendored from [@tintinweb/pi-subagents@0.5.2](https://github.com/tintinweb/pi-subagents).

## Upstream sync procedure

```bash
# Overwrite every file from the installed npm package
cp /usr/local/lib/node_modules/@tintinweb/pi-subagents/src/*.ts ./
cp /usr/local/lib/node_modules/@tintinweb/pi-subagents/src/ui/*.ts ./ui/
```

Do NOT modify the vendored source in place — upstream compatibility depends
on verbatim copies. If rpiv-pi needs behavioral tweaks, add them as a wrapper
extension in a separate directory.

## Provided tools

- `Agent` — spawn subagents (registered at `index.ts:553`)
- `get_subagent_result` — retrieve background subagent results (`index.ts:971`)
- `steer_subagent` — redirect a running subagent (`index.ts:1045`)

## Provided commands

- `/agents` — interactive agent management UI (`index.ts:1667`)

## Agent discovery paths

- Global: `~/.pi/agent/agents/*.md`
- Project: `<cwd>/.pi/agents/*.md` ← populated by rpiv-core's `session_start` handler
```

---

### Phase 3 — New `extensions/web-tools/` (Brave-only)

Exit criterion: after `pi install`, LLM sees `web_search` and `web_fetch` in "Available tools:"; `/web-search-config` command prompts for an API key and persists it to `~/.config/rpiv-pi/web-tools.json`; a test `web_search` call returns Brave results.

#### `extensions/web-tools/index.ts` — NEW

One-line purpose: Brave-backed `web_search` + `web_fetch` tools with config-file persistence.

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

---

### Phase 4 — Canary skill: `commit/SKILL.md`

Exit criterion: end-to-end test on a sample dirty-repo — `/skill:commit` triggers `ask_user_question` tool selector with the three options, user selects "Commit", git commits happen, final state matches intent. No permission prompts (permissions file was seeded in Phase 1).

#### `skills/commit/SKILL.md` — MODIFY (full rewritten file)

**Current** (84 lines, lines 1-84):
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

[...rest of the file, lines 16-84...]
```

**After** (full file, ~77 lines):
```markdown
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
```

Changes applied (mechanical transforms from Decisions 13, 15, 10):
1. **Lines 8-11 deleted** — the `## Current state` block with 3 `!`git`` shell evals. rpiv-core's `before_agent_start` handler at `extensions/rpiv-core/index.ts:141-158` injects the same info.
2. **Line 14 `$ARGUMENTS` replaced** with prose nudge (Decision 10).
3. **Lines 47-61 `AskUserQuestion:` YAML block collapsed** to a one-line tool call instruction (Decision 15). The LLM now sees the tool purpose from the `promptSnippet`/`promptGuidelines` added in Phase 1.
4. **Step 0 "Check git availability" rewritten** — the old version referenced the deleted `## Current state` block; now it runs `git status --short` directly.
5. **Frontmatter `allowed-tools:` kept as-is** (Decision 11).

---

### Phase 5 — Agent-free skills (6 files)

Exit criterion: each of 6 skills runs end-to-end with no `Agent` tool invocations needed, no `rpiv-next:` prefix references, no `!`git`` blocks, no unresolved `$ARGUMENTS`, no `${CLAUDE_PLUGIN_ROOT}`/`${CLAUDE_SKILL_DIR}`.

The 6 skills: `migrate-to-guidance`, `implement-plan`, `create-handoff`, `validate-plan`, `resume-handoff`, `write-plan`. None dispatch custom agents (`write-plan` has 4 `rpiv-next:` hits on non-dispatch lines; `validate-plan` uses only `general-purpose`).

#### Mechanical transform specification

Apply to every file in this phase:

1. **Delete `## Git Context` block** (4-6 lines at the top of each file, always containing `!`git branch`, `!`git rev-parse`, `!`git log``).
2. **Delete `!`git`` shell-eval lines** anywhere else.
3. **Replace `/rpiv-next:<skill>` command references** with `/skill:<skill>` (Pi's native skill command prefix).
4. **Replace prose `rpiv-next:<agent>` references** with `<agent>` (no prefix).
5. **Rewrite `AskUserQuestion:` YAML blocks** to one-line `ask_user_question` tool instructions using Decision 15's template.
6. **Rewrite `$ARGUMENTS` blocks** using Decision 10's template.
7. **Delete `TaskCreate`/`TaskUpdate` prose references** entirely (Decision 16).
8. **Replace `${CLAUDE_PLUGIN_ROOT}/scripts/migrate.js`** with the equivalent file path relative to the vendored rpiv-pi package root. The runtime path is derived by rpiv-core from `import.meta.url`; for the skill body, reference it as the relative path `scripts/migrate.js` or prose instruction to use the package-bundled script.
9. **Keep** `allowed-tools:`, `disable-model-invocation: true`, `argument-hint:` frontmatter fields as-is.
10. **Keep** all "Agent tool" prose references (the tool IS named `Agent` in pi-subagents).

#### Per-file edit lists

**`skills/migrate-to-guidance/SKILL.md`** (89 lines, 5 pattern hits)

- Line 10: `/rpiv-next:annotate-inline` → `/skill:annotate-inline`
- Lines 24 and 57: Replace `${CLAUDE_PLUGIN_ROOT}/scripts/migrate.js` with `scripts/migrate.js` (relative to package root — since this is a skill body read by the LLM, the LLM will run `node scripts/migrate.js` from the rpiv-pi package directory).
- Line 81: `/rpiv-next:annotate-inline` and `/rpiv-next:annotate-guidance` → `/skill:annotate-inline` and `/skill:annotate-guidance`
- **Precondition**: Copy `scripts/migrate.js` from the upstream rpiv-skillbased repo into `/Users/sguslystyi/rpiv-pi/scripts/migrate.js` before running this skill. (See "Migration Notes" section below for the copy command.)

**`skills/implement-plan/SKILL.md`** (92 lines, 6 pattern hits)

- Lines 9-10: `## Task\n$ARGUMENTS` → prose per Decision 10:
  > ## Task
  >
  > If the user has not already provided a specific plan path, ask them for it before proceeding. Their input will appear as a follow-up paragraph after this skill body.
- Lines 51-63: `AskUserQuestion:` block → one-line tool call instruction:
  > Use the `ask_user_question` tool to resolve the mismatch. Question: "[Brief summary of the mismatch]". Header: "Mismatch". Options: "Follow the plan" (Adapt the plan's approach to the current code state); "Skip this change" (Move on without this change — it may not be needed); "Update the plan" (The plan needs to be revised before continuing).

**`skills/create-handoff/SKILL.md`** (97 lines, 7 pattern hits)

- Lines 9-12: Delete `## Git Context` block (`!`git`` × 3).
- Line 86 (inside `<template_response>` block): `/rpiv-next:resume-handoff` → `/skill:resume-handoff`.

**`skills/validate-plan/SKILL.md`** (181 lines, 9 pattern hits)

- Lines 8-11: Delete `## Git Context` block.
- Lines 55-64: **Keep as-is** — references to `general-purpose` agents are already correct (`pi-subagents/src/default-agents.ts:12-28` registers this as a default).
- Line 174: `/rpiv-next:implement-plan` → `/skill:implement-plan`
- Line 175: `/rpiv-next:commit` → `/skill:commit`
- Line 176: `/rpiv-next:validate-plan` → `/skill:validate-plan`

**`skills/resume-handoff/SKILL.md`** (11 pattern hits) — requires full Read for line-level diff before Phase 5 execution. Mechanical transforms per the shared spec above. Expected changes: `## Git Context` block deletion, `$ARGUMENTS` block prose rewrite, 2 `TaskCreate`/`TaskUpdate` prose deletions, 2 `rpiv-next:` prefix strips, 1 `AskUserQuestion:` prose nudge.

**`skills/write-plan/SKILL.md`** (13 pattern hits) — requires full Read for line-level diff before Phase 5 execution. Mechanical transforms: `## Git Context` block deletion, `$ARGUMENTS` block prose rewrite, 1 `TaskCreate`/`TaskUpdate` prose deletion, 4 `rpiv-next:` prefix strips (all non-dispatch), 1 `AskUserQuestion:` prose nudge, 3 "Agent tool" prose references kept.

**Note on `scripts/migrate.js` for `migrate-to-guidance`**: The upstream version lives at `/Users/sguslystyi/rpiv-skillbased/scripts/migrate.js`. During Phase 5 execution:

```bash
mkdir -p /Users/sguslystyi/rpiv-pi/scripts
cp /Users/sguslystyi/rpiv-skillbased/scripts/migrate.js /Users/sguslystyi/rpiv-pi/scripts/migrate.js
```

If that file doesn't exist in rpiv-skillbased either (it's referenced in skill bodies but may be an artifact), the alternative is to mark `migrate-to-guidance` as "partial migration" — the skill body transforms are applied but the skill remains non-functional until the script is ported in a future phase.

---

### Phase 6 — Research skills (4 files)

Exit criterion: all 4 research skills spawn named subagents (`codebase-locator`, `codebase-analyzer`, etc.) successfully — each subagent reports its resolved type back via `console.log` inspection or by stating its role in the response.

The 4 skills: `research`, `research-questions`, `research-codebase`, `research-solutions`.

#### Mechanical transforms (same spec as Phase 5) plus custom-agent validation

Apply the Phase 5 mechanical transform list to all 4 files. Additionally, these skills dispatch CUSTOM subagents (not `general-purpose`), so each `rpiv-next:<agent>` → `<agent>` rewrite is load-bearing for runtime correctness. The per-skill custom-agent dependency matrix:

- `research-codebase`: `codebase-locator`, `codebase-analyzer`, `codebase-pattern-finder`, `integration-scanner`, `thoughts-locator`, `thoughts-analyzer`, `precedent-locator`, `web-search-researcher`
- `research-questions`: `codebase-locator`, `thoughts-locator`, `integration-scanner`
- `research`: `codebase-analyzer`, `codebase-locator`, `precedent-locator`, `web-search-researcher`
- `research-solutions`: `codebase-locator`, `codebase-analyzer`, `codebase-pattern-finder`, `thoughts-locator`, `web-search-researcher`

All 9 custom agents are bundled at `/Users/sguslystyi/rpiv-pi/agents/*.md` and auto-copied to `<cwd>/.pi/agents/` by Phase 1's rpiv-core handler.

**Validation tactic**: For each skill, run it once with a trivial test prompt, then grep the session log for the resolved `subagent_type` at dispatch time. The research doc warns that `@tintinweb/pi-subagents/src/index.ts:730-732` silently falls back to `general-purpose` — confirm each named dispatch resolves correctly by having the subagent state its own type in its response.

#### Per-file pattern counts (from research Pattern Density Table)

| Skill | AskUserQuestion | TaskCreate | `$ARGS` | `!`git`` | `rpiv-next:` | `allowed-tools` |
|---|---|---|---|---|---|---|
| research-codebase | 3 | 1 | 1 | 2 | 8 | 0 |
| research-questions | 1 | 1 | 1 | 2 | 4 | 0 |
| research | 2 | 0 | 1 | 2 | 7 | 0 |
| research-solutions | 0 | 1 | 0 | 2 | 5 | 0 |

Phase 6 execution per skill:
1. Read full file
2. Apply mechanical transforms
3. Write modified file
4. Run `/skill:<name>` in a test workspace
5. Verify named subagent dispatches succeed (check `.pi/` session log or have subagents state their type)

---

### Phase 7 — Design/plan skills (7 files)

Exit criterion: each of 7 skills runs end-to-end, spawning the correct custom subagents, and produces an output artifact in the expected `thoughts/shared/<dir>/` location.

The 7 skills (by pattern density, ascending): `iterate-plan`, `evaluate-research`, `code-review`, `design-feature`, `design-feature-iterative`, `create-plan`, `outline-test-cases`. Wait — `outline-test-cases` belongs to Phase 8. Corrected list:

`iterate-plan` (22 hits), `code-review` (20 hits), `evaluate-research` (17 hits), `design-feature` (26 hits), `design-feature-iterative` (32 hits), `create-plan` (31 hits).

Apply the Phase 5 mechanical transform spec to each. The heaviest files (`design-feature-iterative` 532 lines, `create-plan` 492 lines) will have the most edits but follow the same rules.

**`create-plan/SKILL.md` special case**: Line 458 has 6 `rpiv-next:` tokens on one line (`rpiv-next:codebase-locator`, `codebase-analyzer`, `codebase-pattern-finder`, `thoughts-locator`, `thoughts-analyzer`, `web-search-researcher`). Replace all 6 in one Edit call.

**`code-review/SKILL.md` special case**: Lines 9-13 contain a 5-line `## Git Context` block (wider than the standard 3-line version in other skills). Delete all 5 lines.

Dependency matrix:

- `iterate-plan`: `codebase-locator`, `codebase-analyzer`, `codebase-pattern-finder`, `thoughts-locator`, `thoughts-analyzer`
- `evaluate-research`: `codebase-locator`, `codebase-analyzer`, `integration-scanner`, `thoughts-locator`
- `code-review`: `codebase-locator`, `codebase-analyzer`, `codebase-pattern-finder`, `thoughts-locator`, `thoughts-analyzer`, `web-search-researcher`
- `design-feature`: `codebase-pattern-finder`, `codebase-analyzer`, `integration-scanner`, `precedent-locator`, `codebase-locator`, `thoughts-locator`, `web-search-researcher`
- `design-feature-iterative`: `codebase-pattern-finder`, `codebase-analyzer`, `integration-scanner`, `precedent-locator`, `web-search-researcher`
- `create-plan`: `codebase-locator`, `codebase-analyzer`, `codebase-pattern-finder`, `integration-scanner`, `thoughts-locator`, `thoughts-analyzer`, `precedent-locator`, `web-search-researcher`

---

### Phase 8 — Annotate + test skills (4 files)

Exit criterion: `annotate-guidance`/`annotate-inline` scaffold CLAUDE.md files + resolve template paths correctly; `outline-test-cases`/`write-test-cases` produce outline + test case artifacts in `.rpiv/test-cases/` using the bundled templates.

The 4 skills: `annotate-guidance`, `annotate-inline`, `outline-test-cases`, `write-test-cases`.

Mechanical transforms same as Phase 5/6. Additionally:

#### `${CLAUDE_SKILL_DIR}` replacement

Affected files (from research):

- `annotate-inline/SKILL.md:250, 260 (×2), 271, 282, 283, 284` — 7 tokens
- `annotate-guidance/SKILL.md:254, 264 (×2), 275, 286, 287, 288` — 7 tokens
- `outline-test-cases/SKILL.md:299, 309` — 2 tokens
- `write-test-cases/SKILL.md:220, 221, 223 (×3), 232 (×2), 277` — 8 tokens

Replace every occurrence with the template file's path relative to the skill directory. For example:

```
${CLAUDE_SKILL_DIR}/templates/architecture.md
```
becomes:
```
templates/architecture.md
```

**Why relative paths work**: Pi's `_expandSkillCommand` at `dist/core/agent-session.js:822-824` wraps the skill body in `<skill name="..." location="..."><References are relative to ${skill.baseDir}.>...body...</skill>` — the LLM gets told explicitly that relative paths resolve against the skill's base directory, which is `/Users/sguslystyi/rpiv-pi/skills/<skill-name>/`. Templates live at `/Users/sguslystyi/rpiv-pi/skills/<skill-name>/templates/*.md` already.

**Validation**: after edits, `find skills/annotate-inline/templates skills/annotate-guidance/templates skills/outline-test-cases/templates skills/write-test-cases/templates -name "*.md"` should list all template files referenced in the skills. Any orphan references (template file missing) become follow-up work.

#### Pattern counts

| Skill | AQ | TC | $A | !git | CSD | rpiv-next: |
|---|---|---|---|---|---|---|
| annotate-guidance | 4 | 0 | 0 | 0 | 7 | 5 |
| annotate-inline | 4 | 0 | 0 | 0 | 7 | 5 |
| outline-test-cases | 5 | 1 | 1 | 2 | 2 | 6 |
| write-test-cases | 4 | 0 | 1 | 2 | 8 | 10 |

Dependency matrix:

- `annotate-guidance`: `codebase-locator`, `codebase-analyzer`, `codebase-pattern-finder`
- `annotate-inline`: same 3 agents
- `outline-test-cases`: `codebase-locator`, `test-case-locator`
- `write-test-cases`: `codebase-locator`, `test-case-locator`, `codebase-analyzer`, `integration-scanner`

---

## Desired End State

After all 9 phases complete, the developer runs:

```bash
# Install the migrated package
pi install /Users/sguslystyi/rpiv-pi

# Configure Brave API key (one-time)
/web-search-config

# Start a session in a test project, then:
/skill:commit                       # Canary — Phase 4 validates this
/skill:research-codebase            # Full research flow — Phase 6 validates
/skill:design-feature thoughts/shared/research/<latest>.md   # Phase 7
/skill:write-plan thoughts/shared/designs/<latest>.md        # Phase 5
/skill:implement-plan thoughts/shared/plans/<latest>.md      # Phase 5
/skill:validate-plan thoughts/shared/plans/<latest>.md       # Phase 5
```

From inside a session, the LLM's "Available tools:" list includes: `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`, `Agent`, `get_subagent_result`, `steer_subagent`, `ask_user_question`, `todo`, `web_search`, `web_fetch` (14 tools total).

Subagent dispatches from skills resolve to the correct custom agent (never silently fall back to `general-purpose`). Permissions prompts happen only for `write`/`edit`/non-git-bash operations. Agent files live at `<cwd>/.pi/agents/` and can be edited live (reload on next Agent invocation).

## File Map

```
package.json                                       # MODIFY — rename, drop agents field, bump version
extensions/rpiv-core/index.ts                      # MODIFY — +3 helpers, +session_start logic, +promptSnippet, +/rpiv-update-agents command
extensions/rpiv-core/templates/pi-permissions.jsonc # NEW — default rules file for auto-seed
extensions/pi-subagents/                           # NEW dir — 20 vendored .ts files
extensions/pi-subagents/index.ts                   # COPY from @tintinweb/pi-subagents/src/index.ts
extensions/pi-subagents/agent-manager.ts           # COPY
extensions/pi-subagents/agent-runner.ts            # COPY
extensions/pi-subagents/agent-types.ts             # COPY
extensions/pi-subagents/context.ts                 # COPY
extensions/pi-subagents/cross-extension-rpc.ts     # COPY
extensions/pi-subagents/custom-agents.ts           # COPY
extensions/pi-subagents/default-agents.ts          # COPY
extensions/pi-subagents/env.ts                     # COPY
extensions/pi-subagents/group-join.ts              # COPY
extensions/pi-subagents/invocation-config.ts       # COPY
extensions/pi-subagents/memory.ts                  # COPY
extensions/pi-subagents/model-resolver.ts          # COPY
extensions/pi-subagents/output-file.ts             # COPY
extensions/pi-subagents/prompts.ts                 # COPY
extensions/pi-subagents/skill-loader.ts            # COPY
extensions/pi-subagents/types.ts                   # COPY
extensions/pi-subagents/worktree.ts                # COPY
extensions/pi-subagents/ui/agent-widget.ts         # COPY
extensions/pi-subagents/ui/conversation-viewer.ts  # COPY
extensions/pi-subagents/LICENSE                    # NEW — synthesized MIT attribution
extensions/pi-subagents/README.md                  # NEW — upstream sync procedure
extensions/web-tools/index.ts                      # NEW — Brave web_search/web_fetch + /web-search-config
scripts/migrate.js                                  # NEW (Phase 5 precondition) — copied from rpiv-skillbased if available
skills/commit/SKILL.md                              # MODIFY — Phase 4 canary
skills/migrate-to-guidance/SKILL.md                 # MODIFY — Phase 5
skills/implement-plan/SKILL.md                      # MODIFY — Phase 5
skills/create-handoff/SKILL.md                      # MODIFY — Phase 5
skills/validate-plan/SKILL.md                       # MODIFY — Phase 5
skills/resume-handoff/SKILL.md                      # MODIFY — Phase 5
skills/write-plan/SKILL.md                          # MODIFY — Phase 5
skills/research/SKILL.md                            # MODIFY — Phase 6
skills/research-questions/SKILL.md                  # MODIFY — Phase 6
skills/research-codebase/SKILL.md                   # MODIFY — Phase 6
skills/research-solutions/SKILL.md                  # MODIFY — Phase 6
skills/iterate-plan/SKILL.md                        # MODIFY — Phase 7
skills/evaluate-research/SKILL.md                   # MODIFY — Phase 7
skills/code-review/SKILL.md                         # MODIFY — Phase 7
skills/design-feature/SKILL.md                      # MODIFY — Phase 7
skills/design-feature-iterative/SKILL.md            # MODIFY — Phase 7
skills/create-plan/SKILL.md                         # MODIFY — Phase 7
skills/annotate-guidance/SKILL.md                   # MODIFY — Phase 8
skills/annotate-inline/SKILL.md                     # MODIFY — Phase 8
skills/outline-test-cases/SKILL.md                  # MODIFY — Phase 8
skills/write-test-cases/SKILL.md                    # MODIFY — Phase 8
```

Counts: **28 NEW files** (24 vendored + LICENSE + README + pi-permissions template + web-tools), **22 MODIFY files** (package.json + rpiv-core + 20 skills + 1 future scripts/migrate.js).

## Ordering Constraints

**Hard ordering** (cannot run in parallel):

- **P0 → P1**: rpiv-core dead-import cleanup must land before rpiv-core logic additions, otherwise Edit operations on overlapping lines conflict.
- **P1 → P2**: agent auto-copy must work before testing that pi-subagents finds the agents. If vendored pi-subagents is installed first without agent files in `.pi/agents/`, the silent fallback masks any wiring bug.
- **P1 → P3**: `promptSnippet` convention must be established for `ask_user_question` before web-tools copies the same pattern.
- **P2 → P4**: canary skill uses `Agent` tool guidance? Actually no — `commit/SKILL.md` has no Agent dispatches, so technically P4 could land before P2. But P4's validation exercises the full extension stack; run P2 first so "all extensions loaded" is uniform across phase boundaries.
- **P3 → P6**: `web_search`/`web_fetch` tools must be registered before `web-search-researcher` subagent tries to use them. P6 skills spawn that agent.
- **P4 → P5/6/7/8**: canary validation before wide rewrite is the entire point of the phased structure.

**Soft ordering** (can parallelize within a phase):

- **P5**: all 6 skills are independent file edits; within the phase they can be edited in any order. Run validations after each for isolation.
- **P6**: all 4 research skills can be edited in parallel, but validation should be sequential (each skill spawns subagents that could conflict if run concurrently).
- **P7**: all 6 design/plan skills editable in parallel.
- **P8**: all 4 annotate+test skills editable in parallel.

**Cross-phase independence**:

- **P2 (vendor) and P3 (web-tools) are fully independent** — both are new directories with no shared files. They could run concurrently; sequenced here because the canary validation in P4 is cleaner with one-layer-at-a-time.

## Verification Notes

Carried from the research artifact's Precedents & Lessons + added discoveries from this design's targeted research:

1. **Verify `rpiv-next:` strip actually landed** — the silent fallback at `@tintinweb/pi-subagents/src/index.ts:730-732` hides prefix-strip bugs. Canary tactic: for each custom agent dispatch in skills, have the subagent state its own `subagent_type` in its response. If the response reads like `general-purpose` (generic chatty output) rather than `codebase-locator` (structured file location list), the prefix wasn't stripped.

2. **Verify `web_search`/`web_fetch` have exactly one registration** — the developer's globally-installed `~/.pi/agent/extensions/web-search/index.ts` ALSO registers these tools. After Phase 3, run `pi.getAllTools()` via a debug command or script to confirm one registration path per tool name. If Pi errors on duplicate `pi.registerTool` calls, the new extension must either (a) check for collision first, (b) use different tool names like `rpiv_web_search`, or (c) require the user to disable the local ext first.

3. **Test with `pi-permission-system` active** — the developer's `~/.pi/agent/settings.json:7` loads pi-permission-system every session. If the seeded `~/.pi/agent/pi-permissions.jsonc` is wrong (too strict or too permissive), every canary test will hit the wrong permission path. Validation: after Phase 1, manually cat the seeded file and verify it matches the `extensions/rpiv-core/templates/pi-permissions.jsonc` template.

4. **Session cwd must equal project root** — `@tintinweb/pi-subagents/src/custom-agents.ts:23` scans `process.cwd()` for `.pi/agents/`. If Pi launches from a parent directory, the agents don't get discovered. Validation: always start `pi` from inside a project directory, confirm `<cwd>/.pi/agents/` is populated after session_start.

5. **Do NOT test Phase 2 before Phase 1** — vendored pi-subagents WITHOUT rpiv-core's auto-copy will load successfully but all named-agent dispatches will silently fall back to `general-purpose`. The test output would mislead you into thinking Phase 2 is broken when the real issue is Phase 1 not shipping agents to the cwd.

6. **Canary on `commit` first, not `research-codebase`** — research lesson. `commit` exercises extension + skill-text layers without the agent discovery problem compounding. If `commit` works end-to-end, the full extension stack is proven.

7. **Test production builds of `web_search`** — the Brave API has rate limits. Running the canary + all Phase 6 research skills in a tight loop can burn through a free-tier quota. Either use a paid key or stub the tool in test runs.

8. **Watch for `process.cwd()` vs `ctx.cwd` mismatches** — rpiv-core's `copyBundledAgents` uses `ctx.cwd` (the session's cwd at start), but `@tintinweb/pi-subagents/src/custom-agents.ts:23` uses `process.cwd()` (the process's current cwd, which can drift). Normally these match, but if Phase 2's validation ever shows "agent not found" despite the file being present, check for cwd drift.

9. **Verify `import.meta.url` resolves to the right path** — rpiv-core's `PACKAGE_ROOT` constant does three `dirname` hops from `extensions/rpiv-core/index.ts`. If Pi's extension loader compiles/bundles the TS file to a different layout (e.g., all extensions inlined into one `dist/bundle.js`), the path will be wrong. Quick check: add a `console.log(PACKAGE_ROOT)` during Phase 1 validation and confirm it prints `/Users/sguslystyi/rpiv-pi`.

10. **Scaffolding gap is the first integration test** — `thoughts/shared/{research,designs,plans}/` don't exist in rpiv-pi today despite `extensions/rpiv-core/index.ts:79-92` claiming to create them. This means the extension has never run end-to-end in this workspace. Phase 1 validation is also the first real smoke test of rpiv-core. If the directories appear after `pi install` + session start, the whole extension loader chain is working.

11. **Verify `validate-plan`'s `general-purpose` references** — research doc's dependency matrix listed validate-plan as agent-dependent, but the targeted pattern scan revealed it only uses `general-purpose` (which pi-subagents registers as default). No custom agent rewrite needed. Do NOT accidentally rewrite these references to custom agent names in Phase 5.

12. **Be explicit about the `scripts/migrate.js` precondition for `migrate-to-guidance`** — this script does NOT currently exist in rpiv-pi. If the source copy at `/Users/sguslystyi/rpiv-skillbased/scripts/migrate.js` also doesn't exist, Phase 5's `migrate-to-guidance` migration is partial: text transforms apply, but the skill remains non-functional until the script is ported. Document this explicitly in the Phase 5 handoff so future sessions don't mistake it for a skill bug.

## Performance Considerations

- **Agent auto-copy is I/O bound** — 9 files × copyFileSync on session_start. Cheap (<5ms). Not a hot path.
- **Permissions seed is a one-time write** — touches the filesystem exactly once per user per install. Never on the hot path.
- **Vendored pi-subagents adds ~4800 lines of TS** to the extension load path. Pi's TS loader parses all extensions at startup; expect a small increase in cold-start time (estimated <100ms). No runtime overhead after load.
- **Brave Search API calls are network-bound** — typical latency 300-800ms. The tool is always user-initiated (LLM can't spam it), so rate limiting via backend is sufficient.
- **Skill text expansion cost** — Pi wraps each skill body in `<skill>...</skill>` at command invocation time (`_expandSkillCommand`). The prose rewrites in Phases 4-8 typically shrink skills by 5-15 lines each (delete YAML blocks, delete `## Git Context`), so the LLM's context cost for skill invocations DECREASES after migration.

## Migration Notes

**For the developer's own machine (canary testing)**:

- `/Users/sguslystyi/.pi/agent/settings.json:7` already has pi-permission-system and @tintinweb/pi-subagents in its `packages` array. After Phase 2 vendors pi-subagents into `extensions/pi-subagents/`, there may be a double-registration concern if the developer's globally-installed pi-subagents is also active. Mitigation: remove `"npm:@tintinweb/pi-subagents"` from the global settings.json before canary testing, OR verify that Pi's extension loader handles name collisions gracefully (one should win; the other should be skipped with a warning).

- Agent files may already exist at `~/.pi/agent/agents/` on the developer's machine from prior experimentation. Auto-copy to `<cwd>/.pi/agents/` creates a new copy; the global agents still load but are overridden by project agents (per `custom-agents.ts:26-28` — project overrides global). No action needed.

**For distributable users**:

- README must document the following prerequisite chain:
  1. `pi install /path/to/rpiv-pi`
  2. `pi install npm:pi-permission-system` (recommended — for permission enforcement)
  3. `/web-search-config` (one-time setup for Brave API key)

- The auto-seeded `~/.pi/agent/pi-permissions.jsonc` uses a balanced default: `allow` for read-only operations and rpiv-pi tools, `ask` for write operations and arbitrary bash. Users can edit the file after seeding; rpiv-core will never overwrite.

- `rpiv-next:` prefixes in any user's existing migration plans or handoffs will still work — Pi's skill loader resolves skills by their frontmatter `name:` field, and the skills' `name:` matches their directory basename (no prefix). Old references like `/rpiv-next:commit` need manual rewrite to `/skill:commit` by the user.

**Rollback strategy**:

- **P0 rollback**: revert package.json. Zero runtime impact.
- **P1 rollback**: revert rpiv-core changes. The auto-copied `.pi/agents/` files stay behind; they can be deleted manually. Seeded `~/.pi/agent/pi-permissions.jsonc` stays; users can edit it.
- **P2 rollback**: `rm -rf extensions/pi-subagents/`. Falls back to globally installed @tintinweb/pi-subagents if present, otherwise skills with agent dispatches silently fall back to `general-purpose`.
- **P3 rollback**: `rm -rf extensions/web-tools/`. Falls back to globally installed web-search extension if present. `web_search`/`web_fetch` may become unavailable.
- **P4+ rollback**: `git checkout skills/<name>/SKILL.md` per-file. Each skill is independent.

No data migrations, no schema changes, no irreversible operations anywhere in the 9-phase plan.

## Pattern References

- `extensions/rpiv-core/index.ts:263-342` — canonical `pi.registerTool` with `promptSnippet`/`promptGuidelines`. The template copied for `ask_user_question` and the new `web_search`/`web_fetch`.
- `/usr/local/lib/node_modules/pi-permission-system/src/extension-config.ts:67-83` — `ensurePermissionSystemConfig` idiom (check-exists, write-if-missing, best-effort error handling). The template for rpiv-core's `seedPermissionsFile`.
- `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/examples/extensions/dynamic-resources/index.ts:1-15` — `fileURLToPath(import.meta.url) → baseDir` pattern for resolving the extension's installed directory. Used by rpiv-core's `PACKAGE_ROOT` constant.
- `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/examples/extensions/claude-rules.ts:49-61` — `session_start` handler reading files from `<cwd>/.claude/rules/` + notify pattern. The template for rpiv-core's expanded `session_start`.
- `/usr/local/lib/node_modules/pi-perplexity/src/config.ts` — JSON config file with `join(homedir(), ".config", ...)` + `0o600` chmod + `resolveSearchDefaults(params, env, config, default)` precedence. The template for `extensions/web-tools/`'s `loadConfig`/`saveConfig`/`resolveApiKey`.
- `/usr/local/lib/node_modules/pi-perplexity/src/commands/config.ts` — slash command structure (`--show` / `--help` flags, cancellation handling via `ctx.ui.notify`). The template for `/web-search-config`.
- `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/examples/extensions/dynamic-tools.ts:33-46` — the only live `promptSnippet` + `promptGuidelines` pair in the ecosystem's real extension code. Wording calibration reference.
- `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/tools/{read,write,edit,grep,find,ls}.js` — built-in tool `promptSnippet` strings for house-style alignment (short imperative fragment, no trailing period).
- `/usr/local/lib/node_modules/@tintinweb/pi-subagents/src/index.ts:553-628` — `Agent` tool parameter schema. Referenced in the design so skill prose instructions match the real parameter names (`prompt`, `description`, `subagent_type`).

## Developer Context

Questions asked during the checkpoint (verbatim) and their answers:

**Q: pi-permission-system's DEFAULT_POLICY is "ask" (`permission-manager.ts:31-37`) — when `~/.pi/agent/pi-permissions.jsonc` is missing, EVERY tool call triggers an interactive prompt, including read/bash/ask_user_question/todo. That will make the commit/SKILL.md canary test unrunnable unmodified. How should we handle this?**

A: Auto-seed permissions file + skip vendoring pi-permission-system. (User clarification: "Most important that the final version after migration uses pi-permissions — either with YOLO or restricted by default. On another side that would be great to test it with permissions in place. What will happen if I have pi-permissions globally installed already on my machine — will this cover test runs?")

Answer to the user's sub-question: Yes — the developer's `/Users/sguslystyi/.pi/agent/settings.json:7` already loads pi-permission-system globally, so canary testing uses that copy. Vendoring is unnecessary for local testing; it only matters for distribution. The real load-bearing piece is the rules file, which the auto-seed handles.

**Q: Here is the proposed 9-phase bottom-up structure, each with independent exit criteria. Does this match your mental model of "down to top", or do you want phase boundaries restructured?**

A: Yes — use the 9-phase structure as proposed (P0 foundation → P1 rpiv-core → P2 pi-subagents → P3 web-tools → P4 canary commit → P5 agent-free → P6 research → P7 design/plan → P8 annotate+test).

**Q: The canary pattern scan surfaced that `validate-plan` only uses generic `general-purpose` agent dispatches (lines 55-64) — no custom `rpiv-next:codebase-locator`-style names. And `migrate-to-guidance` uses `${CLAUDE_PLUGIN_ROOT}` (lines 24, 57), which the research doc never mentioned. How should the design treat these?**

A: Treat as known-simple. Leave `general-purpose` references in validate-plan as-is (pi-subagents registers that agent as a default). Replace `${CLAUDE_PLUGIN_ROOT}` in migrate-to-guidance with the vendored `import.meta.url`-derived path using the same mechanism as agent auto-copy.

## References

- Research artifact: `thoughts/shared/research/2026-04-10_13-45-00_complete-pi-migration.md` — 608 lines. The foundation for this design; every architectural decision here either implements a research conclusion or resolves an ambiguity flagged there.
- Research questions doc: `thoughts/shared/questions/2026-04-10_08-45-32_complete-pi-migration.md` — the 8-question brief that drove the research.
- MIGRATION.md: `/Users/sguslystyi/rpiv-pi/thoughts/MIGRATION.md` — living status tracker. After Phase 1 lands, update the "What's Done" section; after Phase 4 lands, update the canary checklist.
- Gap analysis (foundational): `/Users/sguslystyi/rpiv-skillbased/thoughts/shared/research/2026-04-10_gap-analysis-porting-to-pi.md` — 669 lines. Referenced by MIGRATION.md as the "foundational document". Lives in the wrong repo; consider copying into `/Users/sguslystyi/rpiv-pi/thoughts/shared/research/` before Phase 1 to preserve the link.
- Pi runtime source:
  - `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/package-manager.js:38` — `RESOURCE_TYPES` constant (proves `pi.agents` is silently dropped)
  - `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/agent-session.js:812-836` — `_expandSkillCommand` (proves `$ARGUMENTS` is not interpolated and shows the `<skill>` wrap structure with `References are relative to ${skill.baseDir}`)
  - `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/skills.js:211-251` — `loadSkillFromFile` (proves only `name`/`description`/`disable-model-invocation` frontmatter keys are honored)
  - `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/system-prompt.js:42-46` — `visibleTools` filter (proves tools without `promptSnippet` are excluded from "Available tools:")
  - `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/extensions/types.d.ts:281-302` — `ToolDefinition` with `promptSnippet`/`promptGuidelines` fields
  - `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/extensions/types.d.ts:55-164` — `ExtensionUIContext` signatures for `select`/`input`/`confirm`/`notify`
- Vendored source:
  - `/usr/local/lib/node_modules/@tintinweb/pi-subagents/src/index.ts:553-628` — `Agent` tool parameter schema
  - `/usr/local/lib/node_modules/@tintinweb/pi-subagents/src/index.ts:728` — `reloadCustomAgents()` call before every spawn (confirms auto-copy-then-spawn works)
  - `/usr/local/lib/node_modules/@tintinweb/pi-subagents/src/index.ts:730-732` — the silent `general-purpose` fallback
  - `/usr/local/lib/node_modules/@tintinweb/pi-subagents/src/custom-agents.ts:21-28` — agent discovery paths (`<cwd>/.pi/agents/` and `~/.pi/agent/agents/`)
  - `/usr/local/lib/node_modules/@tintinweb/pi-subagents/src/default-agents.ts:12-28` — `general-purpose` default agent definition
  - `/usr/local/lib/node_modules/@tintinweb/pi-subagents/src/agent-runner.ts:25` — `EXCLUDED_TOOL_NAMES` = ["Agent","get_subagent_result","steer_subagent"]
- Permission system source:
  - `/usr/local/lib/node_modules/pi-permission-system/src/permission-manager.ts:22` — `GLOBAL_CONFIG_PATH = join(homedir(), ".pi", "agent", "pi-permissions.jsonc")`
  - `/usr/local/lib/node_modules/pi-permission-system/src/permission-manager.ts:31-37` — `DEFAULT_POLICY` (proves "ask" is the default when rules file is missing)
  - `/usr/local/lib/node_modules/pi-permission-system/src/extension-config.ts:67-83` — `ensurePermissionSystemConfig` pattern (template for rpiv-core's seeder)
- Reference implementations:
  - `/Users/sguslystyi/.pi/agent/extensions/web-search/index.ts` — user's existing web-search extension (~552 lines). Source of the new web-tools/index.ts after Tavily/Serper strip.
  - `/usr/local/lib/node_modules/pi-perplexity/src/config.ts` — JSON config + chmod pattern
  - `/usr/local/lib/node_modules/pi-perplexity/src/commands/config.ts` — slash command structure
  - `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/examples/extensions/dynamic-resources/index.ts` — `fileURLToPath(import.meta.url)` baseDir pattern
  - `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/examples/extensions/claude-rules.ts:49-61` — `session_start` file-scan + notify pattern
  - `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/examples/extensions/dynamic-tools.ts:33-46` — only live `promptSnippet`+`promptGuidelines` example
