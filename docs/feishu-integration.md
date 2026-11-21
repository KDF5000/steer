# Feishu workspace integration

Steer can run a Feishu app bot inside `steer-server`. A Workspace owner enters
the Feishu application credentials in **Settings → Integrations**, selects an
Agent, optionally selects a default Project, and enables the connection.
Project bindings set in Feishu take priority over that default.
No separate bridge deployment or Workspace
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
   - Optional: `im:message.group_msg` (receive group messages without a mention,
     allowing direct replies in threads already connected to Steer)
3. Under Events and Callbacks, select long-connection mode.
4. Subscribe to `im.message.receive_v1`.
   In **Events and Callbacks → Callback Configuration**, also enable
   `card.action.trigger` (card action callbacks) using long-connection mode.
   Model, Project, and cancellation buttons require this callback; no separate
   public callback URL is needed.
5. Publish the application and make it available to the intended users.
6. In Steer, open **Settings → Integrations → Connect Feishu**, enter the App
   ID and App Secret, and select the Agent and an optional default Project.

The status changes from `connecting` to `connected` after Feishu accepts the
long connection. Configuration or permission failures appear on the same
settings row. Use **Reconnect** after changing settings in the developer
console.

## Conversation behavior

- A direct chat reuses one Steer conversation until `/new` is sent.
- A group message starts a conversation for its Feishu thread. Replies in that
  thread reuse the same Steer conversation.
- When the bot is mentioned in a reply, Steer reads the immediate parent
  message when starting a new Steer session and includes its text, rich text,
  and supported images as explicit context for the Agent. Replies in an
  existing session submit only the current message and its own attachments;
  previous exchanges already belong to the runtime session.
- Starting a new group conversation requires explicitly mentioning the bot.
  Replies in a thread already connected to Steer can omit the mention if the
  Feishu app has the `im:message.group_msg` permission. Without that permission,
  Feishu only delivers messages that mention the bot. Other group messages and
  messages from bots are ignored. After `/new` or a Project switch, the known
  thread can still be continued without a mention.
- `/projects` opens a Project selection card for the connected Workspace.
- Integration settings can specify an optional default Project. New private
  and group conversations use the chat's Project binding first, then the
  integration default. With neither configured, tasks run without a Project.
  Existing conversations retain their original Project and execution context,
  even when the integration default changes. Use `/project <project name>`
  to switch the current thread to a different Project.
- `/project` opens the same selection card, with the effective Project selected.
  Applying a selection changes the chat default and resets the current thread.
- `/project <project name>` changes the chat-level default Project, resets the
  current thread, and makes new group threads inherit that Project.
- `/project none` removes the chat-level default Project and resets the current
  thread. New conversations fall back to the integration default Project.
  Existing conversations in other threads remain pinned to the Project
  they started with.
- `/new` starts a new Steer conversation while preserving the current Project
  binding.
- `/model` opens a model selection card using the current execution Runtime's
  model catalog. Select a model, then choose one of its supported effort levels
  (or the model default) and apply. The choice belongs to the current thread,
  keeps the same Steer/native session, and also appears in the Web conversation.
  It applies to subsequent tasks and does not change the Agent's defaults.
  Applying model or Project changes is rejected while a task is running.
  `/new` and Project switching clear the thread's model and effort overrides.
- `/status` opens an additional live execution card for the current thread's active task. If
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
The integration adds a typing reaction while the Agent is working and creates
an execution card immediately after task submission. Its process panel is
collapsed by default; the heading shows a short activity label such as tool
execution, thinking, workspace preparation, or reply generation. It does not
show commands, paths, generated prose, or a persistent tool-call count.
The chevron points right when collapsed and down when expanded.
Expanding it shows execution commentary, tool inputs and
outputs, and reasoning content actually exposed by the Runtime. Canonical
item events and the tool protocols used by Claude, Qoder/QwenWork, OpenCode,
and Pi are projected into the card. The card refreshes when content or status
changes, at most once per second. Runtime providers that do not expose a given
kind of activity cannot display it.

While the task is running, a small **Stop** icon sits beside the process chevron.
It cancels that specific Run, preserves the session, and disappears when the
task ends. Public collapsible panels do not expose a hover-only button area;
the icon is currently persistent, with a tooltip on hover. The documented
hover button area belongs to the checker component, which this card does not use.

The final answer appears below the collapsed process panel in the same card.
By default it appears when the task finishes; **Stream replies** enables
incremental final answers when the Runtime exposes `final`/`final_answer`
events. Tool output and long process histories are bounded in the card; the
complete events remain in Steer. Answers beyond the card's display budget are
also sent as a complete rich-text reply. If sending or updating a card fails,
the complete final reply falls back to a normal message.

Card routing and interaction bindings are persisted, so buttons still route
correctly after a server restart. Selection cards can be applied once and
expire after seven days. A card from another chat, an old session/Project, or a
different Runtime cannot overwrite the current selection. Other members of a
group may interact with its shared cards, consistent with the shared thread
session. Forwarded cards cannot execute actions in the destination chat.

Text, rich-text, and image messages are supported. Steer downloads images
through the message-resource API and applies the same limits as the Web task
input: at most 4 images, 5 MB per image, and 16 MB in total; PNG, JPEG, WebP,
and GIF are accepted. Images imported from the parent message in a new session count toward the
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
