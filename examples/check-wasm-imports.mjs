// Fails if any workload module imports host functions. The browser worker
// instantiates modules with no imports, so an imported module cannot run.
import fs from 'node:fs'
import path from 'node:path'

const files = process.argv.slice(2)
if (files.length === 0) {
  console.error('usage: check-wasm-imports.mjs <module.wasm>...')
  process.exit(2)
}

let failed = false
for (const file of files) {
  const bytes = fs.readFileSync(file)
  const module = new WebAssembly.Module(bytes)
  const imports = WebAssembly.Module.imports(module)
  const exports = WebAssembly.Module.exports(module)
    .filter((entry) => entry.kind === 'function')
    .map((entry) => entry.name)

  if (imports.length > 0) {
    console.error(
      `${path.basename(file)}: has imports -> ${JSON.stringify(imports)}`,
    )
    failed = true
    continue
  }

  console.log(`${path.basename(file)}: ok (${exports.join(', ')})`)
}

if (failed) process.exit(1)
