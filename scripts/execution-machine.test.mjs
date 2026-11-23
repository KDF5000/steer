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
const { executionMachineIP } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
);
const nodes = [
  {
    id: 'machine-a',
    labels: { 'relay.node.ip': '10.37.82.77' },
    runtimes: [{ id: 'machine-a/trae' }, { id: 'machine-a/codex' }],
  },
  {
    id: 'machine-b',
    labels: { 'relay.node.ip': '10.37.127.105' },
    runtimes: [{ id: 'machine-b/trae' }],
  },
];

test('existing session shows its execution machine after Agent/project changes', () => {
  assert.equal(
    executionMachineIP(nodes, 'machine-a/codex', 'machine-b', 'machine-b/trae'),
    '10.37.82.77',
  );
});

test('new conversation uses the project machine before the Agent fallback', () => {
  assert.equal(
    executionMachineIP(nodes, null, 'machine-a', 'machine-b/trae'),
    '10.37.82.77',
  );
  assert.equal(
    executionMachineIP(nodes, null, null, 'machine-b/trae'),
    '10.37.127.105',
  );
});

test('missing metadata or unavailable machine never displays a different IP', () => {
  assert.equal(
    executionMachineIP(nodes, 'removed/trae', 'machine-a', 'machine-a/trae'),
    '',
  );
  assert.equal(
    executionMachineIP([{ id: 'old-node', runtimes: [] }], null, 'old-node'),
    '',
  );
});
