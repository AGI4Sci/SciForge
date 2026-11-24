import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  assertLocallyEnforceableJsonSchema,
  jsonObjectStructuredOutputInstruction,
  structuredOutputValidationIssues,
} from './structured-output-validation';

const schema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  properties: {
    tags: { type: 'array', maxItems: 2, items: { type: 'string', pattern: '^[a-z]+$' } },
    name: { type: 'string', minLength: 1, maxLength: 3, readOnly: true },
    kind: { enum: ['a', 'b'] },
  },
  required: ['tags', 'name', 'kind'],
  additionalProperties: false,
} as const;

test('accepts output that satisfies every enforced keyword', () => {
  assert.deepEqual(structuredOutputValidationIssues('{"tags":["ab"],"name":"字符串","kind":"a"}', schema), []);
});

test('reports bounded, value-free issue paths for violations', () => {
  const issues = structuredOutputValidationIssues(
    '{"tags":["AB","c","d"],"name":"","kind":"z","secret":"leak"}',
    schema,
  );
  assert.ok(issues.length > 0 && issues.length <= 5);
  assert.ok(issues.includes('$.tags: too many items'));
  assert.ok(issues.includes('$.tags[0]: string does not match pattern'));
  assert.ok(!issues.join(' ').includes('leak'));
  assert.deepEqual(structuredOutputValidationIssues('[1]', schema), ['$: output must be a JSON object']);
  assert.deepEqual(structuredOutputValidationIssues('```json\n{}\n```', schema), ['$: output is not valid JSON']);
});

test('only schemas made of locally enforceable keywords are accepted', () => {
  assert.doesNotThrow(() => assertLocallyEnforceableJsonSchema(schema));
  assert.throws(() => assertLocallyEnforceableJsonSchema({ type: 'object', $ref: '#/x' }), /"\$ref"/u);
  assert.throws(
    () => assertLocallyEnforceableJsonSchema({ properties: { a: { type: 'string', format: 'email' } } }),
    /"format" at \$\.properties\.a/u,
  );
  assert.throws(() => assertLocallyEnforceableJsonSchema({ type: 'string', pattern: '(' }), RangeError);
});

test('malformed supported keyword forms fail closed rather than silently losing constraints', () => {
  for (const malformed of [
    { type: 'unsupported' }, { type: [] }, { required: 'name' }, { minLength: '2' },
    { maxItems: -1 }, { enum: [] }, { anyOf: [] }, { additionalProperties: [] }, { items: [] },
  ]) assert.throws(() => assertLocallyEnforceableJsonSchema(malformed), RangeError);
});

test('numeric bounds enforce inclusive minimum and maximum without weakening integer type', () => {
  const numericSchema = { type: 'object', properties: { count: { type: 'integer', minimum: 1, maximum: 10 } }, required: ['count'] };
  assert.doesNotThrow(() => assertLocallyEnforceableJsonSchema(numericSchema));
  for (const count of [1, 10]) assert.deepEqual(structuredOutputValidationIssues(JSON.stringify({ count }), numericSchema), []);
  for (const count of [0, 11, 1.5]) assert.ok(structuredOutputValidationIssues(JSON.stringify({ count }), numericSchema).length > 0);
  for (const bound of [{ minimum: '1' }, { maximum: null }]) assert.throws(() => assertLocallyEnforceableJsonSchema(bound), RangeError);
});

test('JSON-mode instruction names json, carries the schema, and gives an example shape', () => {
  const instruction = jsonObjectStructuredOutputInstruction({
    name: 'plan',
    description: 'A project plan.',
    schema,
  });
  assert.match(instruction, /json object/u);
  assert.match(instruction, /"plan"/u);
  assert.match(instruction, /Schema purpose: A project plan\./u);
  assert.ok(instruction.includes(JSON.stringify(schema)));
  assert.ok(instruction.includes(JSON.stringify({ tags: ['string'], name: 'string', kind: 'a' })));
});
