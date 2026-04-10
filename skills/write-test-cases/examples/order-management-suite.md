# Order Management — Regression Suite

## Overview
- Feature: Order Management
- Module: ORD
- Total test cases: 6
- Estimated execution: ~35 minutes
- Last generated: 2026-03-31
- Git commit: abc1234

## Smoke Test Subset
| Priority | TC ID | Title | Est. Time |
|----------|-------|-------|-----------|
| high | TC-ORD-001 | Place order with physical products | ~5m |
| high | TC-ORD-004 | Process full refund | ~5m |

**Smoke total: ~10 minutes**

## Full Regression

### High Priority
| TC ID | Title | Type | Est. Time |
|-------|-------|------|-----------|
| TC-ORD-001 | Place order with physical products | functional | ~5m |
| TC-ORD-003 | Fulfill order and trigger shipping | functional | ~8m |
| TC-ORD-004 | Process full refund | functional | ~5m |

### Medium Priority
| TC ID | Title | Type | Est. Time |
|-------|-------|------|-----------|
| TC-ORD-002 | Cancel order before fulfillment | functional | ~5m |
| TC-ORD-005 | Admin edits order line items | functional | ~5m |

### Low Priority
| TC ID | Title | Type | Est. Time |
|-------|-------|------|-----------|
| TC-ORD-006 | Filter and search order list | regression | ~3m |

**Full regression total: ~31 minutes**

## Coverage Map
| Area | TCs Covering |
|------|-------------|
| Order Creation | TC-ORD-001 |
| Order Cancellation | TC-ORD-002 |
| Fulfillment | TC-ORD-003 |
| Refunds | TC-ORD-004 |
| Order Editing | TC-ORD-005 |
| Order Listing/Search | TC-ORD-006 |
| Payment Processing | TC-ORD-001, TC-ORD-004 |
| Email Notifications | TC-ORD-001, TC-ORD-003, TC-ORD-004 |
| Inventory Updates | TC-ORD-001, TC-ORD-003, TC-ORD-004 |

## Gaps
- Bulk order import — no TC generated, feature not yet implemented
- Partial refund flow — deferred, pending UX design for line-item selection
- Order export to CSV — low priority, cosmetic feature
