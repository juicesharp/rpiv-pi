# Migration Guide: rpiv-skillbased → Pi

> Based on: `thoughts/shared/research/2026-04-10_gap-analysis-porting-to-pi.md`
> This document tracks migration status and remaining work.

---

## What's Done

### ✅ Project Structure
- `package.json` with Pi manifest (`pi.extensions`, `pi.skills`, `pi.agents`)
- Matches the target architecture from gap analysis §11

### ✅ Extension Core (`extensions/rpiv-core/index.ts`)
All P0 and P1 infrastructure items from the roadmap:

| Gap Analysis Item | Priority | Status | Implementation |
|---|---|---|---|
| `ask_user_question` custom tool | **P0** | ✅ Done | `pi.registerTool()` wrapping `ctx.ui.select()` + `ctx.ui.input()` for "Other" |
| Guidance injection extension | **P1** | ✅ Done | `tool_call` event on read/edit/write, walks `.rpiv/guidance/` hierarchy, injects via `pi.sendMessage()` |
| Git context injection | **P1** | ✅ Done | `before_agent_start` event, runs `git branch`/`git rev-parse` |
| `thoughts/` directory scaffolding | **P1** | ✅ Done | `session_start` creates `thoughts/shared/{research,questions,designs,plans}/` |
| Session lifecycle | **P1** | ✅ Done | `session_start` (init state), `session_compact` (clear markers), `session_shutdown` (cleanup) |
| `todo` tool (replaces TaskCreate) | **P0** | ✅ Done | Based on `todo.ts` example pattern with session entry persistence |
| `/todos` command | — | ✅ Done | For users to view task list |

**Architectural decisions made:**

- **Guidance injection mechanism:** Gap analysis listed 3 options (A: `context` event, B: `tool_result` event, C: `before_agent_start`). Implementation uses `pi.sendMessage()` with `display: false` during `tool_call` — this injects the guidance as a hidden message in session history, similar to Option A but via `sendMessage` rather than modifying the messages array directly. State tracked in-memory (`Set<string>`), not filesystem.
- **Task management:** Gap analysis Appendix B recommended **Option 1** (port `todo.ts` pattern as-is) for initial port. Implemented with `add/toggle/list/clear` actions. No dependency graph or `in_progress` status — just `done`/`not-done` toggle. Future upgrade to Option 2 (richer `task` tool) is P2.
- **Extension structure:** Gap analysis suggested splitting into `guidance.ts`, `ask-user.ts`, `web-tools.ts`. Currently monolithic in `index.ts` (~370 lines) for simplicity. Can split later if it grows.

### ✅ Agents (9 files)
All agent `.md` files ported with updated frontmatter per gap analysis §2:

- Tool names mapped (Appendix A): `Read`→`read`, `Grep`→`grep`, `Glob`→`find`, `LS`→`ls`, `Bash`→`bash`
- `color:` field removed (not part of Pi frontmatter)
- Web tools mapped: `WebSearch`→`web_search`, `WebFetch`→`web_fetch`
- `web-search-researcher.md` references `web_search, web_fetch` in tools — **blocked until web tools extension is built**

| Agent | Tools (Pi) | Notes |
|---|---|---|
| `codebase-analyzer` | read, grep, find, ls | ✅ Ready |
| `codebase-locator` | grep, find, ls | ✅ Ready (no read — locator only) |
| `codebase-pattern-finder` | grep, find, read, ls | ✅ Ready |
| `integration-scanner` | grep, find, ls | ✅ Ready |
| `precedent-locator` | bash, grep, find, read, ls | ✅ Ready |
| `test-case-locator` | grep, find, ls | ✅ Ready |
| `thoughts-analyzer` | read, grep, find, ls | ✅ Ready |
| `thoughts-locator` | grep, find, ls | ✅ Ready |
| `web-search-researcher` | web_search, web_fetch, read, grep, find, ls | ⚠️ Blocked — needs web tools extension |

### ✅ Skills (21 SKILL.md files — copied, not yet migrated)
All skill files copied from source. Templates and examples included for skills that have them. **Skills still contain Claude Code-specific syntax and need text replacements before they are Pi-compatible.**

---

## Remaining Migration Work

### Priority alignment with gap analysis §11

The gap analysis roadmap puts infrastructure (extension code, agents) at P0-P1 and skill text replacements at P2. Since the infrastructure is now done, the remaining work is:

### 🟡 P1 — Needed for full functionality

#### 1. Web tools extension (`web_search`, `web_fetch`)
**Gap analysis §8** | **Blocks:** `web-search-researcher` agent

Pi has no built-in web tools. Need custom tools wrapping HTTP APIs:
- `web_search` — search via Brave Search API, Perplexity, or similar
- `web_fetch` — fetch URL content via HTTP

**Stub location:** Could go in `extensions/rpiv-core/web-tools.ts` (as gap analysis suggests) or a separate extension.

**Code estimate:** ~80 lines, Medium complexity (HTTP API wrapping)

#### 2. Subagent extension dependency
**Gap analysis §2**

Skills like `research-codebase`, `research`, `design-feature` spawn 4–8 parallel agents. In Claude Code this uses the `Agent` tool. In Pi, this requires the **`subagent` extension** (shipped as `examples/extensions/subagent/`).

**Action:** Ensure the `subagent` extension is installed/available. Skills reference agents by name (e.g., `codebase-analyzer`), and the subagent extension discovers them from `.pi/agents/` or `~/.pi/agent/agents/`.

**Note:** The `Agent` tool name in skills must be updated to reference `subagent` tool calls instead. Skills currently say things like "Spawn the **rpiv-next:codebase-analyzer** agent" which needs to become "Use the subagent tool with agent: codebase-analyzer".

### 🟠 P2 — Skill text replacements (mechanical, all 21 SKILL.md files)

#### 3. Remove `` !`shell command` `` dynamic context
**Gap analysis §3** | **Files:** Skills with `## Git Context` sections

```yaml
## Git Context
- Branch: !`git branch --show-current 2>/dev/null || echo "no-branch"`
```

**Fix:** Remove these sections entirely. The extension now injects git context via `before_agent_start` as a hidden message.

#### 4. Replace `AskUserQuestion` blocks with `ask_user_question` tool instructions
**Gap analysis §5** | **Files:** `research-codebase`, `implement-plan`, `commit`, and others

```yaml
AskUserQuestion:
  questions:
    - question: "Which approach?"
      options:
        - label: "Option A"
          description: "Description A"
```

**Fix:** Replace with tool call instructions:
```markdown
Use the ask_user_question tool to ask the user:
- question: "Which approach?"
- options:
  - label: "Option A" description: "Description A"
  - label: "Option B" description: "Description B"
```

#### 5. Replace `TaskCreate`/`TaskUpdate` references with `todo` tool
**Gap analysis Appendix B** | **Files:** 12 skills

| Skill | Usage to replace |
|---|---|
| `research-codebase` | "Create a research plan using TaskCreate to track all subtasks" |
| `research-questions` | "Create a research plan using TaskCreate" |
| `research-solutions` | "Create a task list using TaskCreate to track research tasks" |
| `design-feature` | "Use TaskCreate/TaskUpdate to track design tasks" |
| `create-plan` | "Create a research task list using TaskCreate" + "Use TaskCreate/TaskUpdate to track planning tasks" |
| `write-plan` | "Use TaskCreate/TaskUpdate to track planning tasks" |
| `iterate-plan` | "Always create a task list using TaskCreate" + "Always use TaskCreate/TaskUpdate to track update tasks" |
| `outline-test-cases` | "Create a task list using TaskCreate to track discovery progress" |
| `code-review` | "Create a review plan using TaskCreate to track all aspects" |
| `resume-handoff` | "Use TaskCreate to create task list" + "Use TaskCreate/TaskUpdate to maintain task continuity" |
| `evaluate-research` | (indirect — spawns agents that track tasks) |
| `implement-plan` | (indirect — phase tracking via TaskCreate) |

**Fix:**
```
"Create a task list using TaskCreate to track exploration tasks"
→ "Create a task list using the todo tool (add action) to track exploration tasks"

"Use TaskCreate/TaskUpdate to track planning tasks"
→ "Use the todo tool (add/toggle actions) to track planning tasks"
```

#### 6. Fix `$ARGUMENTS` in all SKILL.md files
**Gap analysis §3** | **Files:** All 21 skills

Pi skill commands (`/skill:name args`) append arguments as `User: <args>` after the skill content. The `$ARGUMENTS` token is not supported.

**Fix:** Replace conditional `$ARGUMENTS` checks with instructions like:
```markdown
If the user hasn't provided specific input, ask them for it before proceeding.
```
Keep `$ARGUMENTS` as a reference point where the user's input will naturally follow.

#### 7. Replace agent namespace references
**Gap analysis §2** | **Files:** Skills that spawn agents

```
rpiv-next:codebase-analyzer → codebase-analyzer
```

Also update the invocation pattern from Claude Code's `Agent` tool to Pi's `subagent` tool:
```
"Spawn the rpiv-next:codebase-analyzer agent using the Agent tool"
→ "Use the subagent tool with agent: codebase-analyzer and task: ..."
```

#### 8. Replace `${CLAUDE_SKILL_DIR}` paths
**Gap analysis §7** | **Files:** Skills with templates/examples

```
${CLAUDE_SKILL_DIR}/templates/test-case.md → templates/test-case.md
```

#### 9. Replace `Glob` tool references in SKILL.md body text
**Gap analysis Appendix A** | **Files:** Multiple skills

Replace prose references: "Glob for files" → "find files", "Use the Glob tool" → "Use the find tool"

#### 10. Update `allowed-tools` to advisory guidance
**Gap analysis §3** | **Files:** `evaluate-research`, `implement-plan`, `iterate-plan`, `migrate-to-guidance`

Four skills declare restricted tool sets. In Pi, `allowed-tools` becomes advisory (guiding the model) rather than a permission grant. Keep the frontmatter field but also add a note in the body text:
```markdown
> Recommended tools: read, bash (git commands only), find, grep, subagent
```

For `implement-plan`, the stricter option is to run it as a subagent with `--tools read,edit,write,bash,grep,find,ls`.

### 🟢 P3 — Nice to have

#### 11. Tool gating extension (optional)
**Gap analysis §11**

Use `input` event + `pi.setActiveTools()` to restrict tools for skills with `allowed-tools`. This would make the advisory restrictions actually enforceable.

#### 12. Custom rendering for subagent results
**Gap analysis §11**

Port the subagent extension's `renderCall`/`renderResult` for better TUI display of agent results.

#### 13. Better `ask_user_question` UI
The current implementation uses `ctx.ui.select()` which is functional but basic. Could upgrade to `ctx.ui.custom()` with a full custom component like Pi's `question.ts` example (which has keyboard navigation, inline editor for custom answers, descriptions).

#### 14. Custom rendering for guidance messages
Register `pi.registerMessageRenderer("rpiv-guidance", ...)` for better TUI display of injected guidance.

#### 15. Split monolithic extension into modules
Current: `extensions/rpiv-core/index.ts` (~370 lines)
Target (from gap analysis): `guidance.ts`, `ask-user.ts`, `web-tools.ts`

#### 16. Add `prompts/` directory
**Gap analysis §11 target architecture** | Optional chain prompts:
```
prompts/
├── research-pipeline.md
└── design-pipeline.md
```

#### 17. Richer `task` tool (future)
**Gap analysis Appendix B, Option 2** | If specific workflows need dependency tracking and status transitions (`pending` → `in_progress` → `completed`), upgrade the `todo` tool to a `task` tool with:
- Status transitions
- `blockedBy`/`blocks` dependency graph
- `owner` assignment

---

## Configuration Requirements

To use this package, add to `.pi/settings.json`:
```json
{
  "enableSkillCommands": true
}
```
This enables `/skill:name` commands (gap analysis §3).

The `subagent` extension must also be available for skills that spawn agents.

---

## File-by-File Migration Checklist

Skills are grouped by which P2 text replacements they need.

### Full migration (all P2 items: AskUserQuestion + $ARGUMENTS + !`git` + TaskCreate + agent namespaces)
- [ ] `research-codebase/SKILL.md` — spawns 6+ agents, uses TaskCreate, AskUserQuestion, git context, $ARGUMENTS
- [ ] `research-questions/SKILL.md` — spawns agents, uses TaskCreate, $ARGUMENTS
- [ ] `research/SKILL.md` — spawns agents, uses AskUserQuestion, git context, $ARGUMENTS
- [ ] `research-solutions/SKILL.md` — uses TaskCreate, $ARGUMENTS
- [ ] `design-feature/SKILL.md` — uses TaskCreate/TaskUpdate, AskUserQuestion, git context, $ARGUMENTS
- [ ] `design-feature-iterative/SKILL.md` — uses AskUserQuestion, $ARGUMENTS
- [ ] `create-plan/SKILL.md` — uses TaskCreate/TaskUpdate, $ARGUMENTS
- [ ] `write-plan/SKILL.md` — uses TaskCreate/TaskUpdate, $ARGUMENTS
- [ ] `iterate-plan/SKILL.md` — uses TaskCreate/TaskUpdate, allowed-tools, $ARGUMENTS
- [ ] `validate-plan/SKILL.md` — $ARGUMENTS
- [ ] `evaluate-research/SKILL.md` — uses allowed-tools, spawns agents
- [ ] `implement-plan/SKILL.md` — uses allowed-tools, AskUserQuestion, disable-model-invocation, $ARGUMENTS

### Moderate migration (AskUserQuestion + $ARGUMENTS)
- [ ] `outline-test-cases/SKILL.md` — uses TaskCreate, $ARGUMENTS
- [ ] `write-test-cases/SKILL.md` — $ARGUMENTS, ${CLAUDE_SKILL_DIR} templates
- [ ] `code-review/SKILL.md` — uses TaskCreate, $ARGUMENTS
- [ ] `commit/SKILL.md` — uses AskUserQuestion, !`git` context, allowed-tools, $ARGUMENTS

### Light migration ($ARGUMENTS only)
- [ ] `create-handoff/SKILL.md` — $ARGUMENTS
- [ ] `resume-handoff/SKILL.md` — uses TaskCreate/TaskUpdate, $ARGUMENTS

### Minimal changes
- [ ] `annotate-guidance/SKILL.md` — fix ${CLAUDE_SKILL_DIR}
- [ ] `annotate-inline/SKILL.md` — fix ${CLAUDE_SKILL_DIR}
- [ ] `migrate-to-guidance/SKILL.md` — fix Glob references, fix allowed-tools advisory

---

## Code Estimates (from gap analysis §12)

| Component | Estimated | Actual | Status |
|---|---|---|---|
| `ask_user_question` tool | ~50 lines | ~70 lines | ✅ Done |
| Guidance injection extension | ~100 lines | ~50 lines | ✅ Done |
| Git context extension | ~30 lines | ~20 lines | ✅ Done |
| Web tools extension | ~80 lines | — | 📋 Not started |
| Session lifecycle (start/end/compact) | ~40 lines | ~20 lines | ✅ Done |
| `todo` tool | — | ~80 lines | ✅ Done (bonus) |
| **Total new code** | **~300 lines** | **~240 lines** | **80% done** |

---

## Testing the Package

```bash
# Quick test — load the extension only
pi -e /Users/sguslystyi/rpiv-pi/extensions/rpiv-core/index.ts

# Full test — install the package
pi install /Users/sguslystyi/rpiv-pi

# Test a skill (after P2 text replacements are done)
/skill:commit

# Test the ask_user_question tool
# In a conversation, the LLM should be able to call ask_user_question
# when a skill instructs it to ask the user a question.

# Test the subagent tool with a ported agent
# Requires the subagent extension to be installed
```
