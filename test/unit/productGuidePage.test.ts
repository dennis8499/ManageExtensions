import assert from 'node:assert/strict';
import test from 'node:test';
import { getProductGuide } from '../../src/productGuides';
import type { ProductGuide } from '../../src/productGuides';
import { guideCopyText, renderProductGuideHtml } from '../../src/productGuidePage';

test('guide page shows editable templates, copy controls, and a restrictive content policy', () => {
  const guide = getProductGuide('codebase-llm-wiki')!;
  const html = renderProductGuideHtml(guide, 'fixed-nonce');
  assert.match(html, /<html lang="zh-Hant">/);
  assert.match(html, /<textarea[^>]*>/);
  assert.match(html, /data-action="copy-keyword"/);
  assert.match(html, /data-action="copy-template"/);
  assert.match(html, /data-action="reset-template"/);
  assert.match(html, /default-src &#39;none&#39;/);
  assert.match(html, /script-src &#39;nonce-fixed-nonce&#39;/);
});

test('copy requests use the selected guide and preserve a user edit verbatim', () => {
  const guide = getProductGuide('merge-reviewer')!;
  const edited = '$merge-reviewer 快速審查 包含未提交變更';
  assert.equal(guideCopyText(guide, { action: 'copy-keyword', productId: guide.productId }), '$merge-reviewer');
  assert.equal(guideCopyText(guide, { action: 'copy-template', productId: guide.productId, featureId: 'quick-review', text: edited }), edited);
  assert.throws(() => guideCopyText(guide, { action: 'copy-template', productId: guide.productId, featureId: 'quick-review', text: '' }));
  assert.throws(() => guideCopyText(guide, { action: 'copy-template', productId: guide.productId, featureId: 'quick-review', text: 'a'.repeat(10001) }));
  assert.throws(() => guideCopyText(guide, { action: 'copy-keyword', productId: 'other' }));
});

test('guide content is escaped before insertion into the webview', () => {
  const original = getProductGuide('merge-reviewer')!;
  const guide: ProductGuide = {
    ...original,
    summary: '<script>alert("bad")</script>',
    features: [{ ...original.features[0], template: '</textarea><script>alert("bad")</script>' }]
  };
  const html = renderProductGuideHtml(guide, 'fixed-nonce');
  assert.ok(html.includes('&lt;script&gt;alert(&quot;bad&quot;)&lt;/script&gt;'));
  assert.ok(html.includes('&lt;/textarea&gt;&lt;script&gt;'));
  assert.ok(!html.includes('<script>alert("bad")</script>'));
});

test('Megin guide contains the copied keyword, editable skill examples, and release action', () => {
  const guide = getProductGuide('megin')!;
  const html = renderProductGuideHtml(guide, 'megin-nonce');
  assert.ok(html.includes('$megin'));
  assert.ok(html.includes('$megin-code-review'));
  assert.ok(html.includes('data-action="copy-keyword"'));
  assert.ok(html.includes('data-action="copy-template"'));
  assert.ok(html.includes('data-action="open-release"'));
  assert.ok(html.includes('data-action="install"'));
});
