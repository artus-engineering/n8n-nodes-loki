# CI (GitHub Actions)

Runner: `ubuntu-latest` (public repo). Cross-project tooling: [Repository Tooling (SonarQube, CI, Cursor Agents)](https://github.com/artus-engineering/agency-portal/blob/main/docs/dev-tooling.md) — also in the Artus portal wiki under SWE → Wissen → Software Engineering.

## Workflows

| File | Purpose |
| --- | --- |
| `.github/workflows/branch.yaml` | Biome lint, n8n node/credential lint, type check, build, unit tests → SonarQube scan → quality gate |
| `.github/workflows/publish.yaml` | On a published GitHub Release: lint, type check, build, test, `npm publish --provenance` |

## Required checks

On `main`:

- **Tests**
- **SonarQube Scan**

The quality gate runs inside the **SonarQube Scan** job — a failed gate fails that check.

Secrets: `SONAR_TOKEN`, `SONAR_HOST_URL`.

PRs use the `pull_request` event so tests and Sonar analyze the PR head. `pull_request_target` checks out the base branch (`main`), and the community branch plugin then records the run as `branch=main` — the quality gate fails on existing main issues and never sees the PR fixes.

## Publishing and npm provenance

`publish.yaml` publishes with `npm publish --provenance --access public` using npm [Trusted Publishing](https://docs.npmjs.com/trusted-publishers/) (GitHub OIDC) — no `NPM_TOKEN` secret, and `NODE_AUTH_TOKEN` must never be set in that step (it overrides OIDC authentication).

This is not just an org convention here: from **1 May 2026**, n8n requires community nodes submitted for verification to be published via a GitHub Actions workflow with a provenance statement, and will not accept nodes published from a local machine. Publishing only ever happens through this workflow, triggered by a GitHub Release — never via a local `npm publish`.

## n8n node lint

`pnpm run lint:n8n` runs `n8n-node lint` (ESLint + `eslint-plugin-n8n-nodes-base` + `@n8n/eslint-plugin-community-nodes`, all shipped by `@n8n/node-cli`). This checks n8n-specific structural rules (credential/node shape, sensitive-field handling, action/display-name casing, forbidden lifecycle scripts) that Biome doesn't know about. It is a separate check from `pnpm run lint` (Biome, which owns all formatting and general TypeScript linting) — see [AGENTS.md](../AGENTS.md).

`package.json#n8n.strict` is `true`, which requires `eslint.config.mjs` to stay byte-identical to `@n8n/node-cli`'s default template. Do not edit that file.
