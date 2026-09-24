import assert from 'node:assert/strict';
import test from 'node:test';
import { PRODUCT_CATALOG } from '../../src/catalog';
import { getProductGuide, PRODUCT_GUIDES } from '../../src/productGuides';

test('the two guides cover the curated products with Codex keywords and distinct templates', () => {
  assert.deepEqual(PRODUCT_GUIDES.map(guide => guide.productId), PRODUCT_CATALOG.map(product => product.id));
  assert.equal(getProductGuide('codebase-llm-wiki')?.keyword, '$codebase-wiki');
  assert.equal(getProductGuide('merge-reviewer')?.keyword, '$merge-reviewer');
  assert.equal(getProductGuide('unknown'), undefined);

  for (const guide of PRODUCT_GUIDES) {
    assert.ok(guide.summary.trim());
    assert.equal(new Set(guide.features.map(feature => feature.id)).size, guide.features.length);
    for (const feature of guide.features) {
      assert.ok(feature.title.trim());
      assert.ok(feature.description.trim());
      assert.ok(feature.template.includes(guide.keyword), `${feature.id} should invoke the installed Codex skill`);
    }
  }
});

test('the Wiki guide offers its documented workflows and MergeReviewer offers comparison variants', () => {
  const wiki = getProductGuide('codebase-llm-wiki')!;
  const reviewer = getProductGuide('merge-reviewer')!;
  assert.equal(wiki.features.length, 13);
  assert.equal(reviewer.features.length, 5);
  assert.ok(wiki.features.some(feature => feature.id === 'query'));
  assert.ok(wiki.features.some(feature => feature.id === 'code-audit'));
  assert.ok(reviewer.features.some(feature => feature.id === 'quick-review'));
  assert.ok(reviewer.features.some(feature => feature.id === 'direct-compare'));
});

test('the Codebase audit example makes its Wiki write boundary explicit', () => {
  const audit = getProductGuide('codebase-llm-wiki')!.features.find(feature => feature.id === 'code-audit')!;
  assert.match(audit.description, /預設.*保存/);
  assert.match(audit.template, /只回報/);
});
