import type { INode } from 'n8n-workflow'
import { describe, expect, it } from 'vitest'
import {
    buildStreams,
    resolvePushUrl,
    serializeLogLine,
    toNanoseconds,
    validateLabelName
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
