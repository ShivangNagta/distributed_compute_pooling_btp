import { describe, expect, it } from 'vitest'

import { findExample } from './examples'
import {
  buildTaskInputs,
  combineResults,
  formatResult,
  splitRange,
  validateValues,
} from './workloads'

function example(id: string) {
  const found = findExample(id)
  if (!found) throw new Error(`missing example ${id}`)
  return found
}

describe('splitRange', () => {
  it('splits into contiguous balanced ranges', () => {
    expect(splitRange(0, 100, 4)).toEqual([
      [0, 25],
      [25, 50],
      [50, 75],
      [75, 100],
    ])
  })

  it('handles uneven splits', () => {
    expect(splitRange(0, 10, 3)).toEqual([
      [0, 3],
      [3, 6],
      [6, 10],
    ])
  })

  it('never returns fewer than one part', () => {
    expect(splitRange(5, 9, 0)).toEqual([[5, 9]])
  })
})

describe('buildTaskInputs', () => {
  it('returns positional args for non-split examples', () => {
    expect(buildTaskInputs(example('add'), { a: 2, b: 3 }, 4)).toEqual([[2, 3]])
  })

  it('splits a prime range across workers', () => {
    const inputs = buildTaskInputs(
      example('prime-count'),
      { start: 0, end: 100 },
      4,
    )
    expect(inputs).toEqual([
      [0, 25],
      [25, 50],
      [50, 75],
      [75, 100],
    ])
  })

  it('splits iterations and offsets seeds', () => {
    const inputs = buildTaskInputs(
      example('monte-carlo-pi'),
      { iterations: 100, seed: 5 },
      3,
    )
    expect(inputs).toEqual([
      [33, 5],
      [33, 6],
      [34, 7],
    ])
  })

  it('splits matrix rows', () => {
    const inputs = buildTaskInputs(
      example('matmul-checksum'),
      { n: 10, seed: 1 },
      2,
    )
    expect(inputs).toEqual([
      [10, 0, 5, 1],
      [10, 5, 10, 1],
    ])
  })

  it('rejects reversed ranges', () => {
    expect(() =>
      buildTaskInputs(example('prime-count'), { start: 10, end: 1 }, 2),
    ).toThrow()
  })
})

describe('combineResults', () => {
  it('sums split results', () => {
    expect(combineResults(example('prime-count'), [1, 2, 3])).toBe(6)
  })

  it('averages split results', () => {
    expect(combineResults(example('monte-carlo-pi'), [3, 4])).toBe(3.5)
  })

  it('returns the single result for non-split examples', () => {
    expect(combineResults(example('fib'), [55])).toBe(55)
    expect(combineResults(example('fib'), [])).toBeNull()
  })

  it('normalizes unsigned results and wraps sums', () => {
    expect(combineResults(example('hash-chain'), [-1])).toBe(4_294_967_295)
    expect(combineResults(example('matmul-checksum'), [0xffffffff, 2])).toBe(1)
  })
})

describe('validateValues', () => {
  it('accepts defaults', () => {
    for (const id of ['add', 'prime-count', 'matmul-checksum']) {
      const item = example(id)
      const values = Object.fromEntries(
        item.args.map((arg) => [arg.key, arg.default]),
      )
      expect(validateValues(item, values)).toBeNull()
    }
  })

  it('rejects non-integer integers', () => {
    expect(validateValues(example('fib'), { n: 1.5 })).toMatch(/integer/)
  })

  it('rejects out-of-range values', () => {
    expect(validateValues(example('fib'), { n: 100_000_000 })).toMatch(
      /at most/,
    )
    expect(validateValues(example('prime-count'), { start: -1 })).toMatch(
      /unsigned/,
    )
  })
})

describe('formatResult', () => {
  it('formats integers with separators and floats with precision', () => {
    expect(formatResult(1234567)).toBe('1,234,567')
    expect(formatResult(3.14159265)).toBe('3.141593')
    expect(formatResult(null)).toBe('—')
  })

  it('renders unsigned results', () => {
    expect(formatResult(-1, 'u32')).toBe('4,294,967,295')
  })
})
