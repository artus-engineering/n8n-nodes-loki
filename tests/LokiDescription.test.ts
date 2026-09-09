import { type INode, type INodeParameters, NodeHelpers } from 'n8n-workflow'
import { describe, expect, it } from 'vitest'
import { lokiProperties } from '../nodes/Loki/LokiDescription'

const node = {
    id: '1',
    name: 'Loki',
    type: 'n8n-nodes-loki.loki',
    typeVersion: 1,
    position: [0, 0],
    parameters: {}
} as unknown as INode

function resolve(saved: INodeParameters) {
    return NodeHelpers.getNodeParameters(lokiProperties, saved, false, false, node, null) as INodeParameters
}

describe('lokiProperties', () => {
    it('keeps push-only options on a Send Log node', () => {
        const resolved = resolve({
            operation: 'push',
            message: 'hello',
            options: { batchAllItems: false, timestamp: '2024-01-01T00:00:00Z', timeout: 5000 }
        })

        expect(resolved.options).toEqual({
            batchAllItems: false,
            timestamp: '2024-01-01T00:00:00Z',
            timeout: 5000
        })
    })

    it('keeps push-only options on nodes saved before the operation field existed', () => {
        const resolved = resolve({
            message: 'hello',
            options: { batchAllItems: false, timestamp: '2024-01-01T00:00:00Z' }
        })

        expect(resolved.options).toEqual({ batchAllItems: false, timestamp: '2024-01-01T00:00:00Z' })
    })

    it('hides push-only options on a Set Workflow Logging node', () => {
        const resolved = resolve({
            operation: 'setWorkflowLogging',
            loggingEnabled: false,
            options: { batchAllItems: false, timestamp: '2024-01-01T00:00:00Z', timeout: 5000 }
        })

        expect(resolved.options).toEqual({ timeout: 5000 })
    })
})
