import type { ProductId } from './catalog';

export interface GuideFeature {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly template: string;
}

export interface ProductGuide {
  readonly productId: ProductId;
  readonly summary: string;
  readonly keyword: string;
  readonly sourceUrl: string;
  readonly features: readonly GuideFeature[];
}

// Curated Codex usage examples from the upstream repositories. These are
// bundled with this extension; installation and release checks remain separate.
export const PRODUCT_GUIDES: readonly ProductGuide[] = [
  {
    productId: 'codebase-llm-wiki',
    summary: '為程式庫建立可追溯的 Markdown Wiki，並用它查詢程式行為、維護知識和產生分析文件。',
    keyword: '$codebase-wiki',
    sourceUrl: 'https://github.com/dennis8499/code-base-llm-wiki/blob/main/Codex.md',
    features: [
      {
        id: 'interactive-ingest',
        title: '分析並收錄單一模組',
        description: '先摘要指定路徑的職責、相依關係與風險，再確認是否寫入 Wiki。',
        template: '請使用 $codebase-wiki，依照 Interactive Ingest 流程分析 {模組路徑}，先摘要主要職責、相依關係與風險，待我確認後再更新 wiki。'
      },
      {
        id: 'batch-ingest',
        title: '批次建立 Wiki',
        description: '掃描指定範圍，建立初始知識頁面並更新索引與紀錄。',
        template: '請使用 $codebase-wiki，依照 Batch Ingest 流程掃描 {程式碼路徑}，建立初始 wiki，最後更新 index 與 log。'
      },
      {
        id: 'query',
        title: '查詢 Wiki',
        description: '先查 Wiki，資訊不足時才回溯來源檔案，並說明證據。',
        template: '請使用 $codebase-wiki，先查 wiki，再於必要時回溯 sources，回答：{問題}。'
      },
      {
        id: 'lint',
        title: '檢查 Wiki 品質',
        description: '檢查過期內容、連結、frontmatter 與涵蓋率；先回報問題。',
        template: '請使用 $codebase-wiki，依照 Lint 流程檢查 wiki 健康狀態，列出 critical 和 warning，先不要修復。'
      },
      {
        id: 'archaeology',
        title: '追查程式與 Git 歷史',
        description: '追蹤目前行為與歷史，分清證據、推論和不確定性。',
        template: '請使用 $codebase-wiki，依照 Code Archaeology 流程追蹤 {功能或符號} 的目前行為與 Git history，區分證據、推論與不確定性。'
      },
      {
        id: 'code-audit',
        title: 'Codebase 健檢',
        description: '盤點入口和呼叫路徑；明確健檢預設會保存 Wiki 報告，此範例使用「只回報」。',
        template: '請使用 $codebase-wiki，對 {範圍} 執行 Codebase 健檢：先盤點目前入口與呼叫路徑，再核對 source、設定與定向 Git history，分列 BUG、技術風險和待確認疑點。只回報，不寫入 Wiki、index 或 log。'
      },
      {
        id: 'adr',
        title: '記錄架構決策',
        description: '建立有來源與背景的 ADR，保存到 Wiki 決策目錄。',
        template: '請使用 $codebase-wiki，建立一份 ADR：{決策標題}，寫入 wiki/decisions/，並更新 index 與 log。'
      },
      {
        id: 'synthesis',
        title: '保存跨模組分析',
        description: '將長期有用的分析整理成可追溯的 Synthesis 頁面。',
        template: '請使用 $codebase-wiki，把 {主題} 的跨模組分析整理成 wiki/synthesis/ 頁面，保留來源並更新 index 與 log。'
      },
      {
        id: 'business-analysis',
        title: '產生 BA 業務分析',
        description: '整理業務需求、流程、規則、涵蓋範圍與待確認缺口。',
        template: '請使用 $codebase-wiki，產出 {範圍} 的 BA 業務分析文件，保留人工 notes、明列 Gap，並更新 index 與 log。'
      },
      {
        id: 'system-analysis',
        title: '產生 SA 系統分析',
        description: '從 BA 與 Wiki 建立可驗證的系統需求和追溯關係。',
        template: '請使用 $codebase-wiki，基於 BA 與目前 Wiki 產出 {範圍} 的 SA 系統分析文件，建立需求與驗證追溯，並更新 index 與 log。'
      },
      {
        id: 'system-design',
        title: '產生 SD 系統設計',
        description: '記錄關注點、架構視圖、決策與品質策略。',
        template: '請使用 $codebase-wiki，基於 SA 產出 {範圍} 的 SD 系統設計文件，建立 concerns、views、DE/ADR 與 SA 追溯，並更新 index 與 log。'
      },
      {
        id: 'notebooklm-export',
        title: '匯出 NotebookLM 知識包',
        description: '先預覽全量盤點與缺口，確認後產生每功能 BA／SA 的本機包。',
        template: '請使用 $codebase-wiki 執行現況 BA／SA NotebookLM export：先全量預覽當下 Codebase 與缺口，取得我一次確認後再建立每功能 BA／SA 與本機 pack。'
      },
      {
        id: 'update-index',
        title: '重建 Wiki 索引',
        description: '掃描現有 Wiki 頁面，更新索引與活動紀錄。',
        template: '請使用 $codebase-wiki，重新掃描 wiki/ 目錄，依現有 frontmatter 重建 wiki/index.md，並追加 wiki/log.md。'
      }
    ]
  },
  {
    productId: 'merge-reviewer',
    summary: '審查 Git 分支、commit 與 merge 結果，找出整合時可能遺失的驗證、授權、錯誤處理和資料轉換邏輯。',
    keyword: '$merge-reviewer',
    sourceUrl: 'https://github.com/dennis8499/MergeReviewer/blob/main/README.md',
    features: [
      {
        id: 'quick-review',
        title: '快速審查目前分支',
        description: '比較目前本地分支與遠端預設主分支，預設只看已提交內容。',
        template: '$merge-reviewer 快速審查'
      },
      {
        id: 'quick-working-tree',
        title: '納入未提交變更',
        description: '將已儲存的 staged、unstaged 和未追蹤檔案納入固定快照。',
        template: '$merge-reviewer 快速審查 包含未提交變更'
      },
      {
        id: 'quick-remote',
        title: '指定遠端快速審查',
        description: '工作區有多個 remote 時，明確指定要比對的遠端。',
        template: '$merge-reviewer 快速審查 遠端={remote名稱}'
      },
      {
        id: 'pre-merge',
        title: '合併前審查',
        description: '檢查比較分支相對共同祖先的變更，也會核對範圍內的 merge commit。',
        template: '$merge-reviewer 基礎分支={基礎分支} 比較分支={比較分支}'
      },
      {
        id: 'direct-compare',
        title: '直接比較兩個版本',
        description: '比較兩個明確指定的 branch、tag 或 commit 之間的完整差異。',
        template: '$merge-reviewer 基礎分支={版本A} 比較分支={版本B} 比較模式=直接比較'
      }
    ]
  },
  {
    productId: 'megin',
    summary: 'Megin coordinates a repository task through requirement discovery, planning, implementation, review, and acceptance. Megin v0.1.0 expects to start at a non-Git Group root; installing the skills in a Git repository is supported, but Megin workflows are not guaranteed to work there.',
    keyword: '$megin',
    sourceUrl: 'https://github.com/dennis8499/Megin/blob/v0.1.0/README.md',
    features: [
      {
        id: 'feature-task',
        title: 'Start a feature task',
        description: 'Ask Megin to explore the change, prepare an approval-ready plan, then implement, review, and verify the accepted work.',
        template: '$megin 幫我新增 {feature}。先探索現有程式與需求，整理可驗收的行為和實作計畫；等我核准計畫後再實作，並完成審查與驗收。'
      },
      {
        id: 'diagnose-bug',
        title: 'Diagnose a defect',
        description: 'Reproduce a suspected defect and collect read-only evidence before planning a repair.',
        template: '$megin-bug-diagnosis 診斷 {issue}。先找出可重現步驟和證據，再提出修復計畫。'
      },
      {
        id: 'review-changes',
        title: 'Review a change',
        description: 'Review the current Megin task snapshot for behavior fit, code quality, tests, and scope safety.',
        template: '$megin-code-review 審查目前 {task} 的整合變更，檢查行為、程式品質、測試、知識與範圍。'
      },
      {
        id: 'plan-work',
        title: 'Prepare an implementation plan',
        description: 'Turn an explored requirement into a bounded plan with behavior scenarios and verification commands.',
        template: '$megin-technical-planning 為 {change} 建立可驗收的 Gherkin 情境、依賴順序、TDD 步驟和驗證命令。'
      },
      {
        id: 'continue-task',
        title: 'Continue the current task',
        description: 'Resume the active Megin task from its approved plan and latest recorded evidence.',
        template: '$megin 繼續目前的 Megin 任務，先讀取已核准計畫與最新證據，再完成尚未處理的步驟。'
      }
    ]
  }
];

export function getProductGuide(productId: string): ProductGuide | undefined {
  return PRODUCT_GUIDES.find(guide => guide.productId === productId);
}
