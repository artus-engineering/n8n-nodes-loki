import { type INode, NodeOperationError } from 'n8n-workflow'

const LABEL_NAME_PATTERN = /^[a-zA-Z_]\w*$/

export interface LokiLogEntry {
    labels: Record<string, string>
    line: string
    timestampNs: string
    metadata?: Record<string, string>
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
