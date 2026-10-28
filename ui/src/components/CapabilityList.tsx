import type { Capabilities } from '../types'

function formatValue(value: unknown) {
  if (value === null || value === undefined || value === '') return 'N/A'
  if (typeof value === 'number') return Number.isInteger(value) ? `${value}` : value.toFixed(1)
  return String(value)
}

export function CapabilityList({ capabilities }: { capabilities: Capabilities | null }) {
  const caps = capabilities
  return (
    <dl className="mt-3 space-y-1.5 text-sm">
      <div className="flex items-center justify-between gap-3">
        <dt className="text-tx-muted">CPU cores</dt>
        <dd className="text-tx-primary">{formatValue(caps?.cores)}</dd>
      </div>
      <div className="flex items-center justify-between gap-3">
        <dt className="text-tx-muted">Memory</dt>
        <dd className="text-tx-primary">
          {caps?.memory_gb != null ? `${caps.memory_gb} GB` : 'N/A'}
        </dd>
      </div>
      <div className="flex items-center justify-between gap-3">
        <dt className="text-tx-muted">Platform</dt>
        <dd className="text-tx-primary">{formatValue(caps?.platform)}</dd>
      </div>
      {caps?.gpu ? (
        <div className="flex items-center justify-between gap-3">
          <dt className="text-tx-muted">GPU</dt>
          <dd className="text-tx-primary">
            {formatValue(caps.gpu.device ?? caps.gpu.vendor)}
          </dd>
        </div>
      ) : null}
    </dl>
  )
}
