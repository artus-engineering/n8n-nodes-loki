import type {
    ICredentialDataDecryptedObject,
    ICredentialTestRequest,
    ICredentialType,
    IHttpRequestOptions,
    INodeProperties
} from 'n8n-workflow'

export class LokiApi implements ICredentialType {
    name = 'lokiApi'

    displayName = 'Loki API'

    icon = 'file:../nodes/Loki/loki.svg' as const

    documentationUrl = 'https://grafana.com/docs/loki/latest/reference/loki-http-api/'

    properties: INodeProperties[] = [
        {
            displayName: 'Loki URL',
            name: 'url',
            type: 'string',
            default: '',
            placeholder: 'https://loki.example.com',
            description:
                'Base URL of your Loki instance, or the full push endpoint. Both "https://loki.example.com" and "https://loki.example.com/loki/api/v1/push" work.',
            required: true
        },
        {
            displayName: 'Authentication',
            name: 'authentication',
            type: 'options',
            options: [
                { name: 'None', value: 'none' },
                { name: 'Basic Auth', value: 'basicAuth' },
                { name: 'Bearer Token', value: 'bearerToken' },
                { name: 'Header Auth', value: 'headerAuth' }
            ],
            default: 'none'
        },
        {
            displayName: 'Username',
            name: 'username',
            type: 'string',
            default: '',
            displayOptions: { show: { authentication: ['basicAuth'] } }
        },
        {
            displayName: 'Password',
            name: 'password',
            type: 'string',
            typeOptions: { password: true },
            default: '',
            displayOptions: { show: { authentication: ['basicAuth'] } }
        },
        {
            displayName: 'Token',
            name: 'token',
            type: 'string',
            typeOptions: { password: true },
            default: '',
            displayOptions: { show: { authentication: ['bearerToken'] } }
        },
        {
            displayName: 'Header Name',
            name: 'headerName',
            type: 'string',
            default: 'Authorization',
            displayOptions: { show: { authentication: ['headerAuth'] } }
        },
        {
            displayName: 'Header Value',
            name: 'headerValue',
            type: 'string',
            typeOptions: { password: true },
            default: '',
            displayOptions: { show: { authentication: ['headerAuth'] } }
        },
        {
            displayName: 'Tenant ID (X-Scope-OrgID)',
            name: 'tenantId',
            type: 'string',
            default: '',
            description: 'Sent as the X-Scope-OrgID header for multi-tenant Loki setups. Leave empty if not applicable.'
        },
        {
            displayName: 'Custom Headers',
            name: 'customHeaders',
            type: 'fixedCollection',
            typeOptions: { multipleValues: true },
            default: {},
            placeholder: 'Add Header',
            options: [
                {
                    displayName: 'Header',
                    name: 'header',
                    values: [
                        { displayName: 'Name', name: 'name', type: 'string', default: '' },
                        { displayName: 'Value', name: 'value', type: 'string', default: '' }
                    ]
                }
            ],
            description: 'Headers sent with every request made using this credential'
        },
        {
            displayName: 'Ignore SSL Issues (Insecure)',
            name: 'skipTlsValidation',
            type: 'boolean',
            default: false,
            description: 'Whether to accept self-signed or otherwise invalid TLS certificates'
        }
    ]

    async authenticate(
        credentials: ICredentialDataDecryptedObject,
        requestOptions: IHttpRequestOptions
    ): Promise<IHttpRequestOptions> {
        const headers: Record<string, string> = { ...(requestOptions.headers as Record<string, string>) }

        if (credentials.authentication === 'basicAuth') {
            requestOptions.auth = {
                username: credentials.username as string,
                password: credentials.password as string
            }
        } else if (credentials.authentication === 'bearerToken') {
            headers.Authorization = `Bearer ${credentials.token as string}`
        } else if (credentials.authentication === 'headerAuth') {
            const headerName = credentials.headerName as string
            if (headerName) {
                headers[headerName] = credentials.headerValue as string
            }
        }

        if (credentials.tenantId) {
            headers['X-Scope-OrgID'] = credentials.tenantId as string
        }

        for (const entry of ((credentials.customHeaders as { header?: Array<{ name: string; value: string }> })
            ?.header ?? []) as Array<{ name: string; value: string }>) {
            if (entry.name) {
                headers[entry.name] = entry.value
            }
        }

        requestOptions.headers = headers
        requestOptions.skipSslCertificateValidation = credentials.skipTlsValidation as boolean

        return requestOptions
    }

    test: ICredentialTestRequest = {
        request: {
            baseURL: '={{ $credentials.url.trim().replace(/\\/+$/, "").replace(/\\/loki\\/api\\/v1(\\/push)?$/, "") }}',
            url: '/loki/api/v1/labels',
            method: 'GET'
        }
    }
}
