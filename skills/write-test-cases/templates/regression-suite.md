```markdown
# {Feature Name} — Regression Suite

## Overview
- Feature: {feature name}
- Module: {module abbreviation}
- Total test cases: {N}
- Estimated execution: ~{X} minutes
- Last generated: {YYYY-MM-DD}
- Git commit: {commit-hash}

## Smoke Test Subset
{Minimum set of TCs that cover critical paths — run these for quick sanity checks}

| Priority | TC ID | Title | Est. Time |
|----------|-------|-------|-----------|
| high | TC-{MOD}-{NNN} | {title} | ~{N}m |

**Smoke total: ~{X} minutes**

## Full Regression

### High Priority
| TC ID | Title | Type | Est. Time |
|-------|-------|------|-----------|
| TC-{MOD}-{NNN} | {title} | {type} | ~{N}m |

### Medium Priority
| TC ID | Title | Type | Est. Time |
|-------|-------|------|-----------|
| TC-{MOD}-{NNN} | {title} | {type} | ~{N}m |

### Low Priority
| TC ID | Title | Type | Est. Time |
|-------|-------|------|-----------|
| TC-{MOD}-{NNN} | {title} | {type} | ~{N}m |

**Full regression total: ~{X} minutes**

## Coverage Map
{Which areas of the feature each TC exercises}

| Area | TCs Covering |
|------|-------------|
| {sub-area} | TC-{MOD}-001, TC-{MOD}-003 |

## Gaps
{Areas of the feature NOT covered by any test case — flagged for future work}
- {uncovered area — reason}
```

**Smoke test subset** picks TCs that cover the highest-risk paths in minimum time. Typically 2-4 TCs per feature. A QA tester should be able to run the smoke suite in under 15 minutes.

**Execution time estimates** based on step count:
- Simple flow (3-5 steps): ~3 minutes
- Medium flow (6-10 steps): ~5 minutes
- Complex flow (11+ steps): ~8-10 minutes

**Coverage map** cross-references TCs against feature sub-areas. Helps QA identify which TCs to re-run when a specific area changes. Sub-areas are derived from Web Layer entry points discovered during analysis.

**Gaps section** flags areas the skill identified but chose not to generate TCs for — either explicitly excluded during checkpoint or insufficient code detail for generation.

**Git commit** tracks which code version was analyzed. Compare against current HEAD to detect when regression suite may be stale.
