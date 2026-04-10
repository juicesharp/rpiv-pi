---
id: TC-TEAM-001
title: "Invite and onboard new team member"
feature: "Team Management"
priority: high
type: functional
status: draft
tags: ["team", "invitation", "onboarding", "roles", "happy-path"]
generated_at_commit: abc1234
---

# Invite and onboard new team member

## Objective
Verify that a workspace admin can invite a new team member by email, the invitee receives an invitation, and upon accepting they gain access to the workspace with the assigned role and permissions.

## Preconditions
- Workspace exists with at least 1 admin user
- Admin user is logged into the workspace Settings area
- Invitation email service is configured in test mode
- Target email address ("newmember@example.com") is not already a workspace member
- Workspace is not at member limit

## Steps
| # | Action | Expected Result |
|---|--------|-----------------|
| 1 | Navigate to Settings > Team Members page | Team members list displays with current members and their roles |
| 2 | Click "Invite Member" button | Invitation form appears with email field and role dropdown |
| 3 | Enter "newmember@example.com" in email field | Email field validates format, no error shown |
| 4 | Select "Editor" from role dropdown | Role selection highlights "Editor" with permission summary tooltip |
| 5 | Click "Send Invitation" | Success toast: "Invitation sent to newmember@example.com". Member appears in list with status "Invited" |
| 6 | Open invitee's email inbox | Invitation email received with workspace name and "Accept Invitation" button |
| 7 | Click "Accept Invitation" link in email | Browser opens account creation page (or login page if account exists) |
| 8 | Complete account creation with name and password | Account created, redirects to workspace dashboard |
| 9 | Verify workspace dashboard access | Dashboard loads with workspace content visible, "Editor" badge in profile menu |
| 10 | Return to admin's Team Members page | New member shows status "Active" with role "Editor" |

## Postconditions
- Invitation record created with status "accepted" and acceptance timestamp
- New user account linked to workspace with "Editor" role
- Invitation email marked as used — re-clicking link shows "Already accepted" message
- Audit log entry created with action "team.member_invited" (admin) and "team.invitation_accepted" (invitee)
- Workspace member count incremented by 1
- Welcome notification sent to new member (in-app)

## Edge Cases
- Invite email already associated with an existing account — verify login flow instead of signup
- Invite with "Admin" role — verify admin permissions granted after acceptance
- Re-invite after previous invitation expired — verify new invitation supersedes old
- Invite when workspace is at member limit — verify error message shown before sending
- Invited user closes browser mid-signup and returns via link later — verify flow resumes

## Notes
- Related TCs: TC-TEAM-002 (change member role), TC-TEAM-003 (deactivate member)
- Dependencies: Email delivery service in test mode, invitation token service
- Known issues: Invitation emails may take up to 1 minute in test environments
