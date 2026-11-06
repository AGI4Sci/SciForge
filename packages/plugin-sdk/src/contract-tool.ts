import { z } from 'zod'

/** Full contracts are data. The DSH scalar DSL is not a lossless schema codec. */
export type ContractToolDefinition = Readonly<{
  name: string
  description: string
  inputSchema: Readonly<Record<string, unknown>>
  output: Readonly<{
    schema: Readonly<Record<string, unknown>>
    render: (args: unknown, value: unknown) => readonly { type: 'text'; text: string }[]
  }>
  execute: (args: unknown) => Promise<unknown>
}>

/**
 * A native ToolDefinition with lossless model/Broker input and output contracts.
 * ToolRuntime only supports a subset for output presentation; the canonical
 * output is validated here and projected separately by the public runner.
 */
export function defineContractTool(definition: ContractToolDefinition) {
  const inputSchema = JSON.parse(JSON.stringify(definition.inputSchema)) as Record<string, unknown>
  const outputSchema = JSON.parse(JSON.stringify(definition.output.schema)) as Record<string, unknown>
  if (inputSchema.type !== 'object') throw new Error('Tool input contract must be object-rooted.')
  const input = z.fromJSONSchema(inputSchema as never)
  const output = z.fromJSONSchema(outputSchema as never)
  return {
    name: definition.name,
    description: definition.description,
    parameters: inputSchema,
    contractOutputSchema: outputSchema,
    output: { schema: {}, render: definition.output.render },
    async execute(args: unknown): Promise<unknown> {
      const result = await definition.execute(input.parse(args))
      return output.parse(result)
    }
  }
}
