import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(
  new URL('../lib/runtime-events.ts', import.meta.url),
  'utf8',
);
const code = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  },
}).outputText;
const { withRuntimeToolEvents, pendingRunApprovals, currentTurnEvents } =
  await import(
    `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
  );
for (const provider of ['qoder', 'qwenwork']) {
  const call = {
    sequence: 1,
    type: `runtime.${provider}.assistant`,
    data: {
      session_id: 's',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'call',
            name: 'Write',
            input: { file_path: 'test.txt', content: 'proposed' },
          },
        ],
      },
    },
  };
  const result = (failed) => ({
    sequence: 2,
    type: `runtime.${provider}.user`,
    data: {
      session_id: 's',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 'call', is_error: failed },
        ],
      },
      tool_use_result: {
        type: 'create',
        filePath: 'test.txt',
        content: 'confirmed',
      },
    },
  });
  test(`${provider}: proposals do not become file changes`, () => {
    assert.equal(
      withRuntimeToolEvents([call]).some((e) => e.data?.item?.changes),
      false,
    );
  });
  test(`${provider}: confirmed writes expose actual content`, () => {
    const events = withRuntimeToolEvents([call, result(false)]);
    assert.equal(events.at(-1).data.item.changes[0].content, 'confirmed');
    assert.equal(events.at(-1).data.item.status, 'completed');
    assert.equal(events[0], call);
  });
  test(`${provider}: permission denial never becomes a change`, () => {
    const item = withRuntimeToolEvents([call, result(true)]).at(-1).data.item;
    assert.equal(item.status, 'failed');
    assert.equal(item.changes, undefined);
  });
  test(`${provider}: replay does not duplicate tool activities`, () => {
    assert.equal(
      withRuntimeToolEvents([call, call, result(false), result(false)]).filter(
        (e) => e.type.endsWith('item.completed'),
      ).length,
      1,
    );
  });
}
test('Codex events retain their identity', () => {
  const event = {
    sequence: 1,
    type: 'runtime.codex.item.completed',
    data: { item: { type: 'fileChange' } },
  };
  assert.deepEqual(withRuntimeToolEvents([event]), [event]);
});
test('malformed and unmatched tool results are ignored', () => {
  assert.deepEqual(
    withRuntimeToolEvents([
      {
        sequence: 1,
        type: 'runtime.qoder.user',
        data: {
          message: {
            content: [null, { type: 'tool_result', tool_use_id: 'unknown' }],
          },
        },
      },
    ]).length,
    1,
  );
});

const approval = {
  sequence: 10,
  type: 'interaction.requested',
  data: {
    id: 'permission-1',
    kind: 'approval',
    state: 'pending',
    prompt: 'Allow command',
    data: {
      toolCall: { rawInput: { CommandLine: 'git status' } },
      options: [
        { kind: 'allow_once', optionId: 'once' },
        { kind: 'allow_always', optionId: 'always' },
      ],
    },
  },
};
test('approval survives replay and disappears after resolution', () => {
  assert.deepEqual(pendingRunApprovals([approval, approval]), [
    {
      id: 'permission-1',
      prompt: 'Allow command',
      command: 'git status',
      allowOnce: true,
    },
  ]);
  assert.deepEqual(
    pendingRunApprovals([
      approval,
      {
        sequence: 11,
        type: 'interaction.resolved',
        data: { interaction_id: 'permission-1' },
      },
    ]),
    [],
  );
});
test('terminal, cancelled, or replaced Attempts cannot retain approvals', () => {
  for (const type of [
    'run.succeeded',
    'run.failed',
    'run.cancelled',
    'run.cancel_requested',
    'attempt.lost',
    'attempt.leased',
  ])
    assert.deepEqual(
      pendingRunApprovals([approval, { sequence: 11, type }]),
      [],
      type,
    );
});
test('persistent-only grants do not enable Allow once', () => {
  const persistent = structuredClone(approval);
  persistent.data.data.options = [{ kind: 'allow_always', optionId: 'always' }];
  assert.equal(pendingRunApprovals([persistent])[0].allowOnce, false);
});

test('Antigravity delayed replay is excluded after the current user echo', () => {
  const events = [
    { sequence: 1, type: 'workspace.prepared' },
    {
      sequence: 2,
      type: 'runtime.antigravity.item.agentMessage.delta',
      data: { itemId: 'old', delta: 'old reply' },
    },
    {
      sequence: 3,
      type: 'assistant.message.completed',
      data: { text: 'old reply' },
    },
    {
      sequence: 4,
      type: 'runtime.antigravity.session.update',
      data: {
        update: {
          sessionUpdate: 'user_message_chunk',
          content: { text: 'new question' },
        },
      },
    },
    {
      sequence: 5,
      type: 'runtime.antigravity.item.agentMessage.delta',
      data: { itemId: 'new', delta: 'new reply' },
    },
    {
      sequence: 6,
      type: 'run.failed',
      data: {
        error: 'relay antigravity: ACP completed without a final message',
      },
    },
  ];
  assert.deepEqual(
    currentTurnEvents(events).map((e) => e.sequence),
    [1, 4, 5, 6],
  );
  assert.deepEqual(
    withRuntimeToolEvents(events).map((e) => e.sequence),
    [1, 4, 5, 6],
  );
});
