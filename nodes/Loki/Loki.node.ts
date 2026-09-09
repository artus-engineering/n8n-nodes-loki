import {
    type IDataObject,
    type IExecuteFunctions,
    type IHttpRequestOptions,
    type INodeExecutionData,
    type INodeType,
    type INodeTypeDescription,
    type JsonObject,
    NodeApiError,
    NodeConnectionTypes,
    NodeOperationError
} from 'n8n-workflow'
import {
    buildContextLabels,
    buildContextMetadata,
    buildStreams,
    coerceTimeout,
    emptyWorkflowDefaults,
    findSubWorkflowTrigger,
    findWorkflowLoggingSettings,
    type LokiLogEntry,
    mergeResolvedDefaults,
    mergeWorkflowDefaults,
    normalizeNameValueRows,
    type ResolvedWorkflowDefaults,
    readPropagatedDefaults,
    resolvePushUrl,
    serializeLogLine,
    toNanoseconds,
    toPropagatedDefaults,
    WORKFLOW_LOGGING_ITEM_KEY,
    type WorkflowLoggingSettings
} from './GenericFunctions'
import { lokiProperties } from './LokiDescription'

function readNameValueMap(this: IExecuteFunctions, parameterName: string, itemIndex: number): Record<string, string> {
    const rows = normalizeNameValueRows(this.getNodeParameter(parameterName, itemIndex, {}))
    const mapped: Record<string, string> = {}
    for (const { name, value } of rows) {
        mapped[name] = value
    }
    return mapped
}

function readLabels(
    this: IExecuteFunctions,
    itemIndex: number,
    workflowLabels: Record<string, string>
): Record<string, string> {
    const workflow = this.getWorkflow()
    return {
        ...buildContextLabels({ workflowId: workflow.id, workflowName: workflow.name }),
        ...workflowLabels,
        ...readNameValueMap.call(this, 'labels', itemIndex)
    }
}

function readLine(this: IExecuteFunctions, itemIndex: number): string {
    const logFormat = this.getNodeParameter('logFormat', itemIndex) as 'text' | 'json'

    if (logFormat === 'text') {
        return serializeLogLine(
            'text',
            { message: this.getNodeParameter('message', itemIndex, '') as string },
            this.getNode()
        )
    }

    const jsonInputMode = this.getNodeParameter('jsonInputMode', itemIndex) as 'raw' | 'fields'
    if (jsonInputMode === 'raw') {
        return serializeLogLine(
            'json',
            {
                jsonInputMode: 'raw',
                jsonBody: this.getNodeParameter('jsonBody', itemIndex, {}) as IDataObject
            },
            this.getNode()
        )
    }

    const fields = normalizeNameValueRows(this.getNodeParameter('jsonFields', itemIndex, {}))
    return serializeLogLine('json', { jsonInputMode: 'fields', fields }, this.getNode())
}

function readMetadata(
    this: IExecuteFunctions,
    itemIndex: number,
    workflowMetadata: Record<string, string>
): Record<string, string> | undefined {
    const metadata = {
        ...buildContextMetadata({ executionId: this.getExecutionId() }),
        ...workflowMetadata,
        ...readNameValueMap.call(this, 'options.structuredMetadata', itemIndex)
    }
    return Object.keys(metadata).length === 0 ? undefined : metadata
}

function readAdditionalHeaders(
    this: IExecuteFunctions,
    itemIndex: number,
    workflowHeaders: Record<string, string>
): Record<string, string> {
    return {
        ...workflowHeaders,
        ...readNameValueMap.call(this, 'options.additionalHeaders', itemIndex)
    }
}

interface IndexedEntry {
    entry: LokiLogEntry
    itemIndex: number
}

interface WorkflowContext {
    settings: WorkflowLoggingSettings[]
    subWorkflowTrigger?: string
}

function readWorkflowContext(this: IExecuteFunctions): WorkflowContext {
    const parents = this.getParentNodes?.(this.getNode().name, { includeNodeParameters: true }) ?? []
    return {
        settings: findWorkflowLoggingSettings(parents, this.getNode().type),
        subWorkflowTrigger: findSubWorkflowTrigger(parents)
    }
}

/**
 * Settings the calling workflow propagated on the items: either on the item
 * this node is processing, or - when nodes in between rebuilt the items - on
 * the sub-workflow trigger that received them.
 */
function readInheritedDefaults(
    this: IExecuteFunctions,
    context: WorkflowContext,
    items: INodeExecutionData[],
    itemIndex: number
): ResolvedWorkflowDefaults | undefined {
    const onItem = readPropagatedDefaults(items[itemIndex]?.json?.[WORKFLOW_LOGGING_ITEM_KEY])
    if (onItem) {
        return onItem
    }
    if (!context.subWorkflowTrigger) {
        return undefined
    }
    try {
        const fromTrigger = this.evaluateExpression(
            `{{ $(${JSON.stringify(context.subWorkflowTrigger)}).first().json[${JSON.stringify(WORKFLOW_LOGGING_ITEM_KEY)}] }}`,
            itemIndex
        )
        return readPropagatedDefaults(fromTrigger)
    } catch {
        return undefined
    }
}

function resolveWorkflowDefaults(
    this: IExecuteFunctions,
    context: WorkflowContext,
    items: INodeExecutionData[],
    itemIndex: number
): ResolvedWorkflowDefaults {
    const inherited = readInheritedDefaults.call(this, context, items, itemIndex) ?? emptyWorkflowDefaults()
    const fromAncestors = mergeWorkflowDefaults(
        context.settings,
        value => this.evaluateExpression(value as string, itemIndex),
        this.getNode()
    )
    return mergeResolvedDefaults(inherited, fromAncestors)
}

/** The control node's own parameters, with expressions resolved for this item. */
function readControlNodeDefaults(this: IExecuteFunctions, itemIndex: number): ResolvedWorkflowDefaults {
    return {
        enabled: this.getNodeParameter('loggingEnabled', itemIndex, true) !== false,
        labels: readNameValueMap.call(this, 'labels', itemIndex),
        additionalHeaders: readNameValueMap.call(this, 'options.additionalHeaders', itemIndex),
        structuredMetadata: readNameValueMap.call(this, 'options.structuredMetadata', itemIndex),
        timeout: coerceTimeout(this.getNodeParameter('options.timeout', itemIndex, undefined))
    }
}

/**
 * Passes the input through, tagging every item with the settings that apply
 * from here on, so Loki nodes in called sub-workflows inherit them too.
 */
function runControlNode(this: IExecuteFunctions, items: INodeExecutionData[]): INodeExecutionData[] {
    if (this.getNodeParameter('options.propagateToSubWorkflows', 0, true) === false) {
        return items
    }

    const context = readWorkflowContext.call(this)

    return items.map((item, itemIndex) => ({
        ...item,
        json: {
            ...item.json,
            [WORKFLOW_LOGGING_ITEM_KEY]: toPropagatedDefaults(
                mergeResolvedDefaults(
                    resolveWorkflowDefaults.call(this, context, items, itemIndex),
                    readControlNodeDefaults.call(this, itemIndex)
                )
            ) as IDataObject
        }
    }))
}

function readLogEntry(this: IExecuteFunctions, itemIndex: number, defaults: ResolvedWorkflowDefaults): LokiLogEntry {
    const timestamp = this.getNodeParameter('options.timestamp', itemIndex, '') as string
    return {
        labels: readLabels.call(this, itemIndex, defaults.labels),
        line: readLine.call(this, itemIndex),
        timestampNs: toNanoseconds(timestamp || undefined, this.getNode()),
        metadata: readMetadata.call(this, itemIndex, defaults.structuredMetadata)
    }
}

function collectEntries(
    this: IExecuteFunctions,
    items: INodeExecutionData[],
    returnData: INodeExecutionData[],
    context: WorkflowContext,
    firstItemDefaults: ResolvedWorkflowDefaults
): IndexedEntry[] {
    const entries: IndexedEntry[] = []

    for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
        try {
            const defaults =
                itemIndex === 0 ? firstItemDefaults : resolveWorkflowDefaults.call(this, context, items, itemIndex)
            entries.push({
                entry: readLogEntry.call(this, itemIndex, defaults),
                itemIndex
            })
        } catch (error) {
            if (this.continueOnFail()) {
                returnData.push({
                    json: { error: (error as Error).message },
                    pairedItem: { item: itemIndex }
                })
                continue
            }
            throw error instanceof NodeOperationError
                ? error
                : new NodeOperationError(this.getNode(), error as Error, { itemIndex })
        }
    }

    return entries
}

async function pushBatch(
    this: IExecuteFunctions,
    batch: IndexedEntry[],
    pushUrl: string,
    additionalHeaders: Record<string, string>,
    timeout: number,
    returnData: INodeExecutionData[]
): Promise<void> {
    if (batch.length === 0) {
        return
    }

    try {
        const streams = buildStreams(
            batch.map(({ entry }) => entry),
            this.getNode()
        )
        const requestOptions: IHttpRequestOptions = {
            method: 'POST',
            url: pushUrl,
            body: { streams },
            json: true,
            headers: additionalHeaders,
            timeout,
            returnFullResponse: true
        }

        const response = (await this.helpers.httpRequestWithAuthentication.call(this, 'lokiApi', requestOptions)) as {
            statusCode: number
        }

        for (const { itemIndex } of batch) {
            returnData.push({
                json: {
                    success: true,
                    statusCode: response.statusCode,
                    entries: batch.length,
                    streams: streams.length
                },
                pairedItem: { item: itemIndex }
            })
        }
    } catch (error) {
        if (this.continueOnFail()) {
            for (const { itemIndex } of batch) {
                returnData.push({
                    json: { error: (error as Error).message },
                    pairedItem: { item: itemIndex }
                })
            }
            return
        }
        throw new NodeApiError(this.getNode(), error as JsonObject, {
            description: describeLokiError(error),
            itemIndex: batch[0].itemIndex
        })
    }
}

export class Loki implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'Loki',
        name: 'loki',
        icon: {
            light: 'file:loki.svg',
            dark: 'file:loki.dark.svg'
        },
        group: ['output'],
        version: 1,
        subtitle: '={{$parameter["operation"]}}',
        description: 'Send log lines to Grafana Loki',
        defaults: {
            name: 'Loki'
        },
        usableAsTool: true,
        inputs: [NodeConnectionTypes.Main],
        outputs: [NodeConnectionTypes.Main],
        credentials: [
            {
                name: 'lokiApi',
                required: true,
                displayOptions: { show: { operation: ['push'] } }
            }
        ],
        properties: lokiProperties
    }

    async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
        const items = this.getInputData()
        const operation = this.getNodeParameter('operation', 0) as string

        if (operation === 'setWorkflowLogging') {
            return [runControlNode.call(this, items)]
        }

        const context = readWorkflowContext.call(this)
        const defaults = resolveWorkflowDefaults.call(this, context, items, 0)
        if (!defaults.enabled) {
            return [items]
        }

        const returnData: INodeExecutionData[] = []

        const credentials = await this.getCredentials('lokiApi')
        const pushUrl = resolvePushUrl(credentials.url as string, this.getNode())
        const entries = collectEntries.call(this, items, returnData, context, defaults)

        const options = this.getNodeParameter('options', 0, {}) as IDataObject
        const batchAllItems = this.getNodeParameter('options.batchAllItems', 0, true) as boolean
        const timeout = coerceTimeout(options.timeout) ?? defaults.timeout ?? 10000
        const additionalHeaders = readAdditionalHeaders.call(this, 0, defaults.additionalHeaders)
        const batches = batchAllItems ? [entries] : entries.map(item => [item])

        for (const batch of batches) {
            await pushBatch.call(this, batch, pushUrl, additionalHeaders, timeout, returnData)
        }

        return [returnData]
    }
}

function extractErrorMessage(error: unknown): string {
    if (typeof error === 'string') {
        return error
    }
    if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
        return error.message
    }
    return 'Unknown error'
}

function describeLokiError(error: unknown): string {
    const message = extractErrorMessage(error)
    if (/label/i.test(message)) {
        return 'Check that all label names only contain letters, digits and underscores, and do not start with a digit.'
    }
    if (/out of order|too far behind|entry too far behind/i.test(message)) {
        return 'Loki rejected the entry because it arrived out of order or too far behind the most recent entry for this stream.'
    }
    if (/401|403/.test(message)) {
        return 'Check the credential authentication settings and, for multi-tenant Loki, the tenant ID (X-Scope-OrgID).'
    }
    return 'See the Loki response above for details.'
}
