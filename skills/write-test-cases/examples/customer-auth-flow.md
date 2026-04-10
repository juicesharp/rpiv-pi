---
id: TC-AUTH-001
title: "Customer magic-link login"
feature: "Customer Authentication"
priority: high
type: functional
status: draft
tags: ["auth", "login", "magic-link", "customer-portal", "happy-path"]
generated_at_commit: abc1234
---

# Customer magic-link login

## Objective
Verify that a customer can request a magic-link login email, click the link, and be authenticated into the Customer Portal with the correct session and permissions.

## Preconditions
- Customer account exists with email "test@example.com"
- Email delivery service is configured in test mode
- Customer is NOT currently logged in
- No active sessions exist for this customer

## Steps
| # | Action | Expected Result |
|---|--------|-----------------|
| 1 | Navigate to Customer Portal login page | Login form displays with email field and "Send Magic Link" button |
| 2 | Enter "test@example.com" in email field | Email field validates format, no error shown |
| 3 | Click "Send Magic Link" | Success message: "Check your email for a login link". Button disabled for 60s |
| 4 | Open email inbox and find magic-link email | Email received within 2 minutes with one-time login URL |
| 5 | Click the magic-link URL in the email | Browser opens, brief loading state, redirects to Customer Portal dashboard |
| 6 | Verify dashboard displays correctly | Customer name in header, recent orders listed, subscription status visible |
| 7 | Refresh the page | Session persists — dashboard still shows, not redirected to login |

## Postconditions
- Session token created and stored (verify via browser cookies/localStorage)
- Login event recorded in audit log with timestamp, IP address, and auth method "magic-link"
- Magic link marked as used — clicking same link again shows "Link expired" page
- Last login timestamp updated on customer record

## Edge Cases
- Expired magic link (>15 minutes old) — verify "Link expired, request a new one" message
- Already-used magic link — verify "Link already used" message
- Non-existent email address — verify same success message shown (no email enumeration)
- Multiple magic links requested — verify only the most recent link works
- Magic link opened in different browser/device — verify it still works

## Notes
- Related TCs: TC-AUTH-002 (logout), TC-AUTH-003 (session expiry)
- Dependencies: Email delivery service in test mode, ability to inspect test emails
- Known issues: Magic link emails may be delayed up to 2 minutes in test environments
