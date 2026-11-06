import { expect, it } from 'vitest'
import { createDomainMainEntry } from './main.js'
import { userInputRequestSchema } from './contract.js'
it('declares one runtime-neutral capability and delegates to the Host contract', async () => {
  const request = userInputRequestSchema.parse({ questions: [{ id: 'q', question: 'Choose?', options: [{ label: 'A' }] }] })
  const received: unknown[] = []
  const entry = createDomainMainEntry({ getUserDataDir: () => '', defineCapability: (definition) => definition,
    userInput: { request: async (input) => { received.push(input); return { status: 'submitted', answers: [{ id: 'q', label: 'A', value: 'A' }] } } } })
  const factory = entry.contributions[0].value as { createDefinitions(): Array<{ audiences: string[]; handler(input: unknown): Promise<unknown> }> }
  const [definition] = factory.createDefinitions()
  expect(definition.audiences).toEqual(['agent'])
  await expect(definition.handler(request)).resolves.toMatchObject({ output: { status: 'submitted' } })
  expect(received).toEqual([request])
})
it('rejects ambiguous question and option identities', () => {
  for (const questions of [
    [{ id: 'q', question: '?' }, { id: 'q', question: '?' }],
    [{ id: 'q', question: '?', options: [{ label: 'A' }, { label: 'A' }] }]
  ]) expect(userInputRequestSchema.safeParse({ questions }).success).toBe(false)
})
