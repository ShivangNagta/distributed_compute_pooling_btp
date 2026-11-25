// Merges native/wasmtime/browser results into a Markdown report and CSV.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const resultsDir = path.join(here, 'results')

function read(name) {
  const file = path.join(resultsDir, name)
  if (!fs.existsSync(file)) return null
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function number(value) {
  return typeof value === 'number' ? value : null
}

function coldTotal(entry) {
  if (!entry) return null
  const compile = number(entry.compile?.p50_ms) ?? 0
  const instantiate = number(entry.instantiate?.p50_ms) ?? 0
  const call = number(entry.call?.p50_ms) ?? 0
  return Math.round((compile + instantiate + call) * 1000) / 1000
}

function formatNumber(value) {
  if (value === null || value === undefined) return '—'
  if (Number.isInteger(value)) return value.toLocaleString('en-US')
  return value.toFixed(3)
}

function formatMs(value) {
  if (value === null || value === undefined) return '—'
  return value.toFixed(3)
}

function csvCell(value) {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function svgChart(title, cases, series) {
  const width = 940
  const rowHeight = 40
  const top = 78
  const height = top + cases.length * rowHeight + 24
  const chartX = 174
  const chartWidth = width - chartX - 100

  const values = []
  for (const id of cases) {
    for (const item of series) {
      const value = item.value(id)
      if (typeof value === 'number' && value > 0) values.push(value)
    }
  }
  const min = Math.min(...values, 0.001)
  const max = Math.max(...values, 0.001)
  const logMin = Math.log10(min)
  const span = Math.log10(max) - logMin || 1

  const parts = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="ui-sans-serif, system-ui, sans-serif">`,
  )
  parts.push(`<rect width="${width}" height="${height}" fill="#ffffff"/>`)
  parts.push(
    `<text x="24" y="30" font-size="18" font-weight="600" fill="#111827">${escapeXml(title)}</text>`,
  )
  parts.push(
    '<text x="24" y="50" font-size="12" fill="#6b7280">p50 milliseconds, log scale</text>',
  )

  let legendX = 24
  for (const item of series) {
    parts.push(
      `<rect x="${legendX}" y="60" width="10" height="10" rx="2" fill="${item.color}"/>`,
    )
    parts.push(
      `<text x="${legendX + 15}" y="69" font-size="12" fill="#374151">${escapeXml(item.name)}</text>`,
    )
    legendX += 20 + item.name.length * 7
  }

  cases.forEach((id, rowIndex) => {
    const rowY = top + rowIndex * rowHeight
    const available = series.filter((item) => {
      const value = item.value(id)
      return typeof value === 'number' && value > 0
    })
    const barHeight = 10
    const gap = 3
    const groupHeight =
      available.length * barHeight + Math.max(0, available.length - 1) * gap
    const groupTop = rowY + (rowHeight - groupHeight) / 2

    parts.push(
      `<text x="162" y="${rowY + rowHeight / 2 + 4}" font-size="12" text-anchor="end" fill="#374151">${escapeXml(id)}</text>`,
    )

    available.forEach((item, index) => {
      const value = item.value(id)
      const ratio = (Math.log10(value) - logMin) / span
      const barWidth = Math.max(2, Math.min(chartWidth, ratio * chartWidth))
      const y = groupTop + index * (barHeight + gap)
      parts.push(
        `<rect x="${chartX}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight}" rx="2" fill="${item.color}"><title>${escapeXml(id)} ${escapeXml(item.name)}: ${value} ms</title></rect>`,
      )
      parts.push(
        `<text x="${(chartX + barWidth + 6).toFixed(1)}" y="${(y + barHeight - 1).toFixed(1)}" font-size="10" fill="#4b5563">${value}</text>`,
      )
    })
  })

  parts.push(
    `<line x1="${chartX}" y1="${top}" x2="${chartX}" y2="${height - 18}" stroke="#e5e7eb" stroke-width="1"/>`,
  )
  parts.push('</svg>')
  return parts.join('\n')
}

const native = read('native.json')
const wasmtime = read('wasmtime.json')
const browser = read('browser.json')

const byId = (result) =>
  new Map((result?.cases ?? []).map((entry) => [entry.id, entry]))

const nativeCases = byId(native)
const wasmtimeCases = byId(wasmtime)
const browserCases = byId(browser)

const ids = [
  ...new Set([
    ...nativeCases.keys(),
    ...wasmtimeCases.keys(),
    ...browserCases.keys(),
  ]),
]

const warmSeries = [
  {
    name: 'native',
    color: '#2563eb',
    value: (id) => number(nativeCases.get(id)?.call?.p50_ms),
  },
  {
    name: 'wasmtime',
    color: '#7c3aed',
    value: (id) => number(wasmtimeCases.get(id)?.warm?.call?.p50_ms),
  },
  {
    name: 'browser',
    color: '#059669',
    value: (id) => number(browserCases.get(id)?.warm?.call?.p50_ms),
  },
]

const coldSeries = [
  {
    name: 'wasmtime',
    color: '#7c3aed',
    value: (id) => coldTotal(wasmtimeCases.get(id)?.cold),
  },
  {
    name: 'browser',
    color: '#059669',
    value: (id) => coldTotal(browserCases.get(id)?.cold),
  },
]

const lines = []
lines.push('# WASM benchmark report')
lines.push('')
lines.push('Warm call = repeated invocation on a pre-instantiated module.')
lines.push('Cold total = compile + instantiate + first call (p50).')
lines.push('')
lines.push(
  '| case | result | native warm p50 (ms) | wasmtime warm p50 (ms) | wasmtime cold total (ms) | browser warm p50 (ms) | browser cold total (ms) |',
)
lines.push('|---|---|---|---|---|---|---|')

const csv = [
  'case,result,native_warm_p50_ms,wasmtime_warm_p50_ms,wasmtime_cold_total_ms,browser_warm_p50_ms,browser_cold_total_ms',
]

for (const id of ids) {
  const n = nativeCases.get(id)
  const w = wasmtimeCases.get(id)
  const b = browserCases.get(id)
  const result = n?.result ?? w?.result ?? b?.result
  const values = [
    result,
    number(n?.call?.p50_ms),
    number(w?.warm?.call?.p50_ms),
    coldTotal(w?.cold),
    number(b?.warm?.call?.p50_ms),
    coldTotal(b?.cold),
  ]
  const markdown = [
    id,
    formatNumber(values[0]),
    formatMs(values[1]),
    formatMs(values[2]),
    formatMs(values[3]),
    formatMs(values[4]),
    formatMs(values[5]),
  ]
  lines.push(`| ${markdown.join(' | ')} |`)
  csv.push([id, ...values.map(csvCell)].join(','))
}

lines.push('')
lines.push('## Warm call')
lines.push('')
lines.push('![Warm call p50](warm-call.svg)')
lines.push('')
lines.push('## Cold total')
lines.push('')
lines.push('![Cold total p50](cold-total.svg)')
lines.push('')
if (native) {
  lines.push(
    `- native: ${native.iterations} iterations, ${native.warmup} warmup`,
  )
}
if (wasmtime) {
  lines.push(
    `- wasmtime: ${wasmtime.iterations} iterations, ${wasmtime.warmup} warmup`,
  )
}
if (browser) {
  lines.push(
    `- browser: ${browser.iterations} iterations, ${browser.warmup} warmup`,
  )
  lines.push(`- browser UA: ${browser.userAgent}`)
}

fs.mkdirSync(resultsDir, { recursive: true })
fs.writeFileSync(path.join(resultsDir, 'report.md'), lines.join('\n') + '\n')
fs.writeFileSync(path.join(resultsDir, 'summary.csv'), csv.join('\n') + '\n')
fs.writeFileSync(
  path.join(resultsDir, 'warm-call.svg'),
  svgChart('Warm call p50', ids, warmSeries) + '\n',
)
fs.writeFileSync(
  path.join(resultsDir, 'cold-total.svg'),
  svgChart('Cold total p50', ids, coldSeries) + '\n',
)
console.log('wrote benchmarks/results/report.md')
console.log('wrote benchmarks/results/summary.csv')
console.log('wrote benchmarks/results/warm-call.svg')
console.log('wrote benchmarks/results/cold-total.svg')
