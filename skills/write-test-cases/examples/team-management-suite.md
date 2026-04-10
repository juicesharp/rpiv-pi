# Team Management — Regression Suite

## Overview
- Feature: Team Management
- Module: TEAM
- Total test cases: 5
- Estimated execution: ~28 minutes
- Last generated: 2026-04-01
- Git commit: abc1234

## Smoke Test Subset
| Priority | TC ID | Title | Est. Time |
|----------|-------|-------|-----------|
| high | TC-TEAM-001 | Invite and onboard new team member | ~5m |
| high | TC-TEAM-003 | Deactivate team member | ~5m |

**Smoke total: ~10 minutes**

## Full Regression

### High Priority
| TC ID | Title | Type | Est. Time |
|-------|-------|------|-----------|
| TC-TEAM-001 | Invite and onboard new team member | functional | ~5m |
| TC-TEAM-003 | Deactivate team member | functional | ~5m |

### Medium Priority
| TC ID | Title | Type | Est. Time |
|-------|-------|------|-----------|
| TC-TEAM-002 | Change member role | functional | ~5m |
| TC-TEAM-004 | Manage team member permissions | functional | ~5m |

### Low Priority
| TC ID | Title | Type | Est. Time |
|-------|-------|------|-----------|
| TC-TEAM-005 | Filter and search team member list | regression | ~3m |

**Full regression total: ~23 minutes**

## Coverage Map
| Area | TCs Covering |
|------|-------------|
| Invitation Flow | TC-TEAM-001 |
| Role Management | TC-TEAM-002 |
| Member Deactivation | TC-TEAM-003 |
| Permission Configuration | TC-TEAM-002, TC-TEAM-004 |
| Member Listing/Search | TC-TEAM-005 |
| Audit Logging | TC-TEAM-001, TC-TEAM-003 |
| Email Notifications | TC-TEAM-001, TC-TEAM-003 |

## Gaps
- Bulk member import via CSV — feature exists but UI is in beta, deferred
- SSO/SAML integration — separate authentication feature, not team management
- Member activity reporting — read-only dashboard, low testing value
