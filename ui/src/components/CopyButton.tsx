import { useEffect, useRef, useState } from 'react'

type CopyButtonProps = {
  value: string
  label?: string
}

export function CopyButton({ value, label = 'Copy' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard may be unavailable; ignore.
    }
  }

  return (
    <button type="button" onClick={onCopy} className="btn btn-ghost shrink-0">
      {copied ? 'Copied' : label}
    </button>
  )
}
