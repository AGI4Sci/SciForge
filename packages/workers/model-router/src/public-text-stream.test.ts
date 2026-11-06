import assert from 'node:assert/strict';
import { test } from 'node:test';
import { publicTextPrefixStream } from './public-text-stream';

test('every chunk boundary holds configured secrets, auth strings and assignment tails', () => {
  for (const privateText of ['opaque-private-key', 'Authorization: Bearer abcdefghijk', 'Bearer abcdefghijk', 'sk-123456789', 'api_key="private value"', 'token: hidden']) {
    const input = `Public prose. ${privateText} after`;
    for (let boundary = 0; boundary <= input.length; boundary++) {
      let output = '';
      const push = publicTextPrefixStream(delta => { output += delta; }, ['opaque-private-key']);
      push(input.slice(0, boundary)); push(input.slice(boundary));
      assert.equal(output, 'Public prose. ', `${privateText} at ${boundary}`);
    }
  }
});

test('plain text progresses while JSON and split DSML controls remain deferred', () => {
  let prose = '';
  const push = publicTextPrefixStream(delta => { prose += delta; }, []);
  push('Visible '); push('answer. ');
  assert.equal(prose, 'Visible answer. ');
  for (const input of ['  \n{"type":"final_answer","content":"x"}', '```json\n{}', '<|DSML|tool_calls>']) {
    let output = '';
    const feed = publicTextPrefixStream(delta => { output += delta; }, []);
    for (const char of input) feed(char);
    assert.equal(output, '');
  }
});
