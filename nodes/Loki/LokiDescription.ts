import type { INodeProperties } from 'n8n-workflow'

export const lokiProperties: INodeProperties[] = [
    {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        options: [
            {
                name: 'Send Log',
                value: 'push',
                description: 'Send one or more log lines to Loki',
                action: 'Send log'
            },
            {
                name: 'Set Workflow Logging',
                value: 'setWorkflowLogging',
                description: 'Turn Loki logging on or off for all Loki nodes further down this workflow',
                action: 'Set workflow logging'
            }
        ],
        default: 'push'
    },
    {
        displayName: 'Logging Enabled',
        name: 'loggingEnabled',
        type: 'boolean',
        default: true,
        displayOptions: { show: { operation: ['setWorkflowLogging'] } },
        description:
            'Whether Loki nodes downstream of this node send their log lines. Turn off to mute Loki for the whole workflow.'
    },
    {
        displayName: 'Labels',
        name: 'labels',
        type: 'assignmentCollection',
        default: {},
        displayOptions: { show: { operation: ['push', 'setWorkflowLogging'] } },
        description:
            'Extra Loki stream labels. On Send Log they apply to this entry; on Set Workflow Logging they are added to every downstream Loki node. A label set on a Send Log node overrides a workflow-wide label of the same name. The node always adds "job" / "n8n", "workflow" and "workflow_id".'
    },
    {
        displayName: 'Log Format',
        name: 'logFormat',
        type: 'options',
        displayOptions: { show: { operation: ['push'] } },
        options: [
            { name: 'Text', value: 'text' },
            { name: 'JSON', value: 'json' }
        ],
        default: 'text'
    },
    {
        displayName: 'Message',
        name: 'message',
        type: 'string',
        typeOptions: { rows: 4 },
        default: '',
        placeholder: 'Something happened',
        displayOptions: { show: { operation: ['push'], logFormat: ['text'] } },
        description: 'The plain-text log line'
    },
    {
        displayName: 'JSON Input Mode',
        name: 'jsonInputMode',
        type: 'options',
        displayOptions: { show: { operation: ['push'], logFormat: ['json'] } },
        options: [
            { name: 'JSON', value: 'raw', description: 'Provide the log line as a raw JSON value' },
            { name: 'Fields Below', value: 'fields', description: 'Build the log line from typed key/value fields' }
        ],
        default: 'raw'
    },
    {
        displayName: 'JSON',
        name: 'jsonBody',
        type: 'json',
        default: '{}',
        displayOptions: { show: { operation: ['push'], logFormat: ['json'], jsonInputMode: ['raw'] } },
        description: 'The log line, serialized as JSON'
    },
    {
        displayName: 'Fields',
        name: 'jsonFields',
        type: 'assignmentCollection',
        default: {},
        displayOptions: { show: { operation: ['push'], logFormat: ['json'], jsonInputMode: ['fields'] } },
        description: 'Key/value fields that are assembled into the JSON log line'
    },
    {
        displayName: 'Options',
        name: 'options',
        type: 'collection',
        placeholder: 'Add Option',
        default: {},
        displayOptions: { show: { operation: ['push', 'setWorkflowLogging'] } },
        options: [
            {
                displayName: 'Additional Headers',
                name: 'additionalHeaders',
                type: 'fixedCollection',
                typeOptions: { multipleValues: true },
                placeholder: 'Add Header',
                default: {},
                description:
                    'Extra headers sent with the request, on top of the ones configured on the credential. On Set Workflow Logging these are the default for every downstream Loki node; a header set on a Send Log node overrides a workflow-wide header of the same name.',
                options: [
                    {
                        displayName: 'Header',
                        name: 'header',
                        values: [
                            { displayName: 'Name', name: 'name', type: 'string', default: '' },
                            { displayName: 'Value', name: 'value', type: 'string', default: '' }
                        ]
                    }
                ]
            },
            {
                displayName: 'Propagate to Sub-Workflows',
                name: 'propagateToSubWorkflows',
                type: 'boolean',
                default: true,
                displayOptions: { show: { '/operation': ['setWorkflowLogging'] } },
                description:
                    'Whether to write the resolved settings onto every item as "_lokiLogging", so Loki nodes in workflows started further down (Execute Sub-workflow) inherit them. Turn off to leave the items untouched; the switch then only applies inside this workflow.'
            },
            {
                displayName: 'Send All Items in One Request',
                name: 'batchAllItems',
                type: 'boolean',
                default: true,
                displayOptions: { show: { '/operation': ['push'] } },
                description:
                    'Whether to send all input items to Loki in a single push request instead of one request per item'
            },
            {
                displayName: 'Structured Metadata',
                name: 'structuredMetadata',
                type: 'fixedCollection',
                typeOptions: { multipleValues: true },
                placeholder: 'Add Metadata',
                default: {},
                description:
                    'Extra per-entry structured metadata (indexed but not part of the stream labels). The n8n execution ID is always added as execution_id. On Set Workflow Logging these are the default for every downstream Loki node; a key set on a Send Log node overrides a workflow-wide key of the same name.',
                options: [
                    {
                        displayName: 'Metadata',
                        name: 'metadata',
                        values: [
                            { displayName: 'Name', name: 'name', type: 'string', default: '' },
                            { displayName: 'Value', name: 'value', type: 'string', default: '' }
                        ]
                    }
                ]
            },
            {
                displayName: 'Timeout',
                name: 'timeout',
                type: 'number',
                default: 10000,
                description:
                    'Time in ms to wait for Loki to respond before aborting the request. On Set Workflow Logging this becomes the default for downstream Loki nodes; a Timeout set on a Send Log node overrides it.'
            },
            {
                displayName: 'Timestamp',
                name: 'timestamp',
                type: 'string',
                default: '',
                displayOptions: { show: { '/operation': ['push'] } },
                placeholder: 'e.g. 2024-01-01T00:00:00Z, or leave empty for now',
                description:
                    'ISO-8601 timestamp or epoch number (seconds, milliseconds, microseconds or nanoseconds are auto-detected). Defaults to the current time.'
            }
        ]
    }
]
