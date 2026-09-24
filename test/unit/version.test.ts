import assert from 'node:assert/strict';
import test from 'node:test';
import { compareVersions, parseStableVersionTag } from '../../src/version';

test('compares SemVer triples and parses only stable release tags', () => {
  assert.equal(compareVersions('0.2.9', '0.2.10'), -1);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('2.0.0', '1.9.9'), 1);
  assert.equal(parseStableVersionTag('v1.2.3'), '1.2.3');
  assert.equal(parseStableVersionTag('v1.2.3-rc.1'), undefined);
  assert.equal(parseStableVersionTag('main'), undefined);
});
