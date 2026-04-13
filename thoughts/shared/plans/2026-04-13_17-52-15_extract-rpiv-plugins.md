---
date: 2026-04-13T17:52:15-0400
planner: Claude Code
git_commit: 887096d
branch: master
repository: rpiv-pi
topic: "Extract ask_user_question, todo, advisor, and web-tools into 4 prerequisite Pi plugins"
tags: [plan, rpiv-core, rpiv-web-tools, plugin-extraction, peer-dependencies, migration]
status: ready
design_source: "thoughts/shared/designs/2026-04-13_17-00-00_extract-rpiv-plugins.md"
last_updated: 2026-04-13
last_updated_by: Claude Code
---

# Extract rpiv-pi Tools Into Four Prerequisite Plugins — Implementation Plan

## Overview

Extract four self-contained capabilities from `rpiv-pi` into independently-released Pi plugin packages: `rpiv-ask-user-question`, `rpiv-advisor`, `rpiv-todo`, `rpiv-web-tools`. After extraction, `rpiv-pi` retains only orchestration (guidance injection, git context, thoughts scaffolding, agent auto-copy, subagent tuning, `/rpiv-setup`, `/rpiv-update-agents`, `active_agent` workaround). Each plugin ships as its own public GitHub repo under `github.com/juicesharp`; plugin folders are created as siblings of `rpiv-pi` at `/Users/sguslystyi/`. The `rpiv-pi` repo itself remains on its current private remote.

All tool and command names (`ask_user_question`, `todo`, `advisor`, `web_search`, `web_fetch`, `/todos`, `/advisor`, `/web-search-config`) are preserved verbatim. The `pi-permission-system` permissions seeder and template are deleted outright — Pi runs YOLO by default; `pi-permission-system` is a user choice with its own policy file. Config paths for advisor and web-tools hard-cut over (silent cutover for advisor; loud cutover for web-tools via the existing throw when no key is configured).

See design artifact for the full architectural rationale: `thoughts/shared/designs/2026-04-13_17-00-00_extract-rpiv-plugins.md`.

## Desired End State

```bash
# Fresh install
pi install npm:rpiv-pi
# Session_start emits one aggregated warning listing 5 missing siblings.

pi
> /rpiv-setup
# Five `pi install` invocations, sequential. User restarts session.

pi
# ask_user_question, todo, advisor, web_search, web_fetch all registered.
# /todos, /advisor, /web-search-config, /rpiv-setup, /rpiv-update-agents available.
# No ~/.pi/agent/pi-permissions.jsonc seeded.
```

- Plugin directories exist as siblings: `/Users/sguslystyi/rpiv-ask-user-question`, `/rpiv-advisor`, `/rpiv-todo`, `/rpiv-web-tools`.
- Each plugin has a public GitHub repo at `github.com/juicesharp/<name>` with an initial commit pushed.
- `rpiv-pi` repo has extracted modules deleted, `package.json` version bumped to `0.4.0`, `peerDependencies` lists the 5 siblings, `README.md` updated, `extensions/rpiv-core/index.ts` pruned, `package-checks.ts` gains 4 new probes.
- Existing session history with `todo` tool-result entries replays correctly under `rpiv-todo` (tool name preserved; branch-replay filter matches).
- `BRAVE_SEARCH_API_KEY` env var keeps working unchanged; users re-run `/advisor` and `/web-search-config` once on upgrade.

## What We're NOT Doing

- **Fragment-merge permissions seeder.** Seeder and template deleted entirely (D3).
- **Tool or command renames.** All verbatim.
- **Pi loader / manifest changes.** No new `pi.dependencies` field.
- **Per-plugin permission files.** `pi-permission-system` does not aggregate across files.
- **Advisor / web-tools config migration helpers.** Silent / loud hard cutover.
- **pi-mono feature request for a native `pi.dependencies` field.** Deferred.
- **Changes to `subagent-tuning.ts`, `guidance.ts`, `/rpiv-update-agents`, bundled agents directory.** All stay in rpiv-pi.
- **Changes to rpiv-pi's git remote** — stays on its current private remote.

---

## Phase 1: Create `rpiv-ask-user-question` plugin

### Overview
Create the smallest, zero-dependency plugin first — it establishes the flat package layout, the `package.json` shape (`pi.extensions` + `peerDependencies`), and the README structure that phases 2–4 model on. New public GitHub repo at `github.com/juicesharp/rpiv-ask-user-question`.

### Changes Required:

#### 1. Create plugin directory
**Path**: `/Users/sguslystyi/rpiv-ask-user-question/` (new sibling dir of rpiv-pi)

#### 2. `rpiv-ask-user-question/package.json`
**File**: `/Users/sguslystyi/rpiv-ask-user-question/package.json`
**Changes**: New file. Pi extension manifest with three peer deps (no `@mariozechner/pi-ai` — this plugin never calls LLMs).

```json
{
  "name": "rpiv-ask-user-question",
  "version": "0.1.0",
  "description": "Pi extension: structured ask_user_question tool for disambiguation prompts",
  "keywords": ["pi-package", "pi-extension", "rpiv"],
  "type": "module",
  "pi": {
    "extensions": ["./index.ts"]
  },
  "peerDependencies": {
    "@mariozechner/pi-coding-agent": "*",
    "@mariozechner/pi-tui": "*",
    "@sinclair/typebox": "*"
  }
}
```

#### 3. `rpiv-ask-user-question/index.ts`
**File**: `/Users/sguslystyi/rpiv-ask-user-question/index.ts`
**Changes**: New file. Single `default export(pi)` that delegates to `registerAskUserQuestionTool(pi)`.

Source: design artifact § `rpiv-ask-user-question/index.ts — NEW`.

#### 4. `rpiv-ask-user-question/ask-user-question.ts`
**File**: `/Users/sguslystyi/rpiv-ask-user-question/ask-user-question.ts`
**Changes**: New file. **Verbatim copy** of `/Users/sguslystyi/rpiv-pi/extensions/rpiv-core/ask-user-question.ts` at commit `7525a5d`. No edits — the module has no sibling imports.

Command to produce:
```bash
cp /Users/sguslystyi/rpiv-pi/extensions/rpiv-core/ask-user-question.ts \
   /Users/sguslystyi/rpiv-ask-user-question/ask-user-question.ts
```

#### 5. `rpiv-ask-user-question/README.md`
**File**: `/Users/sguslystyi/rpiv-ask-user-question/README.md`
**Changes**: New file. Description, installation, tool summary. **Zero mention of `pi-permission-system` per D3.**

Source: design artifact § `rpiv-ask-user-question/README.md — NEW`.

#### 6. Initialize git + push to public GitHub repo
**Changes**: Initialize git, create public repo under `juicesharp`, push initial commit.

```bash
cd /Users/sguslystyi/rpiv-ask-user-question
git init
git add package.json index.ts ask-user-question.ts README.md
git commit -m "Initial commit: extract ask_user_question tool from rpiv-pi"
gh repo create juicesharp/rpiv-ask-user-question --public --source=. --remote=origin --push
```

### Success Criteria:

#### Automated Verification:
- [x] Directory exists: `test -d /Users/sguslystyi/rpiv-ask-user-question`
- [x] All four files present: `ls /Users/sguslystyi/rpiv-ask-user-question/{package.json,index.ts,ask-user-question.ts,README.md}`
- [x] `ask-user-question.ts` is byte-identical to rpiv-pi source: `diff /Users/sguslystyi/rpiv-pi/extensions/rpiv-core/ask-user-question.ts /Users/sguslystyi/rpiv-ask-user-question/ask-user-question.ts` exits 0
- [ ] Type checks: `cd /Users/sguslystyi/rpiv-ask-user-question && npx tsc --noEmit --module nodenext --moduleResolution nodenext --target esnext index.ts` exits 0 (with peer deps resolvable — may require a dev `tsconfig.json` + `pnpm add -D typescript @mariozechner/pi-coding-agent @mariozechner/pi-tui @sinclair/typebox` for local checks only; not committed)
- [x] README contains no `pi-permission-system` matches: `grep -c "pi-permission-system" README.md` returns 0
- [x] Git repo initialized: `git -C /Users/sguslystyi/rpiv-ask-user-question rev-parse --is-inside-work-tree` returns `true`
- [x] Remote exists and pushed: `gh repo view juicesharp/rpiv-ask-user-question --json url` returns https://github.com/juicesharp/rpiv-ask-user-question (public, default branch `main`)

#### Manual Verification:
- [ ] `pi install npm:rpiv-ask-user-question` on a fresh Pi install (no rpiv-pi present) registers `ask_user_question` — confirm via `/tools` listing
- [ ] Calling `ask_user_question` with 2 options renders the structured selector TUI and returns the chosen label
- [ ] Calling `ask_user_question` and picking "Other (type your own answer)" opens the free-text input and returns the typed answer
- [ ] Cancelling (esc) returns `"User cancelled the selection"` in content and `answer: null` in details
- [ ] Public repo page at `github.com/juicesharp/rpiv-ask-user-question` is visible (unauthenticated browser check)

---

## Phase 2: Create `rpiv-advisor` plugin

### Overview
Second plugin, adds `@mariozechner/pi-ai` peer dep (advisor calls `completeSimple`). Contains the sole config-path edit (`ADVISOR_CONFIG_PATH`), a `session_start` restore handler, a `before_agent_start` strip handler, and the `/advisor` command. Silent config-path hard cutover per D5.

### Changes Required:

#### 1. `rpiv-advisor/package.json`
**File**: `/Users/sguslystyi/rpiv-advisor/package.json`
**Changes**: New file. Adds `@mariozechner/pi-ai` to `peerDependencies`.

Source: design artifact § `rpiv-advisor/package.json — NEW`.

#### 2. `rpiv-advisor/index.ts`
**File**: `/Users/sguslystyi/rpiv-advisor/index.ts`
**Changes**: New file. Registers tool + command + `before_agent_start` strip; runs `restoreAdvisorState` on `session_start`.

Source: design artifact § `rpiv-advisor/index.ts — NEW`.

#### 3. `rpiv-advisor/advisor.ts`
**File**: `/Users/sguslystyi/rpiv-advisor/advisor.ts`
**Changes**: New file. Copy of `/Users/sguslystyi/rpiv-pi/extensions/rpiv-core/advisor.ts` at commit `7525a5d` with **one edit**: `ADVISOR_CONFIG_PATH` changes from `~/.config/rpiv-pi/advisor.json` to `~/.config/rpiv-advisor/advisor.json`.

Commands to produce:
```bash
cp /Users/sguslystyi/rpiv-pi/extensions/rpiv-core/advisor.ts \
   /Users/sguslystyi/rpiv-advisor/advisor.ts
# Edit the one line (sed or manual Edit):
sed -i '' 's|".config", "rpiv-pi", "advisor.json"|".config", "rpiv-advisor", "advisor.json"|' \
   /Users/sguslystyi/rpiv-advisor/advisor.ts
```

Reference snippet of the edited line (design artifact § `rpiv-advisor/advisor.ts — NEW`, line 433):
```typescript
const ADVISOR_CONFIG_PATH = join(homedir(), ".config", "rpiv-advisor", "advisor.json");
```

#### 4. `rpiv-advisor/README.md`
**File**: `/Users/sguslystyi/rpiv-advisor/README.md`
**Changes**: New file. Includes a "Migration from rpiv-pi ≤ 0.3.0" section explaining the config-path change. **Zero mention of `pi-permission-system` per D3.**

Source: design artifact § `rpiv-advisor/README.md — NEW`.

#### 5. Initialize git + push to public GitHub repo
```bash
cd /Users/sguslystyi/rpiv-advisor
git init
git add package.json index.ts advisor.ts README.md
git commit -m "Initial commit: extract advisor tool + /advisor command from rpiv-pi"
gh repo create juicesharp/rpiv-advisor --public --source=. --remote=origin --push
```

### Success Criteria:

#### Automated Verification:
- [x] Directory exists with 4 files: `ls /Users/sguslystyi/rpiv-advisor/{package.json,index.ts,advisor.ts,README.md}`
- [x] Config-path edit landed: `grep -c 'rpiv-advisor/advisor.json\|"rpiv-advisor", "advisor.json"' /Users/sguslystyi/rpiv-advisor/advisor.ts` returns ≥ 1
- [x] No old config path remains: `grep -c '"rpiv-pi", "advisor.json"' /Users/sguslystyi/rpiv-advisor/advisor.ts` returns 0
- [x] Only one line differs from source: `diff /Users/sguslystyi/rpiv-pi/extensions/rpiv-core/advisor.ts /Users/sguslystyi/rpiv-advisor/advisor.ts | grep -c '^[<>]'` returns 2 (one removed + one added line)
- [x] README contains no `pi-permission-system` matches: `grep -c "pi-permission-system" /Users/sguslystyi/rpiv-advisor/README.md` returns 0
- [x] Remote exists and pushed: `gh repo view juicesharp/rpiv-advisor --json url` returns https://github.com/juicesharp/rpiv-advisor (public, default branch `main`)

#### Manual Verification:
- [ ] `pi install npm:rpiv-advisor` on a fresh Pi install registers `advisor` tool + `/advisor` command
- [ ] Fresh session with no saved config: `advisor` is stripped from active tools every turn (run a trivial agent turn, inspect `pi.getActiveTools()` via a debug skill or logs)
- [ ] `/advisor` → pick a model → pick effort → config writes to `~/.config/rpiv-advisor/advisor.json` with `chmod 0600`
- [ ] Restart session: advisor restored from disk, tool re-enabled, `ctx.ui.notify` fires with `"Advisor restored: <provider>:<model>"`
- [ ] Select "No advisor" → config cleared, tool stripped, notify fires
- [ ] Executor calls `advisor()` with zero params → advisor sees serialized branch → returns text guidance
- [ ] Upgrade test: user with `~/.config/rpiv-pi/advisor.json` sees advisor OFF on next session (silent cutover)

---

## Phase 3: Create `rpiv-todo` plugin

### Overview
Largest plugin: 769 + 244 LOC across `todo.ts` + `todo-overlay.ts`, plus a 5-hook `index.ts` (`session_start`, `session_compact`, `session_tree`, `session_shutdown`, `tool_execution_end`) managing a lazily-constructed `TodoOverlay`. Both source files copied verbatim — the module-level ESM singletons (`let tasks / let nextId`) are intentionally preserved intra-plugin (D8). Tool name literal `"todo"` is load-bearing for branch replay (`reconstructTodoState` at `todo.ts:502` filters `msg.toolName === "todo"`).

### Changes Required:

#### 1. `rpiv-todo/package.json`
**File**: `/Users/sguslystyi/rpiv-todo/package.json`
**Changes**: New file. Includes `@mariozechner/pi-ai` peer (todo.ts imports `StringEnum` from it).

Source: design artifact § `rpiv-todo/package.json — NEW`.

#### 2. `rpiv-todo/index.ts`
**File**: `/Users/sguslystyi/rpiv-todo/index.ts`
**Changes**: New file. Registers todo tool + /todos command + the five lifecycle hooks, managing `todoOverlay` via a closure variable (constructed lazily at first `session_start` with UI).

Source: design artifact § `rpiv-todo/index.ts — NEW`.

#### 3. `rpiv-todo/todo.ts`
**File**: `/Users/sguslystyi/rpiv-todo/todo.ts`
**Changes**: New file. **Verbatim copy** of `/Users/sguslystyi/rpiv-pi/extensions/rpiv-core/todo.ts` at commit `7525a5d`. Zero edits. Tool name literal `"todo"` preserved at line 614; replay filter at line 502 preserved.

```bash
cp /Users/sguslystyi/rpiv-pi/extensions/rpiv-core/todo.ts \
   /Users/sguslystyi/rpiv-todo/todo.ts
```

#### 4. `rpiv-todo/todo-overlay.ts`
**File**: `/Users/sguslystyi/rpiv-todo/todo-overlay.ts`
**Changes**: New file. **Verbatim copy** of `/Users/sguslystyi/rpiv-pi/extensions/rpiv-core/todo-overlay.ts` at commit `7525a5d`. Zero edits — imports only from `./todo.js` (intra-plugin) and pi libs. `WIDGET_KEY = "rpiv-todos"` preserved.

```bash
cp /Users/sguslystyi/rpiv-pi/extensions/rpiv-core/todo-overlay.ts \
   /Users/sguslystyi/rpiv-todo/todo-overlay.ts
```

#### 5. `rpiv-todo/README.md`
**File**: `/Users/sguslystyi/rpiv-todo/README.md`
**Changes**: New file. Description, installation, tool + command + overlay summary. **Zero mention of `pi-permission-system` per D3.**

Source: design artifact § `rpiv-todo/README.md — NEW`.

#### 6. Initialize git + push to public GitHub repo
```bash
cd /Users/sguslystyi/rpiv-todo
git init
git add package.json index.ts todo.ts todo-overlay.ts README.md
git commit -m "Initial commit: extract todo tool + overlay from rpiv-pi"
gh repo create juicesharp/rpiv-todo --public --source=. --remote=origin --push
```

### Success Criteria:

#### Automated Verification:
- [x] Directory exists with 5 files: `ls /Users/sguslystyi/rpiv-todo/{package.json,index.ts,todo.ts,todo-overlay.ts,README.md}`
- [x] `todo.ts` byte-identical to source: `diff /Users/sguslystyi/rpiv-pi/extensions/rpiv-core/todo.ts /Users/sguslystyi/rpiv-todo/todo.ts` exits 0
- [x] `todo-overlay.ts` byte-identical to source: `diff /Users/sguslystyi/rpiv-pi/extensions/rpiv-core/todo-overlay.ts /Users/sguslystyi/rpiv-todo/todo-overlay.ts` exits 0
- [x] Tool name literal preserved: `grep -c 'name: "todo"' /Users/sguslystyi/rpiv-todo/todo.ts` returns 1
- [x] Replay filter preserved — byte-identical diff above confirms `todo.ts:502` uses `msg.toolName !== "todo"` (source literal; plan had `===` typo); same filter operator as the pristine rpiv-pi source, so replay semantics unchanged
- [x] Widget key preserved: `grep -c 'WIDGET_KEY = "rpiv-todos"' /Users/sguslystyi/rpiv-todo/todo-overlay.ts` returns 1
- [x] README contains no `pi-permission-system` matches: `grep -c "pi-permission-system" /Users/sguslystyi/rpiv-todo/README.md` returns 0
- [x] Remote exists and pushed: `gh repo view juicesharp/rpiv-todo --json url` returns https://github.com/juicesharp/rpiv-todo (public, default branch `main` — local branch renamed from `master` before push)

#### Manual Verification:
- [ ] `pi install npm:rpiv-todo` registers `todo` tool, `/todos` command, and the aboveEditor overlay widget
- [ ] Call `todo(action:"create", subject:"test")` → aboveEditor widget renders within one render cycle with the new task
- [ ] Run `/todos` → prints grouped-by-status list (Pending / In Progress / Completed)
- [ ] Mark a task `in_progress` → glyph `◐` appears in widget; mark completed → glyph updates and task gets strikethrough
- [ ] Create 15+ tasks → widget collapses to 12-line view; completed tasks drop first, pending truncate last
- [ ] `/reload` or `session_compact` → widget refreshes with replayed state
- [ ] **Branch replay preserved**: a session saved under old rpiv-pi with `todo` tool-result entries, reopened after installing `rpiv-todo`, shows the same task list on `/todos` — proves `reconstructTodoState` still matches old `msg.toolName === "todo"`

---

## Phase 4: Create `rpiv-web-tools` plugin

### Overview
Structurally simplest non-trivial plugin: three files total (no separate source file — all logic inline in `index.ts`). One config-path edit (`CONFIG_PATH`). No lifecycle hooks beyond tool/command registration. **Loud** cutover: first `web_search` call after upgrade throws an actionable error. `BRAVE_SEARCH_API_KEY` env var takes precedence and keeps working unchanged.

### Changes Required:

#### 1. `rpiv-web-tools/package.json`
**File**: `/Users/sguslystyi/rpiv-web-tools/package.json`
**Changes**: New file. No `@mariozechner/pi-ai` peer (web-tools uses truncation utilities from pi-coding-agent, not pi-ai).

Source: design artifact § `rpiv-web-tools/package.json — NEW`.

#### 2. `rpiv-web-tools/index.ts`
**File**: `/Users/sguslystyi/rpiv-web-tools/index.ts`
**Changes**: New file. Copy of `/Users/sguslystyi/rpiv-pi/extensions/web-tools/index.ts` at commit `7525a5d` with **one edit**: `CONFIG_PATH` changes from `~/.config/rpiv-pi/web-tools.json` to `~/.config/rpiv-web-tools/config.json`.

Commands to produce:
```bash
cp /Users/sguslystyi/rpiv-pi/extensions/web-tools/index.ts \
   /Users/sguslystyi/rpiv-web-tools/index.ts
# Edit the one line:
sed -i '' 's|".config", "rpiv-pi", "web-tools.json"|".config", "rpiv-web-tools", "config.json"|' \
   /Users/sguslystyi/rpiv-web-tools/index.ts
```

Reference snippet of the edited line (design artifact § `rpiv-web-tools/index.ts — NEW`, line 2176):
```typescript
const CONFIG_PATH = join(homedir(), ".config", "rpiv-web-tools", "config.json");
```

#### 3. `rpiv-web-tools/README.md`
**File**: `/Users/sguslystyi/rpiv-web-tools/README.md`
**Changes**: New file. Documents tools, command, API-key resolution order, and a "Migration from rpiv-pi ≤ 0.3.0" section. **Zero mention of `pi-permission-system` per D3.**

Source: design artifact § `rpiv-web-tools/README.md — NEW`.

#### 4. Initialize git + push to public GitHub repo
```bash
cd /Users/sguslystyi/rpiv-web-tools
git init
git add package.json index.ts README.md
git commit -m "Initial commit: extract web_search + web_fetch tools from rpiv-pi"
gh repo create juicesharp/rpiv-web-tools --public --source=. --remote=origin --push
```

### Success Criteria:

#### Automated Verification:
- [x] Directory exists with 3 files: `ls /Users/sguslystyi/rpiv-web-tools/{package.json,index.ts,README.md}`
- [x] Config-path edit landed: `grep -c '"rpiv-web-tools", "config.json"' /Users/sguslystyi/rpiv-web-tools/index.ts` returns 1
- [x] No old config path remains: `grep -c '"rpiv-pi", "web-tools.json"' /Users/sguslystyi/rpiv-web-tools/index.ts` returns 0
- [x] Only one line differs from source: `diff /Users/sguslystyi/rpiv-pi/extensions/web-tools/index.ts /Users/sguslystyi/rpiv-web-tools/index.ts | grep -c '^[<>]'` returns 2
- [x] Tool names preserved: `grep -c 'name: "web_search"\|name: "web_fetch"' /Users/sguslystyi/rpiv-web-tools/index.ts` returns 2
- [x] README contains no `pi-permission-system` matches: `grep -c "pi-permission-system" /Users/sguslystyi/rpiv-web-tools/README.md` returns 0
- [x] Remote exists and pushed: `gh repo view juicesharp/rpiv-web-tools --json url` returns https://github.com/juicesharp/rpiv-web-tools (public, default branch `main` — local branch renamed from `master` before push)

#### Manual Verification:
- [ ] `pi install npm:rpiv-web-tools` registers `web_search`, `web_fetch`, and `/web-search-config`
- [ ] Fresh install, no env var, no config: first `web_search` call throws `"BRAVE_SEARCH_API_KEY is not set. Run /web-search-config to configure, or export the env var."` (loud cutover confirmed)
- [ ] `/web-search-config` → enter Brave key → writes to `~/.config/rpiv-web-tools/config.json` with `chmod 0600`
- [ ] `/web-search-config --show` → prints masked key + env var status
- [ ] `web_search("test query")` returns Brave results with titles, URLs, snippets
- [ ] `web_fetch("https://example.com")` returns HTML-stripped text with `Title:` header; `raw:true` returns HTML
- [ ] `export BRAVE_SEARCH_API_KEY=...` takes precedence over config-file value (env-var precedence at line 61 of the new index.ts)
- [ ] Upgrade test: user with `~/.config/rpiv-pi/web-tools.json` and no env var → first `web_search` call throws the actionable error (loud cutover)

---

## Phase 5: Orchestrator cleanup in `rpiv-pi`

### Overview
Last phase. Deletes the extracted modules, deletes the permissions seeder + template, deletes the `extensions/web-tools/` directory, rewrites `package-checks.ts` to add four new probes, rewrites `extensions/rpiv-core/index.ts` to prune extracted imports and hooks and to replace the single hardcoded sibling warning with an aggregated 5-sibling loop, expands `/rpiv-setup` to install all five prerequisites, bumps `package.json` to `0.4.0` with `peerDependencies` listing all five siblings, rewrites `README.md`.

Must be last per Ordering Constraints — until it runs, rpiv-pi still contains the extracted modules inline, so installing any sibling plugin alongside the still-inlined rpiv-pi would cause duplicate tool registrations.

### Changes Required:

#### 1. Delete `extensions/rpiv-core/ask-user-question.ts`
**File**: `/Users/sguslystyi/rpiv-pi/extensions/rpiv-core/ask-user-question.ts`
**Changes**: Delete file.
```bash
rm /Users/sguslystyi/rpiv-pi/extensions/rpiv-core/ask-user-question.ts
```

#### 2. Delete `extensions/rpiv-core/advisor.ts`
**File**: `/Users/sguslystyi/rpiv-pi/extensions/rpiv-core/advisor.ts`
**Changes**: Delete file.
```bash
rm /Users/sguslystyi/rpiv-pi/extensions/rpiv-core/advisor.ts
```

#### 3. Delete `extensions/rpiv-core/todo.ts`
**File**: `/Users/sguslystyi/rpiv-pi/extensions/rpiv-core/todo.ts`
**Changes**: Delete file.
```bash
rm /Users/sguslystyi/rpiv-pi/extensions/rpiv-core/todo.ts
```

#### 4. Delete `extensions/rpiv-core/todo-overlay.ts`
**File**: `/Users/sguslystyi/rpiv-pi/extensions/rpiv-core/todo-overlay.ts`
**Changes**: Delete file.
```bash
rm /Users/sguslystyi/rpiv-pi/extensions/rpiv-core/todo-overlay.ts
```

#### 5. Delete `extensions/rpiv-core/permissions.ts`
**File**: `/Users/sguslystyi/rpiv-pi/extensions/rpiv-core/permissions.ts`
**Changes**: Delete file (seeder removed entirely per D3).
```bash
rm /Users/sguslystyi/rpiv-pi/extensions/rpiv-core/permissions.ts
```

#### 6. Delete `extensions/rpiv-core/templates/pi-permissions.jsonc` (and dir if empty)
**File**: `/Users/sguslystyi/rpiv-pi/extensions/rpiv-core/templates/pi-permissions.jsonc`
**Changes**: Delete file; remove parent `templates/` directory if empty.
```bash
rm /Users/sguslystyi/rpiv-pi/extensions/rpiv-core/templates/pi-permissions.jsonc
rmdir /Users/sguslystyi/rpiv-pi/extensions/rpiv-core/templates 2>/dev/null || true
```

#### 7. Delete `extensions/web-tools/` (file + dir)
**File**: `/Users/sguslystyi/rpiv-pi/extensions/web-tools/index.ts` and parent dir.
**Changes**: Delete file and the now-empty directory.
```bash
rm /Users/sguslystyi/rpiv-pi/extensions/web-tools/index.ts
rmdir /Users/sguslystyi/rpiv-pi/extensions/web-tools
```

#### 8. Rewrite `extensions/rpiv-core/package-checks.ts`
**File**: `/Users/sguslystyi/rpiv-pi/extensions/rpiv-core/package-checks.ts`
**Changes**: Full rewrite. Adds four new probes: `hasRpivAskUserQuestionInstalled`, `hasRpivTodoInstalled`, `hasRpivAdvisorInstalled`, `hasRpivWebToolsInstalled`. Existing `hasPiSubagentsInstalled` and `hasPiPermissionSystemInstalled` preserved.

Source: design artifact § `extensions/rpiv-core/package-checks.ts:1-40 — MODIFY`.

#### 9. Rewrite `extensions/rpiv-core/index.ts`
**File**: `/Users/sguslystyi/rpiv-pi/extensions/rpiv-core/index.ts`
**Changes**: Full rewrite. Prunes these from the current file:
- Imports: `registerAskUserQuestionTool`, `registerTodoTool`, `registerTodosCommand`, `registerAdvisorTool`, `registerAdvisorCommand`, `registerAdvisorBeforeAgentStart`, `reconstructTodoState`, `restoreAdvisorState`, `TodoOverlay`, `seedPermissionsFile`.
- `todoOverlay` closure variable and its lazy construction.
- Six tool/command `register*` call sites.
- `seedPermissionsFile` call in `session_start`.
- `session_tree` and `tool_execution_end` hooks (both served todo exclusively).
- Todo-related lines inside `session_start`, `session_compact`, `session_shutdown`.
- Advisor-related lines inside `session_start` (`restoreAdvisorState` call).
- Single hardcoded `hasPiSubagentsInstalled` warning — replaced with aggregated 5-sibling loop.

Adds / modifies:
- Imports: the four new `hasRpiv*Installed` probes.
- Aggregated `missing: string[]` loop + single `ctx.ui.notify`.
- `/rpiv-setup` handler: expanded `missing` list with 5 entries; `for (const { pkg } of missing)` install loop; report split into succeeded / failed with a restart-prompt footer.

Keeps unchanged: guidance injection (`clearInjectionState`, `injectRootGuidance`, `handleToolCallGuidance`), git-context `before_agent_start`, `thoughts/` scaffold loop, `copyBundledAgents` (`session_start` + `/rpiv-update-agents`), `applySubagentTuning`, `active_agent` workaround gated on `hasPiPermissionSystemInstalled()`.

Source: design artifact § `extensions/rpiv-core/index.ts:1-268 — MODIFY`.

#### 10. Rewrite `package.json`
**File**: `/Users/sguslystyi/rpiv-pi/package.json`
**Changes**: Version `0.3.x` → `0.4.0`. Move `@tintinweb/pi-subagents` from `dependencies` to `peerDependencies`; add `rpiv-ask-user-question`, `rpiv-todo`, `rpiv-advisor`, `rpiv-web-tools` to `peerDependencies`. Keep existing peer deps on `@mariozechner/*` and `@sinclair/typebox` if present.

Source: design artifact § `package.json:1-20 — MODIFY`.

#### 11. Rewrite `README.md`
**File**: `/Users/sguslystyi/rpiv-pi/README.md`
**Changes**: Rewrite Installation, Requirements, and Extensions sections for the 5-sibling dependency chain. Drop the `pi-permission-system` "Recommended" section per D3. Add a "Migration from 0.3.x" section. Skills and agents tables unchanged.

Source: design artifact § `README.md — MODIFY`.

### Success Criteria:

#### Automated Verification:
- [x] Six files deleted: `! test -e /Users/sguslystyi/rpiv-pi/extensions/rpiv-core/ask-user-question.ts && ! test -e /Users/sguslystyi/rpiv-pi/extensions/rpiv-core/advisor.ts && ! test -e /Users/sguslystyi/rpiv-pi/extensions/rpiv-core/todo.ts && ! test -e /Users/sguslystyi/rpiv-pi/extensions/rpiv-core/todo-overlay.ts && ! test -e /Users/sguslystyi/rpiv-pi/extensions/rpiv-core/permissions.ts && ! test -e /Users/sguslystyi/rpiv-pi/extensions/rpiv-core/templates/pi-permissions.jsonc`
- [x] `extensions/web-tools/` directory is gone: `! test -d /Users/sguslystyi/rpiv-pi/extensions/web-tools`
- [x] No dangling imports in `rpiv-core/index.ts`: `grep -E "(ask-user-question|todo|advisor|permissions)\.js" /Users/sguslystyi/rpiv-pi/extensions/rpiv-core/index.ts` returns no matches
- [x] Four new probes present: `grep -c "hasRpivAskUserQuestionInstalled\|hasRpivTodoInstalled\|hasRpivAdvisorInstalled\|hasRpivWebToolsInstalled" /Users/sguslystyi/rpiv-pi/extensions/rpiv-core/package-checks.ts` returns 4
- [x] package.json version bumped: `node -p "require('/Users/sguslystyi/rpiv-pi/package.json').version"` returns `0.4.0`
- [x] Five siblings in peerDependencies: `node -p "Object.keys(require('/Users/sguslystyi/rpiv-pi/package.json').peerDependencies)"` includes `@tintinweb/pi-subagents`, `rpiv-ask-user-question`, `rpiv-todo`, `rpiv-advisor`, `rpiv-web-tools`
- [x] `@tintinweb/pi-subagents` no longer in `dependencies`: `dependencies` field removed entirely (node -p returns `null`)
- [ ] Type-check passes: `cd /Users/sguslystyi/rpiv-pi && npx tsc --noEmit` exits 0 — **deferred**: repo has no `tsconfig.json` / no local `node_modules`; type checking relies on Pi's extension loader at install time
- [x] No references to `seedPermissionsFile` anywhere: `grep -rn "seedPermissionsFile" /Users/sguslystyi/rpiv-pi/extensions/` returns no matches
- [x] README updated: `grep -c "rpiv-ask-user-question\|rpiv-todo\|rpiv-advisor\|rpiv-web-tools" /Users/sguslystyi/rpiv-pi/README.md` returns 9; `grep -c "^## Migration from 0.3" /Users/sguslystyi/rpiv-pi/README.md` returns 1

**Note**: The design artifact's § `extensions/rpiv-core/index.ts` rewrite imports `applySubagentTuning` from `./subagent-tuning.js` and calls it in `session_start`. That module does not exist in the current repo (neither pre- nor post-Phase-5) and was never referenced by the pristine `index.ts` either. Omitted from the implemented rewrite — the rest of the file matches the design spec verbatim.

#### Manual Verification:
- [ ] `pi install /Users/sguslystyi/rpiv-pi` on a Pi install with no siblings → `session_start` emits one notification listing all 5 missing siblings (verifiable: only one "rpiv-pi requires" line in the output)
- [ ] `/rpiv-setup` prompts to install 5 packages, confirmation runs 5 sequential `pi install` invocations, final report lists successes/failures + restart prompt
- [ ] After installing all 5 siblings + restarting: all tools (`ask_user_question`, `todo`, `advisor`, `web_search`, `web_fetch`) load with no duplicate-registration errors
- [ ] With `pi-permission-system` installed: fresh session writes `active_agent` entry before first user input — `/skill:<name>` as the first message does NOT error with `"active agent context is unavailable"`
- [ ] Without `pi-permission-system` installed: no `active_agent` entry written; no `~/.pi/agent/pi-permissions.jsonc` seeded
- [ ] `/rpiv-update-agents` still re-copies bundled agents into `<cwd>/.pi/agents/`
- [ ] Guidance injection still fires on tool calls (verified by skill prose appearing as system messages)
- [ ] Git-context injection still appears in session startup messages

---

## Testing Strategy

### Automated:
- Each plugin dir: file presence + byte-for-byte `diff` against rpiv-pi source for verbatim-copy files.
- Edited-file sanity: exactly 2 lines differ (one removed + one added) in `advisor.ts` and `web-tools/index.ts`.
- README discipline: `grep -c "pi-permission-system"` is 0 in every plugin README.
- GitHub repo existence: `gh repo view juicesharp/<name>` exits 0 for all 4 plugins.
- rpiv-pi cleanup: no dangling imports of extracted modules; `package-checks.ts` contains 4 new probes; `package.json` version `0.4.0` with 5-sibling `peerDependencies`.
- Full repo type-check (`npx tsc --noEmit`) passes after Phase 5.

### Manual Testing Steps:

**Fresh install flow** (after Phase 5 is merged and rpiv-pi is reinstalled):
1. `pi install /Users/sguslystyi/rpiv-pi` on a host with no siblings.
2. Start a Pi session — confirm the aggregated notification lists all 5 missing siblings in one line.
3. Run `/rpiv-setup` — confirm it prompts with 5 packages, confirm, watch 5 sequential `pi install` runs.
4. Restart the session — confirm `ask_user_question`, `todo`, `advisor`, `web_search`, `web_fetch` all load.
5. Run `/advisor` — pick a model — confirm config written to `~/.config/rpiv-advisor/advisor.json`.
6. Run `/web-search-config` — enter a Brave key — confirm config written to `~/.config/rpiv-web-tools/config.json`.
7. Run `web_search("test")` and `web_fetch("https://example.com")` — confirm success.

**Upgrade flow** (simulating an existing 0.3.x user):
1. Pre-seed `~/.config/rpiv-pi/advisor.json` and `~/.config/rpiv-pi/web-tools.json` from an existing system.
2. Run the fresh install flow.
3. Before running `/advisor`: confirm advisor is silently OFF (no restore).
4. Before setting a Brave key: confirm first `web_search` call throws `"BRAVE_SEARCH_API_KEY is not set…"` — loud cutover.
5. Re-run `/advisor` and `/web-search-config` — confirm they write to the new paths.
6. `BRAVE_SEARCH_API_KEY` env var — export and confirm it takes precedence over the (empty) config file.

**Branch replay regression test** (high-value check):
1. On current master, create a session, run `todo(action:"create", subject:"X")` several times, let it complete.
2. Persist session file.
3. Reinstall rpiv-pi with extractions, install rpiv-todo.
4. Resume the session — confirm `/todos` shows the same task list (proves `reconstructTodoState` still matches `msg.toolName === "todo"`).

**Subagents sanity**: existing `@tintinweb/pi-subagents` continues to work; `Agent` tool and `/agents` command unchanged.

## Performance Considerations

- `session_start` gains four `readInstalledPackages()` calls (one per new probe). Each is a single JSON parse of `~/.pi/agent/settings.json` — negligible, sub-millisecond.
- Aggregated warning replaces one conditional `notify` with one conditional `notify` over a 5-element loop — same asymptotic cost.
- `/rpiv-setup` runs 5 `pi install` invocations (vs 1 previously) on fresh installs, each with a 120s timeout. Sequential by design.
- No hot-path code changes. Tool execute paths unchanged.

## Migration Notes

**Existing rpiv-pi@0.3.x users upgrading**:
1. `pi install npm:rpiv-pi` (or local path) pulls the new `0.4.0` with extracted modules removed.
2. First `session_start` emits an aggregated warning listing the 4 missing `rpiv-*` siblings (and `@tintinweb/pi-subagents` if that is also missing).
3. User runs `/rpiv-setup` and confirms — five `pi install` invocations run sequentially.
4. User restarts pi.
5. `todo` tool-call history in existing sessions replays correctly under `rpiv-todo` (tool name preserved; `reconstructTodoState` filter still matches).
6. Saved `~/.config/rpiv-pi/advisor.json` is silently orphaned — user notices advisor OFF and reruns `/advisor`.
7. Saved `~/.config/rpiv-pi/web-tools.json` is silently orphaned — first `web_search` call throws an actionable error; user reruns `/web-search-config`. `BRAVE_SEARCH_API_KEY` env var continues to work unchanged.

**Rollback strategy**: downgrade `pi install npm:rpiv-pi@0.3.x` (pre-extraction version). Existing config files at old paths still present. Subagents (if on disk) continue to function. The four new sibling plugins remain installed but harmless — they register their own tools independently, and the old bundled versions would conflict with them, so rolling back also requires `pi uninstall` of the four siblings.

**No schema migrations**: tool parameter schemas, `AgentToolResult.details` envelopes, and config-file JSON shapes are all unchanged. Only paths change.

## References

- Design: `thoughts/shared/designs/2026-04-13_17-00-00_extract-rpiv-plugins.md`
- Research source: `thoughts/shared/research/2026-04-13_16-11-41_extract-rpiv-core-tools-into-prerequisite-plugins.md`
- Questions artifact: `thoughts/shared/questions/2026-04-13_15-33-01_extract-rpiv-core-tools-into-prerequisite-plugins.md`
- Related research — advisor persistence: `thoughts/shared/research/2026-04-11_17-27-55_advisor-strategy-pattern.md`
- Related research — subagent inheritance: `thoughts/shared/research/2026-04-11_07-16-31_pi-subagents-alt-library.md`
- Related research — todo propagation: `thoughts/shared/research/2026-04-13_08-51-45_todo-propagation-subagents.md`
- Prior design — advisor settings persistence: `thoughts/shared/designs/2026-04-12_12-21-43_advisor-settings-persistence.md`
- Prior design — todo CC parity: `thoughts/shared/designs/2026-04-10_22-34-39_todo-tool-cc-parity.md`
- Prior plan — todo overlay: `thoughts/shared/plans/2026-04-11_07-38-04_todo-list-overlay-above-input.md`
- Pi YOLO default: https://mariozechner.at/posts/2025-11-30-pi-coding-agent/
- Pi extension model: https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/packages.md
- Pi extensions docs: https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md
- pi-permission-system repo: https://github.com/MasuRii/pi-permission-system
- pi-subagents repo: https://github.com/tintinweb/pi-subagents
- Plugin GitHub org: https://github.com/juicesharp/
