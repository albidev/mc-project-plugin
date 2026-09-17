# AGENTS.md — MC Project Plugin

## Project Context

- Project ID: `mc-project-plugin`
- Kind: `proprietary`
- Scope: `combined`
- Primary repository: `${MC_PROJECT_ROOT}`
- Source of truth: this repository, current Mission Control plugin contract, and approved plan

## Skill Entry Point

- This is a non-Odoo project.
- Start non-trivial work with `project-skill-router`.
- Let the router select exactly one primary workflow.
- Do not replace a missing workflow with an unrelated skill.
- Use the approved project plan as the implementation scope.
- Do not modify Mission Control core; integrate through the external plugin contract.

## Development Rules

- Keep frontend and backend plugin-owned.
- Frontend must use the plugin API; it must not execute Git or access repository paths directly.
- Use the configured project registry; never accept arbitrary paths or commands from the browser.
- Separate read-only Git/GitHub operations from branch mutations.
- Mutations require strict validation, bounded execution, per-project locking, and read-back verification.
- Preserve the accepted UI baseline (design target congelato `mockup-projects-v4.html`, 17/09/2026): Files tree compatta, Local/Remote branch tabs senza pill dura, breadcrumb (`DIFF/HISTORY/COMMIT`) come header della colonna centrale con Last updated + Refresh a destra, sidebar accordion flat, Issues e Pull requests come accordion separati nella sidebar (non più footer nella colonna centrale), colonna centrale flat senza card arrotondate.

## Verification

- Run focused plugin checks, type-check, and Mission Control host build.
- Verify the real `/api/local` contract and rendered route, not only source files.
- Report unavailable checks and stale host processes explicitly.

## Protected Areas

- Do not modify Mission Control core, Hermes core, or unrelated plugins.
- Do not run Git mutations against real repositories during UI/backend contract tests.
- Never commit credentials, tokens, local registry data, runtime state, or generated private data.
