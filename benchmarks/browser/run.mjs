// Runs the browser benchmark in headless Chromium and writes JSON results.
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const configPath = path.join(root, 'benchmarks/bench.json')
const outPath = path.join(root, 'benchmarks/results/browser.json')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
}

function startServer() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const filePath = path.join(root, decodeURIComponent(url.pathname))
    if (!filePath.startsWith(root)) {
      response.writeHead(403).end('forbidden')
      return
    }
    fs.readFile(filePath, (error, data) => {
      if (error) {
        response.writeHead(404).end('not found')
        return
      }
      response.writeHead(200, {
        'Content-Type':
          MIME[path.extname(filePath)] ?? 'application/octet-stream',
        'Cross-Origin-Opener-Policy': 'same-origin',
      })
      response.end(data)
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

async function main() {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  const pageConfig = {
    iterations: config.iterations,
    warmup: config.warmup,
    cases: config.cases.map((item) => {
      const absolute = path.resolve(path.dirname(configPath), item.wasm)
      const relative = path.relative(root, absolute).split(path.sep).join('/')
      return { ...item, wasmUrl: `/${relative}` }
    }),
  }

  const server = await startServer()
  const { port } = server.address()
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    page.on('console', (message) => console.log('[browser]', message.text()))
    page.on('pageerror', (error) => console.error('[browser error]', error))

    await page.goto(`http://127.0.0.1:${port}/benchmarks/browser/index.html`)
    const result = await page.evaluate(
      (benchConfig) => window.runBench(benchConfig),
      pageConfig,
    )

    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n')
    console.log(`wrote ${path.relative(root, outPath)}`)
  } finally {
    await browser.close()
    await new Promise((resolve) => server.close(resolve))
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
