// Registers the .ts resolve hook for the test process (loaded via `node --import`).
import { register } from 'node:module'
register('./resolve-ts.mjs', import.meta.url)
