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
        <dt className="text-neutral-500">CPU cores</dt>
        <dd className="text-neutral-900">{formatValue(caps?.cores)}</dd>
      </div>
      <div className="flex items-center justify-between gap-3">
        <dt className="text-neutral-500">Memory</dt>
        <dd className="text-neutral-900">
          {caps?.memory_gb != null ? `${caps.memory_gb} GB` : 'N/A'}
        </dd>
      </div>
      <div className="flex items-center justify-between gap-3">
        <dt className="text-neutral-500">Platform</dt>
        <dd className="text-neutral-900">{formatValue(caps?.platform)}</dd>
      </div>
      {caps?.gpu ? (
        <div className="flex items-center justify-between gap-3">
          <dt className="text-neutral-500">GPU</dt>
          <dd className="text-neutral-900">
            {formatValue(caps.gpu.device ?? caps.gpu.vendor)}
          </dd>
        </div>
      ) : null}
    </dl>
  )
}
