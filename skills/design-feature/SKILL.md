---
name: design-feature
description: Design how code will be shaped through interactive architectural collaboration. Resolves ambiguities, fixes decisions, and produces design artifacts with full implementation code in thoughts/shared/designs/. Use after research-codebase (or research-questions → research) or standalone for well-understood areas.
argument-hint: [research artifact path or feature description]
---

## Git Context
- Branch: !`git branch --show-current 2>/dev/null || echo "no-branch (not a git repo)"`
- Commit: !`git rev-parse --short HEAD 2>/dev/null || echo "no-commit (not a git repo)"`

## Task Input
$ARGUMENTS

# Design Feature

You are tasked with designing how code will be shaped for a feature or change. You resolve ambiguities through interactive developer checkpoints, fix architectural decisions, and produce a design artifact containing full implementation code. The design artifact feeds directly into write-plan, which sequences it into phases.

## Step 1: Input Handling

When this command is invoked:

1. **Determine input mode**:

   **Chained mode** (argument is a path to a `.md` file in `thoughts/`):
   - Read the research artifact FULLY using the Read tool WITHOUT limit/offset
   - Extract: Summary, Code References, Integration Points, Architecture Insights, Developer Context, Open Questions
   - **Read the key source files from Code References** into the main context — especially hooks, shared utilities, and integration points the design will depend on. Read them FULLY. This ensures you have complete understanding before proceeding.
   - These become starting context — no need to re-discover what exists
   - Note any Open Questions from the research — these are your first ambiguities

   **Standalone mode** (argument is a feature description):
   - Will do own targeted research in Step 2
   - Respond with:
   ```
   I'll design the architecture for this feature. Let me research the relevant
   patterns and integration points first.
   ```

   **No arguments provided**:
   ```
   I'll help you design a feature's architecture. Please provide either:
   1. A research artifact path: `/rpiv-next:design-feature thoughts/shared/research/2025-01-20_file.md`
   2. A feature description: `/rpiv-next:design-feature Add notification toast system using existing Zustand + HeadlessUI patterns`

   Chained mode (with research) produces better designs for complex or unfamiliar areas.
   Standalone mode works well when you already know the area.
   ```
   Then wait for input.

2. **Read any additional files mentioned** — tickets, related designs, existing implementations. Read them FULLY before proceeding.

## Step 2: Targeted Research

This is NOT research-codebase. Focus on DEPTH (how things work, what patterns to follow) not BREADTH (where things are).

1. **Spawn parallel research agents** using the Agent tool:

   **Chained mode** (research artifact provided — files already located):
   - Use **rpiv-next:codebase-pattern-finder** to find existing implementations to model after — the primary template for code shape
   - Use **rpiv-next:codebase-analyzer** to understand HOW integration points work in detail
   - Use **rpiv-next:integration-scanner** to map the wiring surface — inbound refs, outbound deps, config/DI/event registration
   - Use **rpiv-next:precedent-locator** to find similar past changes in git history — what commits introduced comparable features, what broke, and what lessons apply to this design

   **Standalone mode** (no prior research — need initial discovery):
   - Use **rpiv-next:codebase-locator** to find relevant files and components first
   - Use **rpiv-next:thoughts-locator** to find existing research, decisions, or plans in thoughts/ about this feature area
   - Then spawn the same depth agents as chained mode (codebase-pattern-finder, codebase-analyzer, integration-scanner, precedent-locator)

   **Novel work** (new libraries, first-time patterns, no existing codebase precedent):
   - Add **rpiv-next:web-search-researcher** for external documentation, API references, and community patterns
   - Instruct it to return LINKS with findings — include those links in the final design artifact

   Agent prompts should focus on:
   - "Find the implementation pattern I should model after for [feature type]"
   - "How does [integration point] work in detail — show me the wiring"
   - "What connects to [component] — inbound refs, outbound deps, config"

   NOT: "Find all files related to X" — that's research-codebase's job.

2. **Read all key files identified by agents** into the main context — especially the pattern templates you'll model after.

3. **Wait for ALL agents to complete** before proceeding.

4. **Analyze and verify understanding**:
   - Cross-reference research findings with actual code read in Step 1
   - Identify any discrepancies or misunderstandings
   - Note assumptions that need verification
   - Determine true scope based on codebase reality

## Step 3: Identify Ambiguities

Synthesize agent findings and identify what needs human decision. Categorize each ambiguity:

- **Pattern conflict**: existing code uses pattern A in one place, pattern B in another — which to follow?
- **Missing pattern**: no existing implementation to model after — need to design from scratch
- **Scope boundary**: what's in this feature vs deferred to future work?
- **Integration choice**: multiple valid places to wire in — which one?
- **Novel approach**: new library/technique — which option fits the project architecture?

**Simple decisions** (clear single pattern, one valid option, obvious from codebase) resolve silently — do not ask the developer about these. Record them directly in the Decisions section with evidence.

**Genuine ambiguities** (multiple valid options, conflicting patterns, scope questions, novel choices) become checkpoint questions in Step 4.

**Pre-validate options before presenting them**: Check every option against research constraints and the runtime behavior of code in context. If an option models after an existing pattern, verify the pattern works under the new code's conditions (e.g., conditional mounting, async state). Eliminate options that violate constraints, or present them with an explicit caveat stating the violation. Do not offer choices that contradict evidence from Steps 1-2.

## Step 4: Developer Checkpoint

Use the grounded-questions-one-at-a-time pattern. Use a **❓ Question:** prefix so the developer knows their input is needed. Each question must:
- Reference real findings with `file:line` evidence
- Present concrete options (not abstract choices)
- Pull a DECISION from the developer, not confirm what you already found

**Question patterns by ambiguity type:**

- **Pattern conflict**: "Found 2 patterns for [X]: [pattern A] at `file:line` and [pattern B] at `file:line`. They differ in [specific way]. Which should the new [feature] follow?"
- **Missing pattern**: "No existing [pattern type] in the codebase. Options: (A) [approach] modeled after [external reference], (B) [approach] extending [existing code at file:line]. Which fits the project's direction?"
- **Scope boundary**: "The [research/description] mentions both [feature A] and [feature B]. Should this design cover both, or just [feature A] with [feature B] deferred?"
- **Integration choice**: "[Feature] can wire into [point A] at `file:line` or [point B] at `file:line`. [Point A] matches the [existing pattern] pattern. Agree, or prefer [point B]?"
- **Novel approach**: "No existing [X] in the project. Options: (A) [library/pattern] — [evidence/rationale], (B) [library/pattern] — [evidence/rationale]. Which fits?"

**Critical rules:**
- Ask ONE question at a time. Wait for the answer before asking the next.
- Lead with the most architecturally significant ambiguity.
- Every answer becomes a FIXED decision — no revisiting unless the developer explicitly asks.

**Choosing question format:**

- **AskUserQuestion** — when your question has 2-4 concrete options from code analysis (pattern conflicts, integration choices, scope boundaries, priority overrides). The user can always pick "Other" for free-text. Example:

      AskUserQuestion:
        questions:
          - question: "Found 2 mapping approaches — which should new code follow?"
            header: "Pattern"
            multiSelect: false
            options:
              - label: "Manual mapping (Recommended)"
                description: "Used in OrderService (src/services/OrderService.ts:45) — 8 occurrences"
              - label: "AutoMapper"
                description: "Used in UserService (src/services/UserService.ts:12) — 2 occurrences"

- **Free-text with ❓ Question: prefix** — when the question is open-ended and options can't be predicted (discovery, "what am I missing?", corrections). Example:
  "❓ Question: Integration scanner found no background job registration for this area. Is that expected, or is there async processing I'm not seeing?"

**Batching**: When you have 2-4 independent questions (answers don't depend on each other), you MAY batch them in a single AskUserQuestion call. Keep dependent questions sequential.

**Classify each response:**

**Decision** (e.g., "use pattern A", "yes, follow that approach"):
- Record in Developer Context. Fix in Decisions section.

**Correction** (e.g., "no, there's a third option you missed", "check the events module"):
- Spawn targeted rescan: **rpiv-next:codebase-analyzer** on the new area (max 1-2 agents).
- Merge results. Update ambiguity assessment.

**Scope adjustment** (e.g., "skip the UI, backend only", "include tests"):
- Record in Developer Context. Adjust scope.

**After all ambiguities are resolved**, present a brief design summary (under 15 lines):

```
Design: [feature name]
Approach: [1-2 sentence summary of chosen architecture]

Decisions:
- [Decision 1]: [choice] — modeled after `file:line`
- [Decision 2]: [choice]
- [Decision 3]: [choice]

Scope: [what's in] | Not building: [what's out]
Files: [N] new, [M] modified
```

Use **AskUserQuestion** to confirm before proceeding:

```
questions:
  - question: "[Summary from design brief above]. Ready to proceed to the design document?"
    header: "Design"
    multiSelect: false
    options:
      - label: "Proceed (Recommended)"
        description: "Write the full design document with architecture code"
      - label: "Adjust decisions"
        description: "Revisit one or more architectural decisions above"
      - label: "Change scope"
        description: "Add or remove items from the building/not-building lists"
```

## Step 5: Produce Architecture Code

This is the core deliverable — write FULL implementation code for every component in the design.

1. **For each new file**:
   - Write complete code: imports, types, interfaces, implementation, exports
   - Follow the pattern template identified in Step 2
   - Include inline comments only where logic isn't self-evident

2. **For each modified file**:
   - Read the current file FULLY into context first
   - Show the current code being changed
   - Write the modified version
   - If the change is small (adding an import, a single line), show just the relevant section

3. **For test files** (when the feature warrants tests):
   - Write complete test suites following the project's testing patterns
   - Include setup/teardown, happy path, edge cases
   - Use the same test framework and patterns found in the codebase

4. **For integration/wiring**:
   - Show where new code hooks into existing code (route registration, DI, event subscription, component mounting)
   - Include the exact wiring code
   - When a constraint or workaround is discovered for one target, check all other targets for the same condition

5. **If additional context is needed** to write accurate code for a file:
   - Spawn a targeted **rpiv-next:codebase-analyzer** agent to read and understand the file
   - Wait for the result before writing the modified version

**The code must be copy-pasteable** by implement-plan. No pseudocode, no TODOs, no "// implement here" placeholders. If you can't write complete code for a section, that's a signal an ambiguity wasn't resolved — go back to the developer checkpoint.

6. **Carry forward research warnings**: If the research artifact contains Precedents & Lessons or verification warnings (e.g., "test production builds after CSS changes"), carry them into the Verification Notes section of the design artifact — create-plan needs these for success criteria.

7. **Cross-check architecture against research constraints**: Re-read the research artifact's warnings and precedents. Verify the code above satisfies each one. If any constraint is violated: revise the code, or return to Step 4 with the conflict stated explicitly.

## Step 6: Write Design Artifact

1. **Determine metadata**:
   - Filename: `thoughts/shared/designs/YYYY-MM-DD_HH-MM-SS_topic.md`
     - YYYY-MM-DD_HH-MM-SS: Current date and time
     - topic: Brief kebab-case description
   - Repository name: from git root basename, or current directory basename if not a git repo
   - Use the git branch and commit from the "Git Context" section above
   - Designer: "Claude Code"
   - If metadata unavailable: use "unknown" for commit/branch

2. **Write the design document** using this template:

   ```markdown
   ---
   date: [Current date and time with timezone in ISO format]
   designer: [Designer name]
   git_commit: [Current commit hash]
   branch: [Current branch name]
   repository: [Repository name]
   topic: "[Feature/Change Name]"
   tags: [design, relevant-component-names]
   status: complete
   research_source: "[path to research artifact, or 'standalone']"
   last_updated: [Current date in YYYY-MM-DD format]
   last_updated_by: [Designer name]
   ---

   # Design: [Feature/Change Name]

   ## Summary
   [2-3 sentences: what we're building and the chosen architectural approach. This is the settled decision, not a discussion.]

   ## Requirements
   [What the feature must do. Bullet list from ticket, research, or developer input.]
   - [Requirement 1]
   - [Requirement 2]

   ## Current State Analysis

   [What exists now, what's missing, key constraints discovered]

   ### Key Discoveries:
   - [Important finding with file:line reference]
   - [Pattern to follow]
   - [Constraint to work within]

   ## Scope
   ### Building
   - [Concrete deliverable 1]
   - [Concrete deliverable 2]

   ### Not Building
   [Include developer-stated exclusions AND likely scope-creep vectors from codebase context — alternative architectures not chosen, nearby code that looks related but shouldn't be touched, parameter/algorithm tuning.]
   - [Explicit exclusion 1] — [brief why]
   - [Explicit exclusion 2] — [brief why]

   ## Decisions

   ### [Decision 1: e.g., "Data access pattern"]
   **Ambiguity**: [What was unclear or in conflict]
   **Explored**:
   - Option A: [approach] — `file:line` — [pro/con]
   - Option B: [approach] — `file:line` — [pro/con]
   **Decision**: [Chosen option + rationale]

   ### [Decision 2: e.g., "Where to mount component"]
   **Decision**: [Simple decisions skip Ambiguity/Explored — just state the decision with evidence]

   ## Architecture

   ### `path/to/new-file.ext` — NEW
   [One-line purpose]
   ```[language]
   [Full implementation code — imports, types, logic, exports]
   ```

   ### `path/to/existing-file.ext:line-range` — MODIFY
   **Current**:
   ```[language]
   [existing code being changed]
   ```
   **After**:
   ```[language]
   [modified code]
   ```

   ### `path/to/test-file.test.ext` — NEW
   ```[language]
   [Full test code — setup, cases, teardown]
   ```

   ## Desired End State
   [Usage examples showing how the feature works when complete]
   ```[language]
   [Concrete code showing the API/feature in use from a consumer's perspective]
   ```

   ## File Map
   ```
   path/to/new-file.ext           # NEW — purpose
   path/to/other-file.ext         # NEW — purpose
   path/to/existing-file.ext      # MODIFY — what changes
   path/to/test-file.test.ext     # NEW — what it tests
   ```

   ## Ordering Constraints
   - [What must come before what — e.g., "types before implementations"]
   - [What can run in parallel — e.g., "UI and API layers independent after types defined"]

   ## Verification Notes
   [Carry forward from research: known risks, build/test warnings, precedent lessons.
   Format as verifiable checks where possible — commands, grep patterns, visual inspection steps.
   create-plan converts these directly into success criteria. Empty if none.]

   ## Performance Considerations

   [Any performance implications or optimizations needed]

   ## Migration Notes

   [If applicable: how to handle existing data, schema changes, rollback strategy, backwards compatibility during transition. Empty if not applicable.]

   ## Pattern References
   - `path/to/similar.ext:line-range` — [what pattern to follow and why]

   ## Developer Context
   [Record questions exactly as asked during checkpoint, including file:line evidence]
   **Q: [Question with `file:line` evidence]**
   A: [Developer's answer]

   **Q: [Question with `file:line` evidence]**
   A: [Developer's answer]

   ## References
   - Research: `thoughts/shared/research/[file].md`
   - Ticket: `thoughts/me/tickets/[file].md`
   - Similar implementation: `path/to/file.ext:line`
   ```

## Step 7: Review & Iterate

1. **Present the design artifact location**:
   ```
   Design artifact written to:
   `thoughts/shared/designs/[filename].md`

   [N] architectural decisions fixed, [M] new files designed, [K] existing files modified.

   Please review and let me know:
   - Are the architectural decisions correct?
   - Does the code match what you envision?
   - Any missing integration points or edge cases?

   When ready, run `/rpiv-next:write-plan thoughts/shared/designs/[filename].md` to sequence into phases.
   ```

2. **Handle follow-up changes**:
   - Use the Edit tool to update the design artifact in-place
   - Update frontmatter: `last_updated` and `last_updated_by`
   - Add `last_updated_note: "Updated [brief description]"` to frontmatter
   - If the change affects decisions, update both the Decisions section AND the Architecture code
   - If new ambiguities arise, return to Step 4 (developer checkpoint)

## Guidelines

1. **Be Architectural**: Design shapes code; plans sequence work. Every decision must be grounded in `file:line` evidence from the actual codebase.

2. **Be Interactive**: Don't produce the full design in one shot. Resolve ambiguities through the checkpoint first, get buy-in on the approach, THEN write code.

3. **Be Complete**: Code in the Architecture section must be copy-pasteable by implement-plan. No pseudocode, no TODOs, no "implement here" placeholders. If you can't write complete code, an ambiguity wasn't resolved.

4. **Be Skeptical**: Question vague requirements. If an existing pattern doesn't fit the new feature, say so and propose alternatives. Don't force a pattern where it doesn't belong.

5. **Resolve Everything**: No unresolved questions in the final artifact. If something is ambiguous, ask during the checkpoint. The design must be complete enough that create-plan can mechanically decompose it into phases.

6. **Track Progress**: Use TaskCreate/TaskUpdate to track design tasks, especially for complex multi-component designs.

## Agent Usage

| Mode | Agents Spawned |
|---|---|
| Chained (research artifact provided) | codebase-pattern-finder, codebase-analyzer, integration-scanner, precedent-locator |
| Standalone (no prior research) | + codebase-locator, thoughts-locator |
| Novel work (new library/pattern) | + web-search-researcher |
| During code writing (if needed) | targeted codebase-analyzer for specific files |

Spawn multiple agents in parallel when they're searching for different things. Each agent runs in isolation — provide complete context in the prompt, including specific directory paths when the feature targets a known module. Don't write detailed prompts about HOW to search — just tell it what you're looking for and where.

## Important Notes

- **File reading**: Always read research artifacts and referenced files FULLY (no limit/offset) before spawning agents
- **Critical ordering**: Follow the numbered steps exactly
  - ALWAYS read input files first (Step 1) before spawning agents (Step 2)
  - ALWAYS wait for all agents to complete before identifying ambiguities (Step 3)
  - ALWAYS resolve all ambiguities (Step 4) before producing the design document (Step 5-6)
  - ALWAYS gather metadata before writing the document (Step 6)
  - NEVER write the design document with placeholder values
- NEVER skip the developer checkpoint — developer input on architectural decisions is the highest-value signal in the design process
- NEVER edit source files — all code goes into the design document, not the codebase. This skill produces a document, not implementation. Source file editing is implement-plan's job.
- **Code is source of truth** — if the Architecture code section conflicts with the Decisions prose, the code wins. Update the prose.
- **Frontmatter consistency**: Always include frontmatter, use snake_case for multi-word fields, keep tags relevant
- CC auto-loads CLAUDE.md files when agents read files in a directory — no need to scan for them explicitly

## Common Design Patterns

### New Features
- Research existing patterns first (or receive from research artifact)
- Start with data model / types
- Design backend logic and data access
- Design API surface / service layer
- Design UI components last
- Include tests alongside each implementation

### Modifications to Existing Code
- Read the current file FULLY before designing changes
- Show current → modified (before/after) for every change
- Identify all files affected by the change
- Check integration points for side effects

### Database Changes
- Start with schema/migration design
- Design store/repository methods
- Design business logic and validation
- Design API surface / service layer
- Design client updates last
- Include rollback strategy in Migration Notes

### Refactoring
- Document current behavior before designing changes
- Plan incremental changes that maintain backwards compatibility
- Include migration strategy for data and consumers
- Design verification that existing behavior is preserved

### Novel Work (no existing pattern)
- Always include approach comparison in Decisions section
- Ground every option in codebase evidence OR external web research
- Get explicit developer sign-off on approach BEFORE writing code
- Document external references (library docs, API specs) in References section
