// `n8n-node build` globs `**/*.{png,svg}` across the whole repo (it only
// excludes `dist` and `node_modules`), so it also sweeps README assets and
// leftover coverage-report icons into `dist/`. Keep only what the package
// actually ships: the compiled node/credential and their static files.
import { readdirSync, rmSync } from 'node:fs'

const KEEP = new Set(['nodes', 'credentials', 'package.json'])

for (const entry of readdirSync('dist')) {
    if (!KEEP.has(entry)) {
        rmSync(`dist/${entry}`, { recursive: true, force: true })
    }
}
