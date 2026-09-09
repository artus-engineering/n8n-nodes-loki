# AGENTS.md

Canonical contributor and AI-agent guide for `@artus-engineering/n8n-nodes-loki`. Cursor rules in `.cursor/rules/*.mdc` (if added) should point here; keep this file as the single source of truth.

## Repository map

- `nodes/Loki/Loki.node.ts` — the node's `INodeType` implementation (`execute()`).
- `nodes/Loki/LokiDescription.ts` — the node's `INodeProperties[]` (UI form fields). Kept separate from `Loki.node.ts` for readability.
- `nodes/Loki/GenericFunctions.ts` — pure, context-free helpers (URL resolution, timestamp conversion, label validation, log-line serialization, stream grouping). This is the unit-tested core of the node; every user-facing error it throws goes through `NodeOperationError` (see "n8n node lint" below), so it takes an `INode` argument.
- `nodes/Loki/Loki.node.json` — the node's codex (categories, documentation links) shown in the n8n nodes panel.
- `nodes/Loki/loki.svg` — the official Grafana Loki logo, used as the node and credential icon.
- `credentials/LokiApi.credentials.ts` — the `lokiApi` credential type: URL, optional auth (none/basic/bearer/header), tenant header, custom headers, TLS validation toggle.
- `tests/` — Vitest unit tests, one file per source file under `nodes/`/`credentials/`.
- `scripts/clean-dist.mjs` — post-build cleanup (see "Build output" below).

## n8n node/credential development

- This package must have **zero runtime dependencies** (`n8n-workflow` is a peer dependency only). n8n rejects community nodes that ship dependencies; use `this.helpers.httpRequestWithAuthentication` and other built-ins instead of adding an HTTP client.
- The node must not read environment variables or the filesystem — all configuration goes through node parameters or the credential.
- Every user-facing error must be a `NodeOperationError` or `NodeApiError` (never a raw `Error` that reaches n8n's execution engine). `GenericFunctions.ts` helpers take an `INode` for exactly this reason.
- `package.json#n8n.strict` is `true`. This requires `eslint.config.mjs` to stay **byte-identical** to `@n8n/node-cli`'s default template (`import { config } from '@n8n/node-cli/eslint'; export default config;`) — do not add overrides or ignores there. If a false-positive from `n8n-node lint` needs working around, prefer restructuring the code (see the label-default fix in `LokiDescription.ts`'s git history for an example) over touching the lint config.
- `n8n-node lint`'s `isOption`/title-case heuristic flags any object literal with exactly `{ name, value }` keys, including default values for Name/Value `fixedCollection` fields — not just genuine `INodePropertyOptions` entries. Keep such defaults empty (`default: {}`) rather than pre-filling a row, both to sidestep the false positive and for consistency with the node's other fixedCollection fields.

## Build output

`n8n-node build` (`tsc` + copy `**/*.{png,svg}` and `**/__schema__/**/*.json`) globs those extensions across the **whole repository**, only excluding `dist` and `node_modules` — there's no way to scope it further. Since this repo also has an `assets/` folder (README logo), a plain build would ship it into the npm package. `pnpm run build` therefore runs `scripts/clean-dist.mjs` afterwards, which deletes everything under `dist/` except `nodes/`, `credentials/`, and `package.json`. If you add a new top-level output n8n needs (rare), update that allowlist.

## Testing

- Vitest, `coverage-v8`, `lcovonly` output to `coverage/lcov.info` (uploaded to SonarQube by CI). Do not use the `lcov` reporter — it also writes an HTML report under `coverage/lcov-report/` whose generated JS files trip `n8n-node lint`.
- `tests/GenericFunctions.test.ts` covers the pure helpers directly.
- `tests/Loki.node.test.ts` stubs a minimal `IExecuteFunctions` (`getNodeParameter`, `getCredentials`, `getNode`, `continueOnFail`, `helpers.httpRequestWithAuthentication`) and asserts on the exact request bodies sent to Loki.
- `tests/LokiApi.credentials.test.ts` covers `authenticate()` for every auth mode.
- Do not regress coverage on changed files.

## Conventions

- **pnpm** for package management; **Biome** owns formatting and general TypeScript linting (`pnpm run lint` / `pnpm run lint:fix`) — do not introduce ESLint rules for anything Biome already covers. `pnpm run lint:n8n` (`n8n-node lint`) is a separate, n8n-specific structural check; both must pass.
- **Lefthook** formats and lints staged files on commit (`lefthook.yml`); the `lefthook` package installs it automatically via its own `postinstall` when you run `pnpm install` (no custom `prepare` script — community node packages must not carry lifecycle scripts, since those would also run for anyone who installs this package as an n8n dependency).
- **SonarQube:** SonarLint Connected Mode + MCP analysis on changed `*.ts` files before agent commits (tool priority: `analyze_file_list` → `run_advanced_code_analysis` if present → `analyze_code_snippet` last resort). Lefthook/Biome is not a substitute.
- Cross-project tooling guide: Artus portal wiki **Repository Tooling (SonarQube, CI, Cursor Agents)** or [agency-portal `docs/dev-tooling.md`](https://github.com/artus-engineering/agency-portal/blob/main/docs/dev-tooling.md).
- No comments that narrate code (`// Import X`, `// Set Y`). Keep comments for non-obvious intent, constraints, or trade-offs only.
- Avoid adding emojis to code or comments unless explicitly requested.

## Commands cheatsheet

```bash
pnpm install                 # workspace install (also installs the pre-commit hook)
pnpm run lint                # biome check
pnpm run lint:fix            # biome check --write
pnpm run lint:n8n            # n8n-node lint (structural node/credential rules)
pnpm run typecheck           # tsc --noEmit
pnpm run test                # vitest + coverage
pnpm run test:watch          # vitest --watch
pnpm run build               # n8n-node build + dist cleanup
pnpm run dev                 # n8n-node dev — launches n8n on :5678 with this node hot-linked
```

## Pre-PR checklist

Run locally before pushing:

- [ ] `pnpm run lint`
- [ ] `pnpm run lint:n8n`
- [ ] `pnpm run typecheck`
- [ ] `pnpm run build`
- [ ] `pnpm run test`

CI (`.github/workflows/branch.yaml`) enforces all of the above plus the SonarQube scan and quality gate on `ubuntu-latest` (public repo).

**Dependabot** runs yearly; weekly dependency maintenance is handled by Cursor Automation.

## Publishing

Releases are driven by GitHub Releases, not local npm scripts. See `.github/workflows/publish.yaml` and [docs/ci.md](docs/ci.md).

To cut a release:

1. Ensure `main` is green.
2. Create a GitHub Release with a semver tag, e.g. `v0.2.0` (leading `v` is stripped automatically).
3. The workflow sets `package.json` version from the release tag, runs `lint` → `lint:n8n` → `typecheck` → `build` → `test`, and publishes `@artus-engineering/n8n-nodes-loki` to the public npm registry with `npm publish --provenance`.

Publishing uses [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/) (OIDC) via the GitHub connection configured on npmjs.com for `publish.yaml`. No `NPM_TOKEN` secret is required. Do not set `NODE_AUTH_TOKEN` in the publish step — it overrides OIDC authentication. This also satisfies n8n's requirement (mandatory from 1 May 2026) that verified community nodes be published via GitHub Actions with an npm provenance statement.

### n8n community node verification

To submit this package to the [n8n Creator Portal](https://docs.n8n.io/integrations/creating-nodes/deploy/submit-community-nodes/) for the verified badge / n8n Cloud availability, after a release:

```bash
npx @n8n/scan-community-package @artus-engineering/n8n-nodes-loki
```
