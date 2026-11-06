import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startModelRouterServer, type ModelRouterConfig } from './router';
import { UpstreamProtocolNegotiator } from './upstream-drivers';

const config: ModelRouterConfig = { defaultProfile: 'default', publicModelAlias: 'router', runtimeApiKeyEnv: 'LOCAL_KEY',
  profiles: { default: { textReasoner: { baseUrl: 'http://fixture.invalid/v1', apiKeyEnv: 'UPSTREAM_KEY', model: 'fixture-model',
    compatibility: { preferredProtocol: 'chat-completions', allowedProtocols: ['chat-completions'] } }, translators: {} } } };

for (const upstream of ['responses', 'chat-completions', 'anthropic-messages'] as const) {
for (const wire of ['responses', 'chat/completions', 'messages']) {
  test(`${upstream} -> ${wire} delivers public text before the upstream terminal frame`, async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const encoder = new TextEncoder();
    const send = (delta: object, finish: string | null = null) => controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id: 'chat-fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`));
    const event = (type: string, data: object) => controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`));
    const first = 'Visible before terminal. ';
    const last = 'Finished.';
    const configured = structuredClone(config);
    configured.profiles.default.textReasoner.compatibility = { preferredProtocol: upstream, allowedProtocols: [upstream] };
    const text = (value: string) => {
      if (upstream === 'chat-completions') send({ content: value });
      else if (upstream === 'responses') event('response.output_text.delta', { item_id: 'upstream-message', output_index: 0, content_index: 0, delta: value });
      else event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: value } });
    };
    const server = await startModelRouterServer({ port: 0, config: configured, env: { LOCAL_KEY: 'local-test', UPSTREAM_KEY: 'upstream-test' },
      fetchImpl: async () => new Response(new ReadableStream({ start(c) {
        controller = c;
        if (upstream === 'responses') event('response.output_item.added', { output_index: 0, item: { id: 'upstream-message', type: 'message', phase: 'final_answer' } });
        if (upstream === 'anthropic-messages') {
          event('message_start', { message: { id: 'msg-fixture', type: 'message', role: 'assistant', content: [] } });
          event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
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
      await Promise.race([reading, new Promise(resolve => setTimeout(resolve, 1500))]);
      assert.equal(terminalSent, false);
      assert.match(received, /Visible before terminal\. /);
    } finally {
      terminalSent = true;
      text(last);
      if (upstream === 'chat-completions') send({}, 'stop');
      else if (upstream === 'responses') event('response.completed', { response: { id: 'upstream-response', object: 'response', status: 'completed',
        output: [{ id: 'upstream-message', type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: first + last }] }], output_text: first + last } });
      else {
        event('content_block_stop', { index: 0 });
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
    assert.equal(deltas.join(''), 'Visible before terminal. Finished.');
    if (wire === 'responses') {
      const added = events.find(event => event.type === 'response.output_item.added');
      const done = events.find(event => event.type === 'response.output_item.done');
      const terminal = events.find(event => event.type === 'response.completed');
      assert.equal(added.item.id, done.item.id);
      assert.equal(done.item.id, terminal.response.output[0].id);
      assert.equal(added.output_index, done.output_index);
      if (upstream === 'responses') assert.equal(added.item.phase, 'final_answer');
      if (upstream === 'anthropic-messages') assert.equal(terminal.response.usage.output_tokens, 7);
    }
  });
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
