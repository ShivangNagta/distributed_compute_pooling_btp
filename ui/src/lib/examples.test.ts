import { describe, expect, it } from 'vitest'

import {
  EXAMPLES,
  defaultValueMap,
  findExample,
  isSplittable,
} from './examples'

describe('workload catalog', () => {
  it('has unique ids', () => {
    const ids = EXAMPLES.map((example) => example.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has a default for every argument', () => {
    for (const example of EXAMPLES) {
      const defaults = defaultValueMap(example)
      for (const arg of example.args) {
        expect(defaults[arg.key]).toBe(arg.default)
      }
    }
  })

  it('points split policies at real arguments', () => {
    for (const example of EXAMPLES) {
      if (!example.split) continue
      const keys = new Set(example.args.map((arg) => arg.key))
      if (example.split.kind === 'range') {
        expect(keys.has(example.split.startKey)).toBe(true)
        expect(keys.has(example.split.endKey)).toBe(true)
      } else if (example.split.kind === 'iterations') {
        expect(keys.has(example.split.iterationsKey)).toBe(true)
      } else {
        expect(keys.has(example.split.rowsKey)).toBe(true)
      }
    }
  })

  it('serves wasm modules and source files', () => {
    for (const example of EXAMPLES) {
      expect(example.module).toMatch(/\.wasm$/)
      expect(example.sourceUrl).toMatch(/\.(rs|c)$/)
    }
  })

  it('looks examples up by id and reports splittability', () => {
    expect(findExample('add')?.entryPoint).toBe('add')
    expect(findExample('nope')).toBeUndefined()
    expect(isSplittable(EXAMPLES.find((e) => e.id === 'prime-count')!)).toBe(
      true,
    )
    expect(isSplittable(EXAMPLES.find((e) => e.id === 'add')!)).toBe(false)
    expect(isSplittable(EXAMPLES.find((e) => e.id === 'wordcount')!)).toBe(true)
  })
})
