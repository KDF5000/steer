import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const code = ts.transpileModule(
  await readFile(new URL('../lib/polling.ts', import.meta.url), 'utf8'),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  },
).outputText;
const { collaborationIdlePollInterval, shouldPollCollaborativeSession } =
  await import(
    `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
  );

test('idle collaboration polling is infrequent', () => {
  assert.equal(collaborationIdlePollInterval, 30_000);
});

test('collaboration polling pauses while hidden, submitting, or streaming a run', () => {
  assert.equal(
    shouldPollCollaborativeSession({
      visible: true,
      pendingSubmission: false,
      activeRun: false,
    }),
    true,
  );
  for (const state of [
    { visible: false, pendingSubmission: false, activeRun: false },
    { visible: true, pendingSubmission: true, activeRun: false },
    { visible: true, pendingSubmission: false, activeRun: true },
  ])
    assert.equal(shouldPollCollaborativeSession(state), false);
});
