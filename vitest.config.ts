import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        include: ['tests/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'lcov'],
            reportsDirectory: 'coverage',
            include: ['nodes/**/*.ts', 'credentials/**/*.ts'],
            exclude: ['nodes/**/*Description.ts']
        }
    }
})
