# CRM Round Robin

Round Robin assignment in the CRM selects an eligible user from a configured queue and records the assignment in queue and owner history.

## Configuration

Create an active Round Robin queue, scope it to a project and criteria as needed, and add members with the intended user type and sequence. A member must have the matching CRM profile and be active, available, working, and not on a week off. Queue configuration and membership are managed as Round Robin and Round Robin Member records in Object Manager.

## Queue matching

Project-scoped queues are matched against the Lead's project, user type, status, source hierarchy, and priority where those criteria are configured. The best matching active queue is selected. Recovery, SVC, Sales, Pre-Sales, and other supported workflows use the corresponding user type and profile eligibility.

## Selecting a member

The queue is locked during assignment so concurrent requests do not consume the same turn. Eligible members are considered from the current queue cursor in sequence order, with capacity limits respected where configured. The cursor advances to the selected member. If no eligible member exists, project queue workflows report an assignment error or leave the handoff pending rather than silently assigning someone outside the configured queue.

## When assignment runs

- New Leads use the configured Pre-Sales assignment workflow. Reopened Leads use the queue matching the current user's profile: Sales, Channel Partner, or Pre-Sales by default.
- Moving a Lead to Recovery selects a Recovery queue.
- Pushing an Incoming Lead to SVC selects an SVC queue and moves the Lead to Prospect.
- A completed, GRE-confirmed site visit can hand the Lead to a Sales queue.
- Editing a Lead's project does **not** run automatic Round Robin or change its owner, including when the same save includes other editable Lead fields. Status-driven Recovery and Sales handoffs remain separate explicit workflows.
- When a Lead owner changes outside Recovery, scheduled follow-ups and site visits move to the new owner.

## Handoff access

After an SVC or Sales handoff, the recorded pusher/completing user and assigned recipient can read the Lead even after ownership changes. This handoff access is read-only; the CRM blocks Lead edits and assignment actions for those users. Admins retain their normal administrative access.

## Audit trail

Assignments are recorded in Round Robin history and, when the owner or status changes, Lead Owner History. Handoff workflows also write their corresponding audit entries. These records support assignment review and the read-only access rule.
