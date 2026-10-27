# Account-scoped resource sharing

Workspaces remain owned by one user. Sharing grants access to one conversation
or an Agent's execution capability; it does not create Workspace membership.
The public `/shares/{token}` snapshot API remains a separate read-only feature.

## Invitations

All endpoints require a signed-in account and use its selected personal Workspace.

- `GET /api/v1/resource-shares`: outgoing grants in the selected Workspace plus
  invitations addressed to the account's email. Each entry includes `owned`.
- `POST /api/v1/resource-shares/{kind}/{id}`: invite an email address.
  `kind` is `session` or `agent`; fields are `email`, `permission` (`view` or
  `execute`), and, for Agents, `projectId` and `maxConcurrency` (1–10, default 1).
- `POST /api/v1/resource-shares/{id}/accept`: accept an invitation for this account.
- `PUT /api/v1/resource-shares/{id}`: owner updates `permission`.
- `DELETE /api/v1/resource-shares/{id}`: owner revokes or recipient declines/leaves.

Agent grants require an explicitly bound Runtime and authorized owner project.
Inviting an unregistered email is supported; the matching account can accept
later. This implementation records invitations in-app and sends no email.

## Shared conversations

The scoped gateway `/api/v1/collaboration-access/{shareID}/{resourcePath}` accepts
only the conversation specified by the grant and its own runs, tasks,
attachments and artifacts. It cannot access Workspace bootstrap, private projects,
unrelated conversations or Runtime configuration.

Supported resource paths include `sessions/{conversationID}`,
`conversations/{conversationID}/tasks`, `runs/{runID}`, `runs/{runID}/workspace`,
`runs/{runID}/events/stream`, `runs/{runID}/cancel`, `tasks/{taskID}`,
`tasks/{taskID}/events`, `tasks/{taskID}/artifacts`, `tasks/{taskID}/cancel`,
`messages/{messageID}/attachments/{attachmentID}`, and artifact content/download.

Pending invitations cannot open the conversation. View permission allows reads;
execute permission additionally permits submitting and cancelling tasks. Tasks
use the conversation's existing Agent and project; the scoped API rejects Agent
switching, delegation and project reassignment. The usual conversation lock
prevents concurrent tasks. Message context records the actual human author.

The Fusion sidebar places Collaborative projects alongside personal Projects,
as a non-clickable group label, organizing received conversations by provider
and original project directly in the sidebar. There is no separate collaboration
page. An empty group displays a quiet "No collaborative projects yet" message;
loading and request failures have distinct states. Shared outgoing conversations stay in their personal
project lists and expose collaborator avatars for membership management.
The header separates public snapshot links from collaboration invitations. Opening an incoming conversation does not add the owner's
project or conversation to the recipient's personal lists. Both participants and
owners refresh shared messages while viewing the conversation. Session permission
is rechecked on every request and while streaming events.

## Shared Agent conversations

`POST /api/v1/resource-shares/{id}/conversations` creates a private conversation
and a project entry in the recipient's selected Workspace. Accepting an Agent
invitation imports the authorized project without creating a conversation.
Previously accepted invitations are backfilled when the Workspace loads; deleted
project entries are not restored by ordinary page loads. Repeated use reuses
the same source project's entry, while each started conversation has a separate native session
and Git worktree. Re-entering the shared Agent resumes an unused draft with the
same execution scope rather than creating another empty conversation. Clicking
the private project opens a new conversation composer, just like a personal
project. A conversation is persisted only when the first message is sent. The project shows its original name with a shared-project icon; conversation
titles adopt the first task text. Multiple accepted Agent grants for the same
source project share this entry. Names alone never determine grouping. Existing personal projects are never overwritten.

Execution resolves the owner's current Agent instructions, Skills and Runtime
binding, but stores messages, tasks, artifacts and usage under the recipient's
Workspace. No general Runtime binding is transferred. The project remains fixed and
cannot be edited by the recipient. Users may select any accepted Agent grant
for that source project, subject to the conversation's existing machine rules.
The chosen grant supplies instructions and execution authority and is recorded
on the session after Relay accepts a task. Agent switching preserves the
conversation and worktree, with the usual history synchronization. Git projects use reusable independent worktrees;
local projects use the expressly authorized local directory. These restrictions
set execution placement; they are not an operating-system filesystem sandbox.
The provider still administers the machine, CLI credentials and native logs.

The grant's concurrency limit is enforced across recipient conversations and
Workspaces. Active runs are reconciled before enforcing the allowance. Revocation
blocks subsequent execution, while the recipient retains their existing history.
Project responses expose `sharedSourceProjectId`, recipient-scoped
`sharedAgentGrantIds`, and `sharedAgentAccess`. A project remains usable while
any of its Agent grants is accepted. Session access tracks its last selected
grant; another accepted Agent for the same project can continue the conversation.
The sidebar marks revoked projects with history and hides revoked projects with
no conversations. Existing conversations remain readable with a disabled composer
and a revocation notice. The UI refreshes authorization every ten seconds while
visible, and on window focus; server checks take effect on the next request.
Revocation does not cancel runs that have already started.
Changing authorized source/ref/subdirectory requires a new conversation. Private
conversations created with a shared Agent may be shared for viewing; execution
grants cannot be forwarded to additional accounts. Delegated child conversations
need their own sharing grant to be opened by another account.

## Deployment and checks

Migrations `000031_resource_sharing.sql` and `000032_shared_project_agents.sql`
add grants and group imported projects by their source project. Existing
duplicate entries are consolidated while preserving conversation IDs and
worktree keys. Personal project names remain unique within a Workspace; imported
projects retain their original names and use source identity for uniqueness. Update Steer backend and frontend together; the backend
runs the migration at startup. Relay requires no changes.

`TestAccountScopedSharing` uses PostgreSQL and a mock Relay server to check
invitation acceptance, isolation, view/execute permissions, author attribution,
revocation, independent native conversations/worktrees, concurrency recovery,
local directory execution, and changed-scope rejection. Set
`STEER_TEST_DATABASE_URL` to a dedicated test database to run it with `go test`.
Comments and discussion messages remain prototype-only. The shared Agent list
uses the same table component as personal Agents. Grant responses include model,
role, accepted recipient name and stable owner/project identifiers for display;
these fields do not change execution permissions.
