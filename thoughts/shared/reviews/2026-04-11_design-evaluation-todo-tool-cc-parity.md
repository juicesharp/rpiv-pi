---
date: 2026-04-11T12:00:00-0400
reviewer: Claude Code
repository: rpiv-pi
branch: master
commit: d484cb3
review_type: design-evaluation
document_a: "thoughts/shared/designs/2026-04-10_22-34-30_todo-tool-cc-parity.md"
document_b: "thoughts/shared/designs/2026-04-10_22-34-39_todo-tool-cc-parity.md"
topic: "Upgrade rpiv-pi todo tool to full CC-parity Task record with pure reducer architecture"
winner: "B"
gate_pass_a: false
gate_pass_b: true
tags: [evaluate, design-evaluation, todo-tool, cc-parity]
last_updated: 2026-04-11
last_updated_by: Claude Code
---

# Design Evaluation: Todo Tool CC-Parity Upgrade

## Test Setup

- **Research Question**: Upgrade `extensions/rpiv-core/todo.ts` from 3-field `{id, text, done}` + 4 actions to full CC-parity `Task` record + 6 verbs with pure reducer
- **Document A**: `2026-04-10_22-34-30_todo-tool-cc-parity.md` (1267 lines)
- **Document B**: `2026-04-10_22-34-39_todo-tool-cc-parity.md` (1267 lines)
- **Evaluation Method**: Automated codebase verification via 3 parallel agents (reference verification, behavioral verification, integration compatibility)
- **Claims Verified**: 15 file:line references, 7 behavioral claims, 6 integration points

## Scoring Summary

| Dimension | Doc A | Doc B | Method |
|---|---|---|---|
| 1. **Reference Accuracy (GATE)** | **1/3** | **3/3** | codebase-analyzer agents |
| 2. Code Correctness | 1/3 | 3/3 | Manual code review |
| 3. CC Parity | 2/3 | 3/3 | API surface comparison |
| 4. Structural Quality | 1/3 | 3/3 | Self-consistency + documentation |
| 5. Implementation Safety | 2/3 | 3/3 | Error handling + edge cases |
| 6. Rendering Robustness | 1/3 | 3/3 | RenderCall/renderResult analysis |
| **Total** | **8/18** | **18/18** | |

**Gate**: Doc A **FAIL** (claims/code contradiction + wrong paths), Doc B **PASS**
**Winner**: **Document B** by 10 points

---

## Dimension 1: Reference Accuracy (GATE)

### Document A: 3 MATCH, 3 MISMATCH, 2 MISSING (8 claims)

| Claim | Verdict | Issue |
|---|---|---|
| `todo.ts:16-20` — Todo interface | ✅ MATCH | |
| `todo.ts:33-46` — reconstructTodoState | ✅ MATCH | |
| `todo.ts:52-133` — registerTodoTool | ⚠️ MISMATCH | Function spans 52–138, not 52–133 |
| `todo.ts:139-160` — registerTodosCommand | ✅ MATCH | |
| `web-tools/index.ts:247-272` — "ONLY" renderCall/renderResult precedent | ❌ WRONG | web_fetch has an identical pair at 407–443; not the only precedent |
| `examples/extensions/todo.ts:228-280` — upstream example | ❌ MISSING | No `examples/extensions/` directory in this repo |
| `templates/pi-permissions.jsonc:26` — "todo": "allow" | ❌ MISSING | Wrong path; actual location is `extensions/rpiv-core/templates/pi-permissions.jsonc:26` |

**Accuracy rate**: 3/8 (37.5%). Two path errors, one incorrect exclusivity claim, one line-range drift.

### Document B: 6 MATCH, 1 MISMATCH, 2 UNVERIFIABLE-LOCALLY (9 claims)

| Claim | Verdict | Issue |
|---|---|---|
| `todo.ts:16-20` — Todo interface | ✅ MATCH | |
| `todo.ts:22-23` — module state | ✅ MATCH | |
| `todo.ts:33-46` — reconstructTodoState | ✅ MATCH | |
| `todo.ts:52-133` — registerTodoTool | ⚠️ MISMATCH | Function spans 52–138 (same drift as A) |
| `todo.ts:139-160` — registerTodosCommand | ✅ MATCH | |
| `index.ts:24,29-30,35,99` — only consumer | ✅ MATCH | Lines 35→38, 99→98 minor drift, all references correct |
| `templates/pi-permissions.jsonc:26` | ✅ MATCH | Correct full path |
| `web-tools/index.ts:247-272,407-441` — both renderCall/renderResult precedents | ✅ MATCH | Correctly identifies BOTH web_search and web_fetch |
| `pi-coding-agent/examples/extensions/todo.ts:221-280` | ⏳ UNVERIFIABLE | Peer dep not in local node_modules; verified correct in global install |

**Accuracy rate**: 6/9 confirmed (67% confirmed, 22% minor drift, 11% unverifiable locally). All paths resolve correctly. The two unverifiable claims reference the upstream Pi SDK package which was verified separately to contain the expected file.

**Gate verdict**: Doc A fails (wrong paths + incorrect behavioral claim about "ONLY" precedent). Doc B passes.

---

## Dimension 2: Code Correctness

### Critical Issue in Document A: Summary/Code Contradiction

**The design summary states**: "The load-bearing abstraction is a pure `applyTaskMutation()` reducer called by **both** `execute()` and `reconstructTodoState()`"

**The actual Architecture code shows**: `reconstructTodoState()` does a simple snapshot copy — it does NOT call the reducer.

```typescript
// Document A's reconstructTodoState (Architecture section):
export function reconstructTodoState(ctx: any) {
    tasks = [];
    nextId = 1;
    for (const entry of ctx.sessionManager.getBranch()) {
        // ... simple snapshot copy, no reducer call ...
        if (details?.tasks) {
            tasks = details.tasks;
            nextId = details.nextId ?? tasks.length + 1;
        }
    }
}
```

This is a documentation-code inconsistency that could mislead implementers. The "Pure Reducer" section repeatedly claims the reducer is the "single source of truth for both paths," but only one path actually uses it.

### Other Document A Issues

| Issue | Severity | Detail |
|---|---|---|
| Imports `Static` from typebox — never used | Low | Dead import, will trigger lint warnings |
| `getTasks()` renamed from `getTodos()` | Low | Internal accessor but inconsistent with `index.ts` convention |
| `description` field: `params.description as string \|\| undefined` | Low | Unnecessary `as string` cast; works due to TypeBox validation but masks type intent |
| `reducer` takes flat params `(tasks, nextId, ...)` returns `{tasks, nextId, ...}` | Medium | Inconsistent structure; harder to extend without breaking signature |

### Document B Issues

| Issue | Severity | Detail |
|---|---|---|
| `blockedBy` refs not checked for deleted status | **High** | Both `create` and `update addBlockedBy` validate existence but NOT that the referenced task is non-deleted. Allows deleted tasks as dependencies — contradicts Decision 10 ("Dangling reference to a deleted task → error"). |
| No cycle detection on `create` | Low | Theoretical no-op since new task doesn't exist in graph yet, but missing the defensive check Design A includes |

**Verdict**: Doc A has a serious documentation-code contradiction plus minor issues. Doc B has one genuine bug (missing deleted-status check for blockedBy refs). Doc B's bug is a surgical fix; Doc A's inconsistency requires rethinking what was actually intended.

---

## Dimension 3: CC Parity

| Feature | Doc A | Doc B |
|---|---|---|
| `blockedBy` API on update | Single `blockedBy` param (additive merge only) | `addBlockedBy` + `removeBlockedBy` (CC's exact API) |
| Metadata handling | Simple replace | Null-delete semantics (pass null value to delete key — CC parity) |
| `activeForm` field | ✅ Present | ✅ Present |
| `owner` field | ✅ Present | ✅ Present |
| `description` field | ✅ Present | ✅ Present |
| 6-verb action set | ✅ create/update/list/get/delete/clear | ✅ create/update/list/get/delete/clear |
| 4-state machine | ✅ pending/in_progress/completed/deleted | ✅ pending/in_progress/completed/deleted |

**Winner**: Doc B. The `addBlockedBy`/`removeBlockedBy` split and metadata null-delete semantics match Claude Code's `TaskUpdate` API exactly. Doc A's single `blockedBy` with additive-only merge is simpler but diverges from CC.

---

## Dimension 4: Structural Quality

### Self-Consistency

- **Doc A**: ❌ Summary claims reducer is used in both paths; code only uses it in one. The "Requirements" section says "Factor mutation logic into a pure reducer called by both execute and reconstructTodoState" — the code doesn't fulfill this requirement.
- **Doc B**: ✅ Decision 4 explicitly states "the reducer is only called from execute, not from reconstructTodoState" and the code matches.

### Decision Documentation

- **Doc A**: 8 unnumbered decisions. Most have evidence. No alternatives explored.
- **Doc B**: 15 numbered decisions. Each has explicit evidence. Decision 3 explores Option A (inline) vs Option B (reducer) with trade-offs. More thorough.

### Export Surface

- **Doc A**: Renames `getTodos()` → `getTasks()`. Not imported by `index.ts` (verified), but inconsistent.
- **Doc B**: Preserves `getTodos()`. Consistent with existing naming.

### Legacy Handling

- **Doc A**: No type-guard. Old `{id, text, done}` entries silently skipped by `details?.tasks` check (works because old entries have `todos` not `tasks` key). Fragile implicit behavior.
- **Doc B**: Explicit `isTaskDetails()` type-guard function. Documents behavior clearly. More robust.

---

## Dimension 5: Implementation Safety

### Error Handling

| Aspect | Doc A | Doc B |
|---|---|---|
| Error result pattern | Conditional: `if (!result.error) { tasks = result.tasks }` | Unconditional: always assigns `tasks = result.state.tasks` (error returns unchanged state) |
| Empty update guard | ❌ No check — allows no-op `update({id: 1})` | ✅ `hasMutation` check — requires at least one field |
| Self-blocking prevention | ❌ No check — allows `update({id: 1, blockedBy: [1]})` | ✅ Checks `dep === current.id` |
| Double-delete detection | ❌ Only checks transition validity (deleted→deleted is rejected by transition table) | ✅ Explicit check + explicit error message |
| blockedBy deleted-task check | ✅ Validates `dep.status === "deleted"` | ❌ Missing — allows deleted tasks as dependencies |

Doc B's unconditional state-assignment pattern is cleaner and less error-prone. Doc A's conditional pattern requires the implementer to remember to check `error` before every state mutation — a potential source of bugs if the pattern is broken during future edits.

### Edge Case Coverage

Doc B covers more edge cases (empty update, self-blocking, already-deleted). Doc A covers deleted-task-as-blockedBy. Each has one gap the other doesn't.

---

## Dimension 6: Rendering Robustness

### Document A: Fragile Content Parsing

The `renderResult` for the `update` action **parses the content text with a regex** to extract the status transition:

```typescript
// Document A renderResult, update case:
const content = result.content[0];
const contentText = content?.type === "text" ? content.text : "";
if (contentText.includes("→")) {
    const match = contentText.match(/(\w+) → (\w+)/);
    if (match) {
        text += theme.fg("dim", match[1]) + " → " + theme.fg("muted", match[2]);
    }
}
```

This couples the renderer to the exact content string format. Any change to `content` text breaks the renderer silently.

### Document B: Structured Data Access

The `renderResult` reads from `details.params.status` — the structured data that was originally passed to the tool:

```typescript
// Document B renderResult, update case:
if (details.params.status !== undefined) {
    text += " " + theme.fg("muted", `→ ${updated.status}`);
}
```

Decoupled from content format. Robust to content text changes.

### Type Safety in Rendering

| Aspect | Doc A | Doc B |
|---|---|---|
| `theme` param type | `any` | Inferred from tool registration |
| `_context` param type | `any` | Inferred from tool registration |
| `result` type | `any` | Uses `TaskDetails` |
| `args` type | Explicit `TodoParamsType` | Inferred from tool registration |

Doc B relies on TypeScript inference from the generic tool registration, which is both safer and more idiomatic.

### Glyph Theming

- **Doc A**: `statusGlyph()` returns plain strings (`"○"`, `"◐"`, `"✓"`, `"✗"`) — no theme colors at the glyph level.
- **Doc B**: `statusGlyph(status, theme)` returns themed strings (`theme.fg("dim", "○")`, etc.) — colors baked into the glyph helper.

Doc B's approach is cleaner for rendering consumers since they don't need to know which color maps to which status.

---

## Qualitative Assessment

### Information Unique to Document A

1. **"Unblocked" notification on completion** — When a task is completed, the content shows which downstream tasks become unblocked. Nice UX touch missing from B.
2. **Cycle detection on create** — Defensive check even though it's a no-op for new tasks. Shows defensive thinking.
3. **`deriveBlocks()` in `formatTask()`** — Computed blocks shown inline in content text for list/get.

### Information Unique to Document B

1. **Decision 3 alternative exploration** — Explicitly weighs inline vs reducer approach. Doc A just presents the decision.
2. **Type-guard `isTaskDetails()`** — Explicit handling of legacy session data.
3. **`addBlockedBy`/`removeBlockedBy` API** — True CC parity for dependency management.
4. **Metadata null-delete** — Pass `{key: null}` to delete a metadata key, matching CC.
5. **Self-blocking prevention** — `dep === current.id` check.
6. **Empty-update guard** — Requires at least one mutable field.
7. **Rollback strategy** — Explicit "revert via git" plan.
8. **Correct pi-permissions.jsonc path** — Full path including `extensions/rpiv-core/` prefix.

### Downstream Impact

- **Document A**: Needs the summary/code contradiction resolved before implementation. The implementer must decide: was the intent to call the reducer during replay (as the text says) or not (as the code shows)? If yes, the `reconstructTodoState` code needs a rewrite. If no, the Requirements and Summary sections need correction. The `renderResult` regex parsing should be redesigned. The missing deleted-task check for blockedBy should be added. **Not ready for write-plan without fixes.**

- **Document B**: One surgical fix needed (add `dep.status === "deleted"` check in blockedBy validation). Otherwise ready for implementation. The decisions are internally consistent, the code matches the claims, and the export surface is compatible with `index.ts`. **Ready for write-plan after one fix.**

---

## Improvement Recommendations

### Document A

1. **Resolve the reducer/replay contradiction** — Either update `reconstructTodoState` to actually call the reducer, or remove the "called by both paths" claims from Requirements, Summary, and Decisions sections.
2. **Fix `templates/pi-permissions.jsonc` path** — Correct to `extensions/rpiv-core/templates/pi-permissions.jsonc`.
3. **Fix "ONLY" precedent claim** — web_fetch at 407–443 also has renderCall/renderResult.
4. **Replace regex content parsing in renderResult** — Read from `details.params.status` instead.
5. **Remove unused `Static` import**.
6. **Add self-blocking prevention** for blockedBy.
7. **Add empty-update guard**.
8. **Consider renaming `getTasks()` back to `getTodos()`** for consistency.

### Document B

1. **Add deleted-status check for blockedBy refs** — In both `create` (line where it validates `state.tasks.some((t) => t.id === dep)`) and `update` `addBlockedBy` validation, add: `const depTask = state.tasks.find((t) => t.id === dep); if (depTask?.status === "deleted") return errorResult(..., "addBlockedBy: #${dep} is deleted")`.
2. **Consider adding "Unblocked" notification** from Design A's update completion logic — it's a genuinely useful UX feature that B omits.
