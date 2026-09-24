import { createHash } from 'node:crypto';
import { PRODUCT_CATALOG, type ProductId } from '../catalog';
import { compareVersions, parseStableVersionTag } from '../version';

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  digest?: string | null;
  size?: number;
}

export interface GitHubRelease {
  tag_name: string;
  prerelease: boolean;
  draft: boolean;
  html_url?: string;
  assets: ReleaseAsset[];
}

export interface WikiManifest {
  schema_version: number;
  product: string;
  version: string;
  tag: string;
  channel: string;
  installer_contract_version: number;
  assets: Array<{ name: string; surface: string; format: string; download_url: string; sha256: string }>;
}

export class ReleaseLookupError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ReleaseLookupError';
  }
}

const API_ROOT = 'https://api.github.com/repos/';
const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024;

export function selectLatestStableRelease(releases: GitHubRelease[]): GitHubRelease | undefined {
  return releases.filter(release => !release.draft && !release.prerelease && parseStableVersionTag(release.tag_name))
    .sort((a, b) => compareVersions(b.tag_name, a.tag_name))[0];
}

export function selectWikiManifestAsset(release: GitHubRelease): ReleaseAsset | undefined {
  return release.assets.find(asset => asset.name === 'update-manifest.json');
}

export function selectMergeReviewerAsset(release: GitHubRelease): ReleaseAsset | undefined {
  const version = parseStableVersionTag(release.tag_name);
  if (!version) return undefined;
  const product = PRODUCT_CATALOG.find(candidate => candidate.id === 'merge-reviewer');
  return product ? release.assets.find(asset => asset.name === product.archiveAssetName(version)) : undefined;
}

export function selectMeginAsset(release: GitHubRelease): ReleaseAsset | undefined {
  const version = parseStableVersionTag(release.tag_name);
  if (!version) return undefined;
  const product = PRODUCT_CATALOG.find(candidate => candidate.id === 'megin');
  return product ? release.assets.find(asset => asset.name === product.archiveAssetName(version)) : undefined;
}

export function validateSha256(value: unknown): string {
  if (typeof value !== 'string') throw new ReleaseLookupError('Release asset is missing its SHA-256 digest.');
  const candidate = value.startsWith('sha256:') ? value.slice(7) : value;
  if (!/^[a-f0-9]{64}$/i.test(candidate)) throw new ReleaseLookupError('Release contains an invalid SHA-256 digest.');
  return candidate.toLowerCase();
}

export function validateWikiManifest(value: unknown, release: GitHubRelease): WikiManifest {
  if (!value || typeof value !== 'object') throw new ReleaseLookupError('The Wiki release manifest is not a JSON object.');
  const manifest = value as Partial<WikiManifest>;
  if (manifest.schema_version !== 2 || manifest.product !== 'codebase-llm-wiki' ||
      manifest.tag !== release.tag_name || manifest.channel !== 'stable' ||
      manifest.installer_contract_version !== 6 ||
      parseStableVersionTag(manifest.version ?? '') !== parseStableVersionTag(release.tag_name) ||
      !Array.isArray(manifest.assets)) {
    throw new ReleaseLookupError('The Wiki manifest does not match the supported stable release contract (schema 2, installer contract 6).');
  }
  if (manifest.assets.some(asset => !asset || typeof asset !== 'object' || typeof asset.name !== 'string' || typeof asset.surface !== 'string' || typeof asset.format !== 'string' || typeof asset.download_url !== 'string' || typeof asset.sha256 !== 'string')) {
    throw new ReleaseLookupError('The Wiki manifest contains an invalid asset entry.');
  }
  const codexAssets = manifest.assets.filter(asset => asset.surface === 'codex' && asset.format === 'zip');
  if (codexAssets.length !== 1 || codexAssets[0].name !== 'codebase-llm-wiki-codex.zip') {
    throw new ReleaseLookupError('The Wiki manifest must declare exactly one supported Codex ZIP.');
  }
  validateSha256(codexAssets[0].sha256);
  return manifest as WikiManifest;
}

export class GitHubReleaseClient {
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async getLatest(repository: string): Promise<GitHubRelease> {
    const product = this.findProduct(repository);
    const url = `${API_ROOT}${product.repository}/releases/latest`;
    const response = await this.fetchApi(url);
    const release = await response.json() as GitHubRelease;
    if (!release) throw new ReleaseLookupError(`No stable release was found for ${repository}.`);
    return this.validateRelease(release, repository);
  }

  async getByTag(repository: string, tag: string): Promise<GitHubRelease> {
    const product = this.findProduct(repository);
    if (!parseStableVersionTag(tag)) throw new ReleaseLookupError(`Unsupported historical release tag: ${tag}`);
    const encodedTag = encodeURIComponent(tag);
    const response = await this.fetchApi(`${API_ROOT}${product.repository}/releases/tags/${encodedTag}`);
    const release = await response.json() as GitHubRelease;
    if (release?.tag_name !== tag) throw new ReleaseLookupError(`GitHub returned a different release than requested: ${release?.tag_name ?? '(missing tag)'}.`);
    return this.validateRelease(release, repository);
  }

  async downloadAsset(asset: ReleaseAsset, maxBytes = MAX_DOWNLOAD_BYTES): Promise<Buffer> {
    const url = new URL(asset.browser_download_url);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com') throw new ReleaseLookupError('Release asset uses an unexpected download host.');
    if (!Number.isSafeInteger(asset.size) || asset.size! <= 0 || asset.size! > maxBytes) throw new ReleaseLookupError('Release asset has an invalid or excessive declared size.');
    const digest = validateSha256(asset.digest);
    let response: Response;
    try { response = await this.fetcher(url.toString(), { redirect: 'follow' }); }
    catch (error) { throw new ReleaseLookupError(`Could not download release asset: ${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
    const finalUrl = new URL(response.url || url.toString());
    if (finalUrl.protocol !== 'https:' || !['github.com', 'release-assets.githubusercontent.com'].includes(finalUrl.hostname)) {
      throw new ReleaseLookupError('Release asset redirected to an unexpected host.');
    }
    if (!response.ok) throw new ReleaseLookupError(`GitHub asset download failed with HTTP ${response.status}.`);
    const lengthHeader = response.headers.get('content-length');
    const declaredLength = lengthHeader === null ? undefined : Number(lengthHeader);
    if (declaredLength !== undefined && Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new ReleaseLookupError('Release asset exceeds the download size limit.');
    if (declaredLength !== undefined && declaredLength !== asset.size) throw new ReleaseLookupError(`GitHub asset size does not match release metadata for ${asset.name}.`);
    const bytes = await readBoundedBody(response, maxBytes);
    if (bytes.length === 0 || bytes.length > maxBytes) throw new ReleaseLookupError('Downloaded release asset is empty or exceeds the size limit.');
    if (bytes.length !== asset.size) throw new ReleaseLookupError(`Downloaded asset size does not match GitHub metadata for ${asset.name}.`);
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== digest) throw new ReleaseLookupError(`SHA-256 mismatch for ${asset.name}.`);
    return bytes;
  }

  async downloadWikiAssets(release: GitHubRelease): Promise<{ manifest: WikiManifest; zip: Buffer }> {
    const manifestAsset = selectWikiManifestAsset(release);
    if (!manifestAsset) throw new ReleaseLookupError('Wiki release is missing update-manifest.json.');
    const manifestBytes = await this.downloadAsset(manifestAsset, 2 * 1024 * 1024);
    let manifestValue: unknown;
    try { manifestValue = JSON.parse(manifestBytes.toString('utf8')) as unknown; }
    catch (error) { throw new ReleaseLookupError('Wiki release manifest contains invalid JSON.', { cause: error }); }
    const manifest = validateWikiManifest(manifestValue, release);
    const codex = manifest.assets.find(asset => asset.surface === 'codex' && asset.format === 'zip');
    const product = PRODUCT_CATALOG.find(candidate => candidate.id === 'codebase-llm-wiki');
    if (!product || !codex || typeof codex.sha256 !== 'string' || codex.name !== product.archiveAssetName(parseStableVersionTag(release.tag_name)!)) {
      throw new ReleaseLookupError('Wiki manifest is missing the supported Codex ZIP SHA-256 entry.');
    }
    const zipName = codex.name;
    const zipAsset = release.assets.find(asset => asset.name === zipName);
    if (!zipAsset || codex.download_url !== zipAsset.browser_download_url) throw new ReleaseLookupError(`Wiki release is missing a matching ${zipName} asset.`);
    const zipDigest = validateSha256(codex.sha256);
    if (validateSha256(zipAsset.digest) !== zipDigest) throw new ReleaseLookupError('GitHub asset digest does not match the Wiki manifest SHA-256.');
    const zip = await this.downloadAsset(zipAsset);
    const actual = createHash('sha256').update(zip).digest('hex');
    if (actual !== zipDigest) throw new ReleaseLookupError('Wiki Codex ZIP SHA-256 does not match its release manifest.');
    return { manifest, zip };
  }

  async downloadProductArchive(id: ProductId, release: GitHubRelease): Promise<Buffer> {
    const product = PRODUCT_CATALOG.find(candidate => candidate.id === id);
    if (!product) throw new ReleaseLookupError(`Product ${id} is not in the curated catalog.`);
    if (product.kind === 'wiki') return (await this.downloadWikiAssets(release)).zip;
    if (product.kind === 'skill-bundle') {
      const asset = selectMeginAsset(release);
      if (!asset) throw new ReleaseLookupError('Megin release is missing megin-skills.zip.');
      return this.downloadAsset(asset);
    }
    const asset = selectMergeReviewerAsset(release);
    if (!asset) throw new ReleaseLookupError('MergeReviewer release is missing its versioned ZIP asset.');
    return this.downloadAsset(asset);
  }

  private findProduct(repository: string) {
    const product = PRODUCT_CATALOG.find(candidate => candidate.repository === repository);
    if (!product) throw new ReleaseLookupError(`Repository ${repository} is not in the curated catalog.`);
    return product;
  }

  private async fetchApi(url: string): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetcher(url, { headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' } });
    } catch (error) {
      throw new ReleaseLookupError(`Could not contact GitHub: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    if (!response.ok) throw new ReleaseLookupError(`GitHub release lookup failed with HTTP ${response.status}.`);
    return response;
  }

  private validateRelease(release: GitHubRelease, repository: string): GitHubRelease {
    const product = this.findProduct(repository);
    if (!release || release.draft || release.prerelease || !parseStableVersionTag(release.tag_name) || !Array.isArray(release.assets)) {
      throw new ReleaseLookupError(`GitHub returned an invalid or unstable release for ${product.title}.`);
    }
    const assetNames = new Set<string>();
    for (const asset of release.assets) {
      if (!asset || typeof asset.name !== 'string' || typeof asset.browser_download_url !== 'string' || !Number.isSafeInteger(asset.size) || asset.size! < 0 || assetNames.has(asset.name)) {
        throw new ReleaseLookupError(`GitHub returned invalid or duplicate release assets for ${product.title}.`);
      }
      assetNames.add(asset.name);
    }
    return release;
  }
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.body) throw new ReleaseLookupError('GitHub asset response has no body.');
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new ReleaseLookupError('GitHub asset exceeds the download size limit.');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, bytes);
}
