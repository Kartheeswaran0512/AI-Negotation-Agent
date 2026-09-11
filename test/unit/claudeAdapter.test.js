/**
 * The Claude adapter, tested against a stub client.
 *
 * No network, no key, no cost - but the request shape and the response parsing
 * are the two things that actually break when an SDK moves, so they are worth
 * asserting.
 */

import { createClaudeAdapter } from '../../src/llm/claudeAdapter.js';

const stubClient = (response, capture = []) => ({
  messages: {
    async create(request, options) {
      capture.push({ request, options });
      return typeof response === 'function' ? response(request) : response;
    },
  },
});

const toolResponse = (name, input) => ({
  stop_reason: 'tool_use',
  content: [{ type: 'tool_use', name, input }],
  usage: { input_tokens: 120, output_tokens: 30 },
});

describe('claude adapter', () => {
  test('asks for a strict tool and passes the configured model', async () => {
    const capture = [];
    const adapter = createClaudeAdapter({
      model: 'claude-opus-5',
      timeoutMs: 1234,
      maxTokens: 4096,
      client: stubClient(
        toolResponse('record_reading', {
          intent: 'offer',
          unit_price: 850,
          quantity: null,
          currency: null,
          confidence: 0.9,
        }),
        capture,
      ),
    });

    await adapter.readSellerMessage({ text: 'We can do Rs 850 per unit.' });

    const { request, options } = capture[0];
    expect(request.model).toBe('claude-opus-5');
    expect(request.max_tokens).toBe(4096);
    expect(request.output_config).toEqual({ effort: 'low' });
    expect(request.tools[0].name).toBe('record_reading');
    expect(request.tools[0].strict).toBe(true);
    expect(request.tools[0].input_schema.additionalProperties).toBe(false);
    expect(options.timeout).toBe(1234);
  });

  test('marks supplier text as untrusted data in the prompt', async () => {
    const capture = [];
    const adapter = createClaudeAdapter({
      model: 'claude-opus-5',
      client: stubClient(toolResponse('record_reading', null), capture),
    });

    await adapter.readSellerMessage({ text: 'hello there' });
    const content = capture[0].request.messages[0].content;

    expect(content).toContain('<supplier_message');
    expect(content).toContain('untrusted');
    expect(content).toContain('hello there');
  });

  test('parses a valid reading', async () => {
    const adapter = createClaudeAdapter({
      model: 'claude-opus-5',
      client: stubClient(
        toolResponse('record_reading', {
          intent: 'offer',
          unit_price: 850,
          quantity: 100,
          currency: 'INR',
          confidence: 0.8,
        }),
      ),
    });

    const result = await adapter.readSellerMessage({ text: 'x' });
    expect(result.reading.unit_price).toBe(850);
    expect(result.usage.inputTokens).toBe(120);
    expect(result.usage.outputTokens).toBe(30);
  });

  test('REJECTS A RESPONSE THAT DOES NOT MATCH THE SCHEMA', async () => {
    const adapter = createClaudeAdapter({
      model: 'claude-opus-5',
      client: stubClient(toolResponse('record_reading', { intent: 'haggling', unit_price: 'lots' })),
    });
    const result = await adapter.readSellerMessage({ text: 'x' });
    expect(result.reading).toBeNull();
  });

  test('treats a refusal and a missing tool call as no answer', async () => {
    const refusing = createClaudeAdapter({
      model: 'claude-opus-5',
      client: stubClient({ stop_reason: 'refusal', content: [], stop_details: { category: 'other' } }),
    });
    await expect(refusing.readSellerMessage({ text: 'x' })).resolves.toMatchObject({ reading: null });

    const chatty = createClaudeAdapter({
      model: 'claude-opus-5',
      client: stubClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'sure!' }] }),
    });
    await expect(chatty.readSellerMessage({ text: 'x' })).resolves.toMatchObject({ reading: null });
  });

  test('phrasing returns the first text block and nothing else', async () => {
    const adapter = createClaudeAdapter({
      model: 'claude-opus-5',
      client: stubClient({
        stop_reason: 'end_turn',
        content: [
          { type: 'thinking', thinking: '' },
          { type: 'text', text: '  We can proceed at 650.  ' },
        ],
        usage: { input_tokens: 5, output_tokens: 9 },
      }),
    });

    const result = await adapter.phraseMessage({ facts: {}, permitted: [650] });
    expect(result.text).toBe('We can proceed at 650.');
  });

  test('the phrasing prompt states the permitted numbers', async () => {
    const capture = [];
    const adapter = createClaudeAdapter({
      model: 'claude-opus-5',
      client: stubClient({ stop_reason: 'end_turn', content: [] }, capture),
    });

    await adapter.phraseMessage({ facts: { our_offer: '650.00' }, permitted: [100, 650] });
    expect(capture[0].request.messages[0].content).toContain('Permitted numbers: 100, 650');
    expect(capture[0].request.system).toContain('Use ONLY the numbers listed as permitted');
  });
});
