```markdown
---
id: TC-{MODULE}-{NNN}
title: "{flow description}"
feature: "{feature name}"
priority: high|medium|low
type: functional|regression|smoke|e2e|edge-case
status: draft
tags: ["{tag1}", "{tag2}"]
generated_at_commit: {commit-hash}
---

# {Title}

## Objective
{What this test verifies — 1-2 sentences describing the user goal and what the test proves}

## Preconditions
- {User role and permissions required}
- {System state required before starting — e.g., "at least one product exists in catalog"}
- {Test data requirements — e.g., "valid credit card in Stripe test mode"}
- {Navigation starting point — e.g., "user is logged into Admin portal"}

## Steps
| # | Action | Expected Result |
|---|--------|-----------------|
| 1 | {user action — Navigate to, Click, Enter, Select, Submit} | {observable outcome — page loads, form appears, message displays} |
| 2 | {next user action} | {what user sees or what changes} |
| 3 | {next user action} | {confirmation, redirect, updated state} |

## Postconditions
{Side effects to verify AFTER the flow completes — sourced from domain events and integration points}
- {e.g., "Order confirmation email sent to customer email address"}
- {e.g., "Inventory quantity decremented for purchased items"}
- {e.g., "Audit log entry created with action 'order.created'"}

## Edge Cases
{Variant scenarios worth separate attention — each could become its own TC if important enough}
- {e.g., "Order with mixed digital and physical products"}
- {e.g., "Payment fails after order created — verify rollback"}

## Notes
- Related TCs: {cross-references to other TCs in this module}
- Dependencies: {external system dependencies — payment gateway, email service}
- Known issues: {documented bugs or limitations affecting this flow}
```

**Frontmatter fields** align with what `test-case-locator` greps for (`id`, `title`, `priority`, `status`, `type`, `tags`). Always populate all fields — the locator agent extracts them for coverage reporting. The `generated_at_commit` field tracks which code version was analyzed to produce this TC — used for staleness detection on regeneration.

**Steps table rules:**
- Actions use imperative verbs from the user's perspective: Navigate, Click, Enter, Select, Submit, Drag, Upload, Scroll
- Expected results describe what the user OBSERVES — visible UI changes, messages, redirects — not internal state
- Keep each row to one atomic action. Multi-step actions (fill form -> submit) split into separate rows
- Number steps sequentially — branching flows (if X then Y) become separate TCs

**Postconditions sourced from:**
- Domain events (e.g., `OrderCreatedEvent` -> "confirmation email sent")
- Message handlers (e.g., `InventoryReservationHandler` -> "inventory reserved")
- Webhook dispatches (e.g., `FulfillmentWebhookPublisher` -> "fulfillment notified")
- Audit log entries, cache invalidations, CRM syncs

**Priority definitions:**
- **high**: Core happy path, payment/money flows, data integrity, security-critical
- **medium**: Alternative paths, common edge cases, permission boundaries
- **low**: Rare edge cases, cosmetic validation, error message wording
