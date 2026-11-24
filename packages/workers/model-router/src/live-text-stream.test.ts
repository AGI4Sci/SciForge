import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startModelRouterServer, type ModelRouterConfig } from './router';
import { UpstreamProtocolNegotiator } from './upstream-drivers';

const config: ModelRouterConfig = { defaultProfile: 'default', publicModelAlias: 'router', runtimeApiKeyEnv: 'LOCAL_KEY',
  profiles: { default: { textReasoner: { baseUrl: 'http://fixture.invalid/v1', apiKeyEnv: 'UPSTREAM_KEY', model: 'fixture-model',
    compatibility: { preferredProtocol: 'chat-completions', allowedProtocols: ['chat-completions'] } }, translators: {} } } };

for (const upstream of ['responses', 'chat-completions', 'anthropic-messages'] as const) {
for (const wire of ['responses', 'chat/completions', 'messages']) {
for (const thinking of [false, true]) {
  test(`${upstream} -> ${wire} (${thinking ? 'thinking' : 'plain'}) preserves output order and streams leading prose promptly`, async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const encoder = new TextEncoder();
    const send = (delta: object, finish: string | null = null) => controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id: 'chat-fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`));
    const event = (type: string, data: object) => controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`));
    const outputIndex = thinking ? 1 : 0;
    const reasoning = { id: 'reasoning-fixture', type: 'reasoning', summary: [], content: [{ type: 'reasoning_text', text: 'Inspect the source first.' }] };
    const first = 'Visible before terminal. fixture-model http://fixture.invalid/v1 UPSTREAM_KEY ';
    const last = 'Finished.';
    const configured = structuredClone(config);
    configured.profiles.default.textReasoner.compatibility = { preferredProtocol: upstream, allowedProtocols: [upstream] };
    const text = (value: string) => {
      if (upstream === 'chat-completions') send({ content: value });
      else if (upstream === 'responses') event('response.output_text.delta', { item_id: 'upstream-message', output_index: outputIndex, content_index: 0, delta: value });
      else event('content_block_delta', { index: outputIndex, delta: { type: 'text_delta', text: value } });
    };
    const server = await startModelRouterServer({ port: 0, config: configured, env: { LOCAL_KEY: 'local-test', UPSTREAM_KEY: 'upstream-test' },
      fetchImpl: async () => new Response(new ReadableStream({ start(c) {
        controller = c;
        if (upstream === 'chat-completions' && thinking) send({ reasoning_content: 'Inspect the source first.' });
        if (upstream === 'responses' && thinking) {
          event('response.output_item.added', { output_index: 0, item: reasoning });
          event('response.output_item.done', { output_index: 0, item: reasoning });
        }
        if (upstream === 'responses') event('response.output_item.added', { output_index: outputIndex, item: { id: 'upstream-message', type: 'message', phase: 'final_answer' } });
        if (upstream === 'anthropic-messages') {
          event('message_start', { message: { id: 'msg-fixture', type: 'message', role: 'assistant', content: [] } });
          if (thinking) {
            event('content_block_start', { index: 0, content_block: { type: 'thinking', thinking: 'Inspect the source first.' } });
            event('content_block_stop', { index: 0 });
          }
          event('content_block_start', { index: outputIndex, content_block: { type: 'text', text: '' } });
        }
        text(first);
      } }), { headers: { 'content-type': 'text/event-stream' } }) });
    let terminalSent = false;
    const request = wire === 'responses' ? { input: 'Hello' } : { messages: [{ role: 'user', content: 'Hello' }], max_tokens: 100 };
    const response = await fetch(`${server.url}/v1/${wire}`, { method: 'POST', headers: { Authorization: 'Bearer local-test', 'content-type': 'application/json' }, body: JSON.stringify({ model: 'router', stream: true, ...request }) });
    const reader = response.body!.getReader();
    let received = '';
    const reading = (async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return;
        received += new TextDecoder().decode(value);
        if (received.includes('Visible before terminal. ')) return;
      }
    })();
    try {
      if (!thinking) {
        await Promise.race([reading, new Promise(resolve => setTimeout(resolve, 1500))]);
        assert.equal(terminalSent, false);
        assert.match(received, /Visible before terminal\. /);
      }
    } finally {
      terminalSent = true;
      text(last);
      if (upstream === 'chat-completions') send({}, 'stop');
      else if (upstream === 'responses') event('response.completed', { response: { id: 'upstream-response', object: 'response', status: 'completed',
        output: [...(thinking ? [reasoning] : []), { id: 'upstream-message', type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: first + last }] }], output_text: first + last } });
      else {
        event('content_block_stop', { index: outputIndex });
        event('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 7 } });
        event('message_stop', {});
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
      await reading;
      while (true) { const { done, value } = await reader.read(); if (done) break; received += new TextDecoder().decode(value); }
      await server.close();
    }
    const events = received.split('\n').filter(line => line.startsWith('data: {')).map(line => JSON.parse(line.slice(6)));
    const deltas = events.flatMap(event => wire === 'responses' ? (event.type === 'response.output_text.delta' ? [event.delta] : [])
      : wire === 'messages' ? (event.delta?.type === 'text_delta' ? [event.delta.text] : [])
        : (event.choices?.[0]?.delta?.content ? [event.choices[0].delta.content] : []));
    assert.equal(deltas.join(''), 'Visible before terminal. [redacted-sensitive] [redacted-sensitive] [redacted-sensitive] Finished.');
    assert.doesNotMatch(deltas.join(''), /fixture-model|fixture\.invalid|UPSTREAM_KEY|upstream-test/);
    if (wire === 'responses') {
      const added = events.find(event => event.type === 'response.output_item.added' && event.item.type === 'message');
      const done = events.find(event => event.type === 'response.output_item.done' && event.item.type === 'message');
      const terminal = events.find(event => event.type === 'response.completed');
      assert.equal(added.item.id, done.item.id);
      assert.equal(done.item.id, terminal.response.output[outputIndex].id);
      assert.equal(added.output_index, outputIndex);
      assert.equal(added.output_index, done.output_index);
      const expected = thinking ? ['reasoning', 'message'] : ['message'];
      assert.deepEqual(events.filter(event => event.type === 'response.output_item.added').map(event => event.output_index), thinking ? [0, 1] : [0]);
      assert.deepEqual(terminal.response.output.map((item: { type: string }) => item.type), expected);
      assert.deepEqual(events.filter(event => event.type === 'response.output_item.done').map(event => event.item.type), expected);
      if (upstream === 'responses') assert.equal(added.item.phase, 'final_answer');
      if (upstream === 'anthropic-messages') assert.equal(terminal.response.usage.output_tokens, 7);
    }
  });
}
}
}

for (const protocol of ['responses', 'chat-completions', 'anthropic-messages'] as const) {
  test(`${protocol} partial output followed by an error fails without protocol replay`, async () => {
    const event = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
    const first = protocol === 'responses' ? event('response.output_text.delta', { delta: 'Partial ' })
      : protocol === 'anthropic-messages' ? event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'Partial ' } })
        : `data: ${JSON.stringify({ id: 'chat', choices: [{ delta: { content: 'Partial ' } }] })}\n\n`;
    let calls = 0;
    let partial = '';
    await assert.rejects(new UpstreamProtocolNegotiator().request({
      request: { input: 'hello', stream: true }, baseUrl: 'http://fixture.invalid', apiKey: 'test', model: 'fixture', preferredProtocol: protocol,
      fetchImpl: async () => { calls++; return new Response(first + event('error', { error: { message: 'failed midway' } }), { headers: { 'content-type': 'text/event-stream' } }); },
      onTextDelta: text => { partial += text; },
    }));
    assert.equal(partial, 'Partial ');
    assert.equal(calls, 1);
  });
}

test('split secrets never appear in public deltas, and validated completion adds the sanitized tail once', async () => {
  const texts = ['Safe prose. up', 'stream-', 'test tail.'];
  const chunks = texts.map(content => `data: ${JSON.stringify({ id: 'chat', choices: [{ delta: { content }, finish_reason: null }] })}\n\n`).join('')
    + `data: ${JSON.stringify({ id: 'chat', choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`;
  const server = await startModelRouterServer({ port: 0, config, env: { LOCAL_KEY: 'local-test', UPSTREAM_KEY: 'upstream-test' },
    fetchImpl: async () => new Response(chunks, { headers: { 'content-type': 'text/event-stream' } }) });
  try {
    const response = await fetch(`${server.url}/v1/responses`, { method: 'POST', headers: { Authorization: 'Bearer local-test', 'content-type': 'application/json' }, body: JSON.stringify({ model: 'router', stream: true, input: 'hello' }) });
    const data = await response.text();
    assert.doesNotMatch(data, /upstream-test/);
    const events = data.split('\n').filter(line => line.startsWith('data: {')).map(line => JSON.parse(line.slice(6)));
    assert.equal(events.filter(e => e.type === 'response.output_text.delta').map(e => e.delta).join(''), 'Safe prose. [redacted-sensitive] tail.');
  } finally { await server.close(); }
});

test('protocol fallback preserves prose but holds native tool argument fragments until completion', async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder();
  const send = (delta: object, finish_reason: string | null = null) => controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id: 'chat', choices: [{ index: 0, delta, finish_reason }] })}\n\n`));
  const configured = structuredClone(config);
  configured.profiles.default.textReasoner.compatibility = { preferredProtocol: 'responses', allowedProtocols: ['responses', 'chat-completions'] };
  let calls = 0;
  const server = await startModelRouterServer({ port: 0, config: configured, env: { LOCAL_KEY: 'local-test', UPSTREAM_KEY: 'upstream-test' },
    fetchImpl: async () => {
      if (++calls === 1) return Response.json({ error: 'unsupported endpoint' }, { status: 404 });
      return new Response(new ReadableStream({ start(c) { controller = c; send({ content: 'Checking now. ', tool_calls: [{ index: 0, id: 'call-fixture', function: { name: 'lookup', arguments: '{"x":' } }] }); } }), { headers: { 'content-type': 'text/event-stream' } });
    } });
  const response = await fetch(`${server.url}/v1/responses`, { method: 'POST', headers: { Authorization: 'Bearer local-test', 'content-type': 'application/json' }, body: JSON.stringify({ model: 'router', stream: true, input: 'hello', tools: [{ type: 'function', name: 'lookup', parameters: { type: 'object' } }] }) });
  const reader = response.body!.getReader();
  let received = '';
  const reading = (async () => { while (!received.includes('Checking now. ')) { const { done, value } = await reader.read(); if (done) break; received += new TextDecoder().decode(value); } })();
  try {
    await Promise.race([reading, new Promise(resolve => setTimeout(resolve, 1500))]);
    assert.match(received, /Checking now\. /);
    assert.doesNotMatch(received, /function_call|call-fixture|arguments/);
  } finally {
    send({ tool_calls: [{ index: 0, function: { arguments: '1}' } }] }, 'tool_calls');
    controller.close();
    await reading;
    while (true) { const { done, value } = await reader.read(); if (done) break; received += new TextDecoder().decode(value); }
    await server.close();
  }
  const events = received.split('\n').filter(line => line.startsWith('data: {')).map(line => JSON.parse(line.slice(6)));
  const terminal = events.find(event => event.type === 'response.completed');
  assert.ok(terminal, received);
  assert.equal(calls, 2);
  assert.equal(terminal.response.output.find((item: { type: string }) => item.type === 'function_call').arguments, '{"x":1}');
  assert.equal(events.filter(event => event.type === 'response.output_text.delta').map(event => event.delta).join(''), 'Checking now. ');
});

for (const protocol of ['responses', 'chat-completions', 'anthropic-messages'] as const) {
  test(`${protocol} keeps reasoning with streamed commentary across a tool-result round trip`, async () => {
    const configured = structuredClone(config);
    configured.profiles.default.textReasoner.compatibility = { preferredProtocol: protocol, allowedProtocols: [protocol] };
    const reasoning = 'Locate the document before reading it.';
    const commentary = 'Reading the source now.';
    const item = { id: 'rs_source', type: 'reasoning', summary: [], content: [{ type: 'reasoning_text', text: reasoning }] };
    const message = { id: 'msg_source', type: 'message', role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: commentary }] };
    const call = { id: 'fc_source', type: 'function_call', call_id: 'call_source', name: 'read_document', arguments: '{}' };
    const frame = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
    const chat = (delta: object, finish_reason: string | null = null) => `data: ${JSON.stringify({ id: 'chat_source', choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
    const stream = protocol === 'responses'
      ? frame('response.output_item.added', { output_index: 0, item })
        + frame('response.output_item.done', { output_index: 0, item })
        + frame('response.output_item.added', { output_index: 1, item: message })
        + frame('response.output_text.delta', { item_id: message.id, output_index: 1, content_index: 0, delta: commentary })
        + frame('response.completed', { response: { id: 'resp_source', object: 'response', status: 'completed', output: [item, message, call] } })
      : protocol === 'chat-completions'
        ? chat({ reasoning_content: reasoning }) + chat({ content: commentary })
          + chat({ tool_calls: [{ index: 0, id: call.call_id, type: 'function', function: { name: call.name, arguments: '{}' } }] }, 'tool_calls')
        : frame('message_start', { message: { id: 'msg_source', type: 'message', role: 'assistant', content: [] } })
          + frame('content_block_start', { index: 0, content_block: { type: 'thinking', thinking: reasoning, signature: 'signature' } })
          + frame('content_block_stop', { index: 0 })
          + frame('content_block_start', { index: 1, content_block: { type: 'text', text: '' } })
          + frame('content_block_delta', { index: 1, delta: { type: 'text_delta', text: commentary } })
          + frame('content_block_stop', { index: 1 })
          + frame('content_block_start', { index: 2, content_block: { type: 'tool_use', id: call.call_id, name: call.name, input: {} } })
          + frame('content_block_stop', { index: 2 })
          + frame('message_delta', { delta: { stop_reason: 'tool_use' } })
          + frame('message_stop', {});
    let calls = 0;
    const server = await startModelRouterServer({ port: 0, config: configured, env: { LOCAL_KEY: 'local-test', UPSTREAM_KEY: 'upstream-test' },
      fetchImpl: async (_url, init) => {
        if (++calls === 1) return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
        const body = JSON.parse(String(init?.body));
        if (protocol === 'responses') {
          assert.deepEqual(body.input.map((entry: { type?: string; role?: string }) => entry.type ?? entry.role), ['user', 'reasoning', 'message', 'function_call', 'function_call_output']);
          assert.equal(body.input[1].content[0].text, reasoning);
          assert.equal(body.input.at(-1).output, 'Verified document text.');
          return Response.json({ id: 'resp_final', object: 'response', status: 'completed', output: [{ ...message, content: [{ type: 'output_text', text: 'Read verified.' }] }] });
        }
        if (protocol === 'chat-completions') {
          const assistant = body.messages.find((entry: { role: string; tool_calls?: unknown[] }) => entry.role === 'assistant' && entry.tool_calls?.length);
          assert.equal(assistant.reasoning_content, reasoning);
          assert.equal(body.messages.at(-1).content, 'Verified document text.');
          return Response.json({ id: 'chat_final', object: 'chat.completion', choices: [{ message: { role: 'assistant', content: 'Read verified.' }, finish_reason: 'stop' }] });
        }
        const assistant = body.messages.find((entry: { role: string }) => entry.role === 'assistant');
        assert.deepEqual(assistant.content.map((entry: { type: string }) => entry.type), ['thinking', 'text', 'tool_use']);
        assert.equal(assistant.content[0].thinking, reasoning);
        assert.equal(body.messages.at(-1).content[0].content, 'Verified document text.');
        return Response.json({ id: 'msg_final', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'Read verified.' }], stop_reason: 'end_turn' });
      } });
    const send = (body: object) => fetch(`${server.url}/v1/responses`, { method: 'POST', headers: { Authorization: 'Bearer local-test', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'router', tools: [{ type: 'function', name: call.name, parameters: { type: 'object', properties: {} } }], ...body }) });
    try {
      const first = await send({ input: 'Read the document.', stream: true });
      const events = (await first.text()).split('\n').filter(line => line.startsWith('data: {')).map(line => JSON.parse(line.slice(6)));
      // Codex persists completed items in event order and replays the full history without a previous_response_id.
      const completed = events.filter(event => event.type === 'response.output_item.done').map(event => event.item);
      assert.deepEqual(completed.map(entry => entry.type), ['reasoning', 'message', 'function_call']);
      assert.deepEqual(events.find(event => event.type === 'response.completed').response.output, completed);
      const second = await send({ input: [{ role: 'user', content: 'Read the document.' }, ...completed,
        { type: 'function_call_output', call_id: call.call_id, output: 'Verified document text.' }] });
      assert.equal(second.status, 200, await second.text());
      assert.equal(calls, 2);
    } finally { await server.close(); }
  });
}

for (const upstreamStream of [false, true]) for (const publicStream of [false, true]) for (const handle of [false, true]) {
  test(`Responses ordered opaque multi-tool replay upstreamStream=${upstreamStream} publicStream=${publicStream} handle=${handle}`, async () => {
    const configured = structuredClone(config);
    configured.profiles.default.textReasoner.compatibility = { preferredProtocol: 'responses', allowedProtocols: ['responses'] };
    const user = { role: 'user', content: 'Inspect two bounded sources.' };
    const history: object[] = [user];
    let round = 0;
    const block = (n: number) => [
      { id: `rs_${n}_a`, type: 'reasoning', summary: [], content: [{ type: 'reasoning_text', text: `  full thinking ${n}\n` }], encrypted_content: `opaque-${n}`, provider_state: { version: 7, nested: [null, 'unchanged'] } },
      { id: `msg_${n}_a`, type: 'message', status: 'completed', role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: `Inspecting ${n}.` }] },
      { id: `fc_${n}_a`, type: 'function_call', call_id: `call_${n}_a`, name: 'inspect', arguments: '{}' },
      { id: `rs_${n}_b`, type: 'reasoning', summary: [], encrypted_content: `opaque-second-${n}`, signature: `signature-${n}` },
      { id: `fc_${n}_b`, type: 'function_call', call_id: `call_${n}_b`, name: 'inspect', arguments: '{}' },
    ];
    const frame = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
    const server = await startModelRouterServer({ port: 0, config: configured, env: { LOCAL_KEY: 'local-test', UPSTREAM_KEY: 'upstream-test' },
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        assert.deepEqual(body.input, history, 'replay must preserve every item, order, opaque field and reasoning byte');
        const output = block(++round);
        const result = { id: `upstream_${round}`, object: 'response', status: 'completed', output };
        if (!upstreamStream) return Response.json(result);
        return new Response(output.map((item, output_index) => frame('response.output_item.added', { output_index, item })
          + (item.type === 'message' ? frame('response.output_text.delta', { item_id: item.id, output_index, content_index: 0, delta: item.content![0].text }) : '')
          + frame('response.output_item.done', { output_index, item })).join('') + frame('response.completed', { response: result }),
          { headers: { 'content-type': 'text/event-stream' } });
      } });
    let responseId: string | undefined;
    try {
      for (let n = 1; n <= 3; n++) {
        const response = await fetch(`${server.url}/v1/responses`, { method: 'POST', headers: { authorization: 'Bearer local-test', 'content-type': 'application/json' },
          body: JSON.stringify({ model: 'router', input: history, stream: publicStream,
            ...(handle && responseId ? { previous_response_id: responseId } : {}),
            tools: [{ type: 'function', name: 'inspect', parameters: { type: 'object', properties: {} } }] }) });
        assert.equal(response.status, 200);
        let result;
        if (publicStream) {
          const events = (await response.text()).split('\n').filter(line => line.startsWith('data: {')).map(line => JSON.parse(line.slice(6)));
          result = events.find(event => event.type === 'response.completed')?.response;
          assert.ok(result, JSON.stringify(events.filter(event => event.type === 'error')));
          for (const type of ['response.output_item.added', 'response.output_item.done']) {
            const items = events.filter(event => event.type === type);
            assert.deepEqual(items.map(event => event.output_index), [0, 1, 2, 3, 4]);
            assert.deepEqual(items.map(event => event.item), result.output);
          }
        } else result = await response.json();
        assert.deepEqual(result.output, block(n));
        responseId = result.id;
        history.push(...result.output, ...['a', 'b'].map(suffix => ({ type: 'function_call_output', call_id: `call_${n}_${suffix}`, output: `source ${n} ${suffix}` })));
      }
    } finally { await server.close(); }
  });
}

test('leading live commentary retains its public ID in cached tool continuation', async () => {
  const configured = structuredClone(config);
  configured.profiles.default.textReasoner.compatibility = { preferredProtocol: 'responses', allowedProtocols: ['responses'] };
  const message = { id: 'native_message', type: 'message', status: 'completed', role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: 'Inspecting.' }] };
  const call = { id: 'fc_one', type: 'function_call', call_id: 'call_one', name: 'inspect', arguments: '{}' };
  const frame = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  let captured: unknown;
  let calls = 0;
  const server = await startModelRouterServer({ port: 0, config: configured, env: { LOCAL_KEY: 'local-test', UPSTREAM_KEY: 'upstream-test' }, fetchImpl: async (_url, init) => {
    if (++calls > 1) {
      captured = JSON.parse(String(init?.body)).input;
      return Response.json({ id: 'upstream_done', object: 'response', status: 'completed', output: [] });
    }
    return new Response(frame('response.output_item.added', { output_index: 0, item: message })
      + frame('response.output_text.delta', { item_id: message.id, output_index: 0, content_index: 0, delta: 'Inspecting.' })
      + frame('response.completed', { response: { id: 'upstream_first', object: 'response', status: 'completed', output: [message, call] } }), { headers: { 'content-type': 'text/event-stream' } });
  } });
  const send = (body: object) => fetch(`${server.url}/v1/responses`, { method: 'POST', headers: { authorization: 'Bearer local-test', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const first = await send({ input: [{ role: 'user', content: 'Inspect.' }], stream: true });
    const events = (await first.text()).split('\n').filter(line => line.startsWith('data: {')).map(line => JSON.parse(line.slice(6)));
    const result = events.find(event => event.type === 'response.completed').response;
    const input = [{ role: 'user', content: 'Inspect.' }, ...result.output, { type: 'function_call_output', call_id: 'call_one', output: 'Done.' }];
    assert.equal((await send({ input, previous_response_id: result.id })).status, 200);
    assert.deepEqual(captured, input);
  } finally { await server.close(); }
});

for (const callKind of ['custom', 'tool_search'] as const) for (const upstreamStream of [false, true]) for (const publicStream of [false, true]) for (const handle of [false, true]) {
  test(`structured native ${callKind} tools retain intermediate and final reasoning upstreamStream=${upstreamStream} publicStream=${publicStream} handle=${handle}`, async () => {
    const configured = structuredClone(config);
    configured.profiles.default.textReasoner.compatibility = { preferredProtocol: 'responses', allowedProtocols: ['responses'] };
    const history: object[] = [{ role: 'user', content: 'Use the declared tools, then return the strict result.' }];
    let requestInput = [...history];
    const format = { type: 'json_schema', name: 'result', strict: true,
      schema: { type: 'object', properties: { result: { type: 'string' } }, required: ['result'], additionalProperties: false } };
    let round = 0;
    const block = (n: number) => [
      { id: `rs_${n}`, type: 'reasoning', summary: [], content: [{ type: 'reasoning_text', text: `  reasoning ${n}\n` }], encrypted_content: `opaque-${n}` },
      n === 3
        ? { id: `msg_${n}`, type: 'message', status: 'completed', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: '{"result":"verified"}', annotations: [] }] }
        : callKind === 'custom'
          ? { id: `custom_${n}`, type: 'custom_tool_call', call_id: `call_${n}`, name: 'edit_document', input: `exact non-JSON patch ${n}\n`, status: 'completed' }
          : { id: `search_${n}`, type: 'tool_search_call', execution: 'client', call_id: `call_${n}`, arguments: { goal: `find ${n}` }, status: 'completed' },
    ];
    const frame = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
    const server = await startModelRouterServer({ port: 0, config: configured, env: { LOCAL_KEY: 'local-test', UPSTREAM_KEY: 'upstream-test' },
      fetchImpl: async (_url, init) => {
        const request = JSON.parse(String(init?.body));
        assert.deepEqual(request.input, history, 'client tool call and matching output must survive exact ordered replay');
        assert.deepEqual(request.text.format, format, 'strict final-output contract applies to every request');
        const output = block(++round);
        const result = { id: `upstream_${round}`, object: 'response', status: 'completed', output };
        return upstreamStream ? new Response(output.map((item, output_index) => frame('response.output_item.added', { output_index, item })
          + frame('response.output_item.done', { output_index, item })).join('') + frame('response.completed', { response: result }),
          { headers: { 'content-type': 'text/event-stream' } }) : Response.json(result);
      } });
    let responseId: string | undefined;
    try {
      for (let n = 1; n <= 3; n++) {
        const response = await fetch(`${server.url}/v1/responses`, { method: 'POST', headers: { authorization: 'Bearer local-test', 'content-type': 'application/json' },
          body: JSON.stringify({ model: 'router', input: requestInput, stream: publicStream, text: { format },
            ...(handle && responseId ? { previous_response_id: responseId } : {}),
            tools: [callKind === 'custom' ? { type: 'custom', name: 'edit_document', format: { type: 'text' } }
              : { type: 'tool_search', execution: 'client', parameters: { type: 'object', properties: {} } }] }) });
        assert.equal(response.status, 200);
        let result;
        if (publicStream) {
          const events = (await response.text()).split('\n').filter(line => line.startsWith('data: {')).map(line => JSON.parse(line.slice(6)));
          result = events.find(event => event.type === 'response.completed')?.response;
          assert.ok(result, JSON.stringify(events.filter(event => event.type === 'response.failed')));
          assert.deepEqual(events.filter(event => event.type === 'response.output_item.added').map(event => [event.output_index, event.item.id, event.item.type]),
            result.output.map((item: { id: string; type: string }, index: number) => [index, item.id, item.type]));
          assert.deepEqual(events.filter(event => event.type === 'response.output_item.done').map(event => event.item), result.output);
        } else result = await response.json();
        assert.deepEqual(result.output, block(n));
        assert.equal(result.output_text, n === 3 ? '{"result":"verified"}' : '');
        responseId = result.id;
        if (n < 3) {
          const toolOutput = callKind === 'custom' ? { type: 'custom_tool_call_output', call_id: `call_${n}`, output: ` exact result ${n}\n` }
            : { type: 'tool_search_output', execution: 'client', call_id: `call_${n}`, status: 'completed', tools: [] };
          requestInput = handle ? [...history, toolOutput] : [...history, ...result.output, toolOutput];
          history.push(...result.output, toolOutput);
        }
      }
    } finally { await server.close(); }
  });
}

for (const output of [[], [{ type: 'web_search_call', id: 'server-search', status: 'completed' }],
  [{ type: 'tool_search_call', id: 'server-tools', execution: 'server', status: 'completed' }]]) {
  test(`structured empty final output remains rejected with server output ${output[0]?.type ?? 'none'}`, async () => {
    const configured = structuredClone(config);
    configured.profiles.default.textReasoner.compatibility = { preferredProtocol: 'responses', allowedProtocols: ['responses'] };
    const server = await startModelRouterServer({ port: 0, config: configured, env: { LOCAL_KEY: 'local-test', UPSTREAM_KEY: 'upstream-test' },
      fetchImpl: async () => Response.json({ id: 'empty-final', object: 'response', status: 'completed', output }) });
    try {
      const response = await fetch(`${server.url}/v1/responses`, { method: 'POST', headers: { authorization: 'Bearer local-test', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'router', input: 'Answer', outputSchema: { type: 'object', properties: {}, additionalProperties: false } }) });
      assert.equal(response.status, 502);
      assert.match(await response.text(), /structured_output_empty/);
    } finally { await server.close(); }
  });
}
