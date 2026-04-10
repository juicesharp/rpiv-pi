```markdown
---
feature: "{Feature Name}"
module: {MOD}
portal: {Portal Name}
slug: {feature-slug}
status: pending | partial | generated
generated: {YYYY-MM-DD}
git_commit: {commit-hash}
tc_count: 0
---

## Routes
- `{route path}` — {ComponentName}

## Endpoints
- `{HTTP method} {path}` — {description}

## Scope Decisions
- {What's in scope and why}
- {What's OUT of scope and why}

## Domain Context
- {Business rules, intentional behaviors, known limitations}

## Test Data Requirements
- {Minimum data conditions for testing this feature}

## Checkpoint History
### {YYYY-MM-DD}
**Q: {Question asked during checkpoint}**
A: {Developer's answer}
```

**Notes on `_meta.md` content:**
- Routes come from route discovery findings — path and component name only, no file:line
- Endpoints come from backend discovery, filtered to those serving this feature
- Scope Decisions, Domain Context, and Test Data Requirements come from checkpoint answers
- Checkpoint History records dated Q&A pairs from developer checkpoints
- If a feature has no frontend routes (e.g., widget), list the component entry point instead
- If status is "partial", add an `## Existing Test Cases` section listing TC IDs found by the test-case-locator agent
- git_commit records which commit was analyzed during outline generation — used for staleness detection by consuming skills
- tc_count starts at 0 and is updated by write-test-cases when TCs are created
