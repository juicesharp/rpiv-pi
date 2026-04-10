```markdown
# {Project Name} — Test Case Coverage Map

## Overview
- Project: {project name}
- Total features: {N} covered
- Total test cases: {N}
- Estimated full regression: ~{X} minutes
- Last updated: {YYYY-MM-DD}
- Git commit: {commit-hash}

## Portal Summary

### {Portal Name} ({N} features, {M} TCs, ~{X}m)
| Feature | Module | TCs | High | Med | Low | Smoke | Est. Time |
|---------|--------|-----|------|-----|-----|-------|-----------|
| {Feature Name} | {MOD} | {N} | {h} | {m} | {l} | {smoke count} | ~{X}m |

## Project-Wide Smoke Suite
{Minimum TCs across ALL features for quick project-level sanity check}

| Portal | TC ID | Feature | Title | Est. Time |
|--------|-------|---------|-------|-----------|
| {portal} | TC-{MOD}-{NNN} | {feature} | {title} | ~{N}m |

**Project smoke total: ~{X} minutes**

## Cross-Feature Coverage
{Areas that span multiple features — verify these when cross-cutting changes are made}

| Cross-Cutting Area | Features Involved | TCs Covering |
|-------------------|-------------------|-------------|
| {e.g., Payment Processing} | {Order Mgmt, Invoice Mgmt} | TC-ORD-001, TC-INV-003 |

## Priority Distribution
| Priority | Count | Percentage |
|----------|-------|-----------|
| High | {N} | {X}% |
| Medium | {N} | {X}% |
| Low | {N} | {X}% |

## Uncovered Areas
{Features or sub-areas without test cases — flagged for future work}
- {uncovered area} — {reason: not yet generated / out of scope / deferred}

## Phantom Features (Backend-Only)
{Backend endpoints with no frontend exposure — skipped during generation. Populated from _meta.md data when available.}
- {controller/endpoint group} — {reason: platform API / webhook / deprecated / sub-service}

## Test Data Requirements
{Aggregate test data needs across all features. Populated from _meta.md Test Data Requirements sections when available.}
- {e.g., "Stripe test mode with valid API keys (Order Mgmt, Invoice Mgmt)"}
- {e.g., "At least 2 published products with inventory (Order Mgmt, Product Mgmt)"}
```

**Portal Summary** groups features by application/portal for QA team assignment. Each portal section includes aggregate stats. Portal names come from `_meta.md` `portal` field when available, or default to "General" when features were generated in standalone mode.

**Project-Wide Smoke Suite** selects the highest-priority TCs from each feature's smoke subset — typically 1-2 per feature. A QA tester should be able to run the project smoke suite in under 30 minutes.

**Cross-Feature Coverage** identifies shared concerns (payment, email, auth, inventory) and which TCs from different features exercise them. Useful when a cross-cutting change is made — QA knows exactly which TCs to re-run. Built by scanning postconditions across all regression suites for shared keywords.

**Phantom Features** documents what was NOT covered and why. Populated from `_meta.md` data (pipeline mode). In standalone mode, populated from phantom detection results. If no phantom data is available, omit this section.

**Test Data Requirements** consolidates prerequisites across all features so QA can set up a test environment once. Populated from `_meta.md` `## Test Data Requirements` sections. If no _meta.md data is available, omit this section.
