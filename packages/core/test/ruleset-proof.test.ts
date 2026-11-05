import { describe, expect, it } from 'vitest'

// throwaway: proves that a pull request whose check fails cannot merge into main
describe('ruleset proof', () => {
  it('fails on purpose', () => {
    expect(1 + 1).toBe(3)
  })
})
