---
date: 2026-04-11T11:47:54+0000
researcher: Claude Code
git_commit: d484cb3
branch: master
repository: rpiv-pi
topic: "Parallel question-generation subagents for design-feature-iterative — mirroring the research-questions → research fan-out pattern to shape architecture slices, code shape, interfaces, and signatures"
tags: [research, design-feature-iterative, parallel-question-generation, subagents, ambiguity-surface, ask-user-question, holistic-self-critique, write-plan-contract, slice-decomposition, pi-port]
status: complete
questions_source: "thoughts/shared/questions/2026-04-11_07-11-40_design-iterative-question-subagents.md"
last_updated: 2026-04-11
last_updated_by: Claude Code
---

# Research: Parallel Question-Generation Subagents for design-feature-iterative

## Research Question

Can `design-feature-iterative` adopt a `research-questions → research` style fan-out pattern where parallel subagents each surface architectural questions along a dedicated dimension (data model, API, integration, scope, verification, performance), with the goal of shaping slice boundaries, code shape, interfaces, and signatures? If so: what decomposition axis do subagents own, where does the new step insert into the current 10-step flow, how does the merge interact with the existing holistic self-critique, and does it fire once upfront or per-slice?

## Summary

Yes — and the mapping is unusually clean because three independently-maintained contracts triangulate onto the same 6 architectural dimensions: write-plan's Step 1 extraction list at `skills/write-plan/SKILL.md:26`, the design artifact template's fill-list at `skills/design-feature-iterative/SKILL.md:217-241`, and the Step 2 targeted-research agent roster at `:60-76`. The 5 Step 3 ambiguity types (`:92-96`) are classification outcomes, not parallelization axes — they produce overlapping file ownership and do not map onto any downstream consumer. Architectural dimensions (data model / API surface / integration wiring / scope / verification / performance, with migration conditional on schema changes) are the load-bearing axis: they partition the file ownership space cleanly, they map 1:1 to write-plan's extract sections, and they inherit Step 6's existing natural priority ordering (`:210` "types/interfaces always Slice 1"; `:418` "types → backend → API → UI").

The developer selected a minimum-viable shape: **replace Step 3 in-place** (zero numbering shift), **6 parallel general-purpose subagents** with 7-block assembled prompts (Option 1+4 precedent at `designs/2026-04-09_12-38-44_option1-plus-option4-fill-quality-hardening.md:75-77`), **self-prioritize to top 1-2 questions per dimension** so the drained queue is ≤5 (the `ask_user_question.ts:28-35` single-question schema forces sequential draining — the "batch 2-4" claim at `skills/design-feature-iterative/SKILL.md:153` is a Claude-Code carryover bug), **hybrid merge** (local `:114/:116` critique axes inside each subagent, orchestrator owns `:115/:117` cross-cutting and ambiguity-completeness), and **upfront only** (runs once before Step 6 decomposition, matching Option 1+4's phased implementation precedent and avoiding collision with Step 7c's existing `:294` Approve/Revise/Rethink checkpoint). Per-slice dispatch is deferred until upfront validates via A/B. The line-153 batching claim gets deleted as part of this work.

## Detailed Findings

### Decomposition axis — why architectural dimensions beat the 5 ambiguity types

The 5 types at `skills/design-feature-iterative/SKILL.md:92-96` (pattern conflict, missing pattern, scope boundary, integration choice, novel approach) are **discovery outcomes**, not codebase regions. A single file can generate a pattern conflict AND an integration choice AND a scope question; one subagent per type produces massive file-ownership overlap. Contrast with `skills/research-questions/SKILL.md:42-44` where codebase-locator is dispatched "one per decomposed area" — the areas are spatial, so locators don't collide. Per `:46-47` each locator reports "function names, class/type names, and import paths" for a specific area — a coherent unit of work only when the area has a spatial anchor.

Architectural dimensions have three structural properties the ambiguity types lack:

1. **Non-overlapping file ownership** — data-model owns `types/*.ts`; API owns `routes/controllers/services`; integration owns `config/, di.ts`, event registries. This matches research-questions' spatial partitioning at `skills/research-questions/SKILL.md:42-44`.
2. **Stable contract with downstream** — each dimension populates a `skills/write-plan/SKILL.md:26` extract section directly, so the fan-in merge has a pre-defined destination in the Step 6 skeleton at `skills/design-feature-iterative/SKILL.md:217-241`.
3. **Step 2 agents already aligned** — `:60-76` spawns codebase-pattern-finder (data/API shape), codebase-analyzer (integration), integration-scanner (wiring), precedent-locator (migration/verification lessons). Each dimension subagent can inherit a pre-partitioned slice of Step 2 findings, not a raw dump.

### Dimension → write-plan section mapping

| Architectural dimension | write-plan extract section | design-feature-iterative skeleton | Step 2 research agent |
|---|---|---|---|
| Data model (types, schemas, entities) | Architecture (NEW foundation files) | `:210` "types/interfaces always Slice 1" | codebase-pattern-finder |
| API surface (signatures, exports, routes) | Architecture + File Map | `:231`, `:233` | codebase-pattern-finder |
| Integration wiring (mount points, DI, events) | Architecture (MODIFY) + Ordering Constraints | `:234` | integration-scanner |
| Scope boundary (in/out) | Scope (Building / Not Building) | `:229` | (cross-cutting) |
| Verification (tests, asserts, risks) | Verification Notes | `:235` | precedent-locator |
| Performance (load, caching, N+1) | Performance Considerations | `:236` | codebase-pattern-finder |
| Migration (conditional) | Migration Notes — NOT in `:26` extract list | `:237` | precedent-locator |

Notable asymmetries: Migration is carried forward at `skills/write-plan/SKILL.md:185-187` but NOT listed in the Step 1 extract spec at `:26` — so a migration dimension subagent feeds a section write-plan uses but doesn't gate phases on. Ordering Constraints has no clean single-dimension owner — it's emergent across types→impl→wiring, and `:210` plus `:418` enforce its ordering implicitly, so no dedicated subagent is needed.

### Coverage guarantee (two-axis)

Research-questions' rule at `skills/research-questions/SKILL.md:100`:
> Every key file read in Step 3 should appear in at least one question. Files that were read but don't appear in any question indicate either an unnecessary read or a missing question.

The design-feature-iterative parallel is **stronger** — it has two axes:
1. **File coverage**: every file in Step 2's read-list must appear in at least one subagent's dimension output.
2. **Section coverage**: every `skills/write-plan/SKILL.md:26` section must be populated by at least one subagent.

Both are mechanically checkable during the orchestrator merge. Missing Verification Notes breaks `skills/write-plan/SKILL.md:161-162`; missing Ordering Constraints breaks `:46-52`; missing Scope breaks `:136`.

### Host placement — replace Step 3 in-place

Three candidates were compared:

**Candidate (a) — Step 2.5 insertion**: sub-agents see raw Step 2 output and produce the Step 3 queue. Forces the `:102` pre-validate rule to move into each subagent. Numbering: sub-number insert, downstream `:104/:124/:184/:247/:313/:330/:349` stay put.

**Candidate (b) — Replace Step 3 in-place** *(selected)*: the orchestrator's Step 3 triage logic at `:88-102` gets parallelized across dimensions. Each subagent categorizes its dimension's findings into simple decisions vs. genuine ambiguities with its own pre-validation per `:102`. Step 4 at `:104-122` becomes the **primary cross-dimension integration point** — its existing prompts at `:109-111` ("What's inconsistent, missing, or contradictory... Do any patterns from different agents conflict when combined?") are literally written for the merged-subagent-output case. **Zero numbering shift** — the Step 3 number stays, all downstream line references remain valid. This is the unique property driving the selection: the holistic-critique design at `designs/2026-04-08_19-11-09_holistic-self-critique-loop.md:60-61` cited cross-reference stability as Decision 1 ("~30 thoughts/ docs with line refs" blast radius at `:141-143`), and the Pi port at `66eaea3` already broke the sub-numbering convention once by flattening Step 3.5 → Step 4.

**Candidate (c) — Step 4.5 insertion**: subagents refine what Step 4 already merged. Least disruptive to `:102/:119-122/:141` but diverges from the research-questions mirror (becomes correction-pass instead — closer to `:160-162` "Correction → Spawn targeted rescan"). Has no analog in the design-feature sibling which lacks Step 4 entirely (see `skills/design-feature/SKILL.md:104-162` — its Step 4 is the Developer Checkpoint directly).

Candidate (b) wins because it mirrors research-questions' fan-out most faithfully, ships without a numbering shift, and Step 4's existing prompts fit the cross-dimension conflict case without modification. Backport to the `design-feature` sibling is mechanical (swap its Step 3 identically), but deferred — the sibling has no holistic critique to feed, and that's a separate follow-up.

### Effect on Step 3 pre-validate rule at `:102`

> Pre-validate options before presenting them: Check every option against research constraints and the runtime behavior of code in context. ... Eliminate options that violate constraints, or present them with an explicit caveat stating the violation. Do not offer choices that contradict evidence from Steps 1-2.

With Replace-Step-3, this rule is **inherited by each dimension subagent** — it goes into prompt block 5 (decisions & constraints) of the assembled prompt. Each subagent pre-validates within its own scope. Cross-dimension pre-validation (a data-model option invalidated by a migration constraint) becomes the orchestrator's job during Step 4's merge.

### Effect on Step 4 reclassification at `:119-122`

> Issues you can resolve with evidence: fix in-place — reclassify simple decisions as genuine ambiguities, or resolve a genuine ambiguity as simple if holistic review provides clarity. Note what changed.

Unchanged. Step 4 still runs the same fix-in-place or add-to-checkpoint-queue remediation — it just now operates on a merged set from 6 subagents instead of a single orchestrator pass. Reclassification authority stays with the orchestrator because it's a conversation-state mutation, not a returnable value (this rules out Option c of the merge-site question — a meta subagent can only *recommend* reclassifications).

### Effect on Step 5 `:141` lead-significance rule

> Lead with the most architecturally significant ambiguity.

Unchanged at the prose level but operates on a larger merged queue. The architectural priority order at `:210` (types first) and `:418` (types → backend → API → UI) provides the natural sort key for the merged set: data-model questions first, API second, integration third, scope/verification/performance interleaved by evidence strength. Self-prioritize to top-3 (below) caps the queue depth before this rule fires.

### Agent form — general-purpose with 7-block assembled prompt (Option B)

The Option 1+4 precedent at `designs/2026-04-09_12-38-44_option1-plus-option4-fill-quality-hardening.md:75-77` is directly binding:

> Subagent type: general-purpose. No named fill-agent. General-purpose agent receives full behavioral instructions in prompt. Modeled after `validate-plan/SKILL.md:57-59`. Named agent deferred until A/B validated — per research Q1, `48f7aa3` showed agent dispatch patterns cascade (3 pattern changes in 2 days at `441ef08`→`b75f2aa`).

Three legs of the rationale still hold:
1. **Cascade risk** — the `441ef08`→`5585727`→`b75f2aa` chain (Skill tool → Agent tool → general-purpose → named agents, 3 changes in 2 days) plus `66eaea3` (Pi port flattening `rpiv-next:` → bare names) shows generator-class agents cascade unpredictably.
2. **Validation prerequisite** — A/B testing is required before locking an agent shape; Pi's agent runtime is only 4 days old with 9 existing agents, all inherited locators/analyzers, **zero generator-class agents** — no breakage precedent to learn from.
3. **Precedent** — `validate-plan/SKILL.md:57-59` already uses the general-purpose-with-assembled-prompt pattern.

The 7 blocks mapped to the question-generation context:

1. **Artifact path** — research artifact from `skills/design-feature-iterative/SKILL.md:46-48`, read via Pi `read` tool inside the subagent (no orchestrator excerpting).
2. **Assigned architectural dimension** — one of the 6 (7 with migration). Each parallel subagent receives one dimension.
3. **Pattern templates from Step 2** — file:line pointers surfaced by the 4 Step 2 research agents at `:60-76`; subagent reads fresh via `read` tool.
4. **Coverage map** — "dimensions already assigned: A, B, C, D, E, F — do not duplicate their angles" (parallel fan-out, so this block collapses to a no-overlap reminder).
5. **Decisions & constraints** — TWO compressed rule inclusions:
   - `skills/research-questions/SKILL.md:92`: "thoughts/ docs are NOT questions — thoughts-locator findings provide historical context. They should be mentioned in the Discovery Summary, not turned into questions that ask an agent to summarize a document."
   - `skills/design-feature-iterative/SKILL.md:102`: the full pre-validate rule verbatim.
6. **Behavioral priority rule** — "The research artifact on disk is the source of truth. If the assigned dimension or any summary conflicts with the research artifact, follow the research artifact. Do not invent constraints not anchored in the research."
7. **Self-verify instructions** — dimension-local OK/VIOLATION check before returning (see Merge Site section below).

Return format: dense 3-6 sentence paragraphs mirroring `skills/research-questions/SKILL.md:80-90`, each naming the dimension, the pattern-template anchor, and embedding ≥3 `file:line` references per paragraph per `:92-95`.

### I/O constraint — ask_user_question is single-question; fix line-153

The Pi `ask_user_question` tool at `extensions/rpiv-core/ask-user-question.ts:28-35` accepts exactly ONE question per call:

```ts
parameters: Type.Object({
  question: Type.String(...),         // :29 — singular, required
  header: Type.Optional(Type.String(...)),   // :30 — singular
  options: Type.Array(OptionSchema),          // :31 — options for ONE question
  multiSelect: Type.Optional(Type.Boolean(...))  // :32-34
})
```

There is no `questions` wrapper anywhere. The execute body at `:37-114` builds ONE `Container` (`:61`), ONE `Text` title (`:65`), ONE `SelectList` (`:69`), awaits via `ctx.ui.custom` (`:60`) — the UI layer is inherently sequential.

By contrast, Claude Code's native `AskUserQuestion` takes a `questions` array — visible at `skillbased/skills/design-feature-iterative/SKILL.md:150-159`. The Pi SKILL.md at `:153` still says "you MAY batch 2-4 in a single `ask_user_question` call" — **this is a factual carryover bug from the port**. The fix is to delete that paragraph.

**v1 approach**: force self-prioritize. Each dimension subagent returns its top 1-2 questions only (not its full raw candidate list). Orchestrator picks global top 3-5 from the merged set during Step 4. The drained `ask_user_question` chain is capped at ≤5 sequential calls, each blocking on the previous at `:140`. No new tool, no new artifact type — Developer Context at `:239` remains the only recording surface. Q5's persistence concern is acknowledged but deferred; the durability gap becomes visible only for chains longer than ~5, which the cap prevents.

The line-153 fix is small enough to land in the same edit as the Step 3 replacement — the prose surfaces to rewrite are physically adjacent.

### Merge site — hybrid: local critique inside subagent + cross-cutting in orchestrator

Q6's information-theoretic argument: cross-subagent dedupe and pre-validation require something that sees all N outputs simultaneously. Option 1+4's "inside-the-subagent self-verify" at `designs/.../hardening.md:79-82` works only for self-contained per-slice work where each subagent verifies against a shared static context — question generation is the opposite case, where conflicts between outputs are the whole point.

But Step 4's 4 review axes at `skills/design-feature-iterative/SKILL.md:113-117` split cleanly into local and cross-cutting:

**Local axes (fit inside the subagent)**:
- `:114` Requirement coverage — within its dimension
- `:116` Pattern coherence — among its own simple decisions

**Cross-cutting axes (require orchestrator)**:
- `:115` Cross-cutting concerns — error handling / state / performance spanning multiple dimensions
- `:117` Ambiguity completeness — did Step 3 miss a multi-faceted issue by treating it as simple in isolation

**Protocol**:
1. Each subagent runs local-axes critique before returning and embeds the result as a compressed self-verify block in its output, modeled on Option 1+4's Step 7b format at `skills/design-feature-iterative/SKILL.md:272-277` and `designs/.../hardening.md:163-168`:
   ```
   Self-verify Dimension N:
   - Coverage: [OK / VIOLATION: dimension skips file X — fix applied]
   - thoughts/ rule: [OK / VIOLATION: question Q asks for doc summary — rewritten as code-path trace]
   - Pre-validate rule: [OK / VIOLATION: question Q option contradicts Step 2 evidence — fix applied]
   - Self-contained: [OK / VIOLATION: question Q lacks file:line anchors — fix applied]
   ```
2. Orchestrator receives compressed shards (not full raw evidence blocks). Payload per subagent ≈ 200-400 tokens, matching Option 1+4's estimate at `designs/.../hardening.md:81`. For 6 dimensions: ~1200-2400 tokens total, vs. ~2000-4000 for orchestrator-side option. Savings ~40-50%.
3. Orchestrator runs `:115` cross-cutting and `:117` ambiguity-completeness on the merged compressed set plus the dimension question lists. Remediation at `:119-122` is unchanged.
4. Reclassification authority stays in the orchestrator (rules out pure meta-subagent Option c from Q6's options).

### Timing — upfront only, runs once pre-Step 6

Q7's class distinction is load-bearing:

| Class | Answer point | Context state | Orchestrator pressure |
|---|---|---|---|
| Slice-boundary (what exists, what depends on what) | Before Step 6 freezes `:233` File Map and `:234` Ordering Constraints | Research findings + Step 2 + Step 4 critique; **prior-slices-summary block does NOT exist yet** | Least pressured |
| Interface/signature (types, exported signatures, wiring hooks) | Inside Step 7 after `:253` fills code | `:140-147` prior-slices-summary block populated incrementally per `:156` | Most pressured (mid-loop) |

**Upfront** is picked for v1 because:

- Answers the class the user's framing emphasizes ("architecture slices").
- **1 fan-out, not N** — for a 6-slice design, upfront dispatches 6 subagents once vs. per-slice dispatching 6 × N = 36.
- **No `:294` collision** — Step 7c's Approve/Revise/Rethink checkpoint is completely untouched.
- **No prior-slices-summary dependency** — the `:140-147` block doesn't exist at upfront time, but upfront-class questions don't need it (they're about boundaries, not signatures).
- **Orchestrator context is least pressured pre-Step 6** — the hybrid merge's cross-cutting pass lands where the orchestrator has the most headroom.
- **Phased implementation precedent** — Option 1+4 itself at `designs/.../hardening.md:294-295` shipped in phases ("Combined design, phased implementation. Design artifact covers both. Implementation: Option 1 first... then add Option 4 on top"). Upfront-only is v1; per-slice is v2 after A/B validates upfront.

Per-slice dispatch is structurally possible — if adopted later, the prior-slices-summary block at `:140-147` gets reused verbatim (the orchestrator is already maintaining it for the fill subagent, so passing it to question subagents is free), and the `:294` collision must be resolved explicitly (demote 7c to final go/no-go OR fire per-slice questions conditionally only when Step 4 flagged an unresolved interface ambiguity scoped to that slice). Deferring this to v2 keeps v1's specification surface small.

## Code References

- `skills/design-feature-iterative/SKILL.md:16-26` — 10-step flow overview
- `skills/design-feature-iterative/SKILL.md:56-86` — Step 2 Targeted Research (4 agent dispatches)
- `skills/design-feature-iterative/SKILL.md:60-76` — the 4 Step 2 agents that provide inputs to dimension subagents
- `skills/design-feature-iterative/SKILL.md:88-102` — Step 3 Identify Ambiguities (the replacement target)
- `skills/design-feature-iterative/SKILL.md:92-96` — 5 ambiguity types (rejected as decomposition axis)
- `skills/design-feature-iterative/SKILL.md:98` — "Simple decisions resolve silently" rule
- `skills/design-feature-iterative/SKILL.md:102` — Pre-validate rule (inherited by each dimension subagent)
- `skills/design-feature-iterative/SKILL.md:104-122` — Step 4 Holistic Self-Critique (receives merged subagent output; runs cross-cutting axes)
- `skills/design-feature-iterative/SKILL.md:113-117` — Step 4's 4 review axes (split local vs cross-cutting)
- `skills/design-feature-iterative/SKILL.md:119-122` — Step 4 remediation (unchanged, authority stays in orchestrator)
- `skills/design-feature-iterative/SKILL.md:124-182` — Step 5 Developer Checkpoint
- `skills/design-feature-iterative/SKILL.md:140` — "Ask ONE question at a time" rule (amplified by the single-question tool constraint)
- `skills/design-feature-iterative/SKILL.md:141` — "Lead with most architecturally significant" rule
- `skills/design-feature-iterative/SKILL.md:153` — **line-153 batching bug** (delete as part of this work)
- `skills/design-feature-iterative/SKILL.md:184-245` — Step 6 Feature Decomposition (freezes File Map and Ordering Constraints)
- `skills/design-feature-iterative/SKILL.md:210` — "Foundation first: types/interfaces always Slice 1" (natural priority sort key)
- `skills/design-feature-iterative/SKILL.md:217-241` — Step 6 skeleton section list (aligns 1:1 with dimension axis)
- `skills/design-feature-iterative/SKILL.md:229` — Scope skeleton section
- `skills/design-feature-iterative/SKILL.md:231, :233` — Architecture + File Map skeleton
- `skills/design-feature-iterative/SKILL.md:234` — Ordering Constraints skeleton
- `skills/design-feature-iterative/SKILL.md:235` — Verification Notes skeleton
- `skills/design-feature-iterative/SKILL.md:236` — Performance Considerations skeleton
- `skills/design-feature-iterative/SKILL.md:237` — Migration Notes skeleton
- `skills/design-feature-iterative/SKILL.md:239` — Developer Context (current question-recording surface)
- `skills/design-feature-iterative/SKILL.md:240` — Design History (explicitly ignored by write-plan)
- `skills/design-feature-iterative/SKILL.md:247-311` — Step 7 Generate Slices
- `skills/design-feature-iterative/SKILL.md:253-266` — Step 7a generate slice code (Option 1+4 fill dispatch target — per-slice question dispatch deferred to v2)
- `skills/design-feature-iterative/SKILL.md:272-277` — Step 7b Self-verify format (template for dimension subagent self-verify block)
- `skills/design-feature-iterative/SKILL.md:294` — Step 7c Approve/Revise/Rethink (per-slice collision surface; untouched in v1)
- `skills/design-feature-iterative/SKILL.md:418` — Common Design Patterns ordering (types → backend → API → UI; secondary priority sort key)
- `skills/research-questions/SKILL.md:40-49` — the fan-out template being mirrored
- `skills/research-questions/SKILL.md:78-100` — Step 4 synthesize (orchestrator-side, not meta-subagent)
- `skills/research-questions/SKILL.md:92` — "thoughts/ docs are NOT questions" rule (inherited by dimension subagent prompt block 5)
- `skills/research-questions/SKILL.md:100` — file coverage rule (extended to two-axis with section coverage)
- `skills/research-questions/SKILL.md:80-90` — dense-paragraph output schema
- `skills/research-questions/SKILL.md:129-168` — Step 6 Write Questions Artifact (structural reference only; v1 does NOT create a parallel artifact type)
- `skills/research/SKILL.md:36-47` — file-overlap grouping pattern (informs orchestrator merge)
- `skills/write-plan/SKILL.md:26` — Step 1 extract list (6 sections defining the dimension axis); note: this file lives in `rpiv-skillbased` — Pi copy is pending port
- `skills/write-plan/SKILL.md:29, :253, :301` — STOP-if-unresolved-questions rules
- `skills/write-plan/SKILL.md:161-162` — Verification Notes → success criteria
- `skills/write-plan/SKILL.md:185-187` — Migration Notes carry-forward (not in `:26` extract)
- `extensions/rpiv-core/ask-user-question.ts:17-35` — registerAskUserQuestionTool, single-question schema
- `extensions/rpiv-core/ask-user-question.ts:28-35` — Type.Object schema (no questions array)
- `extensions/rpiv-core/ask-user-question.ts:37-114` — execute body (single Container/Text/SelectList, inherently sequential)
- `extensions/rpiv-core/ask-user-question.ts:60` — `ctx.ui.custom` blocking await
- `extensions/rpiv-core/index.ts:23, :28` — registerAskUserQuestionTool registration point (untouched in v1)
- `extensions/rpiv-core/index.ts:49-58` — dirs array (untouched in v1 — no new `design-questions/` directory)
- `extensions/rpiv-core/agents.ts:19-25` — PACKAGE_ROOT resolution
- `extensions/rpiv-core/agents.ts:36-62` — copyBundledAgents function (untouched in v1 — no new agent file)
- `extensions/rpiv-core/agents.ts:49-59` — skip-if-exists copy loop
- `extensions/rpiv-core/index.ts:33-85` — session_start handler
- `extensions/rpiv-core/index.ts:61` — `copyBundledAgents(ctx.cwd, false)` first-run seed
- `extensions/rpiv-core/index.ts:128-142` — `/rpiv-update-agents` forced refresh
- `agents/codebase-locator.md:1-5` — canonical Pi agent frontmatter (lowercase tools, no color field)
- `agents/codebase-analyzer.md:4` — `tools: read, grep, find, ls`
- `agents/integration-scanner.md:4` — `tools: grep, find, ls`
- `agents/codebase-pattern-finder.md:4` — `tools: grep, find, read, ls`
- `agents/precedent-locator.md:4` — `tools: bash, grep, find, read, ls`
- `skills/design-feature/SKILL.md:88-102` — sibling Step 3 (identical text, candidate for backport)
- `skills/design-feature/SKILL.md:104-162` — sibling Step 4 is the Developer Checkpoint directly (no holistic critique; backport-blocker for Candidate (c))

## Integration Points

### Inbound References
- `skills/design-feature-iterative/SKILL.md:46-48` — research artifact argument (read by the new dimension subagents via prompt block 1)
- `skills/design-feature-iterative/SKILL.md:78` — "Read all key files identified by agents" (Step 2 file read list — partitioned across dimension subagents as prompt block 3)
- `skills/research/SKILL.md` — downstream consumer if any skill ever dispatches this pattern (not in v1)
- `skills/design-feature/SKILL.md` — sibling that is a backport candidate (deferred)

### Outbound Dependencies
- `skills/write-plan/SKILL.md:26` — the contract the dimension axis maps onto (every dimension must populate a section in this list, or coverage fails)
- `skills/write-plan/SKILL.md:29, :253, :301` — STOP rules; v1 does not add a new parseable signal (Developer Context remains the recording surface)
- `extensions/rpiv-core/ask-user-question.ts` — the sequential-draining constraint that forces self-prioritize

### Infrastructure Wiring
- `extensions/rpiv-core/index.ts:23, :28` — registerAskUserQuestionTool (no new registration in v1)
- `extensions/rpiv-core/index.ts:49-58` — dirs array (no new directory in v1)
- `extensions/rpiv-core/agents.ts:36-62` — auto-copy (no new agent file in v1)

## Architecture Insights

1. **Three contracts triangulate on the same 6-dimension axis**. `skills/write-plan/SKILL.md:26` extract list, `skills/design-feature-iterative/SKILL.md:217-241` skeleton template, and `:60-76` Step 2 agent roster all organize around the same architectural axes. This is the structural reason the mapping works — it's not an arbitrary taxonomy, it's the existing contract with downstream.

2. **The Pi port already broke the sub-numbering convention once**. `66eaea3` flattened Step 3.5 → Step 4 during the port, shifting all downstream numbers. The holistic-critique design at `designs/2026-04-08_19-11-09_holistic-self-critique-loop.md:60-61, :141-143` explicitly argued for sub-numbering to avoid breaking ~30 thoughts/ cross-references — so every new step insertion decision in Pi now has to either accept another numbering tax or find a way to avoid shifting numbers. Replace-Step-3 uniquely avoids the shift.

3. **Step 4 was designed for exactly the merged-subagent-output case by accident**. The holistic self-critique's prompts at `:109-111` ("What's inconsistent, missing, or contradictory across the research findings, resolved decisions, and identified ambiguities? Do any patterns from different agents conflict when combined?") are written as if they anticipated multiple parallel upstreams. They pre-fit parallel fan-out without modification — the replacement of Step 3 can ship without rewriting any Step 4 prose.

4. **The `ask_user_question` single-question schema is a hard constraint at the UI layer, not just the tool layer**. `ctx.ui.custom` at `:60` is inherently sequential — even a new `ask_user_questions` array-taking tool would loop internally and render one modal at a time. So parallelization cannot remove the sequential-draining bottleneck; it can only reduce how many questions enter the queue. Self-prioritize-to-top-3 is the structurally correct response.

5. **Pi's agent runtime at `agents.ts` is 4 days old and has never been stressed by a generator-class agent**. The existing 9 agents in `agents/` are all locators/analyzers (inherited from rpiv-skillbased). Shipping a named `design-question-generator` agent file would be the first generator-class stress test AND would land at the trailing edge of the `441ef08`→`5585727`→`b75f2aa` cascade that Option 1+4 explicitly cited — general-purpose with assembled prompt is strictly safer.

6. **The prompt-bloat budget is ~25 lines added**. `write-test-cases v1` at 514 lines lost A/B (cited in holistic-self-critique Verification Notes); Option 1+4 at `designs/.../hardening.md` had to compress Guidelines 6+7 and line 481 to fit 55-80 new lines in a 550-line budget. Pi's `design-feature-iterative/SKILL.md` is currently 422 lines — headroom exists but the replacement-of-Step-3 plus line-153 deletion should net to ≤25 added lines or compress neighboring prose upfront.

## Precedents & Lessons

6 similar past changes analyzed. Key commits: `bcca905` (v0.9.26 — research-questions+research two-phase pipeline introduction), `1b5d32e` (v0.9.29 — initial design-feature-iterative + holistic self-critique), `1b3cf2c` (v0.9.31 — Option 1+4 partial ship of self-verify format and merge protocol), `441ef08`→`5585727`→`b75f2aa` (agent delegation cascade, 3 changes in 2 days), `21b044d`/`48f7aa3` (prescriptive-prompt reverts), `66eaea3` (Pi port flattening `rpiv-next:` → bare names).

- **Prescriptive checklists get reverted** — `21b044d`, `48f7aa3`, and the holistic-critique Decision 2 all cite the same anti-pattern. The dimension list MUST be marked "suggestive coverage areas, not a mandatory checklist" — and quality instructions belong in the subagent prompt (block 5), not SKILL.md orchestrator prose.
- **"Instructions at the wrong step have no effect"** — `48f7aa3` lesson via the holistic-critique design. Placement matters more than content. Replace-Step-3 puts the fan-out at the highest-leverage point.
- **Sub-numbering is the norm when downstream references exist** — `21b044d` Step 2.4, the original Step 3.5, and Step 4.5 all exist to avoid renumbering. Replace-Step-3 achieves the same outcome (zero shift) by replacement instead of sub-numbering.
- **Quality instructions belong in subagent prompts, not orchestrator SKILL.md prose** — `48f7aa3` and Option 1+4 Verification Notes. The `:102` pre-validate rule is copied into prompt block 5 of each dimension subagent, not duplicated in SKILL.md Step-level prose.
- **Self-critique goes inside the subagent where it can be local** — Option 1+4 Decision at `designs/.../hardening.md:79-82`. The hybrid merge preserves this for local axes (`:114`, `:116`) while accepting that cross-cutting axes (`:115`, `:117`) structurally require the orchestrator.
- **Agent dispatch cascades unpredictably** — `441ef08`→`5585727`→`b75f2aa` in 2 days (Skill → Agent → general-purpose → named), plus `66eaea3` Pi port rewriting every reference. **Do not ship new named agents for v1.** General-purpose with assembled prompt is the safe form until A/B validates the shape.
- **Pi `ask_user_question` accepts ONE question, not an array** — `ask-user-question.ts:28-35` vs the Claude-Code-origin claim at `skills/design-feature-iterative/SKILL.md:153`. The line-153 fix is a trivial, separable one-line deletion that lands in the same edit as the Step 3 replacement.
- **Prompt bloat is the #1 skill killer** — `write-test-cases v1` at 514 lines lost A/B. Target ≤25 added lines, compress neighbors if needed.
- **Option 1+4 was designed but only partially shipped** — `1b3cf2c` landed the self-verify format and merge protocol; the subagent dispatch was deferred. The current work is effectively **completing Option 1+4 with a question-generation twist** — the 7-block prompt spec at `designs/.../hardening.md:131-150` is the directly reusable template.
- **Phantom references cleanup is costly** — `7b164dc` removed thoughts/searchable/ dangling refs across 6 skills + 1 agent. v1 must NOT ship a new persisted artifact type (`thoughts/shared/design-questions/`) without the corresponding write-plan reader, or phantom refs will land.
- **Write-plan is in `rpiv-skillbased`, not Pi yet**. Any change to `skills/write-plan/SKILL.md:26` extract list is a cross-repo edit. v1 avoids this entirely by not changing the write-plan contract.

## Historical Context (from thoughts/)

- `thoughts/shared/questions/2026-04-11_07-11-40_design-iterative-question-subagents.md` — the questions artifact feeding this research
- `thoughts/shared/designs/2026-04-09_12-38-44_option1-plus-option4-fill-quality-hardening.md` — the Option 1+4 precedent (subagent dispatch designed but only partially shipped; self-verify format + merge protocol landed in `1b3cf2c`, subagent dispatch deferred)
- `thoughts/shared/designs/2026-04-08_19-11-09_holistic-self-critique-loop.md` — Step 4 origin and general-prompts-not-checklists discipline; sub-numbering Decision 1
- `thoughts/shared/designs/2026-04-08_20-11-20_simplify-design-feature-iterative.md` — sibling simplification design showing compression norms
- `thoughts/shared/research/2026-04-10_13-45-00_complete-pi-migration.md` — confirms `pi.agents` package field is dead; only `.pi/agents/` is live; pi-subagents tool registry uses lowercase names
- `thoughts/shared/research/2026-04-09_10-28-07_large-file-generation-strategies.md` — referenced by Option 1+4 for the "Skeleton-of-Thought fails on coding tasks" ruling (applies to code generation, NOT question generation — parallelism remains open here)
- `thoughts/shared/questions/2026-04-11_10-40-21_todo-list-overlay-above-input.md` — reference example of question-artifact shape (frontmatter + Discovery Summary + dense paragraphs)

## Developer Context

**Q (`skills/design-feature-iterative/SKILL.md:88-122`): Which host placement for the new fan-out step — Step 2.5 insertion, replace Step 3, or Step 4.5 insertion?**
A: **Replace Step 3 in-place.** Zero numbering shift; Step 4 holistic self-critique at `:104-122` becomes the natural cross-dimension merge point; preserves all downstream line references at `:124/:184/:247/:294/:313`.

**Q (`extensions/rpiv-core/ask-user-question.ts:28-35` vs `skills/design-feature-iterative/SKILL.md:153`): How should v1 handle the single-question schema constraint and the question-persistence gap — self-prioritize to top-3 + fix line-153, new `thoughts/shared/design-questions/` artifact type, or new array-taking tool?**
A: **Self-prioritize to top-3 + fix line-153.** Each subagent returns top 1-2 questions per dimension; orchestrator picks global top 3-5 during Step 4 merge; delete the batching paragraph at `:153`; questions land in Developer Context as today. No new artifact type, no new tool. Durability deferred to v2.

**Q (`designs/2026-04-09_12-38-44_option1-plus-option4-fill-quality-hardening.md:75-77` vs named agent file): Which form for v1 — general-purpose with 7-block assembled prompt, reuse existing named subagents, or ship new `design-question-generator.md`?**
A: **General-purpose Agent with 7-block assembled prompt** (Option 1+4 precedent). No new files in `agents/` or `.pi/agents/`. Reuse-existing rejected for role contamination and output-format conflict. Named-agent rejected for cascade risk (`441ef08`→`5585727`→`b75f2aa` in 2 days, Pi runtime is 4 days old with no generator-class stress test).

**Q (`skills/design-feature-iterative/SKILL.md:104-122` holistic critique vs `designs/.../hardening.md:79-82` self-verify-in-subagent): Where should merge and Step 4 critique run — hybrid (local in subagent + cross-cutting in orchestrator), orchestrator-side pure, or meta-subagent?**
A: **Hybrid.** Each subagent runs `:114` requirement-coverage and `:116` pattern-coherence locally and returns compressed OK/VIOLATION shards per the `:272-277` Step 7b format. Orchestrator runs `:115` cross-cutting and `:117` ambiguity-completeness on the merged compressed set. Preserves `:119-122` reclassification authority in the orchestrator.

**Q (`skills/design-feature-iterative/SKILL.md:184-245` Step 6 vs `:247-311` Step 7; `:294` collision): Upfront only, both upfront + per-slice, or per-slice only?**
A: **Upfront only** (v1). Runs once pre-Step 6 as the Step 3 replacement. 1 fan-out not N. No `:294` collision. No prior-slices-summary dependency. Per-slice deferred to v2 pending A/B validation — matches Option 1+4's own phased implementation precedent at `designs/.../hardening.md:294-295`.

## Related Research

- Questions source: `thoughts/shared/questions/2026-04-11_07-11-40_design-iterative-question-subagents.md`
- Precedent design: `thoughts/shared/designs/2026-04-09_12-38-44_option1-plus-option4-fill-quality-hardening.md` (v1 effectively completes this design with a question-generation variant)
- Precedent design: `thoughts/shared/designs/2026-04-08_19-11-09_holistic-self-critique-loop.md` (establishes Step 4 critique and sub-numbering discipline)
- Pi migration context: `thoughts/shared/research/2026-04-10_13-45-00_complete-pi-migration.md`

## Open Questions

- **Backport to `design-feature` sibling**: the non-iterative sibling at `skills/design-feature/SKILL.md:88-102` has an identical Step 3 but NO Step 4 holistic critique (`:104-162` is the Developer Checkpoint directly). Replace-Step-3 ports the subagent dispatch mechanically but loses the hybrid merge's cross-cutting critique half — deferred, not part of v1.
- **Write-plan Pi port timing**: `skills/write-plan/SKILL.md` still lives in `rpiv-skillbased` only. The v1 design does not touch write-plan, but if per-slice dispatch ships in v2 and introduces a parseable STOP signal (e.g. design-questions artifact with `status: open`), the Pi port of write-plan becomes a dependency.
- **Per-slice question dispatch in v2**: if upfront A/B validates, per-slice can reuse the `:140-147` prior-slices-summary block verbatim, but the `:294` collision must be resolved explicitly (demote 7c to final go/no-go, or fire per-slice conditionally only when Step 4 flagged an unresolved interface ambiguity scoped to that slice). Not scoped for v1.
