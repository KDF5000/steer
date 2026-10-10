# Feishu workspace integration

Steer can run a Feishu app bot inside `steer-server`. A Workspace owner enters
the Feishu application credentials in **Settings → Integrations**, selects an
Agent, and enables the connection. Project binding is managed from Feishu for
each direct chat or group thread. No separate bridge deployment or Workspace
API key is required.

Each Feishu App ID can be connected to only one Workspace in a Steer database.
App ID matching is case-insensitive. Connecting an App ID that is already in
use returns a conflict instead of starting a second connection.

## Deployment prerequisite

Set a stable, private encryption key on every `steer-server` instance:

```dotenv
STEER_CREDENTIAL_ENCRYPTION_KEY=replace-with-a-long-random-secret
```

Steer derives a 256-bit encryption key from this value and encrypts every
Feishu App Secret with AES-GCM before storing it. The plaintext secret is never
returned by the API. Keep this value stable and backed up: changing or losing
it makes existing integration credentials unreadable.

## Configure the Feishu app

Create a self-built application in the Feishu developer console. Custom group
webhook bots cannot receive and reply to conversations through this integration.

1. Enable the **Bot** capability.
2. Grant these application permissions:
   - `im:message.p2p_msg:readonly`
   - `im:message.group_at_msg:readonly`
   - `im:message:send_as_bot`
   - `im:message:readonly` (read replied-to messages and download message images)
3. Under Events and Callbacks, select long-connection mode.
4. Subscribe to `im.message.receive_v1`.
5. Publish the application and make it available to the intended users.
6. In Steer, open **Settings → Integrations → Connect Feishu**, enter the App
   ID and App Secret, and select the Agent.

The status changes from `connecting` to `connected` after Feishu accepts the
long connection. Configuration or permission failures appear on the same
settings row. Use **Reconnect** after changing settings in the developer
console.

## Conversation behavior

- A direct chat reuses one Steer conversation until `/new` is sent.
- A group message starts a conversation for its Feishu thread. Replies in that
  thread reuse the same Steer conversation.
- When the bot is mentioned in a reply, Steer reads the immediate parent
  message and includes its text, rich text, and supported images as explicit
  context for the Agent.
- Group messages must explicitly mention the bot.
- `/projects` lists the available Projects in the connected Workspace.
- `/project` shows the effective Project for the current Feishu chat.
- `/project <project name>` changes the chat-level default Project, resets the
  current thread, and makes new group threads inherit that Project.
- `/project none` removes the chat-level default Project and resets the current
  thread. Existing conversations in other threads remain pinned to the Project
  they started with.
- `/new` starts a new Steer conversation while preserving the current Project
  binding.
- `/status` opens a live status card for the current thread's active task. If
  the command is sent as a new top-level group message, it follows the most
  recently active task in that chat. The process output is inside a native
  collapsible panel.
- `/cancel` requests cancellation of the active task.
- `/help` displays the available commands.

Project names are matched case-insensitively. A group still uses a separate
Steer conversation per thread, while its Project choice is a chat-level default
for new threads. Project switching is rejected while the current thread's task
is still running because a Steer conversation is pinned to its Project and
Runtime.

Incoming Feishu event IDs are persisted and are also used as Steer task
idempotency keys. Pending events are recovered when the connection restarts.
The integration adds a typing reaction while the Agent is working. Commentary,
tool activity, and reasoning are hidden by default. When the Agent starts its
`final_answer` phase, Steer removes the reaction and streams only that final
answer into a normal Feishu rich-text reply. If the runtime does not expose a
streamable final phase, Steer sends the authoritative final Task content once
the Run finishes.

Process output is opt-in through `/status`. While the task is running, that
command creates a live card and refreshes its commentary output at most once
per second. The card uses Feishu JSON 2.0's `collapsible_panel`, so the user can
collapse or expand the process details. Ordinary Feishu rich-text messages do
not expose an app-controlled collapse property. Feishu also has a separate API
for temporary cards visible only to selected group members, but this
integration does not use that private-card API for task status.

Text, rich-text, and image messages are supported. Steer downloads images
through the message-resource API and applies the same limits as the Web task
input: at most 4 images, 5 MB per image, and 16 MB in total; PNG, JPEG, WebP,
and GIF are accepted. Images in the replied-to parent message count toward the
same limits. Other file, audio, and video attachments are not forwarded yet.

## Runtime model

The integration manager is an internal `steer-server` component. At startup it
loads all enabled Workspace integrations and starts one Feishu channel for each
configured application. Creating, editing, disabling, reconnecting, or deleting
an integration updates that channel without restarting the server.

Multiple `steer-server` replicas may open long connections for the same App ID;
Feishu distributes incoming events among those connections. This version does
not add cross-replica ownership leases or duplicate protection for pending-event
recovery. Deployments that require strict exactly-once replies should keep one
integration worker replica until that coordination layer is implemented.
