import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { isLocalWindowsDrive, resolveInstallTarget, type WorkspaceCandidate } from '../../src/workspace/target';
import { runProcess } from '../../src/process';

test('rejects non-Windows, untrusted, non-file and non-Git workspaces before selection', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'manage-ext-workspace-'));
  const candidate: WorkspaceCandidate = { name: 'workspace', fsPath: root, scheme: 'file' };
  try {
    await assert.rejects(() => resolveInstallTarget({ platform: 'linux', trusted: true, candidates: [candidate] }, async () => undefined));
    await assert.rejects(() => resolveInstallTarget({ platform: 'win32', trusted: false, candidates: [candidate] }, async () => undefined));
    await assert.rejects(() => resolveInstallTarget({ platform: 'win32', trusted: true, candidates: [{ ...candidate, scheme: 'vscode-vfs' }] }, async () => undefined));
    await assert.rejects(() => resolveInstallTarget(
      { platform: 'win32', trusted: true, candidates: [candidate] },
      async () => undefined,
      async () => ({ exitCode: 128, stdout: '', stderr: 'not a Git workspace' }),
      async () => true
    ));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('requires a selection in multi-root workspaces and resolves only Git repository roots', async t => {
  if (process.platform !== 'win32') { t.skip('Windows local paths are required by the install boundary.'); return; }
  const first = await fs.mkdtemp(path.join(os.tmpdir(), 'manage-ext-git-a-'));
  const second = await fs.mkdtemp(path.join(os.tmpdir(), 'manage-ext-git-b-'));
  const initFirst = await runProcess('git', ['init', '--quiet'], { cwd: first });
  const initSecond = await runProcess('git', ['init', '--quiet'], { cwd: second });
  assert.equal(initFirst.exitCode, 0);
  assert.equal(initSecond.exitCode, 0);
  let chosen = false;
  try {
    const target = await resolveInstallTarget({
      platform: 'win32', trusted: true, forceSelection: true,
      candidates: [{ name: 'first', fsPath: first, scheme: 'file' }, { name: 'second', fsPath: second, scheme: 'file' }]
    }, async targets => { chosen = true; return targets[1]; }, runProcess, async () => true);
    assert.equal(chosen, true);
    assert.equal(path.win32.normalize(target.root).toLocaleLowerCase('en-US'), path.win32.normalize(await fs.realpath(second)).toLocaleLowerCase('en-US'));
  } finally {
    await fs.rm(first, { recursive: true, force: true });
    await fs.rm(second, { recursive: true, force: true });
  }
});

test('rejects mapped network drives and unknown drive types for Windows install targets', async () => {
  const query = async (driveType: string, exitCode = 0) => isLocalWindowsDrive('Z:\\', async (executable, args) => {
    assert.equal(executable, 'powershell.exe');
    assert.match(args.at(-1) ?? '', /GetDriveType\('Z:\\'\)/);
    return { exitCode, stdout: driveType, stderr: '' };
  });
  assert.equal(await query('3'), true);
  assert.equal(await isLocalWindowsDrive('E:\\', async () => ({ exitCode: 0, stdout: '2', stderr: '' })), true);
  assert.equal(await query('4'), false);
  assert.equal(await query('5'), false);
  assert.equal(await query('3', 1), false);
  assert.equal(await isLocalWindowsDrive('\\\\server\\share\\', async () => ({ exitCode: 0, stdout: '3', stderr: '' })), false);
});
