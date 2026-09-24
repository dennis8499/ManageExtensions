import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  GitHubReleaseClient,
  ReleaseLookupError,
  selectLatestStableRelease,
  selectMeginAsset,
  selectMergeReviewerAsset,
  selectWikiManifestAsset,
  validateSha256,
  validateWikiManifest
} from '../../src/github/releases';
import { makeMeginZip, makeWikiZip } from '../helpers/zip';

const sha = 'a'.repeat(64);

test('selects the latest stable release and validates its SemVer tag', () => {
  assert.equal(selectLatestStableRelease([
    { tag_name: 'v9.0.0-beta.1', prerelease: true, draft: false, assets: [] },
    { tag_name: 'v1.2.3', prerelease: false, draft: false, assets: [] }
  ])?.tag_name, 'v1.2.3');
  assert.equal(selectLatestStableRelease([
    { tag_name: 'main', prerelease: false, draft: false, assets: [] }
  ]), undefined);
});

test('finds exact release assets and validates SHA-256 metadata', () => {
  const release = {
    tag_name: 'v1.2.3', prerelease: false, draft: false,
    assets: [
      { name: 'codebase-llm-wiki-codex.zip', browser_download_url: 'https://github.com/a.zip', digest: `sha256:${sha}` },
      { name: 'update-manifest.json', browser_download_url: 'https://github.com/manifest.json', digest: `sha256:${sha}` },
      { name: 'merge-reviewer-1.2.3.zip', browser_download_url: 'https://github.com/mr.zip', digest: `sha256:${sha}` }
    ]
  };
  assert.equal(selectWikiManifestAsset(release)?.name, 'update-manifest.json');
  assert.equal(selectMergeReviewerAsset(release)?.name, 'merge-reviewer-1.2.3.zip');
  assert.throws(() => validateSha256(`sha256:${'z'.repeat(64)}`), /SHA-256/i);
});

test('selects only the Megin release bundle and verifies GitHub SHA-256 before returning it', async () => {
  const zip = makeMeginZip('0.1.0');
  const digest = createHash('sha256').update(zip).digest('hex');
  const url = 'https://github.com/dennis8499/Megin/releases/download/v0.1.0/megin-skills.zip';
  const release = {
    tag_name: 'v0.1.0', prerelease: false, draft: false,
    assets: [{ name: 'megin-skills.zip', browser_download_url: url, digest: `sha256:${digest}`, size: zip.length }]
  };
  assert.equal(selectMeginAsset(release)?.name, 'megin-skills.zip');
  const client = new GitHubReleaseClient(async () => new Response(zip, { status: 200, headers: { 'content-length': String(zip.length) } }));
  assert.deepEqual(await client.downloadProductArchive('megin', release), zip);
  assert.equal(selectMeginAsset({ ...release, assets: [{ ...release.assets[0], name: 'other.zip' }] }), undefined);
  const badDigest = { ...release, assets: [{ ...release.assets[0], digest: `sha256:${'0'.repeat(64)}` }] };
  await assert.rejects(() => client.downloadProductArchive('megin', badDigest), /SHA-256 mismatch/i);
});

test('uses GitHub API safely and reports HTTP errors', async () => {
  const calls: string[] = [];
  const client = new GitHubReleaseClient(async (input, init) => {
    calls.push(String(input));
    assert.equal(new Headers(init?.headers).get('accept'), 'application/vnd.github+json');
    return new Response(JSON.stringify({ tag_name: 'v1.0.0', prerelease: false, draft: false, assets: [] }), { status: 200 });
  });
  const release = await client.getLatest('dennis8499/MergeReviewer');
  assert.equal(release.tag_name, 'v1.0.0');
  assert.equal(calls[0], 'https://api.github.com/repos/dennis8499/MergeReviewer/releases/latest');

  const failed = new GitHubReleaseClient(async () => new Response('rate limited', { status: 403 }));
  await assert.rejects(() => failed.getLatest('dennis8499/MergeReviewer'), ReleaseLookupError);
});

test('validates the Wiki Codex manifest against the exact release asset and archive SHA-256', async () => {
  const tag = 'v0.2.1';
  const zipName = 'codebase-llm-wiki-codex.zip';
  const zipUrl = `https://github.com/dennis8499/code-base-llm-wiki/releases/download/${tag}/${zipName}`;
  const manifestUrl = `https://github.com/dennis8499/code-base-llm-wiki/releases/download/${tag}/update-manifest.json`;
  const zip = makeWikiZip('0.2.1');
  const zipDigest = createHash('sha256').update(zip).digest('hex');
  const manifest = Buffer.from(JSON.stringify({
    schema_version: 2,
    product: 'codebase-llm-wiki',
    version: '0.2.1',
    tag,
    channel: 'stable',
    installer_contract_version: 6,
    assets: [{ name: zipName, surface: 'codex', format: 'zip', download_url: zipUrl, sha256: zipDigest }]
  }));
  const release = {
    tag_name: tag,
    prerelease: false,
    draft: false,
    assets: [
      { name: 'update-manifest.json', browser_download_url: manifestUrl, digest: `sha256:${createHash('sha256').update(manifest).digest('hex')}`, size: manifest.length },
      { name: zipName, browser_download_url: zipUrl, digest: `sha256:${zipDigest}`, size: zip.length }
    ]
  };
  const client = new GitHubReleaseClient(async input => {
    const requested = String(input);
    return new Response(requested === manifestUrl ? manifest : zip, { status: 200, headers: { 'content-length': String(requested === manifestUrl ? manifest.length : zip.length) } });
  });
  const result = await client.downloadWikiAssets(release);
  assert.deepEqual(result.zip, zip);
  assert.equal(result.manifest.installer_contract_version, 6);
  assert.throws(() => validateWikiManifest({ schema_version: 2, product: 'codebase-llm-wiki', version: '0.2.1', tag, channel: 'stable', installer_contract_version: 6, assets: [] }, release), /Codex ZIP/i);
});
