import type { INode, NodeTypeAndVersion } from 'n8n-workflow'
import { describe, expect, it } from 'vitest'
import {
    buildContextLabels,
    buildContextMetadata,
    buildStreams,
    findWorkflowLoggingSettings,
    mergeWorkflowDefaults,
    normalizeNameValueRows,
    resolvePushUrl,
    serializeLogLine,
    toNanoseconds,
    validateLabelName,
    type WorkflowLoggingSettings
} from '../nodes/Loki/GenericFunctions'

const testNode: INode = {
    id: '1',
    name: 'Loki',
    type: 'loki',
    typeVersion: 1,
    position: [0, 0],
    parameters: {}
}

describe('resolvePushUrl', () => {
    it('appends the push path to a bare host', () => {
        expect(resolvePushUrl('https://loki.example.com', testNode)).toBe('https://loki.example.com/loki/api/v1/push')
    })

    it('strips a trailing slash before appending the push path', () => {
        expect(resolvePushUrl('https://loki.example.com/', testNode)).toBe('https://loki.example.com/loki/api/v1/push')
    })

    it('strips multiple trailing slashes before appending the push path', () => {
        expect(resolvePushUrl('https://loki.example.com///', testNode)).toBe(
            'https://loki.example.com/loki/api/v1/push'
        )
    })

    it('appends only /push when the URL already ends with /loki/api/v1', () => {
        expect(resolvePushUrl('https://loki.example.com/loki/api/v1', testNode)).toBe(
            'https://loki.example.com/loki/api/v1/push'
        )
    })

    it('leaves a full push URL unchanged', () => {
        expect(resolvePushUrl('https://loki.example.com/loki/api/v1/push', testNode)).toBe(
            'https://loki.example.com/loki/api/v1/push'
        )
    })

    it('leaves a full push URL with trailing slash normalized', () => {
        expect(resolvePushUrl('https://loki.example.com/loki/api/v1/push/', testNode)).toBe(
            'https://loki.example.com/loki/api/v1/push'
        )
    })

    it('trims surrounding whitespace', () => {
        expect(resolvePushUrl('  https://loki.example.com  ', testNode)).toBe(
            'https://loki.example.com/loki/api/v1/push'
        )
    })

    it('rejects an empty URL', () => {
        expect(() => resolvePushUrl('', testNode)).toThrow('Loki URL is empty')
    })

    it('rejects a non-URL string', () => {
        expect(() => resolvePushUrl('not a url', testNode)).toThrow(/not a valid URL/)
    })

    it('rejects a non-http(s) protocol', () => {
        expect(() => resolvePushUrl('ws://loki.example.com', testNode)).toThrow(/must use http or https/)
    })
})

describe('toNanoseconds', () => {
    it('defaults to now when no value is given', () => {
        const before = BigInt(Date.now()) * 1_000_000n
        const result = BigInt(toNanoseconds(undefined, testNode))
        const after = BigInt(Date.now()) * 1_000_000n
        expect(result >= before && result <= after).toBe(true)
    })

    it('converts a Date instance', () => {
        const date = new Date('2024-01-01T00:00:00.000Z')
        expect(toNanoseconds(date, testNode)).toBe(`${date.getTime()}000000`)
    })

    it('rejects an invalid Date instance', () => {
        expect(() => toNanoseconds(new Date('not a date'), testNode)).toThrow('Invalid Date')
    })

    it('parses an ISO-8601 string', () => {
        expect(toNanoseconds('2024-01-01T00:00:00.000Z', testNode)).toBe('1704067200000000000')
    })

    it('parses an epoch string in seconds', () => {
        expect(toNanoseconds('1704067200', testNode)).toBe('1704067200000000000')
    })

    it('parses an epoch string in milliseconds', () => {
        expect(toNanoseconds('1704067200000', testNode)).toBe('1704067200000000000')
    })

    it('parses an epoch string in microseconds', () => {
        expect(toNanoseconds('1704067200000000', testNode)).toBe('1704067200000000000')
    })

    it('leaves a nanosecond-precision epoch string unchanged', () => {
        expect(toNanoseconds('1704067200000000000', testNode)).toBe('1704067200000000000')
    })

    it('rejects an unparsable string', () => {
        expect(() => toNanoseconds('not a timestamp', testNode)).toThrow(/Invalid timestamp/)
    })
})

describe('validateLabelName', () => {
    it('accepts letters, digits and underscores not starting with a digit', () => {
        expect(() => validateLabelName('job', testNode)).not.toThrow()
        expect(() => validateLabelName('_private', testNode)).not.toThrow()
        expect(() => validateLabelName('service_name2', testNode)).not.toThrow()
    })

    it('rejects a name starting with a digit', () => {
        expect(() => validateLabelName('2fast', testNode)).toThrow(/Invalid label name/)
    })

    it('rejects a name containing a hyphen', () => {
        expect(() => validateLabelName('my-label', testNode)).toThrow(/Invalid label name/)
    })
})

describe('serializeLogLine', () => {
    it('returns the message unchanged for text format', () => {
        expect(serializeLogLine('text', { message: 'hello world' }, testNode)).toBe('hello world')
    })

    it('stringifies a raw JSON object', () => {
        expect(serializeLogLine('json', { jsonInputMode: 'raw', jsonBody: { a: 1 } }, testNode)).toBe('{"a":1}')
    })

    it('passes through a raw JSON string unchanged', () => {
        expect(serializeLogLine('json', { jsonInputMode: 'raw', jsonBody: '{"a":1}' }, testNode)).toBe('{"a":1}')
    })

    it('builds an object from typed fields', () => {
        const result = serializeLogLine(
            'json',
            {
                jsonInputMode: 'fields',
                fields: [
                    { name: 'message', value: 'hi', type: 'string' },
                    { name: 'count', value: '3', type: 'number' },
                    { name: 'active', value: 'true', type: 'boolean' },
                    { name: 'meta', value: '{"x":1}', type: 'json' }
                ]
            },
            testNode
        )
        expect(JSON.parse(result)).toEqual({ message: 'hi', count: 3, active: true, meta: { x: 1 } })
    })

    it('throws when a number field is not numeric', () => {
        expect(() =>
            serializeLogLine(
                'json',
                { jsonInputMode: 'fields', fields: [{ name: 'n', value: 'nope', type: 'number' }] },
                testNode
            )
        ).toThrow(/not a valid number/)
    })

    it('throws when a json field is not valid JSON', () => {
        expect(() =>
            serializeLogLine(
                'json',
                { jsonInputMode: 'fields', fields: [{ name: 'n', value: '{bad', type: 'json' }] },
                testNode
            )
        ).toThrow(/not valid JSON/)
    })
})

describe('buildStreams', () => {
    it('groups entries with identical labels into one stream', () => {
        const streams = buildStreams(
            [
                { labels: { job: 'n8n' }, line: 'first', timestampNs: '2' },
                { labels: { job: 'n8n' }, line: 'second', timestampNs: '1' }
            ],
            testNode
        )
        expect(streams).toHaveLength(1)
        expect(streams[0].stream).toEqual({ job: 'n8n' })
    })

    it('sorts entries within a stream ascending by timestamp', () => {
        const streams = buildStreams(
            [
                { labels: { job: 'n8n' }, line: 'second', timestampNs: '2' },
                { labels: { job: 'n8n' }, line: 'first', timestampNs: '1' }
            ],
            testNode
        )
        expect(streams[0].values).toEqual([
            ['1', 'first'],
            ['2', 'second']
        ])
    })

    it('keeps equal timestamps in their relative order', () => {
        const streams = buildStreams(
            [
                { labels: { job: 'n8n' }, line: 'first', timestampNs: '1' },
                { labels: { job: 'n8n' }, line: 'second', timestampNs: '1' }
            ],
            testNode
        )
        expect(streams[0].values).toEqual([
            ['1', 'first'],
            ['1', 'second']
        ])
    })

    it('splits entries with different label sets into separate streams', () => {
        const streams = buildStreams(
            [
                { labels: { job: 'a' }, line: 'x', timestampNs: '1' },
                { labels: { job: 'b' }, line: 'y', timestampNs: '1' }
            ],
            testNode
        )
        expect(streams).toHaveLength(2)
    })

    it('treats label sets as equal regardless of insertion order', () => {
        const streams = buildStreams(
            [
                { labels: { job: 'n8n', env: 'prod' }, line: 'x', timestampNs: '1' },
                { labels: { env: 'prod', job: 'n8n' }, line: 'y', timestampNs: '2' }
            ],
            testNode
        )
        expect(streams).toHaveLength(1)
    })

    it('includes structured metadata when present', () => {
        const streams = buildStreams(
            [{ labels: { job: 'n8n' }, line: 'x', timestampNs: '1', metadata: { traceId: 'abc' } }],
            testNode
        )
        expect(streams[0].values[0]).toEqual(['1', 'x', { traceId: 'abc' }])
    })

    it('omits the metadata slot when metadata is empty', () => {
        const streams = buildStreams([{ labels: { job: 'n8n' }, line: 'x', timestampNs: '1', metadata: {} }], testNode)
        expect(streams[0].values[0]).toEqual(['1', 'x'])
    })

    it('rejects an invalid label name', () => {
        expect(() => buildStreams([{ labels: { 'bad-label': 'x' }, line: 'x', timestampNs: '1' }], testNode)).toThrow(
            /Invalid label name/
        )
    })
})

describe('buildContextLabels', () => {
    it('maps workflow name and id onto label names', () => {
        expect(buildContextLabels({ workflowId: 'wf-1', workflowName: 'Observability' })).toEqual({
            job: 'n8n',
            workflow: 'Observability',
            workflow_id: 'wf-1'
        })
    })

    it('always includes job and omits missing or blank workflow values', () => {
        expect(buildContextLabels({})).toEqual({ job: 'n8n' })
        expect(buildContextLabels({ workflowId: '  ', workflowName: '' })).toEqual({ job: 'n8n' })
        expect(buildContextLabels({ workflowId: 'wf-1' })).toEqual({ job: 'n8n', workflow_id: 'wf-1' })
        expect(buildContextLabels({ workflowName: ' Observability ' })).toEqual({
            job: 'n8n',
            workflow: 'Observability'
        })
    })
})

describe('buildContextMetadata', () => {
    it('maps the execution id onto structured metadata', () => {
        expect(buildContextMetadata({ executionId: 'exec-42' })).toEqual({ execution_id: 'exec-42' })
    })

    it('omits missing and blank values', () => {
        expect(buildContextMetadata({})).toEqual({})
        expect(buildContextMetadata({ executionId: '   ' })).toEqual({})
    })
})

describe('normalizeNameValueRows', () => {
    it('reads assignmentCollection rows', () => {
        expect(
            normalizeNameValueRows({
                assignments: [{ id: '1', name: 'job', value: 'n8n', type: 'string' }]
            })
        ).toEqual([{ name: 'job', value: 'n8n', type: 'string' }])
    })

    it('reads a legacy fixedCollection wrapper', () => {
        expect(normalizeNameValueRows({ label: [{ name: 'job', value: 'n8n' }] })).toEqual([
            { name: 'job', value: 'n8n', type: 'string' }
        ])
    })

    it('reads a values wrapper that MCP clients often emit', () => {
        expect(normalizeNameValueRows({ values: [{ name: 'job', value: 'n8n' }] })).toEqual([
            { name: 'job', value: 'n8n', type: 'string' }
        ])
    })

    it('reads a bare row array', () => {
        expect(normalizeNameValueRows([{ name: 'job', value: 'n8n' }])).toEqual([
            { name: 'job', value: 'n8n', type: 'string' }
        ])
    })

    it('reads a flat name/value object', () => {
        expect(normalizeNameValueRows({ job: 'n8n', workflow: 'Observability' })).toEqual([
            { name: 'job', value: 'n8n', type: 'string' },
            { name: 'workflow', value: 'Observability', type: 'string' }
        ])
    })

    it('maps assignment object/array types onto json fields', () => {
        expect(
            normalizeNameValueRows({
                assignments: [{ name: 'payload', value: { ok: true }, type: 'object' }]
            })
        ).toEqual([{ name: 'payload', value: '{"ok":true}', type: 'json' }])
    })

    it('stringifies object values even when the declared type is string', () => {
        expect(
            normalizeNameValueRows({
                assignments: [{ name: 'payload', value: { ok: true }, type: 'string' }]
            })
        ).toEqual([{ name: 'payload', value: '{"ok":true}', type: 'string' }])
    })

    it('treats null assignment values as empty strings', () => {
        expect(
            normalizeNameValueRows({
                assignments: [{ name: 'job', value: null, type: 'string' }]
            })
        ).toEqual([{ name: 'job', value: '', type: 'string' }])
    })

    it('stringifies primitive number and boolean assignment values', () => {
        expect(
            normalizeNameValueRows({
                assignments: [
                    { name: 'count', value: 3, type: 'number' },
                    { name: 'active', value: true, type: 'boolean' }
                ]
            })
        ).toEqual([
            { name: 'count', value: '3', type: 'number' },
            { name: 'active', value: 'true', type: 'boolean' }
        ])
    })

    it('skips rows without a name and empty input', () => {
        expect(normalizeNameValueRows({ assignments: [{ value: 'n8n' }] })).toEqual([])
        expect(normalizeNameValueRows(undefined)).toEqual([])
        expect(normalizeNameValueRows({})).toEqual([])
    })
})

function parentNode(overrides: Partial<NodeTypeAndVersion> = {}): NodeTypeAndVersion {
    return {
        name: 'Loki Settings',
        type: 'loki',
        typeVersion: 1,
        disabled: false,
        parameters: { operation: 'setWorkflowLogging' },
        ...overrides
    }
}

function emptySettings(overrides: Partial<WorkflowLoggingSettings> = {}) {
    return {
        name: 'Loki Settings',
        loggingEnabled: undefined,
        labels: undefined,
        additionalHeaders: undefined,
        structuredMetadata: undefined,
        timeout: undefined,
        ...overrides
    }
}

describe('findWorkflowLoggingSettings', () => {
    it('returns nothing when there are no parents', () => {
        expect(findWorkflowLoggingSettings([], 'loki')).toEqual([])
    })

    it('ignores unrelated node types', () => {
        expect(
            findWorkflowLoggingSettings(
                [parentNode({ type: 'n8n-nodes-base.set', parameters: { operation: 'setWorkflowLogging' } })],
                'loki'
            )
        ).toEqual([])
    })

    it('ignores a Loki ancestor that is not a control node', () => {
        expect(findWorkflowLoggingSettings([parentNode({ parameters: { operation: 'push' } })], 'loki')).toEqual([])
    })

    it('ignores a disabled control node', () => {
        expect(
            findWorkflowLoggingSettings(
                [
                    parentNode({
                        disabled: true,
                        parameters: { operation: 'setWorkflowLogging', loggingEnabled: false }
                    })
                ],
                'loki'
            )
        ).toEqual([])
    })

    it('returns an unset loggingEnabled as undefined (default on)', () => {
        expect(findWorkflowLoggingSettings([parentNode()], 'loki')).toEqual([emptySettings()])
    })

    it('returns an explicit false and raw default fields', () => {
        const labels = { assignments: [{ name: 'env', value: 'prod', type: 'string' }] }
        expect(
            findWorkflowLoggingSettings(
                [
                    parentNode({
                        parameters: {
                            operation: 'setWorkflowLogging',
                            loggingEnabled: false,
                            labels,
                            options: {
                                additionalHeaders: { header: [{ name: 'X-Trace', value: 'abc' }] },
                                structuredMetadata: { metadata: [{ name: 'region', value: 'eu' }] },
                                timeout: 5000
                            }
                        }
                    })
                ],
                'loki'
            )
        ).toEqual([
            emptySettings({
                loggingEnabled: false,
                labels,
                additionalHeaders: { header: [{ name: 'X-Trace', value: 'abc' }] },
                structuredMetadata: { metadata: [{ name: 'region', value: 'eu' }] },
                timeout: 5000
            })
        ])
    })

    it('returns an expression string without evaluating it', () => {
        expect(
            findWorkflowLoggingSettings(
                [parentNode({ parameters: { operation: 'setWorkflowLogging', loggingEnabled: '={{ $vars.LOKI }}' } })],
                'loki'
            )
        ).toEqual([emptySettings({ loggingEnabled: '={{ $vars.LOKI }}' })])
    })

    it('returns every matching control node', () => {
        const parents = [
            parentNode({ name: 'First', parameters: { operation: 'setWorkflowLogging', loggingEnabled: true } }),
            parentNode({ name: 'Second', parameters: { operation: 'setWorkflowLogging', loggingEnabled: false } })
        ]
        expect(findWorkflowLoggingSettings(parents, 'loki')).toEqual([
            emptySettings({ name: 'First', loggingEnabled: true }),
            emptySettings({ name: 'Second', loggingEnabled: false })
        ])
    })
})

describe('mergeWorkflowDefaults', () => {
    const identity = (value: unknown) => value

    it('returns enabled defaults when there are no settings', () => {
        expect(mergeWorkflowDefaults([], identity)).toEqual({
            enabled: true,
            labels: {},
            additionalHeaders: {},
            structuredMetadata: {}
        })
    })

    it('disables logging when any setting resolves to false', () => {
        expect(mergeWorkflowDefaults([emptySettings({ loggingEnabled: false })], identity).enabled).toBe(false)
        expect(mergeWorkflowDefaults([emptySettings({ loggingEnabled: 'false' })], identity).enabled).toBe(false)
    })

    it('merges maps in array order so later keys win', () => {
        const first = emptySettings({
            labels: { env: 'dev', team: 'platform' },
            additionalHeaders: { 'X-A': '1' },
            structuredMetadata: { region: 'us' }
        })
        const second = emptySettings({
            labels: { env: 'prod' },
            additionalHeaders: { 'X-B': '2' },
            structuredMetadata: { region: 'eu', cluster: 'a' }
        })

        expect(mergeWorkflowDefaults([first, second], identity)).toEqual({
            enabled: true,
            labels: { env: 'prod', team: 'platform' },
            additionalHeaders: { 'X-A': '1', 'X-B': '2' },
            structuredMetadata: { region: 'eu', cluster: 'a' }
        })
    })

    it('keeps the last resolved numeric timeout', () => {
        expect(
            mergeWorkflowDefaults([emptySettings({ timeout: 3000 }), emptySettings({ timeout: 5000 })], identity)
                .timeout
        ).toBe(5000)
        expect(mergeWorkflowDefaults([emptySettings({ timeout: 3000 }), emptySettings()], identity).timeout).toBe(3000)
    })

    it('parses numeric timeout strings and skips empty or invalid values', () => {
        expect(mergeWorkflowDefaults([emptySettings({ timeout: '2500' })], identity).timeout).toBe(2500)
        expect(mergeWorkflowDefaults([emptySettings({ timeout: '' })], identity).timeout).toBeUndefined()
        expect(mergeWorkflowDefaults([emptySettings({ timeout: 'nope' })], identity).timeout).toBeUndefined()
        expect(mergeWorkflowDefaults([emptySettings({ timeout: { ms: 1 } })], identity).timeout).toBeUndefined()
    })

    it('stringifies resolved label values without using Object.toString', () => {
        const resolveValue = (value: unknown) => {
            if (value === '{{ $json.count }}') {
                return 3
            }
            if (value === '{{ $json.flag }}') {
                return true
            }
            if (value === '{{ $json.meta }}') {
                return { ok: true }
            }
            if (value === '{{ $json.empty }}') {
                return null
            }
            if (value === '{{ $json.other }}') {
                return Symbol('x')
            }
            return value
        }

        expect(
            mergeWorkflowDefaults(
                [
                    emptySettings({
                        labels: {
                            assignments: [
                                { name: 'count', value: '={{ $json.count }}', type: 'string' },
                                { name: 'flag', value: '={{ $json.flag }}', type: 'string' },
                                { name: 'meta', value: '={{ $json.meta }}', type: 'string' },
                                { name: 'blank', value: '={{ $json.empty }}', type: 'string' },
                                { name: 'other', value: '={{ $json.other }}', type: 'string' }
                            ]
                        }
                    })
                ],
                resolveValue
            ).labels
        ).toEqual({ count: '3', flag: 'true', meta: '{"ok":true}', blank: '', other: '' })
    })

    it('resolves expression values through the injected resolver', () => {
        const resolveValue = (value: unknown) => {
            if (value === '{{ $vars.LOKI }}') {
                return false
            }
            if (value === '{{ $vars.ENV }}') {
                return 'staging'
            }
            if (value === '{{ $vars.TIMEOUT }}') {
                return 2500
            }
            return value
        }

        expect(
            mergeWorkflowDefaults(
                [
                    emptySettings({
                        loggingEnabled: '={{ $vars.LOKI }}',
                        labels: { env: '={{ $vars.ENV }}' },
                        timeout: '={{ $vars.TIMEOUT }}'
                    })
                ],
                resolveValue
            )
        ).toEqual({
            enabled: false,
            labels: { env: 'staging' },
            additionalHeaders: {},
            structuredMetadata: {},
            timeout: 2500
        })
    })
})
