import type { IExecuteFunctions, INode, NodeTypeAndVersion } from 'n8n-workflow'
import { NodeApiError, NodeOperationError } from 'n8n-workflow'
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
    workflow?: { id?: string; name?: string; active: boolean }
    executionId?: string
    parentNodes?: NodeTypeAndVersion[]
    evaluateExpression?: (expression: string, itemIndex: number) => unknown
    itemJson?: Array<Record<string, unknown>>
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

    const items = Array.from({ length: opts.items }, (_, index) => ({
        json: { item: index, ...(opts.itemJson?.[index] ?? {}) }
    }))

    const stub = {
        getInputData: () => items,
        getNodeParameter: (name: string, itemIndex: number, fallback?: unknown) =>
            getByPath(opts.paramsByItem[itemIndex] ?? {}, name, fallback),
        getCredentials: vi.fn(async () => opts.credentials ?? { url: 'https://loki.example.com' }),
        getNode: () => node,
        getWorkflow: () => opts.workflow ?? { id: 'wf-1', name: 'Observability', active: true },
        getExecutionId: () => opts.executionId ?? 'exec-42',
        continueOnFail: () => opts.continueOnFail ?? false,
        getParentNodes: vi.fn(() => opts.parentNodes ?? []),
        evaluateExpression:
            opts.evaluateExpression ??
            ((expression: string) => {
                throw new Error(`Unexpected expression: ${expression}`)
            }),
        helpers: {
            httpRequestWithAuthentication: opts.httpRequestWithAuthentication
        }
    }

    return stub as unknown as IExecuteFunctions
}

function controlNode(overrides: Partial<NodeTypeAndVersion> = {}): NodeTypeAndVersion {
    return {
        name: 'Loki Settings',
        type: 'loki',
        typeVersion: 1,
        disabled: false,
        parameters: { operation: 'setWorkflowLogging' },
        ...overrides
    }
}

function defaultParams(overrides: ParamTree = {}): ParamTree {
    return {
        operation: 'push',
        labels: { assignments: [] },
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
            {
                stream: { job: 'n8n', workflow: 'Observability', workflow_id: 'wf-1' },
                values: [['1704067200000000000', 'hello world', { execution_id: 'exec-42' }]]
            }
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
                    jsonFields: {
                        assignments: [{ id: 'level', name: 'level', value: 'error', type: 'string' }]
                    }
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
            { execution_id: 'exec-42', traceId: 'abc' }
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
                defaultParams({
                    labels: { assignments: [{ id: 'a', name: 'job', value: 'a', type: 'string' }] }
                }),
                defaultParams({
                    labels: { assignments: [{ id: 'b', name: 'job', value: 'b', type: 'string' }] }
                })
            ],
            httpRequestWithAuthentication
        })

        await loki.execute.call(context)

        const [, requestOptions] = httpRequestWithAuthentication.mock.calls[0]
        expect(requestOptions.body.streams).toHaveLength(2)
    })

    it('injects workflow labels when the user provides none', async () => {
        const loki = new Loki()
        const context = createExecuteFunctions({
            items: 1,
            paramsByItem: [defaultParams({ labels: { assignments: [] } })],
            httpRequestWithAuthentication
        })

        await loki.execute.call(context)

        const [, requestOptions] = httpRequestWithAuthentication.mock.calls[0]
        expect(requestOptions.body.streams[0].stream).toEqual({
            job: 'n8n',
            workflow: 'Observability',
            workflow_id: 'wf-1'
        })
    })

    it('lets a user workflow label override the injected one', async () => {
        const loki = new Loki()
        const context = createExecuteFunctions({
            items: 1,
            paramsByItem: [
                defaultParams({
                    labels: { assignments: [{ id: 'workflow', name: 'workflow', value: 'Custom', type: 'string' }] }
                })
            ],
            httpRequestWithAuthentication
        })

        await loki.execute.call(context)

        const [, requestOptions] = httpRequestWithAuthentication.mock.calls[0]
        expect(requestOptions.body.streams[0].stream).toEqual({
            job: 'n8n',
            workflow: 'Custom',
            workflow_id: 'wf-1'
        })
    })

    it('lets a user execution_id override the injected one', async () => {
        const loki = new Loki()
        const context = createExecuteFunctions({
            items: 1,
            paramsByItem: [
                defaultParams({
                    options: {
                        ...(defaultParams().options as Record<string, unknown>),
                        structuredMetadata: { metadata: [{ name: 'execution_id', value: 'user-exec' }] }
                    }
                })
            ],
            httpRequestWithAuthentication
        })

        await loki.execute.call(context)

        const [, requestOptions] = httpRequestWithAuthentication.mock.calls[0]
        expect(requestOptions.body.streams[0].values[0][2]).toEqual({ execution_id: 'user-exec' })
    })

    it('still reads the legacy fixedCollection label wrapper', async () => {
        const loki = new Loki()
        const context = createExecuteFunctions({
            items: 1,
            paramsByItem: [defaultParams({ labels: { label: [{ name: 'job', value: 'legacy' }] } })],
            httpRequestWithAuthentication
        })

        await loki.execute.call(context)

        const [, requestOptions] = httpRequestWithAuthentication.mock.calls[0]
        expect(requestOptions.body.streams[0].stream).toEqual({
            job: 'legacy',
            workflow: 'Observability',
            workflow_id: 'wf-1'
        })
    })

    it('reads a flat label object the way MCP often writes it', async () => {
        const loki = new Loki()
        const context = createExecuteFunctions({
            items: 1,
            paramsByItem: [defaultParams({ labels: { job: 'n8n', workflow: 'Observability' } })],
            httpRequestWithAuthentication
        })

        await loki.execute.call(context)

        const [, requestOptions] = httpRequestWithAuthentication.mock.calls[0]
        expect(requestOptions.body.streams[0].stream).toEqual({
            job: 'n8n',
            workflow: 'Observability',
            workflow_id: 'wf-1'
        })
    })

    it('continues on fail and reports the error as item JSON', async () => {
        const loki = new Loki()
        const context = createExecuteFunctions({
            items: 1,
            paramsByItem: [
                defaultParams({
                    options: {
                        ...(defaultParams().options as Record<string, unknown>),
                        timestamp: 'not a timestamp'
                    }
                })
            ],
            httpRequestWithAuthentication,
            continueOnFail: true
        })

        const result = await loki.execute.call(context)

        expect(result[0][0].json.error).toContain('Invalid timestamp')
        expect(httpRequestWithAuthentication).not.toHaveBeenCalled()
    })

    it.each([
        ['400 - invalid label name', 'label names only contain letters'],
        ['entry too far behind', 'out of order or too far behind'],
        ['401 Unauthorized', 'credential authentication settings'],
        ['502 - gateway timeout', 'See the Loki response above']
    ])('wraps a failed request (%s) in a NodeApiError with a helpful description', async (message, description) => {
        httpRequestWithAuthentication.mockRejectedValue(new Error(message))
        const loki = new Loki()
        const context = createExecuteFunctions({
            items: 1,
            paramsByItem: [defaultParams()],
            httpRequestWithAuthentication
        })

        await expect(loki.execute.call(context)).rejects.toMatchObject({
            constructor: NodeApiError,
            description: expect.stringContaining(description)
        })
    })

    it('describes a string rejection without using object stringification', async () => {
        httpRequestWithAuthentication.mockRejectedValue('401 Unauthorized')
        const loki = new Loki()
        const context = createExecuteFunctions({
            items: 1,
            paramsByItem: [defaultParams()],
            httpRequestWithAuthentication
        })

        await expect(loki.execute.call(context)).rejects.toBeInstanceOf(NodeApiError)
    })

    it('describes an unknown rejection without using object stringification', async () => {
        httpRequestWithAuthentication.mockRejectedValue({ status: 500 })
        const loki = new Loki()
        const context = createExecuteFunctions({
            items: 1,
            paramsByItem: [defaultParams()],
            httpRequestWithAuthentication
        })

        await expect(loki.execute.call(context)).rejects.toMatchObject({
            description: expect.stringContaining('See the Loki response above')
        })
    })

    it('continues on fail when the Loki request is rejected', async () => {
        httpRequestWithAuthentication.mockRejectedValue(new Error('502 - gateway timeout'))
        const loki = new Loki()
        const context = createExecuteFunctions({
            items: 1,
            paramsByItem: [defaultParams()],
            httpRequestWithAuthentication,
            continueOnFail: true
        })

        const result = await loki.execute.call(context)

        expect(result[0][0].json.error).toContain('502 - gateway timeout')
    })

    it('passes items through when an upstream control node has logging disabled', async () => {
        const loki = new Loki()
        const context = createExecuteFunctions({
            items: 2,
            paramsByItem: [defaultParams(), defaultParams()],
            httpRequestWithAuthentication,
            parentNodes: [controlNode({ parameters: { operation: 'setWorkflowLogging', loggingEnabled: false } })]
        })

        const result = await loki.execute.call(context)

        expect(result).toEqual([context.getInputData()])
        expect(httpRequestWithAuthentication).not.toHaveBeenCalled()
        expect(context.getCredentials).not.toHaveBeenCalled()
    })

    it('still pushes when the upstream control node leaves loggingEnabled unset', async () => {
        const loki = new Loki()
        const context = createExecuteFunctions({
            items: 1,
            paramsByItem: [defaultParams()],
            httpRequestWithAuthentication,
            parentNodes: [controlNode()]
        })

        await loki.execute.call(context)

        expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(1)
    })

    it('still pushes when the upstream control node is disabled on the canvas', async () => {
        const loki = new Loki()
        const context = createExecuteFunctions({
            items: 1,
            paramsByItem: [defaultParams()],
            httpRequestWithAuthentication,
            parentNodes: [
                controlNode({ disabled: true, parameters: { operation: 'setWorkflowLogging', loggingEnabled: false } })
            ]
        })

        await loki.execute.call(context)

        expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(1)
    })

    it('passes items through when the control node stores the string false', async () => {
        const loki = new Loki()
        const context = createExecuteFunctions({
            items: 1,
            paramsByItem: [defaultParams()],
            httpRequestWithAuthentication,
            parentNodes: [controlNode({ parameters: { operation: 'setWorkflowLogging', loggingEnabled: 'false' } })]
        })

        const result = await loki.execute.call(context)

        expect(result).toEqual([context.getInputData()])
        expect(httpRequestWithAuthentication).not.toHaveBeenCalled()
    })

    it('passes items through when an expression on the control node resolves to false', async () => {
        const loki = new Loki()
        const context = createExecuteFunctions({
            items: 1,
            paramsByItem: [defaultParams()],
            httpRequestWithAuthentication,
            parentNodes: [
                controlNode({ parameters: { operation: 'setWorkflowLogging', loggingEnabled: '={{ $vars.LOKI }}' } })
            ],
            evaluateExpression: () => false
        })

        const result = await loki.execute.call(context)

        expect(result).toEqual([context.getInputData()])
        expect(httpRequestWithAuthentication).not.toHaveBeenCalled()
        expect(context.getCredentials).not.toHaveBeenCalled()
    })

    it('inherits workflow labels, headers, metadata and timeout from an upstream control node', async () => {
        const loki = new Loki()
        const params = defaultParams()
        const options = { ...(params.options as Record<string, unknown>) }
        delete options.timeout
        const context = createExecuteFunctions({
            items: 1,
            paramsByItem: [{ ...params, options }],
            httpRequestWithAuthentication,
            parentNodes: [
                controlNode({
                    parameters: {
                        operation: 'setWorkflowLogging',
                        labels: { assignments: [{ name: 'env', value: 'prod', type: 'string' }] },
                        options: {
                            additionalHeaders: { header: [{ name: 'X-Trace', value: 'abc' }] },
                            structuredMetadata: { metadata: [{ name: 'region', value: 'eu' }] },
                            timeout: 5000
                        }
                    }
                })
            ]
        })

        await loki.execute.call(context)

        const [, requestOptions] = httpRequestWithAuthentication.mock.calls[0]
        expect(requestOptions.timeout).toBe(5000)
        expect(requestOptions.headers).toEqual({ 'X-Trace': 'abc' })
        expect(requestOptions.body.streams[0].stream).toEqual({
            job: 'n8n',
            workflow: 'Observability',
            workflow_id: 'wf-1',
            env: 'prod'
        })
        expect(requestOptions.body.streams[0].values[0][2]).toEqual({
            execution_id: 'exec-42',
            region: 'eu'
        })
    })

    it('lets the Send Log node override inherited workflow defaults', async () => {
        const loki = new Loki()
        const context = createExecuteFunctions({
            items: 1,
            paramsByItem: [
                defaultParams({
                    labels: { assignments: [{ name: 'env', value: 'staging', type: 'string' }] },
                    options: {
                        ...(defaultParams().options as Record<string, unknown>),
                        additionalHeaders: { header: [{ name: 'X-Trace', value: 'local' }] },
                        structuredMetadata: { metadata: [{ name: 'region', value: 'us' }] },
                        timeout: 15000
                    }
                })
            ],
            httpRequestWithAuthentication,
            parentNodes: [
                controlNode({
                    parameters: {
                        operation: 'setWorkflowLogging',
                        labels: { assignments: [{ name: 'env', value: 'prod', type: 'string' }] },
                        options: {
                            additionalHeaders: { header: [{ name: 'X-Trace', value: 'abc' }] },
                            structuredMetadata: { metadata: [{ name: 'region', value: 'eu' }] },
                            timeout: 5000
                        }
                    }
                })
            ]
        })

        await loki.execute.call(context)

        const [, requestOptions] = httpRequestWithAuthentication.mock.calls[0]
        expect(requestOptions.timeout).toBe(15000)
        expect(requestOptions.headers).toEqual({ 'X-Trace': 'local' })
        expect(requestOptions.body.streams[0].stream.env).toBe('staging')
        expect(requestOptions.body.streams[0].values[0][2]).toEqual({
            execution_id: 'exec-42',
            region: 'us'
        })
    })

    it('tags items with the resolved settings when the operation is Set Workflow Logging', async () => {
        const loki = new Loki()
        const controlParams = {
            operation: 'setWorkflowLogging',
            loggingEnabled: false,
            labels: { assignments: [{ name: 'env', value: 'prod', type: 'string' }] },
            options: { timeout: 5000 }
        }
        const context = createExecuteFunctions({
            items: 2,
            paramsByItem: [controlParams, controlParams],
            httpRequestWithAuthentication
        })

        const result = await loki.execute.call(context)

        expect(result[0]).toEqual([
            { json: { item: 0, _lokiLogging: { enabled: false, labels: { env: 'prod' }, timeout: 5000 } } },
            { json: { item: 1, _lokiLogging: { enabled: false, labels: { env: 'prod' }, timeout: 5000 } } }
        ])
        expect(httpRequestWithAuthentication).not.toHaveBeenCalled()
        expect(context.getCredentials).not.toHaveBeenCalled()
    })

    it('leaves items untouched when propagation to sub-workflows is turned off', async () => {
        const loki = new Loki()
        const controlParams = {
            operation: 'setWorkflowLogging',
            loggingEnabled: false,
            options: { propagateToSubWorkflows: false }
        }
        const context = createExecuteFunctions({
            items: 1,
            paramsByItem: [controlParams],
            httpRequestWithAuthentication
        })

        const result = await loki.execute.call(context)

        expect(result).toEqual([context.getInputData()])
    })

    it('folds an upstream control node and inherited settings into what it propagates', async () => {
        const loki = new Loki()
        const context = createExecuteFunctions({
            items: 1,
            itemJson: [
                {
                    _lokiLogging: {
                        labels: { env: 'prod', tenant: 'acme' },
                        additionalHeaders: { 'X-Trace': 'inherited' },
                        timeout: 5000
                    }
                }
            ],
            paramsByItem: [
                {
                    operation: 'setWorkflowLogging',
                    labels: { assignments: [{ name: 'env', value: 'staging', type: 'string' }] }
                }
            ],
            httpRequestWithAuthentication,
            parentNodes: [
                controlNode({
                    name: 'Outer Settings',
                    parameters: {
                        operation: 'setWorkflowLogging',
                        options: { structuredMetadata: { metadata: [{ name: 'region', value: 'eu' }] } }
                    }
                })
            ]
        })

        const result = await loki.execute.call(context)

        expect(result[0][0].json._lokiLogging).toEqual({
            enabled: true,
            labels: { env: 'staging', tenant: 'acme' },
            additionalHeaders: { 'X-Trace': 'inherited' },
            structuredMetadata: { region: 'eu' },
            timeout: 5000
        })
    })

    it('mutes a Send Log node from settings inherited on its input item', async () => {
        const loki = new Loki()
        const context = createExecuteFunctions({
            items: 1,
            itemJson: [{ _lokiLogging: { enabled: false } }],
            paramsByItem: [defaultParams()],
            httpRequestWithAuthentication
        })

        const result = await loki.execute.call(context)

        expect(result).toEqual([context.getInputData()])
        expect(httpRequestWithAuthentication).not.toHaveBeenCalled()
        expect(context.getCredentials).not.toHaveBeenCalled()
    })

    it('mutes a Send Log node from settings on the sub-workflow trigger when the items were rebuilt', async () => {
        const loki = new Loki()
        const context = createExecuteFunctions({
            items: 1,
            paramsByItem: [defaultParams()],
            httpRequestWithAuthentication,
            parentNodes: [
                {
                    name: 'When Executed by Another Workflow',
                    type: 'n8n-nodes-base.executeWorkflowTrigger',
                    typeVersion: 1,
                    disabled: false
                }
            ],
            evaluateExpression: expression =>
                expression.includes('When Executed by Another Workflow') ? { enabled: false } : undefined
        })

        const result = await loki.execute.call(context)

        expect(result).toEqual([context.getInputData()])
        expect(httpRequestWithAuthentication).not.toHaveBeenCalled()
    })

    it('inherits labels from the sub-workflow trigger and lets a local control node override them', async () => {
        const loki = new Loki()
        const withoutTimeout = { ...(defaultParams().options as Record<string, unknown>) }
        delete withoutTimeout.timeout
        const context = createExecuteFunctions({
            items: 1,
            paramsByItem: [defaultParams({ options: withoutTimeout })],
            httpRequestWithAuthentication,
            parentNodes: [
                {
                    name: 'Sub Trigger',
                    type: 'n8n-nodes-base.executeWorkflowTrigger',
                    typeVersion: 1,
                    disabled: false
                },
                controlNode({
                    parameters: {
                        operation: 'setWorkflowLogging',
                        labels: { assignments: [{ name: 'env', value: 'local', type: 'string' }] }
                    }
                })
            ],
            evaluateExpression: expression =>
                expression.includes('Sub Trigger')
                    ? { labels: { env: 'inherited', tenant: 'acme' }, timeout: 7000 }
                    : undefined
        })

        await loki.execute.call(context)

        const [, requestOptions] = httpRequestWithAuthentication.mock.calls[0]
        expect(requestOptions.timeout).toBe(7000)
        expect(requestOptions.body.streams[0].stream).toMatchObject({ env: 'local', tenant: 'acme' })
    })

    it('pushes normally when the sub-workflow trigger has no data to read', async () => {
        const loki = new Loki()
        const context = createExecuteFunctions({
            items: 1,
            paramsByItem: [defaultParams()],
            httpRequestWithAuthentication,
            parentNodes: [
                {
                    name: 'Sub Trigger',
                    type: 'n8n-nodes-base.executeWorkflowTrigger',
                    typeVersion: 1,
                    disabled: false
                }
            ],
            evaluateExpression: () => {
                throw new Error('Referenced node is unexecuted')
            }
        })

        await loki.execute.call(context)

        expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(1)
    })

    it('resolves workflow-wide label expressions per item', async () => {
        const loki = new Loki()
        const context = createExecuteFunctions({
            items: 2,
            paramsByItem: [defaultParams(), defaultParams()],
            httpRequestWithAuthentication,
            parentNodes: [
                controlNode({
                    parameters: {
                        operation: 'setWorkflowLogging',
                        labels: { assignments: [{ name: 'tenant', value: '={{ $json.tenant }}', type: 'string' }] }
                    }
                })
            ],
            evaluateExpression: (_expression, itemIndex) => `tenant-${itemIndex}`
        })

        await loki.execute.call(context)

        const [, requestOptions] = httpRequestWithAuthentication.mock.calls[0]
        expect(
            requestOptions.body.streams.map((stream: { stream: Record<string, string> }) => stream.stream.tenant)
        ).toEqual(['tenant-0', 'tenant-1'])
    })

    it('prefers a local timeout that an expression resolved to a numeric string', async () => {
        const loki = new Loki()
        const context = createExecuteFunctions({
            items: 1,
            paramsByItem: [
                defaultParams({
                    options: { ...(defaultParams().options as Record<string, unknown>), timeout: '15000' }
                })
            ],
            httpRequestWithAuthentication,
            parentNodes: [controlNode({ parameters: { operation: 'setWorkflowLogging', options: { timeout: 5000 } } })]
        })

        await loki.execute.call(context)

        const [, requestOptions] = httpRequestWithAuthentication.mock.calls[0]
        expect(requestOptions.timeout).toBe(15000)
    })

    it('reports which control node an expression failure came from', async () => {
        const loki = new Loki()
        const context = createExecuteFunctions({
            items: 1,
            paramsByItem: [defaultParams()],
            httpRequestWithAuthentication,
            parentNodes: [
                controlNode({
                    name: 'Mute Switch',
                    parameters: { operation: 'setWorkflowLogging', loggingEnabled: '={{ $json.flag }}' }
                })
            ],
            evaluateExpression: () => {
                throw new Error('Referenced node is unexecuted')
            }
        })

        await expect(loki.execute.call(context)).rejects.toThrowError(NodeOperationError)
        await expect(loki.execute.call(context)).rejects.toThrowError(/Referenced node is unexecuted/)
    })
})
