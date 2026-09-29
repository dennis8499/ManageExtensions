# 使用指南

[返回專案首頁](../README.md)

## 開啟工具清單

在 VS Code Activity Bar 選取 **Manage Extensions**，再開啟 **Repo Tools** 檢視。清單會顯示 Codebase LLM Wiki (Codex)、MergeReviewer 與 Megin 的安裝狀態。選取工具可開啟指南；清單標題列也提供更新檢查與狀態重新整理。

## 安裝與更新

1. 開啟受信任的 Windows 本機工作區。
2. 在 **Repo Tools** 選擇尚未安裝的工具，或選擇有更新的工具。
3. 按下 **Install / Update**，閱讀變更預覽。
4. 確認後才會套用檔案；取消預覽不會安裝更新。

Codebase LLM Wiki 會呼叫其上游安裝器，以 Codex surface 和 coexist 保護模式執行。MergeReviewer 與 Megin 會先檢查新舊版本檔案；若舊版內容與該版本 Release 不符，或發現缺漏、額外檔案或未管理的 Megin 技能目錄，就會停止更新並列出相關路徑。

| 工具 | 目標工作區 | 安裝位置 |
| --- | --- | --- |
| Codebase LLM Wiki (Codex) | 受信任的本機 Git 儲存庫根目錄 | `.agents/skills/codebase-wiki/` |
| MergeReviewer | 受信任的本機 Git 儲存庫根目錄 | `.agents/skills/merge-reviewer/` |
| Megin | 受信任的本機資料夾，可為非 Git 資料夾 | `.agents/skills/` 下的 12 個技能目錄及 `.agents/manage-extensions/megin.json` |

上述安裝目標必須位於本機固定或可移除磁碟。遠端、虛擬、UNC 路徑、映射網路磁碟及未受信任工作區不符合安裝條件。多根工作區會要求選取目標資料夾。

Megin v0.1.0 的上游說明預期從非 Git 的 Group 根目錄啟動。ManageExtensions 允許在 Git 根目錄安裝 Megin 技能，但會顯示警告，且不保證 Megin 工作流程在該位置正常運作。

## 工具指南與 Codex 模板

選取工具即可閱讀功能說明與使用範例。指南內可以搜尋範例、編輯模板、使用 **Copy Template** 複製編輯後的內容，或使用 **Reset** 還原內建範例。選擇 **Copy Keyword** 可複製以下關鍵字：

- Codebase LLM Wiki：`$codebase-wiki`
- MergeReviewer：`$merge-reviewer`
- Megin：`$megin`

指南和複製功能可在安裝前使用，也可在目前工作區不符合安裝條件時使用。模板來源及上游說明連結收錄於各工具指南中。

## 命令

可在 VS Code 命令面板搜尋下列命令：

| 命令 | 說明 |
| --- | --- |
| `ManageExtensions: Install Repo Tool` | 選取精選工具並安裝。 |
| `ManageExtensions: Update Repo Tool` | 選取精選工具並更新。 |
| `ManageExtensions: Check for Updates` | 檢查精選工具的最新穩定版 Release；不會安裝更新。 |
| `ManageExtensions: Refresh Status` | 重新整理 Repo Tools 中的狀態。 |
| `ManageExtensions: Open GitHub Release` | 開啟所選工具的 GitHub Releases 頁面。 |
| `ManageExtensions: View Tool Guide` | 開啟所選工具的指南。 |
| `ManageExtensions: Copy Codex Keyword` | 複製所選工具的 Codex 關鍵字。 |

## 設定

`manageExtensions.checkUpdatesOnStartup` 控制擴充功能啟動時是否檢查精選工具的更新，預設值為 `true`。更新檢查不會自動安裝任何檔案。

在 `settings.json` 關閉啟動檢查：

```json
{
  "manageExtensions.checkUpdatesOnStartup": false
}
```

## 疑難排解

| 訊息或狀況 | 建議處理方式 |
| --- | --- |
| 顯示需要 Windows | 在 Windows 10 或更新版本使用此擴充功能。 |
| 要求信任工作區 | 依組織安全政策確認工作區內容後，在 VS Code 將工作區標記為受信任。 |
| 找不到可安裝的 Git 儲存庫 | Codebase LLM Wiki 與 MergeReviewer 要求開啟本機 Git 儲存庫根目錄，並確認 `git` 可從 `PATH` 執行。Megin 可安裝到不含 Git 的本機資料夾。 |
| 多根工作區中沒有目標 | 使用安裝提示選取符合該工具條件的資料夾。 |
| Wiki 安裝器找不到 Python | 安裝 Python 3.11 或更新版本，並確認可由擴充功能找到。 |
| GitHub Release 查詢或下載失敗 | 確認網路可連線到公開 GitHub Releases，稍後重試。摘要或 Release 資料驗證失敗時，請勿繞過檢查或手動替換下載檔。 |
| 更新因本機修改或額外檔案停止 | 先備份並檢視提示列出的路徑；確認如何處理這些檔案後，再重新執行更新。 |
| Megin 提示 Group 根目錄 | 上游 Megin v0.1.0 預期從非 Git 的 Group 根目錄啟動；Git 根目錄安裝技能仍可進行，但工作流程不保證可用。 |

若要回報問題，請附上錯誤訊息、VS Code 版本、Windows 版本，以及發生問題的工具名稱；請勿附上機密程式碼或權杖。
