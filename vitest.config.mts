import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

/**
 * n8n-workflow (and @n8n/expression-runtime) ship ESM with extensionless
 * imports, so Vite must transform them. Their .map files point at unpublished
 * src/, which Vite then warns about on every import.
 */
function stripBrokenDependencySourcemaps() {
    return {
        name: 'strip-broken-dependency-sourcemaps',
        enforce: 'pre' as const,
        load(id: string) {
            const file = id.split('?')[0] ?? id
            if (!file.endsWith('.js') || !file.includes('node_modules')) {
                return
            }
            if (!file.includes('n8n-workflow') && !file.includes('expression-runtime')) {
                return
            }

            let code: string
            try {
                code = readFileSync(file, 'utf8')
            } catch {
                return
            }

            if (!code.includes('sourceMappingURL')) {
                return
            }

            return code.replace(/\/\/[#@]\s*sourceMappingURL=\S+/g, '')
        }
    }
}

export default defineConfig({
    plugins: [stripBrokenDependencySourcemaps()],
    test: {
        include: ['tests/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'lcovonly'],
            reportsDirectory: 'coverage',
            include: ['nodes/**/*.ts', 'credentials/**/*.ts'],
            exclude: ['nodes/**/*Description.ts']
        }
    }
})
