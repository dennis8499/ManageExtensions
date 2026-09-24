# ManageExtensions

ManageExtensions is a Windows VS Code extension for installing curated tools from public GitHub Releases into the current local Git repository. Release sources are maintained in the extension catalog; users cannot enter arbitrary repository URLs.

## First supported tools

- **Codebase LLM Wiki (Codex):** validates the stable release manifest, GitHub asset digest, and manifest SHA-256, then runs the upstream installer with `--surface codex --guard-mode coexist --format json`. The extension shows the upstream dry-run plan and asks before applying.
- **MergeReviewer:** downloads the versioned skill archive, verifies the GitHub release digest, and installs the skill to `.agents/skills/merge-reviewer/`.

Before replacing MergeReviewer, the extension compares every installed file with that exact historical release, including unexpected extra files. Modified or extra paths block the update. A clean update stages the new skill beside the existing one and restores the previous directory if replacement fails.

The Activity Bar view shows each tool's installed version and available release. Startup checks can be disabled with `manageExtensions.checkUpdatesOnStartup`. Checks never install updates automatically.

## Browse features and copy Codex templates

Click either tool in the **Repo Tools** Activity Bar view to open its guide. The guide explains what the tool can do, shows its Codex keyword, and offers a searchable set of example prompts. Use **Copy Keyword** for `$codebase-wiki` or `$merge-reviewer`. Each template can be edited in the guide before **Copy Template**; **Reset** restores the bundled example. Paste the result into Codex and replace placeholders such as `{模組路徑}` or `{基礎分支}` with your values.

Reading guides and copying text work even before installation or when the workspace is not eligible for installation. The guide's **Install / Update** button uses the same existing verified installation flow as the Activity Bar action. The bundled examples are curated from the upstream [Codebase LLM Wiki Codex guide](https://github.com/dennis8499/code-base-llm-wiki/blob/main/Codex.md) and [MergeReviewer usage guide](https://github.com/dennis8499/MergeReviewer/blob/main/README.md); consult the guide shipped with an installed release if its usage changes later.

## Requirements

- Windows 10 or later, VS Code 1.95 or later, and a trusted local Git repository.
- Git on `PATH`.
- Python 3.11 or later for Codebase LLM Wiki.

Remote, virtual, mapped network drive, and untrusted workspaces are not supported for installation. The first release supports public repositories only.

## Adding another supported source

Add a curated entry to `src/catalog.ts` with its exact owner/repository, release asset naming, archive root, and project install path. Implement a product adapter when the upstream package needs an install or update contract, then connect it to `src/extension.ts` and add behavior scenarios in `features/manage-extensions.feature`. Keep release lookup scoped to catalog entries and verify each release asset before extraction.

The current adapters do not require functional changes in either upstream repository. MergeReviewer could optionally add a README example for installing its skill into `.agents/skills/merge-reviewer/`, alongside its existing global Codex installation instructions.

## Development

```powershell
npm ci
npm run compile
npm test
npm run package
```

The VSIX is written to `dist/manage-extensions-0.1.0.vsix`. Install it with VS Code's **Install from VSIX...** command. The VS Code host test downloads a stable VS Code test runtime on first use if one is not cached.
