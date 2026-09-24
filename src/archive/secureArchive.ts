import { createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import yauzl, { type Entry, type ZipFile } from 'yauzl';

const MAX_ENTRIES = 5_000;
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;
const MAX_COMPRESSION_RATIO = 1_000;

export interface ArchiveEntryLike {
  fileName: string;
  externalFileAttributes: number;
  uncompressedSize: number;
  compressedSize: number;
  generalPurposeBitFlag: number;
}

export interface ExtractedPackage {
  readonly temporaryDirectory: string;
  readonly packageDirectory: string;
  readonly version: string;
}

export const MEGIN_SKILL_DIRECTORIES = Object.freeze([
  'megin',
  'megin-behavior-contract',
  'megin-bug-diagnosis',
  'megin-code-review',
  'megin-finishing-delivery',
  'megin-human-acceptance',
  'megin-implementation-execution',
  'megin-project-knowledge',
  'megin-requirements-discovery',
  'megin-technical-planning',
  'megin-test-driven-development',
  'megin-verification-before-completion'
] as const);

export function safeArchivePath(fileName: string, expectedRoot: string): string {
  if (expectedRoot.includes('/') || expectedRoot.includes('\\') || !expectedRoot || expectedRoot === '.' || expectedRoot === '..') {
    throw new Error(`Invalid expected ZIP root: ${expectedRoot}`);
  }
  const parts = safeArchiveParts(fileName);
  if (parts[0] !== expectedRoot) throw new Error(`ZIP entry is outside expected package root: ${fileName}`);
  return parts.slice(1).join('/');
}

function safeMeginBundlePath(fileName: string): string {
  const parts = safeArchiveParts(fileName);
  if (parts.length === 1 && parts[0] === 'README.md') return 'README.md';
  if (!MEGIN_SKILL_DIRECTORIES.some(directory => directory === parts[0])) {
    throw new Error(`Megin bundle contains an unexpected skill directory or path: ${fileName}`);
  }
  return parts.join('/');
}

function safeArchiveParts(fileName: string): string[] {
  if (!fileName || fileName.includes('\\') || fileName.startsWith('/') || fileName.startsWith('//')) {
    throw new Error(`Unsafe ZIP path: ${fileName}`);
  }
  const trimmed = fileName.endsWith('/') ? fileName.slice(0, -1) : fileName;
  if (!trimmed || /^[A-Za-z]:/.test(trimmed)) throw new Error(`Unsafe ZIP path: ${fileName}`);
  const parts = trimmed.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || /[<>:"|?*\u0000-\u001f]/.test(part) || /[. ]$/.test(part) || isReservedWindowsName(part))) {
    throw new Error(`Unsafe ZIP path: ${fileName}`);
  }
  return parts;
}

export function validateArchiveEntry(entry: ArchiveEntryLike): void {
  if ((entry.generalPurposeBitFlag & 0x1) !== 0) throw new Error(`Encrypted ZIP entry is not supported: ${entry.fileName}`);
  const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
  const type = mode & 0xf000;
  if (type === 0xa000 || (type !== 0 && type !== 0x8000 && type !== 0x4000)) {
    throw new Error(`ZIP entry is a symlink or special file: ${entry.fileName}`);
  }
  if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0 || entry.uncompressedSize > MAX_FILE_BYTES) {
    throw new Error(`ZIP entry exceeds the per-file size limit: ${entry.fileName}`);
  }
  if (!Number.isSafeInteger(entry.compressedSize) || entry.compressedSize < 0 || entry.compressedSize > MAX_FILE_BYTES) {
    throw new Error(`ZIP entry has an invalid compressed size: ${entry.fileName}`);
  }
  if (entry.uncompressedSize > 0 && (entry.compressedSize === 0 || entry.uncompressedSize / entry.compressedSize > MAX_COMPRESSION_RATIO)) {
    throw new Error(`ZIP entry has an excessive compression ratio: ${entry.fileName}`);
  }
}

export async function extractReleaseArchive(
  archive: Buffer,
  parentDirectory: string,
  expectedRoot: string,
  expectedVersion: string,
  kind: 'wiki' | 'skill'
): Promise<ExtractedPackage> {
  if (archive.byteLength === 0 || archive.byteLength > MAX_TOTAL_BYTES) throw new Error('ZIP archive is empty or exceeds the size limit.');
  const temporaryDirectory = await fs.mkdtemp(path.join(parentDirectory, 'manage-extensions-'));
  const packageDirectory = path.join(temporaryDirectory, expectedRoot);
  try {
    await fs.mkdir(packageDirectory, { recursive: true });
    await extractBuffer(archive, packageDirectory, expectedRoot);
    const versionPath = path.join(packageDirectory, 'VERSION');
    const version = (await fs.readFile(versionPath, 'utf8')).trim();
    if (version !== expectedVersion) throw new Error(`Archive VERSION (${version || 'missing'}) does not match release ${expectedVersion}.`);
    const requiredFiles = kind === 'skill'
      ? ['SKILL.md']
      : ['.agents/skills/codebase-wiki/SKILL.md', '.agents/skills/codebase-wiki/scripts/install-framework.py', 'Codex.md'];
    for (const relative of requiredFiles) {
      const stat = await fs.lstat(path.join(packageDirectory, relative));
      if (!stat.isFile()) throw new Error(`Release package is missing ${relative}.`);
    }
    return { temporaryDirectory, packageDirectory, version };
  } catch (error) {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}

export async function extractMeginSkillsArchive(
  archive: Buffer,
  parentDirectory: string,
  expectedVersion: string
): Promise<ExtractedPackage> {
  if (archive.byteLength === 0 || archive.byteLength > MAX_TOTAL_BYTES) throw new Error('Megin ZIP archive is empty or exceeds the size limit.');
  if (!expectedVersion) throw new Error('Megin release version is missing.');
  const temporaryDirectory = await fs.mkdtemp(path.join(parentDirectory, 'manage-extensions-megin-'));
  const packageDirectory = path.join(temporaryDirectory, 'bundle');
  try {
    await fs.mkdir(packageDirectory, { recursive: true });
    await extractBuffer(archive, packageDirectory, undefined);
    const rootEntries = await fs.readdir(packageDirectory, { withFileTypes: true });
    const actualDirectories = rootEntries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
    const expectedDirectories = [...MEGIN_SKILL_DIRECTORIES].sort();
    if (actualDirectories.length !== expectedDirectories.length || actualDirectories.some((name, index) => name !== expectedDirectories[index])) {
      throw new Error('Megin archive must contain exactly the twelve supported skill directories.');
    }
    for (const directory of MEGIN_SKILL_DIRECTORIES) {
      const root = path.join(packageDirectory, directory);
      const rootStat = await fs.lstat(root);
      if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error(`Megin skill path is not a regular directory: ${directory}`);
      const skill = path.join(root, 'SKILL.md');
      const skillStat = await fs.lstat(skill).catch(() => undefined);
      if (!skillStat?.isFile() || skillStat.isSymbolicLink()) throw new Error(`Megin archive is missing a regular ${directory}/SKILL.md.`);
    }
    return { temporaryDirectory, packageDirectory, version: expectedVersion };
  } catch (error) {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}

async function extractBuffer(archive: Buffer, packageDirectory: string, expectedRoot: string | undefined): Promise<void> {
  const zipFile = await openBuffer(archive);
  if (zipFile.entryCount > MAX_ENTRIES) {
    zipFile.close();
    throw new Error('ZIP archive has too many entries.');
  }
  let totalBytes = 0;
  const seen = new Set<string>();
  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const fail = (error: Error): void => {
        if (!settled) {
          settled = true;
          zipFile.close();
          reject(error);
        }
      };
      zipFile.on('error', fail);
      zipFile.on('end', () => {
        if (!settled) { settled = true; resolve(); }
      });
      zipFile.on('entry', (entry: Entry) => {
        if (settled) return;
        void processEntry(zipFile, entry).then(() => zipFile.readEntry(), error => fail(asError(error)));
      });
      async function processEntry(zip: ZipFile, entry: Entry): Promise<void> {
        validateArchiveEntry(entry);
        const unixType = (entry.externalFileAttributes >>> 16) & 0xf000;
        const isDirectory = entry.fileName.endsWith('/');
        if ((unixType === 0x4000 && !isDirectory) || (unixType === 0x8000 && isDirectory)) throw new Error(`ZIP entry type does not match its path: ${entry.fileName}`);
        totalBytes += entry.uncompressedSize;
        if (totalBytes > MAX_TOTAL_BYTES) throw new Error('ZIP archive exceeds the expanded size limit.');
        const relative = expectedRoot ? safeArchivePath(entry.fileName, expectedRoot) : safeMeginBundlePath(entry.fileName);
        if (!relative) {
          if (!entry.fileName.endsWith('/')) throw new Error('ZIP root entry must be a directory.');
          return;
        }
        const normalizedKey = relative.toLocaleLowerCase('en-US');
        if (seen.has(normalizedKey)) throw new Error(`ZIP archive contains duplicate paths: ${relative}`);
        seen.add(normalizedKey);
        const destination = path.resolve(packageDirectory, ...relative.split('/'));
        const root = path.resolve(packageDirectory) + path.sep;
        if (!destination.startsWith(root)) throw new Error(`ZIP path escapes package directory: ${entry.fileName}`);
        if (isDirectory) {
          if (entry.uncompressedSize !== 0 || entry.compressedSize !== 0) throw new Error(`ZIP directory entry contains data: ${entry.fileName}`);
          await fs.mkdir(destination, { recursive: true });
          return;
        }
        await fs.mkdir(path.dirname(destination), { recursive: true });
        const stream = await openEntryStream(zip, entry);
        await pipeline(stream, createWriteStream(destination, { flags: 'wx', mode: 0o600 }));
        const stat = await fs.stat(destination);
        if (stat.size !== entry.uncompressedSize) throw new Error(`ZIP entry size mismatch: ${relative}`);
      }
      zipFile.readEntry();
    });
  } finally {
    if (zipFile.isOpen) zipFile.close();
  }
}

function openBuffer(archive: Buffer): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(archive, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true, strictFileNames: true }, (error, zipFile) => {
      if (error || !zipFile) reject(error ?? new Error('Unable to open ZIP archive.'));
      else resolve(zipFile);
    });
  });
}

function openEntryStream(zipFile: ZipFile, entry: Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error || !stream) reject(error ?? new Error(`Unable to read ZIP entry ${entry.fileName}.`));
      else resolve(stream);
    });
  });
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function isReservedWindowsName(value: string): boolean {
  const base = value.split('.')[0].toUpperCase();
  return /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(base);
}
