Feature: Install curated repository tools into a Windows VS Code workspace

  @ME-001
  Scenario: Show curated products and require an eligible local Git workspace
    Given the extension is running in a trusted Windows workspace
    When the product view is opened
    Then Codebase LLM Wiki and MergeReviewer are listed with their installation status
    And an untrusted, non-Windows, virtual, mapped network, or non-Git workspace cannot start installation

  @ME-002
  Scenario: Install Codebase LLM Wiki through its upstream Codex installer
    Given a valid SHA-verified stable Codebase LLM Wiki release with a Codex package
    And Python 3.11 or newer is available
    When I request installation and approve the displayed dry-run changes
    Then the upstream installer applies the Codex surface in coexist mode
    And the installed VERSION matches the downloaded release

  @ME-003
  Scenario: Install MergeReviewer into the repository skill directory
    Given a valid stable MergeReviewer release ZIP and an empty local Git repository
    When I request installation
    Then the verified skill is installed in the repository project skill directory
    And its VERSION matches the release tag

  @ME-004
  Scenario: Update both products without replacing locally edited managed content
    Given an older installation of either product
    When I request an update and a managed file differs from that installed release
    Then the update reports the conflicting path and changes no target files
    And an unchanged installation updates to the selected stable release
    Then the selected stable release is installed without a conflict

  @ME-005
  Scenario: Reject invalid release metadata and unsafe ZIP entries
    Given a release with a missing or mismatched asset digest, an invalid manifest, or a corrupt archive
    When I request installation
    Then the operation fails with a useful error and leaves the repository unchanged
    And absolute, traversal, duplicate, and symlink ZIP entries are rejected

  @ME-006
  Scenario: Check releases in the background without applying updates
    Given startup update checks are enabled
    When a newer stable release is found
    Then the view shows the newer version and offers a manual update action
    And no release content is written until I explicitly choose to install or update

  @ME-007
  Scenario: Select a repository in a multi-root workspace
    Given two trusted local Git repositories are open in VS Code
    When I request an installation
    Then I must select one repository before any files are written

  @ME-008
  Scenario: Preserve local Codebase LLM Wiki changes reported by the upstream installer
    Given a Codebase LLM Wiki workspace with local managed changes
    When I request a Wiki update
    Then the upstream conflict is shown without asking to apply
    And the local target files remain unchanged

  @ME-009
  Scenario: Upgrade and repeat Codebase LLM Wiki through its upstream installer
    Given an older Codebase LLM Wiki installation and a local wiki file
    When I request a Wiki upgrade and approve the dry-run
    Then the upstream upgrade is previewed and exact-version apply preserves wiki content
    When I repeat installation of the current Wiki release
    Then the upstream upgrade preview runs without applying or prompting again
