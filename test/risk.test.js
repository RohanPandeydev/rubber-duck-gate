'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyUpdate, riskyReasons } = require('../src/risk');

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const ZERO = '0'.repeat(40);
const update = (remoteRef, localSha, remoteSha) => ({ localRef: 'refs/heads/x', localSha, remoteRef, remoteSha });
const fastForward = { isAncestor: () => true };
const rewritten = { isAncestor: () => false };

test('a normal push to a feature branch is not risky', () => {
  assert.equal(classifyUpdate(update('refs/heads/feature', A, B), fastForward).risky, false);
});

test('a new feature branch is not risky', () => {
  assert.equal(classifyUpdate(update('refs/heads/feature', A, ZERO), rewritten).risky, false);
});

test('any push to main is risky', () => {
  assert.deepEqual(classifyUpdate(update('refs/heads/main', A, B), fastForward), { risky: true, reason: 'push to main' });
});

test('a rewrite of any branch is a force-push', () => {
  assert.deepEqual(classifyUpdate(update('refs/heads/feature', A, B), rewritten), { risky: true, reason: 'force-push to feature' });
});

test('deleting a branch is risky', () => {
  assert.deepEqual(classifyUpdate(update('refs/heads/feature', ZERO, B), fastForward), { risky: true, reason: 'delete feature' });
});

test('pushing and deleting tags is not gated', () => {
  assert.equal(classifyUpdate(update('refs/tags/v1', A, ZERO), rewritten).risky, false);
  assert.equal(classifyUpdate(update('refs/tags/v1', ZERO, B), rewritten).risky, false);
});

test('protected branches can be configured', () => {
  const options = { ...fastForward, protectedBranches: ['trunk'] };
  assert.equal(classifyUpdate(update('refs/heads/trunk', A, B), options).risky, true);
  assert.equal(classifyUpdate(update('refs/heads/main', A, B), options).risky, false);
});

test('the most destructive reason comes first', () => {
  const input = [
    `refs/heads/main ${A} refs/heads/main ${B}`,
    `refs/heads/y ${A} refs/heads/feature ${B}`,
    `(delete) ${ZERO} refs/heads/old ${B}`,
  ].join('\n');
  const isAncestor = (remote, local) => local !== A || remote !== B;
  assert.deepEqual(riskyReasons(input, { isAncestor }), ['force-push to main', 'force-push to feature', 'delete old']);
});

test('empty input has no reasons', () => {
  assert.deepEqual(riskyReasons('', fastForward), []);
});
