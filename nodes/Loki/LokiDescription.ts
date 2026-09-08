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
            }
        ],
        default: 'push'
    },
    {
        displayName: 'Labels',
        name: 'labels',
        type: 'fixedCollection',
        typeOptions: { multipleValues: true },
        placeholder: 'Add Label',
        default: {},
        description: 'Loki stream labels for this log entry, e.g. "job" / "n8n". At least one label is required.',
        options: [
            {
                displayName: 'Label',
                name: 'label',
                values: [
                    { displayName: 'Name', name: 'name', type: 'string', default: '' },
                    { displayName: 'Value', name: 'value', type: 'string', default: '' }
                ]
            }
        ]
    },
    {
        displayName: 'Log Format',
        name: 'logFormat',
        type: 'options',
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
        displayOptions: { show: { logFormat: ['text'] } },
        description: 'The plain-text log line'
    },
    {
        displayName: 'JSON Input Mode',
        name: 'jsonInputMode',
        type: 'options',
        displayOptions: { show: { logFormat: ['json'] } },
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
        displayOptions: { show: { logFormat: ['json'], jsonInputMode: ['raw'] } },
        description: 'The log line, serialized as JSON'
    },
    {
        displayName: 'Fields',
        name: 'jsonFields',
        type: 'fixedCollection',
        typeOptions: { multipleValues: true },
        placeholder: 'Add Field',
        default: {},
        displayOptions: { show: { logFormat: ['json'], jsonInputMode: ['fields'] } },
        description: 'Key/value fields that are assembled into the JSON log line',
        options: [
            {
                displayName: 'Field',
                name: 'field',
                values: [
                    { displayName: 'Name', name: 'name', type: 'string', default: '' },
                    { displayName: 'Value', name: 'value', type: 'string', default: '' },
                    {
                        displayName: 'Type',
                        name: 'type',
                        type: 'options',
                        options: [
                            { name: 'String', value: 'string' },
                            { name: 'Number', value: 'number' },
                            { name: 'Boolean', value: 'boolean' },
                            { name: 'JSON', value: 'json' }
                        ],
                        default: 'string'
                    }
                ]
            }
        ]
    },
    {
        displayName: 'Options',
        name: 'options',
        type: 'collection',
        placeholder: 'Add Option',
        default: {},
        options: [
            {
                displayName: 'Additional Headers',
                name: 'additionalHeaders',
                type: 'fixedCollection',
                typeOptions: { multipleValues: true },
                placeholder: 'Add Header',
                default: {},
                description: 'Extra headers sent with this request, on top of the ones configured on the credential',
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
                displayName: 'Send All Items in One Request',
                name: 'batchAllItems',
                type: 'boolean',
                default: true,
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
                description: 'Per-entry structured metadata (indexed but not part of the stream labels)',
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
                description: 'Time in ms to wait for Loki to respond before aborting the request'
            },
            {
                displayName: 'Timestamp',
                name: 'timestamp',
                type: 'string',
                default: '',
                placeholder: 'e.g. 2024-01-01T00:00:00Z, or leave empty for now',
                description:
                    'ISO-8601 timestamp or epoch number (seconds, milliseconds, microseconds or nanoseconds are auto-detected). Defaults to the current time.'
            }
        ]
    }
]
