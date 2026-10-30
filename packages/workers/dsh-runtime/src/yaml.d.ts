// Narrow declarations for the existing js-yaml runtime API; no code evaluation is exposed.
declare module 'js-yaml' {
  interface Schema { extend(types: Type[]): Schema }
  class Type {
    constructor(tag: string, options: { kind: 'scalar'; construct: (value: string) => unknown })
  }
  const yaml: { DEFAULT_SCHEMA: Schema; Type: typeof Type; dump(value: unknown): string; load(text: string, options: { schema: Schema }): unknown }
  export default yaml
}
