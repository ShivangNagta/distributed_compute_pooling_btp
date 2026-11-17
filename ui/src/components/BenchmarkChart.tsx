import type { BenchmarkResult } from '../benchmarks/types'

type ScenarioDatum = {
  scenario: string
  median_ms: number
}

const SCENARIO_COLORS: Record<string, string> = {
  'native-backend': '#454545',
  'browser-local-wasm': '#8c8c8c',
  'remote-browser-worker': '#5f5f5f',
}

const CHART_WIDTH = 800
const CHART_HEIGHT = 420
const PLOT_LEFT = 56
const PLOT_RIGHT = CHART_WIDTH - 16
const PLOT_TOP = 40
const PLOT_BOTTOM = CHART_HEIGHT - 48
const PLOT_WIDTH = PLOT_RIGHT - PLOT_LEFT
const PLOT_HEIGHT = PLOT_BOTTOM - PLOT_TOP
const BAR_WIDTH = 18
const BAR_GAP = 8

function formatMilliseconds(value: number): string {
  if (value < 0.01) return `${value.toFixed(4)} ms`
  if (value < 1) return `${value.toFixed(3)} ms`
  return `${value.toFixed(2)} ms`
}

function groupResultsByWorkload(
  results: BenchmarkResult[],
): Array<{ workload: string; scenarios: ScenarioDatum[] }> {
  const byWorkload = new Map<string, BenchmarkResult[]>()
  for (const result of results) {
    const group = byWorkload.get(result.workload)
    if (group) {
      group.push(result)
    } else {
      byWorkload.set(result.workload, [result])
    }
  }

  return [...byWorkload.entries()].map(([workload, workloadResults]) => {
    const uniqueResults = [
      ...new Map(
        workloadResults.map((result) => [result.scenario, result] as const),
      ).values(),
    ]
    return {
      workload,
      scenarios: uniqueResults.map((result) => ({
        scenario: result.scenario,
        median_ms: result.summary.median_ms,
      })),
    }
  })
}

export function BenchmarkChart({ results }: { results: BenchmarkResult[] }) {
  const rows = groupResultsByWorkload(results)
  const maxMedian = Math.max(
    0,
    ...rows.flatMap((row) =>
      row.scenarios.map((scenario) => scenario.median_ms),
    ),
  )
  const topValue = maxMedian > 0 ? maxMedian : 1
  const groupWidth = rows.length > 0 ? PLOT_WIDTH / rows.length : PLOT_WIDTH

  return (
    <div>
      <div className="flex flex-wrap items-center gap-4">
        {Object.entries(SCENARIO_COLORS).map(([scenario, color]) => (
          <span
            key={scenario}
            className="flex items-center gap-2 text-xs text-tx-secondary"
          >
            <span
              className="inline-block h-3 w-3 rounded-sm"
              style={{ backgroundColor: color }}
            />
            {scenario}
          </span>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className="mt-4 w-full"
        role="img"
        aria-label="Benchmark median latency by workload and scenario"
      >
        {[0, 0.5, 1].map((fraction) => {
          const value = topValue * fraction
          const y = PLOT_TOP + PLOT_HEIGHT - PLOT_HEIGHT * fraction
          return (
            <g key={`grid-${fraction}`}>
              <line
                x1={PLOT_LEFT}
                x2={PLOT_RIGHT}
                y1={y}
                y2={y}
                stroke="#9e9e9e"
                strokeWidth={1}
              />
              <text
                x={PLOT_LEFT - 8}
                y={y + 3}
                fontSize={10}
                textAnchor="end"
                fill="#737373"
              >
                {formatMilliseconds(value)}
              </text>
            </g>
          )
        })}
        <line
          x1={PLOT_LEFT}
          x2={PLOT_RIGHT}
          y1={PLOT_BOTTOM}
          y2={PLOT_BOTTOM}
          stroke="#6f6f6f"
          strokeWidth={1}
        />
        {rows.map((row, rowIndex) => {
          const groupCenterX = PLOT_LEFT + groupWidth * (rowIndex + 0.5)
          const scenariosWidth =
            row.scenarios.length * (BAR_WIDTH + BAR_GAP) - BAR_GAP
          const groupStartX = groupCenterX - scenariosWidth / 2
          return (
            <g key={row.workload}>
              {row.scenarios.map((scenario, scenarioIndex) => {
                const barX = groupStartX + scenarioIndex * (BAR_WIDTH + BAR_GAP)
                const barHeight = Math.max(
                  (scenario.median_ms / topValue) * PLOT_HEIGHT,
                  1,
                )
                const barY = PLOT_BOTTOM - barHeight
                return (
                  <g key={`${row.workload}-${scenario.scenario}`}>
                    <rect
                      x={barX}
                      y={barY}
                      width={BAR_WIDTH}
                      height={barHeight}
                      rx={2}
                      fill={SCENARIO_COLORS[scenario.scenario] ?? '#737373'}
                    />
                    <text
                      x={barX + BAR_WIDTH / 2}
                      y={barY - 4}
                      fontSize={10}
                      textAnchor="middle"
                      fill="#737373"
                    >
                      {formatMilliseconds(scenario.median_ms)}
                    </text>
                  </g>
                )
              })}
              <text
                x={groupCenterX}
                y={PLOT_BOTTOM + 18}
                fontSize={10}
                textAnchor="middle"
                fill="#737373"
              >
                {row.workload}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
