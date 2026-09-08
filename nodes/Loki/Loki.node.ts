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
    buildStreams,
    type LokiLogEntry,
    resolvePushUrl,
    serializeLogLine,
    type TypedField,
    toNanoseconds
} from './GenericFunctions'
import { lokiProperties } from './LokiDescription'

function readLabels(this: IExecuteFunctions, itemIndex: number): Record<string, string> {
    const raw = this.getNodeParameter('labels.label', itemIndex, []) as Array<{ name: string; value: string }>
    const labels: Record<string, string> = {}
    for (const { name, value } of raw) {
        if (name) {
            labels[name] = value
        }
    }
    if (Object.keys(labels).length === 0) {
        throw new NodeOperationError(this.getNode(), 'At least one label is required', { itemIndex })
    }
    return labels
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

    const fields = this.getNodeParameter('jsonFields.field', itemIndex, []) as TypedField[]
    return serializeLogLine('json', { jsonInputMode: 'fields', fields }, this.getNode())
}

function readMetadata(this: IExecuteFunctions, itemIndex: number): Record<string, string> | undefined {
    const raw = this.getNodeParameter('options.structuredMetadata.metadata', itemIndex, []) as Array<{
        name: string
        value: string
    }>
    if (raw.length === 0) {
        return undefined
    }
    const metadata: Record<string, string> = {}
    for (const { name, value } of raw) {
        if (name) {
            metadata[name] = value
        }
    }
    return metadata
}

function readAdditionalHeaders(this: IExecuteFunctions, itemIndex: number): Record<string, string> {
    const raw = this.getNodeParameter('options.additionalHeaders.header', itemIndex, []) as Array<{
        name: string
        value: string
    }>
    const headers: Record<string, string> = {}
    for (const { name, value } of raw) {
        if (name) {
            headers[name] = value
        }
    }
    return headers
}

interface IndexedEntry {
    entry: LokiLogEntry
    itemIndex: number
}

function readLogEntry(this: IExecuteFunctions, itemIndex: number): LokiLogEntry {
    const timestamp = this.getNodeParameter('options.timestamp', itemIndex, '') as string
    return {
        labels: readLabels.call(this, itemIndex),
        line: readLine.call(this, itemIndex),
        timestampNs: toNanoseconds(timestamp || undefined, this.getNode()),
        metadata: readMetadata.call(this, itemIndex)
    }
}

function collectEntries(this: IExecuteFunctions, itemCount: number, returnData: INodeExecutionData[]): IndexedEntry[] {
    const entries: IndexedEntry[] = []

    for (let itemIndex = 0; itemIndex < itemCount; itemIndex++) {
        try {
            entries.push({
                entry: readLogEntry.call(this, itemIndex),
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
                required: true
            }
        ],
        properties: lokiProperties
    }

    async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
        const items = this.getInputData()
        const returnData: INodeExecutionData[] = []

        const credentials = await this.getCredentials('lokiApi')
        const pushUrl = resolvePushUrl(credentials.url as string, this.getNode())
        const entries = collectEntries.call(this, items.length, returnData)

        const batchAllItems = this.getNodeParameter('options.batchAllItems', 0, true) as boolean
        const timeout = this.getNodeParameter('options.timeout', 0, 10000) as number
        const additionalHeaders = readAdditionalHeaders.call(this, 0)
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
