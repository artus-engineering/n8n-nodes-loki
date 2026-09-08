import type { IExecuteFunctions, INode } from 'n8n-workflow'
import { NodeApiError } from 'n8n-workflow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Loki } from '../nodes/Loki/Loki.node'

type ParamTree = Record<string, unknown>

function getByPath(tree: ParamTree, path: string, fallback: unknown): unknown {
    const parts = path.split('.')
    let current: unknown = tree
    for (const part of parts) {
        if (current === undefined || current === null || typeof current !== 'object') {
            return fallback
        }
        current = (current as Record<string, unknown>)[part]
    }
    return current === undefined ? fallback : current
}

interface StubOptions {
    items: number
    paramsByItem: ParamTree[]
    credentials?: Record<string, unknown>
    httpRequestWithAuthentication: ReturnType<typeof vi.fn>
    continueOnFail?: boolean
}

function createExecuteFunctions(opts: StubOptions): IExecuteFunctions {
    const node: INode = {
        id: '1',
        name: 'Loki',
        type: 'loki',
        typeVersion: 1,
        position: [0, 0],
        parameters: {}
    }

    const stub = {
        getInputData: () => Array.from({ length: opts.items }, () => ({ json: {} })),
        getNodeParameter: (name: string, itemIndex: number, fallback?: unknown) =>
            getByPath(opts.paramsByItem[itemIndex] ?? {}, name, fallback),
        getCredentials: async () => opts.credentials ?? { url: 'https://loki.example.com' },
        getNode: () => node,
        continueOnFail: () => opts.continueOnFail ?? false,
        helpers: {
            httpRequestWithAuthentication: opts.httpRequestWithAuthentication
        }
    }

    return stub as unknown as IExecuteFunctions
}

function defaultParams(overrides: ParamTree = {}): ParamTree {
    return {
        operation: 'push',
        labels: { label: [{ name: 'job', value: 'n8n' }] },
        logFormat: 'text',
        message: 'hello world',
        jsonInputMode: 'raw',
        jsonBody: {},
        jsonFields: {},
        options: {
            timestamp: '2024-01-01T00:00:00.000Z',
            structuredMetadata: {},
            batchAllItems: true,
            additionalHeaders: {},
            timeout: 10000
        },
        ...overrides
    }
}

describe('Loki node execute', () => {
    let httpRequestWithAuthentication: ReturnType<typeof vi.fn>

    beforeEach(() => {
        httpRequestWithAuthentication = vi.fn().mockResolvedValue({ statusCode: 204 })
    })

    it('sends a text log line as a single stream', async () => {
        const loki = new Loki()
        const context = createExecuteFunctions({
            items: 1,
            paramsByItem: [defaultParams()],
            httpRequestWithAuthentication
        })

        const result = await loki.execute.call(context)

        expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(1)
        const [, requestOptions] = httpRequestWithAuthentication.mock.calls[0]
        expect(requestOptions.method).toBe('POST')
        expect(requestOptions.url).toBe('https://loki.example.com/loki/api/v1/push')
        expect(requestOptions.body.streams).toEqual([
            { stream: { job: 'n8n' }, values: [['1704067200000000000', 'hello world']] }
        ])
        expect(result[0][0].json).toMatchObject({ success: true, statusCode: 204 })
    })

    it('serializes JSON fields into the log line', async () => {
        const loki = new Loki()
        const context = createExecuteFunctions({
            items: 1,
            paramsByItem: [
                defaultParams({
                    logFormat: 'json',
                    jsonInputMode: 'fields',
                    jsonFields: { field: [{ name: 'level', value: 'error', type: 'string' }] }
                })
            ],
            httpRequestWithAuthentication
        })

        await loki.execute.call(context)

        const [, requestOptions] = httpRequestWithAuthentication.mock.calls[0]
        expect(requestOptions.body.streams[0].values[0][1]).toBe('{"level":"error"}')
    })

    it('includes structured metadata in the stream values', async () => {
        const loki = new Loki()
        const context = createExecuteFunctions({
            items: 1,
            paramsByItem: [
                defaultParams({
                    options: {
                        ...(defaultParams().options as Record<string, unknown>),
                        structuredMetadata: { metadata: [{ name: 'traceId', value: 'abc' }] }
                    }
                })
            ],
            httpRequestWithAuthentication
        })

        await loki.execute.call(context)

        const [, requestOptions] = httpRequestWithAuthentication.mock.calls[0]
        expect(requestOptions.body.streams[0].values[0]).toEqual([
            '1704067200000000000',
            'hello world',
            { traceId: 'abc' }
        ])
    })

    it('batches all items into a single request by default', async () => {
        const loki = new Loki()
        const context = createExecuteFunctions({
            items: 2,
            paramsByItem: [defaultParams({ message: 'first' }), defaultParams({ message: 'second' })],
            httpRequestWithAuthentication
        })

        const result = await loki.execute.call(context)

        expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(1)
        expect(result[0]).toHaveLength(2)
    })

    it('sends one request per item when batching is disabled', async () => {
        const loki = new Loki()
        const params = (message: string) =>
            defaultParams({
                message,
                options: { ...(defaultParams().options as Record<string, unknown>), batchAllItems: false }
            })
        const context = createExecuteFunctions({
            items: 2,
            paramsByItem: [params('first'), params('second')],
            httpRequestWithAuthentication
        })

        await loki.execute.call(context)

        expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(2)
    })

    it('groups items with different labels into separate streams within one request', async () => {
        const loki = new Loki()
        const context = createExecuteFunctions({
            items: 2,
            paramsByItem: [
                defaultParams({ labels: { label: [{ name: 'job', value: 'a' }] } }),
                defaultParams({ labels: { label: [{ name: 'job', value: 'b' }] } })
            ],
            httpRequestWithAuthentication
        })

        await loki.execute.call(context)

        const [, requestOptions] = httpRequestWithAuthentication.mock.calls[0]
        expect(requestOptions.body.streams).toHaveLength(2)
    })

    it('throws when no labels are provided', async () => {
        const loki = new Loki()
        const context = createExecuteFunctions({
            items: 1,
            paramsByItem: [defaultParams({ labels: { label: [] } })],
            httpRequestWithAuthentication
        })

        await expect(loki.execute.call(context)).rejects.toThrow('At least one label is required')
    })

    it('continues on fail and reports the error as item JSON', async () => {
        const loki = new Loki()
        const context = createExecuteFunctions({
            items: 1,
            paramsByItem: [defaultParams({ labels: { label: [] } })],
            httpRequestWithAuthentication,
            continueOnFail: true
        })

        const result = await loki.execute.call(context)

        expect(result[0][0].json.error).toContain('At least one label is required')
        expect(httpRequestWithAuthentication).not.toHaveBeenCalled()
    })

    it('wraps a failed request in a NodeApiError with a helpful description', async () => {
        httpRequestWithAuthentication.mockRejectedValue(new Error('400 - invalid label name'))
        const loki = new Loki()
        const context = createExecuteFunctions({
            items: 1,
            paramsByItem: [defaultParams()],
            httpRequestWithAuthentication
        })

        await expect(loki.execute.call(context)).rejects.toBeInstanceOf(NodeApiError)
    })
})
