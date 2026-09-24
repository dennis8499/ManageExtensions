import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { extractReleaseArchive } from '../archive/secureArchive';
import { getProduct } from '../catalog';
import { GitHubReleaseClient, type GitHubRelease } from '../github/releases';
import { findPython311, runProcess, type ProcessResult, type PythonCommand } from '../process';
import type { InstallTarget } from '../workspace/target';
import { formatPaths, type InstallInteraction } from './interaction';

interface UpstreamPlan {
  ok: boolean;
  action?: string;
  framework_version?: string;
  changes?: string[];
  preserved?: string[];
  conflicts?: string[];
  obsolete_paths?: string[];
  applied?: boolean;
  error?: string;
}

export type ProcessRunner = (executable: string, args: readonly string[], options?: { cwd?: string; timeoutMs?: number; maxOutputBytes?: number }) => Promise<ProcessResult>;

export async function installWiki(
  target: InstallTarget,
  release: GitHubRelease,
  client: GitHubReleaseClient,
  interaction: InstallInteraction,
  runner: ProcessRunner = runProcess,
  pythonFinder: () => Promise<PythonCommand> = findPython311,
  temporaryParent = os.tmpdir()
): Promise<void> {
  const version = release.tag_name.replace(/^v/, '');
  const { zip } = await client.downloadWikiAssets(release);
  const archiveRoot = getProduct('codebase-llm-wiki')!.archiveRoot(version);
  const extracted = await extractReleaseArchive(zip, temporaryParent, archiveRoot, version, 'wiki');
  try {
    const python = await pythonFinder();
    const script = path.join(extracted.packageDirectory, '.agents', 'skills', 'codebase-wiki', 'scripts', 'install-framework.py');
    const currentVersion = await readInstalledWikiVersion(target.root);
    const action = currentVersion ? 'upgrade' : 'install';
    const baseArgs = [...python.prefixArguments, script, action, '--target', target.root, '--surface', 'codex', '--guard-mode', 'coexist', '--format', 'json'];
    const previewResult = await runner(python.executable, baseArgs, { cwd: target.root, timeoutMs: 120_000, maxOutputBytes: 2 * 1024 * 1024 });
    const preview = parsePlan(previewResult, 'preview');
    if (!preview.ok || previewResult.exitCode !== 0) {
      const lines = [
        ...(preview.changes ?? []).map(file => `Change: ${file}`),
        ...(preview.preserved ?? []).map(file => `Preserve local file: ${file}`),
        ...(preview.conflicts ?? []).map(file => `Conflict: ${file}`),
        ...(preview.obsolete_paths ?? []).map(file => `Obsolete: ${file}`),
        ...(preview.error ? [`Error: ${preview.error}`] : [])
      ];
      await interaction.warn(`Codebase LLM Wiki preview found conflicts or failed${lines.length ? `:\n${formatPaths(lines).join('\n')}` : '.'}`);
      return;
    }
    const changes = preview.changes ?? [];
    const preserved = preview.preserved ?? [];
    const obsolete = preview.obsolete_paths ?? [];
    if (changes.length === 0) {
      await interaction.inform(`Codebase LLM Wiki ${version} is already installed with no changes.`);
      return;
    }
    const details = [
      ...changes.map(file => `Change: ${file}`),
      ...preserved.map(file => `Preserve local file: ${file}`),
      ...obsolete.map(file => `Obsolete from previous release: ${file}`)
    ];
    const approved = await interaction.confirm(
      `Apply Codebase LLM Wiki ${version}?`,
      `The upstream installer previewed ${changes.length} change(s). Local files will be protected in coexist mode.`,
      formatPaths(details)
    );
    if (!approved) return;
    const applyResult = await runner(python.executable, [...baseArgs, '--apply'], { cwd: target.root, timeoutMs: 120_000, maxOutputBytes: 2 * 1024 * 1024 });
    const applied = parsePlan(applyResult, 'apply');
    if (applyResult.exitCode !== 0 || !applied.ok || !applied.applied || applied.framework_version !== version) {
      await interaction.warn(`Codebase LLM Wiki was not applied successfully${applied.conflicts?.length ? `:\n${formatPaths(applied.conflicts).join('\n')}` : applied.error ? `: ${applied.error}` : '.'}`);
      return;
    }
    await interaction.inform(`Codebase LLM Wiki ${version} was installed in ${target.name}.`);
  } finally {
    await fs.rm(extracted.temporaryDirectory, { recursive: true, force: true });
  }
}

async function readInstalledWikiVersion(root: string): Promise<string | undefined> {
  let current = root;
  const components = ['.agents', 'skills', 'codebase-wiki', 'VERSION'];
  for (let index = 0; index < components.length; index++) {
    current = path.join(current, components[index]);
    let stat;
    try { stat = await fs.lstat(current); }
    catch (error) { if (isNotFound(error)) return undefined; throw error; }
    if (stat.isSymbolicLink() || hasReparseAttribute(stat)) throw new Error(`The installed Wiki path contains a symlink or reparse point: ${current}`);
    if (index < components.length - 1 && !stat.isDirectory()) throw new Error(`The installed Wiki path is not a directory: ${current}`);
    if (index === components.length - 1 && !stat.isFile()) throw new Error('The installed Wiki VERSION path is not a regular file.');
  }
  const version = (await fs.readFile(current, 'utf8')).trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`The installed Wiki version marker is invalid: ${version || '(empty)'}.`);
  return version;
}

function parsePlan(result: ProcessResult, stage: string): UpstreamPlan {
  let value: unknown;
  try { value = JSON.parse(result.stdout.trim()) as unknown; }
  catch (error) {
    throw new Error(`Upstream Wiki installer returned invalid JSON during ${stage}: ${result.stderr.trim() || result.stdout.trim()}`, { cause: error });
  }
  if (!value || typeof value !== 'object' || typeof (value as UpstreamPlan).ok !== 'boolean') throw new Error(`Upstream Wiki installer returned an unexpected ${stage} plan.`);
  return value as UpstreamPlan;
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function hasReparseAttribute(stat: object): boolean {
  if (process.platform !== 'win32') return false;
  const attributes = (stat as { attributes?: number }).attributes ?? 0;
  return (attributes & 0x400) !== 0;
}
