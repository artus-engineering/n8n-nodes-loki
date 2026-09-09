import { type INode, NodeOperationError, type NodeParameterValueType, type NodeTypeAndVersion } from 'n8n-workflow'

const LABEL_NAME_PATTERN = /^[a-zA-Z_]\w*$/
const DEFAULT_JOB_LABEL = 'n8n'
const EXECUTE_WORKFLOW_TRIGGER_TYPE = 'n8n-nodes-base.executeWorkflowTrigger'

export interface LokiLogEntry {
    labels: Record<string, string>
    line: string
    timestampNs: string
    metadata?: Record<string, string>
}

export interface N8nContext {
    workflowId?: string
    workflowName?: string
    executionId?: string
}

function presentValue(value: string | undefined): string | undefined {
    const trimmed = value?.trim()
    return trimmed || undefined
}

/**
 * Low-cardinality n8n context that is safe to attach as Loki stream labels.
 * High-cardinality values such as the execution ID belong in structured metadata.
 */
export function buildContextLabels(context: N8nContext): Record<string, string> {
    const labels: Record<string, string> = { job: DEFAULT_JOB_LABEL }
    const workflowName = presentValue(context.workflowName)
    const workflowId = presentValue(context.workflowId)
    if (workflowName) {
        labels.workflow = workflowName
    }
    if (workflowId) {
        labels.workflow_id = workflowId
    }
    return labels
}

/**
 * High-cardinality n8n context that belongs on the entry as structured metadata,
 * not as stream labels.
 */
export function buildContextMetadata(context: N8nContext): Record<string, string> {
    const metadata: Record<string, string> = {}
    const executionId = presentValue(context.executionId)
    if (executionId) {
        metadata.execution_id = executionId
    }
    return metadata
}

export interface LokiStream {
    stream: Record<string, string>
    values: Array<[string, string] | [string, string, Record<string, string>]>
}

/**
 * Resolves a user-supplied Loki URL (base URL or full push endpoint) to the
 * push endpoint. Accepts a bare host, a base URL with a trailing slash, a
 * "/loki/api/v1" URL, or the full "/loki/api/v1/push" URL.
 */
export function resolvePushUrl(raw: string, node: INode): string {
    const trimmed = (raw ?? '').trim()
    if (!trimmed) {
        throw new NodeOperationError(node, 'Loki URL is empty')
    }

    let url: URL
    try {
        url = new URL(trimmed)
    } catch {
        throw new NodeOperationError(node, `Loki URL "${trimmed}" is not a valid URL`)
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new NodeOperationError(node, `Loki URL "${trimmed}" must use http or https`)
    }

    const withoutTrailingSlash = stripTrailingSlashes(trimmed)

    if (withoutTrailingSlash.endsWith('/loki/api/v1/push')) {
        return withoutTrailingSlash
    }

    if (withoutTrailingSlash.endsWith('/loki/api/v1')) {
        return `${withoutTrailingSlash}/push`
    }

    return `${withoutTrailingSlash}/loki/api/v1/push`
}

function stripTrailingSlashes(value: string): string {
    let end = value.length
    while (end > 0 && value[end - 1] === '/') {
        end--
    }
    return value.slice(0, end)
}

/**
 * Converts a timestamp value to a decimal nanosecond string, as required by
 * the Loki push API. Accepts a Date, an ISO-8601 string, or an epoch number
 * (string or number) in seconds, milliseconds, microseconds or nanoseconds -
 * inferred from magnitude. Empty/undefined resolves to "now".
 */
export function toNanoseconds(value: string | Date | undefined, node: INode): string {
    if (value === undefined || value === null || value === '') {
        return `${BigInt(Date.now()) * 1_000_000n}`
    }

    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) {
            throw new NodeOperationError(node, 'Invalid Date provided for timestamp')
        }
        return `${BigInt(value.getTime()) * 1_000_000n}`
    }

    const trimmed = value.trim()

    if (/^\d+$/.test(trimmed)) {
        const digits = trimmed.length
        if (digits <= 10) {
            return `${BigInt(trimmed) * 1_000_000_000n}`
        }
        if (digits <= 13) {
            return `${BigInt(trimmed) * 1_000_000n}`
        }
        if (digits <= 16) {
            return `${BigInt(trimmed) * 1_000n}`
        }
        return trimmed
    }

    const parsed = new Date(trimmed)
    if (Number.isNaN(parsed.getTime())) {
        throw new NodeOperationError(node, `Invalid timestamp "${value}"`)
    }
    return `${BigInt(parsed.getTime()) * 1_000_000n}`
}

/**
 * Validates a Loki label name. Loki rejects invalid label names with a 400,
 * so this fails fast with a readable error instead.
 */
export function validateLabelName(name: string, node: INode): void {
    if (!LABEL_NAME_PATTERN.test(name)) {
        throw new NodeOperationError(
            node,
            `Invalid label name "${name}". Label names must match ${LABEL_NAME_PATTERN} (letters, digits, underscore, not starting with a digit).`
        )
    }
}

export interface TypedField {
    name: string
    value: string
    type: 'string' | 'number' | 'boolean' | 'json'
}

const NAME_VALUE_WRAPPER_KEYS = ['assignments', 'label', 'field', 'values', 'header', 'metadata', 'parameters'] as const

function mapAssignmentType(type: unknown): TypedField['type'] {
    if (type === 'number' || type === 'boolean' || type === 'json') {
        return type
    }
    if (type === 'array' || type === 'object') {
        return 'json'
    }
    return 'string'
}

function stringifyAssignmentValue(value: unknown): string {
    if (typeof value === 'string') {
        return value
    }
    if (typeof value === 'number') {
        return value.toString()
    }
    if (typeof value === 'boolean') {
        return value ? 'true' : 'false'
    }
    if (value != null && typeof value === 'object') {
        return JSON.stringify(value)
    }
    return ''
}

function rowToNameValue(row: unknown): TypedField[] {
    if (!row || typeof row !== 'object') {
        return []
    }
    const record = row as Record<string, unknown>
    const name = typeof record.name === 'string' ? record.name : ''
    if (!name) {
        return []
    }
    const type = mapAssignmentType(record.type)
    return [{ name, value: stringifyAssignmentValue(record.value), type }]
}

function isPlainNameValueMap(record: Record<string, unknown>): boolean {
    return Object.values(record).every(
        value =>
            value === undefined || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    )
}

/**
 * Accepts the shapes n8n, the Public API and MCP clients actually persist:
 * assignmentCollection (`{ assignments: [...] }`), legacy fixedCollection
 * wrappers (`label` / `field` / `values` / …), a bare row array, or a flat
 * `{ name: value }` object. fixedCollection rows are dropped on API write
 * when the wrapper key does not match the node description.
 */
export function normalizeNameValueRows(raw: unknown): TypedField[] {
    if (raw == null) {
        return []
    }
    if (Array.isArray(raw)) {
        return raw.flatMap(rowToNameValue)
    }
    if (typeof raw !== 'object') {
        return []
    }

    const record = raw as Record<string, unknown>
    for (const key of NAME_VALUE_WRAPPER_KEYS) {
        const nested = record[key]
        if (Array.isArray(nested)) {
            return nested.flatMap(rowToNameValue)
        }
    }

    if (isPlainNameValueMap(record)) {
        return Object.entries(record)
            .filter(([name]) => name.length > 0)
            .map(([name, value]) => ({
                name,
                value: stringifyAssignmentValue(value),
                type: 'string' as const
            }))
    }

    return []
}

function coerceTypedValue(field: TypedField, node: INode): unknown {
    switch (field.type) {
        case 'number': {
            const num = Number(field.value)
            if (Number.isNaN(num)) {
                throw new NodeOperationError(node, `Field "${field.name}" is not a valid number: "${field.value}"`)
            }
            return num
        }
        case 'boolean':
            return field.value === 'true' || field.value === '1'
        case 'json':
            try {
                return JSON.parse(field.value)
            } catch (error) {
                throw new NodeOperationError(
                    node,
                    `Field "${field.name}" is not valid JSON: ${(error as Error).message}`
                )
            }
        default:
            return field.value
    }
}

/**
 * Builds the log line string for a single item: plain text, a raw JSON
 * value, or an object assembled from typed key/value fields.
 */
export function serializeLogLine(format: 'text', options: { message: string }, node: INode): string
export function serializeLogLine(
    format: 'json',
    options: { jsonInputMode: 'raw'; jsonBody: unknown } | { jsonInputMode: 'fields'; fields: TypedField[] },
    node: INode
): string
export function serializeLogLine(
    format: 'text' | 'json',
    options:
        | { message: string }
        | { jsonInputMode: 'raw'; jsonBody: unknown }
        | { jsonInputMode: 'fields'; fields: TypedField[] },
    node: INode
): string {
    if (format === 'text') {
        return (options as { message: string }).message
    }

    if ('jsonInputMode' in options && options.jsonInputMode === 'raw') {
        const { jsonBody } = options
        return typeof jsonBody === 'string' ? jsonBody : JSON.stringify(jsonBody)
    }

    const { fields } = options as { jsonInputMode: 'fields'; fields: TypedField[] }
    const record: Record<string, unknown> = {}
    for (const field of fields) {
        record[field.name] = coerceTypedValue(field, node)
    }
    return JSON.stringify(record)
}

function canonicalLabelKey(labels: Record<string, string>): string {
    return Object.keys(labels)
        .sort((left, right) => left.localeCompare(right))
        .map(key => `${key}=${labels[key]}`)
        .join(',')
}

function compareNanosecondTimestamps(left: string, right: string): number {
    const leftNs = BigInt(left)
    const rightNs = BigInt(right)
    if (leftNs < rightNs) {
        return -1
    }
    if (leftNs > rightNs) {
        return 1
    }
    return 0
}

/**
 * Groups entries into Loki streams by their exact label set, and sorts each
 * stream's entries ascending by timestamp, as Loki requires entries within a
 * stream to be in non-decreasing time order.
 */
export function buildStreams(entries: LokiLogEntry[], node: INode): LokiStream[] {
    const streamsByKey = new Map<string, LokiStream>()

    for (const entry of entries) {
        for (const name of Object.keys(entry.labels)) {
            validateLabelName(name, node)
        }

        const key = canonicalLabelKey(entry.labels)
        let stream = streamsByKey.get(key)
        if (!stream) {
            stream = { stream: entry.labels, values: [] }
            streamsByKey.set(key, stream)
        }

        stream.values.push(
            entry.metadata && Object.keys(entry.metadata).length > 0
                ? [entry.timestampNs, entry.line, entry.metadata]
                : [entry.timestampNs, entry.line]
        )
    }

    for (const stream of streamsByKey.values()) {
        stream.values.sort((a, b) => compareNanosecondTimestamps(a[0], b[0]))
    }

    return [...streamsByKey.values()]
}

export interface WorkflowLoggingSettings {
    name: string
    loggingEnabled: NodeParameterValueType | undefined
    labels: unknown
    additionalHeaders: unknown
    structuredMetadata: unknown
    timeout: unknown
}

export interface ResolvedWorkflowDefaults {
    enabled: boolean
    labels: Record<string, string>
    additionalHeaders: Record<string, string>
    structuredMetadata: Record<string, string>
    timeout?: number
}

/**
 * Finds enabled "Set Workflow Logging" control nodes among the given
 * ancestors. Disabled canvas nodes are skipped. Raw parameter values are
 * returned as stored — unset `loggingEnabled` (n8n omits default `true`)
 * is left undefined so callers treat it as enabled.
 */
export function findWorkflowLoggingSettings(
    parents: NodeTypeAndVersion[],
    nodeType: string
): WorkflowLoggingSettings[] {
    const settings: WorkflowLoggingSettings[] = []

    for (const parent of parents) {
        if (parent.type !== nodeType || parent.disabled) {
            continue
        }
        if (parent.parameters?.operation !== 'setWorkflowLogging') {
            continue
        }
        const options =
            parent.parameters.options && typeof parent.parameters.options === 'object'
                ? (parent.parameters.options as Record<string, unknown>)
                : {}
        settings.push({
            name: parent.name,
            loggingEnabled: parent.parameters.loggingEnabled as NodeParameterValueType | undefined,
            labels: parent.parameters.labels,
            additionalHeaders: options.additionalHeaders,
            structuredMetadata: options.structuredMetadata,
            timeout: options.timeout
        })
    }

    return settings
}

function resolveExpressionValue(value: unknown, resolveValue: (value: unknown) => unknown): unknown {
    if (typeof value === 'string' && value.startsWith('=')) {
        return resolveValue(value.slice(1))
    }
    return value
}

function resolveNameValueMap(raw: unknown, resolveValue: (value: unknown) => unknown): Record<string, string> {
    const mapped: Record<string, string> = {}
    for (const { name, value } of normalizeNameValueRows(raw)) {
        mapped[name] = stringifyAssignmentValue(resolveExpressionValue(value, resolveValue))
    }
    return mapped
}

/**
 * Coerces a stored or resolved timeout to a number of milliseconds. Numeric
 * strings are accepted because an expression can resolve to one.
 */
export function coerceTimeout(value: unknown): number | undefined {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : undefined
    }
    if (typeof value === 'string' && value !== '') {
        const parsed = Number(value)
        return Number.isFinite(parsed) ? parsed : undefined
    }
    return undefined
}

function resolveTimeout(raw: unknown, resolveValue: (value: unknown) => unknown): number | undefined {
    if (raw === undefined || raw === null || raw === '') {
        return undefined
    }
    return coerceTimeout(resolveExpressionValue(raw, resolveValue))
}

/**
 * Key under which a "Set Workflow Logging" node writes its resolved settings
 * onto every item it passes through. This is the only channel that survives an
 * Execute Sub-workflow call, so it is how the switch reaches sub-workflows.
 */
export const WORKFLOW_LOGGING_ITEM_KEY = '_lokiLogging'

export function emptyWorkflowDefaults(): ResolvedWorkflowDefaults {
    return { enabled: true, labels: {}, additionalHeaders: {}, structuredMetadata: {} }
}

function toStringMap(raw: unknown): Record<string, string> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return {}
    }
    const map: Record<string, string> = {}
    for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
        if (name.length > 0) {
            map[name] = stringifyAssignmentValue(value)
        }
    }
    return map
}

/**
 * Reads defaults a control node propagated on an item. The value comes from
 * the item stream and may have been reshaped by other nodes, so every field is
 * coerced rather than trusted.
 */
export function readPropagatedDefaults(raw: unknown): ResolvedWorkflowDefaults | undefined {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return undefined
    }
    const record = raw as Record<string, unknown>
    return {
        enabled: record.enabled !== false && record.enabled !== 'false',
        labels: toStringMap(record.labels),
        additionalHeaders: toStringMap(record.additionalHeaders),
        structuredMetadata: toStringMap(record.structuredMetadata),
        timeout: coerceTimeout(record.timeout)
    }
}

/**
 * Trims resolved defaults down to what is worth carrying on every item: empty
 * maps and an unset timeout are dropped, since `readPropagatedDefaults` fills
 * them back in.
 */
export function toPropagatedDefaults(defaults: ResolvedWorkflowDefaults): Record<string, unknown> {
    const propagated: Record<string, unknown> = { enabled: defaults.enabled }
    if (Object.keys(defaults.labels).length > 0) {
        propagated.labels = defaults.labels
    }
    if (Object.keys(defaults.additionalHeaders).length > 0) {
        propagated.additionalHeaders = defaults.additionalHeaders
    }
    if (Object.keys(defaults.structuredMetadata).length > 0) {
        propagated.structuredMetadata = defaults.structuredMetadata
    }
    if (defaults.timeout !== undefined) {
        propagated.timeout = defaults.timeout
    }
    return propagated
}

/**
 * Layers `override` (the nearer control node) on top of `base` (an inherited
 * or more distant one). Logging stays off once either side turned it off.
 */
export function mergeResolvedDefaults(
    base: ResolvedWorkflowDefaults,
    override: ResolvedWorkflowDefaults
): ResolvedWorkflowDefaults {
    return {
        enabled: base.enabled && override.enabled,
        labels: { ...base.labels, ...override.labels },
        additionalHeaders: { ...base.additionalHeaders, ...override.additionalHeaders },
        structuredMetadata: { ...base.structuredMetadata, ...override.structuredMetadata },
        timeout: override.timeout ?? base.timeout
    }
}

/**
 * Name of the ancestor that starts a sub-workflow run, if there is one. Its
 * output items carry the settings the calling workflow propagated.
 */
export function findSubWorkflowTrigger(parents: NodeTypeAndVersion[]): string | undefined {
    for (const parent of parents) {
        if (parent.type === EXECUTE_WORKFLOW_TRIGGER_TYPE && !parent.disabled) {
            return parent.name
        }
    }
    return undefined
}

/**
 * Merges control-node snapshots into workflow defaults. `settings` is expected
 * in the order `getParentNodes` returns - furthest ancestor first - so the
 * last-wins merge of maps and timeout lets the nearest control node win. Any
 * resolved `false` disables logging; a later control node cannot re-enable it.
 */
export function mergeWorkflowDefaults(
    settings: WorkflowLoggingSettings[],
    resolveValue: (value: unknown) => unknown,
    node: INode
): ResolvedWorkflowDefaults {
    const defaults = emptyWorkflowDefaults()

    for (const setting of settings) {
        const resolve = (value: unknown) => {
            try {
                return resolveValue(value)
            } catch (error) {
                throw new NodeOperationError(node, error as Error, {
                    description: `The expression is set on the "${setting.name}" node (Set Workflow Logging) and is evaluated in this node's context.`
                })
            }
        }

        const loggingEnabled = resolveExpressionValue(setting.loggingEnabled, resolve)
        if (loggingEnabled === false || loggingEnabled === 'false') {
            defaults.enabled = false
        }

        Object.assign(defaults.labels, resolveNameValueMap(setting.labels, resolve))
        Object.assign(defaults.additionalHeaders, resolveNameValueMap(setting.additionalHeaders, resolve))
        Object.assign(defaults.structuredMetadata, resolveNameValueMap(setting.structuredMetadata, resolve))

        const timeout = resolveTimeout(setting.timeout, resolve)
        if (timeout !== undefined) {
            defaults.timeout = timeout
        }
    }

    return defaults
}
