<div align="center">
  <img alt="Artus Engineering" src="assets/Artus-Engineering-Logos_artus-logo-groß-wort-und-bildmarke-zweizeilig-violet.svg" width="400" />
</div>

<p align="center">
  An <a href="https://n8n.io" target="_blank">n8n</a> community node that sends log lines to <a href="https://grafana.com/oss/loki/" target="_blank">Grafana Loki</a> — plain text or JSON, with optional auth and custom headers.
</p>

<div align="center">
  <a href="https://www.npmjs.com/package/@artus-engineering/n8n-nodes-loki"><img alt="NPM Version" src="https://img.shields.io/npm/v/%40artus-engineering%2Fn8n-nodes-loki"></a>
  <a href="https://github.com/artus-engineering/n8n-nodes-loki/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/badge/License-MIT-8b5cf6"></a>
  <a href="https://github.com/artus-engineering/n8n-nodes-loki/actions/workflows/branch.yaml"><img alt="CI Status" src="https://img.shields.io/github/actions/workflow/status/artus-engineering/n8n-nodes-loki/.github%2Fworkflows%2Fbranch.yaml?label=CI&logo=GitHub"></a>
  <a href="https://sonar.artus-engineering.de/dashboard?id=artus-engineering_n8n-nodes-loki_f771277c-125c-400f-aca0-df3d8c63b594"><img alt="SonarQube Quality Gate" src="https://sonar.artus-engineering.de/api/project_badges/measure?project=artus-engineering_n8n-nodes-loki_f771277c-125c-400f-aca0-df3d8c63b594&metric=alert_status"></a>
  <img alt="n8n community node" src="https://img.shields.io/badge/n8n-community--node-ea4b71?logo=n8n&logoColor=white">
</div>

<hr />

## Table of Contents <!-- omit in toc -->

- [Features](#features)
- [Installation](#installation)
- [Credential](#credential)
- [Node reference](#node-reference)
- [Usage](#usage)
- [Loki push payload](#loki-push-payload)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Releases](#releases)

## Features

- **Auto-detected Loki URL** — Enter a base URL (`https://loki.example.com`) or the full push endpoint (`.../loki/api/v1/push`); both work
- **Optional authentication** — None, Basic Auth, Bearer Token, or a custom header — configured once on a reusable credential
- **Custom headers & multi-tenant support** — Arbitrary headers plus a dedicated `X-Scope-OrgID` tenant field
- **Plain text or JSON messages** — Free-form JSON, or build a JSON object from typed key/value fields, no manual `JSON.stringify` needed
- **Labels & structured metadata** — Set Loki stream labels and per-entry structured metadata from the node UI
- **Batching** — Send all input items in a single push request (grouped into streams by label set), or one request per item
- **Zero runtime dependencies** — Uses n8n's built-in HTTP helpers only, per n8n's community node requirements
- **Full TypeScript support** — Written in strict TypeScript against `n8n-workflow`'s types

## Installation

### From the n8n GUI (recommended)

In n8n, go to **Settings → Community Nodes → Install**, and enter:

```
@artus-engineering/n8n-nodes-loki
```

### Self-hosted, via npm

```bash
npm install @artus-engineering/n8n-nodes-loki
```

See n8n's [community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) for details (including instructions for `npm`-restricted or Docker deployments).

## Credential

Create a **Loki API** credential and configure:

| Field | Description |
| --- | --- |
| **Loki URL** | Base URL or full push endpoint, e.g. `https://loki.example.com` or `https://loki.example.com/loki/api/v1/push` — both work |
| **Authentication** | `None` (default), `Basic Auth`, `Bearer Token`, or `Header Auth` |
| **Username / Password** | Shown for Basic Auth |
| **Token** | Shown for Bearer Token |
| **Header Name / Header Value** | Shown for Header Auth, e.g. an `X-Api-Key` header |
| **Tenant ID (X-Scope-OrgID)** | Sent as `X-Scope-OrgID` for multi-tenant Loki setups. Leave empty otherwise |
| **Custom Headers** | Arbitrary name/value headers sent with every request |
| **Ignore SSL Issues (Insecure)** | Accept self-signed or otherwise invalid TLS certificates |

Use **Test** on the credential to verify connectivity (calls `GET /loki/api/v1/labels`).

## Node reference

| Parameter | Description |
| --- | --- |
| **Operation** | `Send Log` — pushes one or more log lines to Loki |
| **Labels** | Loki stream labels (name/value pairs). At least one is required, e.g. `job` = `n8n` |
| **Log Format** | `Text` or `JSON` |
| **Message** | The plain-text log line (shown for `Text`) |
| **JSON Input Mode** | `JSON` (a raw JSON value) or `Fields Below` (build an object from typed fields) — shown for `JSON` |
| **JSON** | The raw JSON log line — shown for JSON Input Mode `JSON` |
| **Fields** | Name/Value/Type rows (String, Number, Boolean, JSON) assembled into the JSON log line — shown for JSON Input Mode `Fields Below` |

### Options

| Option | Description |
| --- | --- |
| **Timestamp** | ISO-8601 or epoch (seconds/ms/µs/ns auto-detected). Defaults to now |
| **Structured Metadata** | Per-entry [structured metadata](https://grafana.com/docs/loki/latest/get-started/labels/structured-metadata/) (indexed but not part of the stream labels) |
| **Send All Items in One Request** | Default on. Groups all input items into one push request (still split into separate streams per distinct label set); disable to send one request per item |
| **Additional Headers** | Extra headers for this request, layered on top of the credential's |
| **Timeout** | Request timeout in ms (default `10000`) |

## Usage

### Plain text

Set **Log Format** to `Text`, add a `job` label, and enter a message:

```
job = n8n
Message: Workflow "Order Sync" completed successfully
```

### Free-form JSON

Set **Log Format** to `JSON`, **JSON Input Mode** to `JSON`:

```json
{
  "event": "order.synced",
  "orderId": "{{ $json.orderId }}",
  "durationMs": 842
}
```

### Key/value JSON (no manual stringify)

Set **JSON Input Mode** to `Fields Below` and add typed fields:

| Name | Value | Type |
| --- | --- | --- |
| `event` | `order.synced` | String |
| `orderId` | `{{ $json.orderId }}` | String |
| `durationMs` | `842` | Number |
| `success` | `true` | Boolean |

### Multiple items in one stream

With **Send All Items in One Request** enabled (default), feeding the node multiple input items with the same labels sends one push request containing one stream with all entries, sorted by timestamp — the efficient way to log a batch.

## Loki push payload

The node builds a standard Loki [push API](https://grafana.com/docs/loki/latest/reference/loki-http-api/#ingest-logs) request. For the plain-text example above, it sends:

```json
{
  "streams": [
    {
      "stream": { "job": "n8n" },
      "values": [
        ["1717000000000000000", "Workflow \"Order Sync\" completed successfully"]
      ]
    }
  ]
}
```

## Troubleshooting

| Problem | Cause |
| --- | --- |
| `400 Bad Request` mentioning a label | Label names must match `[a-zA-Z_][a-zA-Z0-9_]*` — no hyphens or leading digits |
| `400` — entry out of order / too far behind | Loki requires non-decreasing timestamps per stream; check the **Timestamp** option and clock skew |
| `401` / `403` | Check the credential's authentication settings and, for multi-tenant Loki, the **Tenant ID (X-Scope-OrgID)** field |
| `ECONNREFUSED` / TLS errors | Verify the **Loki URL**, and enable **Ignore SSL Issues** for self-signed certificates on self-hosted Loki |

## Development

Clone the repository and install dependencies:

```bash
pnpm install
pnpm run dev    # launches n8n on :5678 with this node hot-linked
```

Run the full check suite before opening a pull request:

```bash
pnpm run lint       # biome
pnpm run lint:n8n   # n8n node/credential structural rules
pnpm run typecheck
pnpm run build
pnpm run test
```

See [AGENTS.md](AGENTS.md) for contributor conventions.

## Releases

Packages are published to [npm](https://www.npmjs.com/package/@artus-engineering/n8n-nodes-loki) when a [GitHub Release](https://github.com/artus-engineering/n8n-nodes-loki/releases) is published.

1. Ensure `main` is green.
2. Create a GitHub Release with a semver tag, e.g. `v0.2.0`.
3. The publish workflow runs lint, type checks, builds, tests, and publishes to npm via [Trusted Publishing](https://docs.npmjs.com/trusted-publishers/) with npm provenance (no npm token required).

The release tag (without the leading `v`) becomes the package version.

---

Maintained by [Artus Engineering GmbH](https://artus-engineering.de).
