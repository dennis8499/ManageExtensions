Feature: Install curated repository tools into a Windows VS Code workspace

  @ME-001
  Scenario: Show curated products and require an eligible local Git workspace
    Given the extension is running in a trusted Windows workspace
    When the product view is opened
    Then Codebase LLM Wiki, MergeReviewer, and Megin are listed with their installation status
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
  Scenario: Update installed products without replacing locally edited managed content
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

  @ME-010
  Scenario: Browse product guides without an installable workspace
    Given the three curated product guides
    When I open each guide without an eligible workspace
    Then each guide explains its capabilities and shows its Codex keyword and editable templates
    And the existing installation action remains available

  @ME-011
  Scenario: Copy a keyword or a personally edited template
    Given the MergeReviewer guide is open
    When I edit its quick review template and copy it
    Then the exact edited template is copied
    And I can copy the MergeReviewer keyword without installing it
    And an unknown product or template cannot supply clipboard text

  @ME-012
  Scenario: Install Megin skills in a non-Git Group folder and report its version
    Given a valid Megin v0.1.0 release with twelve skills and a local non-Git Group folder
    When I request Megin installation and approve the preview
    Then all twelve Megin skill directories and version metadata are installed
    When I repeat installation of the current Megin release
    Then the installed version is reported without another confirmation

  @ME-013
  Scenario: Upgrade a clean Megin installation and preserve local edits on conflict
    Given an older Megin installation and a newer stable release
    When I request a clean Megin update and approve the preview
    Then all Megin skills and metadata update to the new release
    When I edit a managed Megin skill and request another update
    Then the modified path is reported and the complete Megin installation stays unchanged

  @ME-014
  Scenario: Warn when installing Megin at a Git repository root
    Given a valid Megin v0.1.0 release and a local Git repository
    When I request Megin installation and approve the preview
    Then the preview explains Megin expects a non-Git Group root

  @ME-015
  Scenario: Reject an incomplete Megin release bundle before writing target files
    Given an incomplete Megin skill bundle
    When I request Megin installation
    Then the missing skill is reported and the workspace remains unchanged

  @ME-016
  Scenario: Select a target folder in a multi-root Megin workspace
    Given two trusted local folders are open for Megin
    When I choose the non-Git folder as the Megin target
    Then the selected folder is the only Megin target and no files are written yet

  @ME-017
  Scenario: Copy a Megin usage example without installing the bundle
    Given the Megin guide is open
    When I edit a Megin template and copy it
    Then the exact Megin template is copied

  @ME-018
  Scenario: Restore the installed Megin bundle when a directory replacement fails
    Given an older Megin installation and a newer stable release
    When a Megin replacement step fails
    Then every old skill and the old version metadata are restored
