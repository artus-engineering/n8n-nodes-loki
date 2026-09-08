import type { ICredentialDataDecryptedObject, IHttpRequestOptions } from 'n8n-workflow'
import { describe, expect, it } from 'vitest'
import { LokiApi } from '../credentials/LokiApi.credentials'

function baseRequestOptions(): IHttpRequestOptions {
    return { method: 'POST', url: 'https://loki.example.com/loki/api/v1/push' }
}

describe('LokiApi credential', () => {
    it('adds no auth headers when authentication is none', async () => {
        const credential = new LokiApi()
        const credentials: ICredentialDataDecryptedObject = { authentication: 'none' }
        const result = await credential.authenticate(credentials, baseRequestOptions())
        expect(result.headers).toEqual({})
    })

    it('sets basic auth on the request options', async () => {
        const credential = new LokiApi()
        const credentials: ICredentialDataDecryptedObject = {
            authentication: 'basicAuth',
            username: 'user',
            password: 'pass'
        }
        const result = await credential.authenticate(credentials, baseRequestOptions())
        expect(result.auth).toEqual({ username: 'user', password: 'pass' })
    })

    it('sets a bearer token header', async () => {
        const credential = new LokiApi()
        const credentials: ICredentialDataDecryptedObject = { authentication: 'bearerToken', token: 'abc123' }
        const result = await credential.authenticate(credentials, baseRequestOptions())
        expect((result.headers as Record<string, string>).Authorization).toBe('Bearer abc123')
    })

    it('sets a custom auth header', async () => {
        const credential = new LokiApi()
        const credentials: ICredentialDataDecryptedObject = {
            authentication: 'headerAuth',
            headerName: 'X-Api-Key',
            headerValue: 'secret'
        }
        const result = await credential.authenticate(credentials, baseRequestOptions())
        expect((result.headers as Record<string, string>)['X-Api-Key']).toBe('secret')
    })

    it('adds the tenant header when a tenant ID is set', async () => {
        const credential = new LokiApi()
        const credentials: ICredentialDataDecryptedObject = { authentication: 'none', tenantId: 'team-a' }
        const result = await credential.authenticate(credentials, baseRequestOptions())
        expect((result.headers as Record<string, string>)['X-Scope-OrgID']).toBe('team-a')
    })

    it('applies custom headers', async () => {
        const credential = new LokiApi()
        const credentials: ICredentialDataDecryptedObject = {
            authentication: 'none',
            customHeaders: { header: [{ name: 'X-Custom', value: 'value1' }] }
        }
        const result = await credential.authenticate(credentials, baseRequestOptions())
        expect((result.headers as Record<string, string>)['X-Custom']).toBe('value1')
    })

    it('forwards skipTlsValidation as skipSslCertificateValidation', async () => {
        const credential = new LokiApi()
        const credentials: ICredentialDataDecryptedObject = { authentication: 'none', skipTlsValidation: true }
        const result = await credential.authenticate(credentials, baseRequestOptions())
        expect(result.skipSslCertificateValidation).toBe(true)
    })
})
