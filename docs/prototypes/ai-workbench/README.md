# Steer AI Workbench Prototypes

## Simplified direction

- `04-minimal.html` — 极简首页：只展示开始工作、继续工作、需要关注和一个近期提醒；其余信息由 AI 在后台维护并按需出现。
- `05-high-fidelity.html` — 基于当前 Steer 前端视觉与布局的高保真版本；保留现有侧栏、会话、Agent/Project 选择器和输入框，仅在新聊天首页增加低干扰的工作入口。

These prototypes explore one shared product model through three different primary surfaces. They are standalone HTML and do not change the production application.

## Information hierarchy

```text
Person
├── Today
│   ├── AI briefing
│   ├── Needs attention
│   ├── Reminders
│   ├── Active work
│   └── Resurfaced ideas
├── Work
│   ├── Conversation
│   ├── Working context
│   ├── Agent execution
│   └── Review surfaces
├── Projects
│   ├── Living brief
│   ├── Decisions
│   ├── Entries
│   ├── Assets
│   ├── Memories
│   ├── Skills
│   ├── Conversations
│   └── Working locations
├── Library
│   ├── Ideas
│   ├── Notes
│   ├── Memories
│   ├── Skills
│   └── Assets
└── System
    ├── Agents
    ├── Models
    ├── Runtimes
    ├── Connections
    └── Permissions
```

## Core object boundaries

| Object | Purpose |
| --- | --- |
| Entry | A quickly captured Todo, Idea, Note, or Reminder. |
| Project | A durable context container, not an issue tracker. |
| Working location | A machine directory, repository, worktree, or other execution environment. |
| Conversation | The continuous human–AI working surface. |
| Memory | A fact or preference the AI should actively know later. |
| Skill | A reusable procedure that constrains how the AI works. |
| Capability | An operation or connected service the AI may use. |
| Asset | A durable output produced or collected during work. |
| Decision | A project conclusion with source and provenance. |
| Run | A technical Agent execution record; normally secondary in the UI. |

## Shared lifecycle

```text
Capture or conversation
        ↓
AI proposes classification and links
        ↓
Todo / Idea / Note / Reminder
        ↓
Work in a Conversation using Project context
        ↓
Decision / Memory / Asset / Next step
        ↓
AI updates Project and Today views with provenance and undo
```

## Concepts

1. `01-today.html` — attention-first daily workspace.
2. `02-conversation.html` — ChatGPT-like work surface with transparent context and automatic organization.
3. `03-project.html` — AI-maintained project hub without an issue-board model.

All concepts use the same navigation and universal Capture interaction. Open any HTML file through a local static server; links switch between concepts.
