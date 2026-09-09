<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/artus-engineering-logo-white.svg" />
    <source media="(prefers-color-scheme: light)" srcset="assets/artus-engineering-logo-black.svg" />
    <img alt="Artus Engineering" src="assets/artus-engineering-logo-black.svg" width="400" />
  </picture>
</div>

<p align="center">
  An <a href="https://n8n.io" target="_blank">n8n</a> community node that sends log lines to <a href="https://grafana.com/oss/loki/" target="_blank">Grafana Loki</a>. Plain text or JSON, with optional auth and custom headers.
</p>

<div align="center">
  <a href="https://www.npmjs.com/package/@artus-engineering/n8n-nodes-loki"><img alt="NPM Version" src="https://img.shields.io/npm/v/%40artus-engineering%2Fn8n-nodes-loki"></a>
  <a href="https://github.com/artus-engineering/n8n-nodes-loki/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/badge/License-MIT-8b5cf6"></a>
  <a href="https://github.com/artus-engineering/n8n-nodes-loki/actions/workflows/branch.yaml"><img alt="CI Status" src="https://img.shields.io/github/actions/workflow/status/artus-engineering/n8n-nodes-loki/.github%2Fworkflows%2Fbranch.yaml?label=CI&logo=GitHub"></a>
  <a href="https://sonar.artus-engineering.de/dashboard?id=artus-engineering_n8n-nodes-loki_f771277c-125c-400f-aca0-df3d8c63b594"><img alt="SonarQube Quality Gate" src="https://sonar.artus-engineering.de/api/project_badges/measure?project=artus-engineering_n8n-nodes-loki_f771277c-125c-400f-aca0-df3d8c63b594&metric=alert_status&token=sqb_a5a57356a20825f17494e7b95caf1d0a015b00e7"></a>
  <img alt="n8n community node" src="https://img.shields.io/badge/n8n-community--node-ea4b71?logo=n8n&logoColor=white">
</div>

<hr />

## Table of Contents <!-- omit in toc -->

- [Features](#features)
- [Installation](#installation)
  - [From the n8n GUI (recommended)](#from-the-n8n-gui-recommended)
  - [Self-hosted, via npm](#self-hosted-via-npm)
- [Credential](#credential)
- [Node reference](#node-reference)
  - [Options](#options)
- [Automatic n8n context](#automatic-n8n-context)
- [Workflow-level logging toggle](#workflow-level-logging-toggle)
  - [Sub-workflows](#sub-workflows)
- [Usage](#usage)
  - [Plain text](#plain-text)
  - [Free-form JSON](#free-form-json)
  - [Key/value JSON (no manual stringify)](#keyvalue-json-no-manual-stringify)
  - [Multiple items in one stream](#multiple-items-in-one-stream)
- [Loki push payload](#loki-push-payload)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Releases](#releases)

## Features

- **Auto-detected Loki URL** — Enter a base URL (`https://loki.example.com`) or the full push endpoint (`.../loki/api/v1/push`); both work
- **Optional authentication** — None, Basic Auth, Bearer Token, or a custom header — configured once on a reusable credential
- **Custom headers & multi-tenant support** — Arbitrary headers plus a dedicated `X-Scope-OrgID` tenant field
- **Plain text or JSON messages** — Free-form JSON, or build a JSON object from typed key/value fields, no manual `JSON.stringify` needed
- **Automatic n8n context** — Every entry gets `job`, `workflow` and `workflow_id` stream labels plus the execution ID as structured metadata
- **Labels & structured metadata** — Set additional Loki stream labels and per-entry structured metadata from the node UI
- **Workflow-level mute** — A `Set Workflow Logging` operation on one Loki node turns logging off for every Loki node downstream, sub-workflows included, without disabling each one
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
| **Header Name / Header Secret** | Shown for Header Auth, e.g. an `X-Api-Key` header |
| **Tenant ID (X-Scope-OrgID)** | Sent as `X-Scope-OrgID` for multi-tenant Loki setups. Leave empty otherwise |
| **Custom Headers** | Arbitrary name/value headers sent with every request |
| **Ignore SSL Issues (Insecure)** | Accept self-signed or otherwise invalid TLS certificates |

Use **Test** on the credential to verify connectivity (calls `GET /loki/api/v1/labels`).

## Node reference

| Parameter | Description |
| --- | --- |
| **Operation** | `Send Log` — pushes one or more log lines to Loki. `Set Workflow Logging` — a pass-through switch that later Loki nodes read to mute or allow logging |
| **Logging Enabled** | Shown for `Set Workflow Logging`. Defaults to on. Turn off to mute every Loki node further down this workflow |
| **Labels** | Extra Loki stream labels (name/value pairs, Edit Fields–style). Shown for both operations: on Send Log they apply to this entry; on Set Workflow Logging they are added to every downstream Loki node. A same-name label on Send Log overrides the workflow default. `job` (`n8n`), `workflow` and `workflow_id` are added automatically. In workflow JSON this is `{ "assignments": [{ "name": "env", "value": "prod", "type": "string" }] }` |
| **Log Format** | `Text` or `JSON` |
| **Message** | The plain-text log line (shown for `Text`) |
| **JSON Input Mode** | `JSON` (a raw JSON value) or `Fields Below` (build an object from typed fields) — shown for `JSON` |
| **JSON** | The raw JSON log line — shown for JSON Input Mode `JSON` |
| **Fields** | Name/Value/Type rows assembled into the JSON log line — shown for JSON Input Mode `Fields Below`. Same `assignments` JSON shape as Labels |

### Options

| Option | Description |
| --- | --- |
| **Timestamp** | ISO-8601 or epoch (seconds/ms/µs/ns auto-detected). Defaults to now. Do not also add a `timestamp` label or JSON field — Loki already indexes this value on the entry |
| **Structured Metadata** | Extra per-entry [structured metadata](https://grafana.com/docs/loki/latest/get-started/labels/structured-metadata/) (indexed but not part of the stream labels). The execution ID is always added as `execution_id`. Also available on Set Workflow Logging as a default for downstream nodes |
| **Send All Items in One Request** | Default on. Groups all input items into one push request (still split into separate streams per distinct label set); disable to send one request per item. Send Log only |
| **Additional Headers** | Extra headers for this request, layered on top of the credential's. Also available on Set Workflow Logging as a default for downstream nodes |
| **Timeout** | Request timeout in ms (default `10000`). Also available on Set Workflow Logging as a default for downstream nodes |
| **Propagate to Sub-Workflows** | Set Workflow Logging only, default on. Writes the resolved settings onto every item as `_lokiLogging` so sub-workflows inherit them |

## Automatic n8n context

Every log entry is tagged with the current workflow without extra fields on the node:

| Field | Where it lands | Why |
| --- | --- | --- |
| `job` | Stream label | Fixed to `n8n` so every log from this node is queryable as one job |
| `workflow` | Stream label | Low cardinality — bounded by how many workflows you have |
| `workflow_id` | Stream label | Survives a rename; same cardinality as `workflow` |
| `execution_id` | [Structured metadata](https://grafana.com/docs/loki/latest/get-started/labels/structured-metadata/) | High cardinality — a new value every run, so it must not become a stream label |
| Entry timestamp | Loki value tuple (`[ts, line]`) | Already produced automatically. Do not add a `timestamp` label or JSON field |

A user-defined label or metadata key of the same name wins over the injected value. Structured metadata requires Loki 3.0+ with a TSDB schema v13.

## Workflow-level logging toggle

n8n has no per-workflow setting a community node can register, so the mute switch lives on a Loki node itself.

1. Drop a Loki node immediately after the trigger (or anywhere that is an ancestor of every Loki node you want to gate).
2. Set **Operation** to `Set Workflow Logging`.
3. Leave **Logging Enabled** on (the default) or turn it off to mute Loki for the rest of this workflow.
4. Optionally add **Labels** and, under Options, **Additional Headers**, **Structured Metadata**, or **Timeout**. Those become defaults for every downstream `Send Log` node.

How later `Send Log` nodes resolve the switch and defaults:

- No control node upstream, or `Logging Enabled` left at its default / unset → logging stays on
- Any enabled upstream control node resolving to off disables logging ("off wins")
- A control node that is itself disabled on the canvas is ignored, so disabling that node is the quick way to restore logging
- The control node can use an expression (`={{ $vars.LOKI_ENABLED }}`). Expressions on a control node in the *same* workflow are evaluated in the reading Loki node's context; `Logging Enabled`, `Timeout` and `Additional Headers` are resolved once against the first input item, `Labels` and `Structured Metadata` per item
- An expression that resolves to something other than `false` (including an unset variable) leaves logging on — the switch fails open
- When logging is off, each `Send Log` node passes its input items through unchanged and does not call Loki
- Workflow labels / headers / metadata are merged under the automatic n8n context; a same-name field on the Send Log node overrides the workflow default
- Workflow Timeout is used when the Send Log node has not added Timeout itself; a local Timeout always wins
- Several enabled control nodes merge nearest-last, so the control node closest to the Send Log node wins on colliding keys

The control operation does not require a Loki credential. Also skip `Send All Items in One Request` and `Timestamp` on the control node — those stay per Send Log node.

### Sub-workflows

Nothing about a running workflow is visible from a sub-workflow, so the settings travel with the data: a control node writes them onto every item it passes through, under `_lokiLogging`. `Execute Sub-workflow` hands those items to the sub-workflow, where Loki nodes pick them up again — from their own input item, or from the `Execute Sub-workflow Trigger` if nodes in between rebuilt the items.

- Off stays off: a sub-workflow cannot re-enable logging its caller muted. A control node inside the sub-workflow can add labels, headers, metadata and a timeout on top, and merges the inherited settings into what it propagates further down, so nesting works to any depth
- The `Execute Sub-workflow Trigger` must accept the extra field. With **Input data mode** set to `Define using fields below`, n8n drops everything outside the declared schema — including `_lokiLogging` — so use `Accept all data`, or declare a `_lokiLogging` field
- Turn the `Propagate to Sub-Workflows` option off to leave the items untouched; the switch then applies inside the current workflow only
- A Loki node used as an **AI tool** is not connected into the main flow and receives no items from it, so the switch does not reach it — mute those nodes on the canvas instead

## Usage

### Plain text

Set **Log Format** to `Text` and enter a message. `job`, `workflow` and `workflow_id` are added automatically:

```
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
      "stream": { "job": "n8n", "workflow": "Order Sync", "workflow_id": "wCmWqkUNVuNhbIU0" },
      "values": [
        ["1717000000000000000", "Workflow \"Order Sync\" completed successfully", { "execution_id": "1234" }]
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
