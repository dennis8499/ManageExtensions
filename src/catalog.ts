export type ProductId = 'codebase-llm-wiki' | 'merge-reviewer';

export interface ProductDefinition {
  readonly id: ProductId;
  readonly title: string;
  readonly repository: string;
  readonly releasePage: string;
  readonly kind: 'wiki' | 'skill';
  readonly installRelativePath: string;
  readonly archiveRoot: (version: string) => string;
  readonly archiveAssetName: (version: string) => string;
}

export const PRODUCT_CATALOG: readonly ProductDefinition[] = Object.freeze([
  {
    id: 'codebase-llm-wiki',
    title: 'Codebase LLM Wiki (Codex)',
    repository: 'dennis8499/code-base-llm-wiki',
    releasePage: 'https://github.com/dennis8499/code-base-llm-wiki/releases',
    kind: 'wiki',
    installRelativePath: '.agents/skills/codebase-wiki',
    archiveRoot: version => `codebase-llm-wiki-codex-${version}`,
    archiveAssetName: () => 'codebase-llm-wiki-codex.zip'
  },
  {
    id: 'merge-reviewer',
    title: 'MergeReviewer',
    repository: 'dennis8499/MergeReviewer',
    releasePage: 'https://github.com/dennis8499/MergeReviewer/releases',
    kind: 'skill',
    installRelativePath: '.agents/skills/merge-reviewer',
    archiveRoot: () => 'merge-reviewer',
    archiveAssetName: version => `merge-reviewer-${version}.zip`
  }
]);

export function getProduct(id: string): ProductDefinition | undefined {
  return PRODUCT_CATALOG.find(product => product.id === id);
}
