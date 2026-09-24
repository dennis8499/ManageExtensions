import assert from 'node:assert/strict';
import test from 'node:test';
import { PRODUCT_CATALOG, getProduct } from '../../src/catalog';

test('catalog contains only the two curated public products', () => {
  assert.deepEqual(PRODUCT_CATALOG.map(product => product.id), ['codebase-llm-wiki', 'merge-reviewer']);
  assert.equal(getProduct('codebase-llm-wiki')?.repository, 'dennis8499/code-base-llm-wiki');
  assert.equal(getProduct('merge-reviewer')?.repository, 'dennis8499/MergeReviewer');
  assert.equal(getProduct('arbitrary-repo'), undefined);
});
