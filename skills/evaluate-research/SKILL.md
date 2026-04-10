---
name: evaluate-research
description: A/B test two research documents by verifying claims against the actual codebase. Dispatches parallel agents to check file references, behavioral claims, completeness, and integration coverage. Produces evaluation reports in thoughts/shared/reviews/. Use when comparing research pipelines or assessing research quality.
argument-hint: "[path/to/research-A.md] [path/to/research-B.md]"
allowed-tools: Read, Bash(git *), Glob, Grep, Agent
---

## Git Context
- Branch: !`git branch --show-current 2>/dev/null || echo "no-branch (not a git repo)"`
- Commit: !`git rev-parse --short HEAD 2>/dev/null || echo "no-commit (not a git repo)"`

## Documents Under Evaluation
$ARGUMENTS

# Evaluate Research

You are tasked with evaluating research documents by automatically verifying their claims against the actual codebase. You dispatch parallel agents to check whether file paths exist, code descriptions are accurate, integration points are real, and the research question is fully answered.

**Modes:**
- **A/B comparison** (two paths): Verify both, score both, declare winner
- **Single evaluation** (one path): Verify and score one document, no comparison

## Initial Setup

If no arguments were provided, respond with:
```
Ready to evaluate research documents. Provide:
- Two paths for A/B comparison: `/evaluate-research path/to/A.md path/to/B.md`
- One path for single evaluation: `/evaluate-research path/to/A.md`

Documents must be research artifacts from thoughts/shared/research/.
```
Then wait for the user's input.

If arguments were provided, proceed to Step 1.

## Scoring Dimensions

Six dimensions, each scored 0-3 (18 total). Dimension 1 is a **gate** — score 0-1 fails the document regardless of total.

### Dimension 1: Reference Accuracy (GATE) — agent-verified

Are file:line references real? Do behavioral descriptions match what code actually does?

| Score | Criteria |
|---|---|
| 0 | >20% of file:line references are wrong OR a core finding contradicts actual code |
| 1 | 10-20% of references wrong OR a significant behavioral claim is inaccurate |
| 2 | <10% references have minor inaccuracies (line drift, renamed var) but all files exist and descriptions are directionally correct |
| 3 | All file:line references resolve correctly, all behavioral descriptions match the code |

**Gate rule**: Score 0 or 1 means the document is **not safe for downstream consumption** (design-feature, write-plan) regardless of total score.

### Dimension 2: Completeness — agent-verified

Did the research find all relevant code and fully answer its research question?

| Score | Criteria |
|---|---|
| 0 | Research question unanswered or majority of relevant components missed |
| 1 | Partially answered; several important files/components not discovered |
| 2 | Answered; most relevant code found but 1-2 significant areas missed |
| 3 | Fully answered; all relevant code, integration points, and context found |

### Dimension 3: Integration Coverage — agent-verified

Did the Integration Points section capture all connections?

| Score | Criteria |
|---|---|
| 0 | No Integration Points section or empty/trivial |
| 1 | Missing an entire category (Inbound/Outbound/Wiring) or <50% of connections |
| 2 | All three categories present, most connections found, 1-2 missed |
| 3 | Comprehensive; all connections verified; no significant gaps |

### Dimension 4: Compactness — orchestrator-computed

Is the document concise enough for efficient LLM consumption downstream?

| Score | Criteria |
|---|---|
| 0 | >500 lines, or raw agent output pasted without synthesis |
| 1 | 300-500 lines with significant redundancy between sections |
| 2 | 150-300 lines; minimal redundancy; some sections could be tighter |
| 3 | <150 lines; every line adds information; no cross-section duplication |

### Dimension 5: Actionability — orchestrator-computed

Can design-feature consume this without re-researching?

| Score | Criteria |
|---|---|
| 0 | No Code References or file paths; designer must search from scratch |
| 1 | Code References exist but lack line numbers or descriptions |
| 2 | Code References with line numbers; Architecture Insights present but generic |
| 3 | Complete jump-table (file:line-range + descriptions); concrete Architecture Insights; actionable Precedent warnings |

### Dimension 6: Developer Checkpoint Quality — orchestrator-computed

Were grounded questions asked that pulled new information?

| Score | Criteria |
|---|---|
| 0 | No Developer Context section or empty |
| 1 | Questions are generic or confirmatory ("Is this correct?") |
| 2 | Questions grounded with evidence but no file:line refs, or multi-part |
| 3 | Each question references file:line, asks one thing, pulls new information |

## Steps

### Step 1: Read and Parse Documents

1. Parse `$ARGUMENTS` for one or two `.md` file paths
2. Read each document FULLY (no limit/offset)
3. Verify each has research document structure (YAML frontmatter with `topic:`, `tags:`, `status:`)
4. Extract the research question from `## Research Question` section
5. In A/B mode: check if both documents answer the same research question — warn if topics differ significantly
6. Report:
   ```
   Evaluating:
   - Document A: [filename] — "[topic]" ([line count] lines)
   - Document B: [filename] — "[topic]" ([line count] lines)  (A/B mode only)
   - Research question: [extracted]
   ```

### Step 2: Extract Claims

For each document, extract claims into five categories by parsing the markdown structure:

**Category A — File References**: Every `path/to/file.ext:line` or `path/to/file.ext:startLine-endLine` from Code References, Integration Points, and Detailed Findings sections. Extract as tuples: `(path, line_or_range, description)`.

**Category B — Behavioral Claims**: Statements about what code does, how many lines/steps/components something has, what pattern is used. Prioritize claims from Summary and the first 3 Detailed Findings subsections. Cap at ~15 claims per document.

**Category C — Existence Claims**: Counts ("9 agent types", "285 lines"), architectural assertions.

**Category D — Connection Claims**: Everything in Integration Points — "X is consumed by Y", "Z depends on W".

**Category E — Historical References**: Paths to thoughts/ documents, git commit hashes, references to other research docs.

Report claim counts:
```
Claims extracted:
- Document A: [N] file refs, [M] behavioral, [K] connections, [J] historical
- Document B: [N] file refs, [M] behavioral, [K] connections, [J] historical
```

### Step 3: Dispatch Verification Agents

Spawn agents in parallel. All at once, in a single message with multiple Agent tool calls.

**For A/B mode (7 agents):**

1. **verify-refs-A** (`rpiv-next:codebase-locator`):
   ```
   Verify these file references exist in the codebase. For each:
   1. Check if the file path exists (use Glob)
   2. If exists, check total line count (use LS or Grep to estimate)
   3. Report: path, claimed_line, verdict (EXISTS / MISSING / LINE_OUT_OF_RANGE)

   References:
   [paste Category A claims from Document A]
   ```

2. **verify-refs-B** (`rpiv-next:codebase-locator`): Same prompt with Document B's Category A claims.

3. **verify-behavior-A** (`rpiv-next:codebase-analyzer`):
   ```
   For each claim below, read the referenced file and verify whether the description accurately describes what the code does. Report for each:
   - Verdict: CONFIRMED / INACCURATE / PARTIALLY_ACCURATE
   - One-line explanation

   Claims:
   [paste top ~15 Category B claims from Document A]
   ```

4. **verify-behavior-B** (`rpiv-next:codebase-analyzer`): Same prompt with Document B's Category B claims.

5. **completeness-baseline** (`rpiv-next:codebase-locator`):
   ```
   Search the codebase independently for ALL files relevant to this research question:
   "[paste research question]"

   Do NOT reference any existing research. Discover independently.
   Report all relevant files grouped by: implementation, configuration, tests, documentation, types/interfaces.
   ```

6. **integration-baseline** (`rpiv-next:integration-scanner`):
   ```
   Map all connections for these components: [main components from research question]
   Report: Inbound references, Outbound dependencies, Infrastructure wiring.
   ```

7. **verify-historical** (`rpiv-next:thoughts-locator`):
   ```
   Verify these document and commit references exist:
   [paste Category E claims from BOTH documents, deduplicated]
   For each: report EXISTS / MISSING.
   ```

**For single-document mode (5 agents):** Drop agents 2 and 4 (verify-refs-B, verify-behavior-B).

### Step 4: Collect and Compile Results

Wait for ALL agents to complete. Compile:

- **Reference accuracy rate** per document: `EXISTS count / total references`
- **Behavioral accuracy rate** per document: `CONFIRMED count / verified claims`
- **Completeness delta** per document: Files found by completeness-baseline but absent from document
- **Integration delta** per document: Connections found by integration-baseline but absent from document
- **Historical accuracy rate**: `EXISTS count / total historical references` (shared)

### Step 5: Score Agent-Verified Dimensions (1-3)

Apply the rubric from the Scoring Dimensions section above using the compiled rates:

**Dimension 1 (Reference Accuracy — GATE):**
- Combine reference accuracy rate and behavioral accuracy rate
- >95% refs valid AND >80% behavioral confirmed → 3
- >90% refs valid AND >70% behavioral confirmed → 2
- >80% refs valid OR >50% behavioral confirmed → 1
- Below → 0

**Dimension 2 (Completeness):**
- 0 files in completeness delta → 3
- 1-2 non-central files in delta → 2
- 3+ files or a central component missing → 1
- Majority of baseline files not in document → 0

**Dimension 3 (Integration Coverage):**
- 0 connections in integration delta → 3
- 1-2 connections missing, all categories present → 2
- Missing a category or >3 connections missing → 1
- No section or >50% missing → 0

### Step 6: Score Structural Dimensions (4-6)

These require no agents — compute directly from the documents.

**Dimension 4 (Compactness):**
- Count total lines per document
- Count references that appear identically in both Code References AND Detailed Findings (cross-section duplication)
- Apply rubric thresholds

**Dimension 5 (Actionability):**
- Count Code References entries that have both line numbers AND descriptions
- Check Architecture Insights section for concrete patterns (not generic statements)
- Check Precedents for actionable warnings (commands, checks, not just "be careful")
- Apply rubric thresholds

**Dimension 6 (Developer Checkpoint Quality):**
- Parse Developer Context section for Q&A pairs
- Count questions containing `file:line` or `:line` patterns
- Check for multi-part questions (questions with "and" joining two distinct concerns)
- Apply rubric thresholds

### Step 7: Write Evaluation Report

**Filename**: `thoughts/shared/reviews/YYYY-MM-DD_HH-MM-SS_evaluate-research-[topic-slug].md`

Write the report with this structure:

```markdown
---
date: [ISO datetime with timezone]
reviewer: Claude Code
repository: [repo name from git root]
branch: [from Git Context]
commit: [from Git Context]
review_type: research-evaluation
document_a: "[path to Doc A]"
document_b: "[path to Doc B]"  # omit in single mode
topic: "[shared research question]"
winner: "[A | B | tie]"  # omit in single mode
gate_pass_a: [true | false]
gate_pass_b: [true | false]  # omit in single mode
tags: [evaluate-research, ab-testing, relevant-tags]
last_updated: [YYYY-MM-DD]
last_updated_by: Claude Code
---

# Research Evaluation: [Topic]

## Test Setup
- **Research Question**: [question]
- **Document A**: [path] ([date from frontmatter], [line count] lines)
- **Document B**: [path] ([date from frontmatter], [line count] lines)
- **Evaluation Method**: Automated codebase verification via [N] parallel agents
- **Claims Verified**: [total across both docs]

## Scoring Summary

| Dimension | Doc A | Doc B | Method |
|---|---|---|---|
| 1. **Reference Accuracy (GATE)** | **N/3** | **N/3** | codebase-locator + codebase-analyzer |
| 2. Completeness | N/3 | N/3 | Independent codebase-locator baseline |
| 3. Integration Coverage | N/3 | N/3 | Independent integration-scanner baseline |
| 4. Compactness | N/3 | N/3 | Line count + duplication analysis |
| 5. Actionability | N/3 | N/3 | Code References structure analysis |
| 6. Developer Checkpoint | N/3 | N/3 | Developer Context section parsing |
| **Total** | **N/18** | **N/18** | |

**Gate**: Doc A [PASS/FAIL], Doc B [PASS/FAIL]
**Winner**: [A/B/tie] ([margin]-point difference)

## Dimension Details

### Dim 1: Reference Accuracy (GATE)

**Document A**: [X/Y] file refs valid, [M/N] behavioral claims confirmed
Failures:
- `path:line` — MISSING: [explanation]
- "claim text" — INACCURATE: [what code actually does]

**Document B**: [X/Y] file refs valid, [M/N] behavioral claims confirmed
Failures:
- [list]

### Dim 2: Completeness

**Baseline found**: [N] files across [M] categories.

**Missing from A**: [list with relevance explanation]
**Missing from B**: [list]

### Dim 3: Integration Coverage

**Baseline found**: [N] inbound, [M] outbound, [K] wiring.

**Missing from A**: [list]
**Missing from B**: [list]

### Dim 4: Compactness

| Metric | Doc A | Doc B |
|---|---|---|
| Total lines | N | N |
| Code Ref entries | N | N |
| Cross-section duplicates | N | N |

### Dim 5: Actionability

| Metric | Doc A | Doc B |
|---|---|---|
| Code Refs with line numbers | N/M | N/M |
| Concrete Architecture Insights | N | N |
| Actionable Precedent warnings | N | N |

### Dim 6: Developer Checkpoint

| Metric | Doc A | Doc B |
|---|---|---|
| Q&A pairs | N | N |
| Questions with file:line | N | N |
| Multi-part questions (penalty) | N | N |

## Qualitative Assessment

### Information Unique to Each
- **In A, not B**: [list]
- **In B, not A**: [list]

### Downstream Impact
- **Document A**: [readiness assessment for design-feature]
- **Document B**: [readiness assessment]

## Improvement Recommendations

### Document A
- [specific fix based on verification failures]

### Document B
- [specific fix]
```

For **single-document mode**: Remove all Doc B columns and comparison rows. Replace winner/comparison with a standalone quality verdict: READY / NEEDS_FIXES / UNRELIABLE.

### Step 8: Present Results

Show a concise summary:
```
## Evaluation Complete

| Dimension | Doc A | Doc B |
|---|---|---|
| Reference Accuracy (GATE) | N/3 ✓ | N/3 ✗ |
| ... | ... | ... |
| **Total** | **N/18** | **N/18** |

Winner: Document [A/B] by [N] points.

Key differentiators:
- [most impactful dimension difference]
- [second most impactful]

Full report: [path to report file]
```

## Important Notes

- **File reading**: Read both documents FULLY (no limit/offset) before any claim extraction
- **Critical ordering**: Follow the numbered steps exactly
  - ALWAYS read documents first (step 1)
  - ALWAYS extract claims before dispatching agents (step 2 before step 3)
  - ALWAYS wait for ALL agents before scoring (step 4 before step 5)
  - ALWAYS write the report before presenting results (step 7 before step 8)
- **Agent isolation**: Each agent works independently — provide complete claim lists and context in the prompt, not references to "the document"
- **Behavioral sampling**: Cap at ~15 behavioral claims per document. Prioritize claims from Summary and early Detailed Findings. Note in the report which claims were verified vs. unchecked
- **Conservative extraction**: Only extract claims you can parse with confidence from markdown structure. Do not try to NLP-parse every sentence
- **No developer checkpoint**: This is an evaluation skill. The report is the deliverable
- **Threshold calibration**: The numeric thresholds for scoring (>95%, >90%, etc.) are starting points. Note in the report if a score falls near a threshold boundary
