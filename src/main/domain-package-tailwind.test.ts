import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('renderer domain package styling', () => {
  it('includes every trusted domain package renderer source in Tailwind discovery', () => {
    const config = readFileSync(resolve(process.cwd(), 'tailwind.config.js'), 'utf8')

    expect(config).toContain("'./packages/domains/*/src/**/*.{ts,tsx}'")
    expect(config).not.toContain('packages/domains/paper-radar')
  })

  it('defines every semantic ds color alias used by renderer actions and surfaces', () => {
    const config = readFileSync(resolve(process.cwd(), 'tailwind.config.js'), 'utf8')

    for (const alias of [
      "accent: 'var(--ds-accent)'",
      "bg: 'var(--ds-bg-main)'",
      "panel: 'var(--ds-surface-card)'",
      "surface: 'var(--ds-surface-card)'",
      "'surface-subtle': 'var(--ds-surface-subtle)'",
      "'border-strong': 'var(--ds-border-strong)'",
      "'card-muted': 'var(--ds-card-muted)'",
      "'card-strong': 'var(--ds-card-strong)'",
      "text: 'var(--ds-text)'",
      "'text-muted': 'var(--ds-text-muted)'"
    ]) {
      expect(config).toContain(alias)
    }
  })
})
