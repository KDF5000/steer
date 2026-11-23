import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(
  new URL('../lib/execution-machine.ts', import.meta.url),
  'utf8',
);
const code = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  },
}).outputText;
const { executionMachineName, runExecutionLocation } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
);
const nodes = [
  {
    id: 'machine-a',
    labels: { name: '10.37.82.77' },
    runtimes: [{ id: 'machine-a/trae' }, { id: 'machine-a/codex' }],
  },
  {
    id: 'machine-b',
    labels: { name: '10.37.127.105' },
    runtimes: [{ id: 'machine-b/trae' }],
  },
];

test('existing session shows its execution machine after Agent/project changes', () => {
  assert.equal(
    executionMachineName(
      nodes,
      'machine-a/codex',
      'machine-b',
      'machine-b/trae',
    ),
    '10.37.82.77',
  );
});

test('new conversation uses the project machine before the Agent fallback', () => {
  assert.equal(
    executionMachineName(nodes, null, 'machine-a', 'machine-b/trae'),
    '10.37.82.77',
  );
  assert.equal(
    executionMachineName(nodes, null, null, 'machine-b/trae'),
    '10.37.127.105',
  );
});

test('missing metadata or unavailable machine never displays a different machine', () => {
  assert.equal(
    executionMachineName(nodes, 'removed/trae', 'machine-a', 'machine-a/trae'),
    '',
  );
  assert.equal(
    executionMachineName([{ id: 'old-node', runtimes: [] }], null, 'old-node'),
    'old-node',
  );
});

test('Git automatic execution uses the assigned Node and actual worktree', () => {
  const location = runExecutionLocation([
    { sequence: 1, type: 'attempt.leased', data: { node_id: 'machine-b' } },
    {
      sequence: 2,
      type: 'workspace.prepared',
      data: { kind: 'git', work_dir: '/relay/worktrees/conversation/src' },
    },
  ]);
  assert.deepEqual(location, {
    nodeId: 'machine-b',
    workDir: '/relay/worktrees/conversation/src',
  });
  assert.equal(
    executionMachineName(nodes, null, null, null, location.nodeId),
    '10.37.127.105',
  );
});

test('retry assignment discards the previous machine worktree', () => {
  assert.deepEqual(
    runExecutionLocation([
      { sequence: 1, type: 'attempt.leased', data: { node_id: 'machine-a' } },
      {
        sequence: 2,
        type: 'workspace.prepared',
        data: { work_dir: '/old/tree' },
      },
      { sequence: 3, type: 'attempt.leased', data: { node_id: 'machine-b' } },
    ]),
    { nodeId: 'machine-b' },
  );
});

test('older Runs can restore their directory from runtime events or output', () => {
  assert.deepEqual(
    runExecutionLocation([
      {
        sequence: 1,
        type: 'runtime.codex.started',
        data: { work_dir: '/actual/tree' },
      },
    ]),
    { workDir: '/actual/tree' },
  );
  assert.deepEqual(
    runExecutionLocation([], {
      result: { output: { work_dir: '/saved/tree' } },
    }),
    { workDir: '/saved/tree' },
  );
});

test('machine names work with unmodified Nodes and actual assignment wins', () => {
  const named = [
    {
      ...nodes[0],
      labels: { name: 'Build machine', 'relay.node.ip': '1.2.3.4' },
    },
    nodes[1],
  ];
  assert.equal(executionMachineName(named, null, 'machine-a'), 'Build machine');
  assert.equal(
    executionMachineName(
      named,
      'machine-a/codex',
      'machine-a',
      null,
      'machine-b',
    ),
    '10.37.127.105',
  );
});
