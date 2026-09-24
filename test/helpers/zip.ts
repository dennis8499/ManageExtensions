import { deflateRawSync } from 'node:zlib';

interface Member {
  readonly name: string;
  readonly data: Buffer | string;
  readonly mode?: number;
  readonly method?: 0 | 8;
}

export function makeZip(members: readonly Member[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const member of members) {
    const name = Buffer.from(member.name, 'utf8');
    const data = Buffer.isBuffer(member.data) ? member.data : Buffer.from(member.data, 'utf8');
    const method = member.method ?? 0;
    const compressed = method === 8 ? deflateRawSync(data) : data;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((member.mode ?? 0o100644) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(members.length, 8);
  end.writeUInt16LE(members.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

export function makeSkillZip(version: string, files: Record<string, string> = {}): Buffer {
  return makeZip([
    { name: 'merge-reviewer/VERSION', data: version },
    { name: 'merge-reviewer/SKILL.md', data: files['SKILL.md'] ?? `# MergeReviewer ${version}\n` },
    ...Object.entries(files).filter(([name]) => name !== 'SKILL.md').map(([name, data]) => ({ name: `merge-reviewer/${name}`, data }))
  ]);
}

export const MEGIN_SKILL_DIRECTORIES = [
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
] as const;

export function makeMeginZip(version: string, options: { missingSkill?: string; extraPath?: string; edit?: string } = {}): Buffer {
  const members: Member[] = [{ name: 'README.md', data: '# Megin skills\n' }];
  for (const directory of MEGIN_SKILL_DIRECTORIES) {
    if (directory === options.missingSkill) {
      members.push({ name: `${directory}/`, data: '', mode: 0o40755 });
      continue;
    }
    members.push({ name: `${directory}/SKILL.md`, data: `# ${directory} ${options.edit ?? version}\n` });
    members.push({ name: `${directory}/examples/example.md`, data: `Release ${version}\n` });
  }
  if (options.extraPath) members.push({ name: options.extraPath, data: 'unexpected\n' });
  return makeZip(members);
}

export function makeWikiZip(version: string): Buffer {
  return makeZip([
    { name: `codebase-llm-wiki-codex-${version}/VERSION`, data: version },
    { name: `codebase-llm-wiki-codex-${version}/AGENTS.md`, data: '# Instructions\n' },
    { name: `codebase-llm-wiki-codex-${version}/LICENSE`, data: 'MIT' },
    { name: `codebase-llm-wiki-codex-${version}/README.md`, data: '# Codebase LLM Wiki — Codex package\n' },
    { name: `codebase-llm-wiki-codex-${version}/Codex.md`, data: '# Codex instructions\n' },
    { name: `codebase-llm-wiki-codex-${version}/.codex/config.toml`, data: 'mode = "coexist"\n' },
    { name: `codebase-llm-wiki-codex-${version}/.agents/skills/codebase-wiki/SKILL.md`, data: '# Codebase Wiki skill\n' },
    { name: `codebase-llm-wiki-codex-${version}/.agents/skills/codebase-wiki/scripts/install-framework.py`, data: '# Fake upstream installer fixture\n' }
  ]);
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
