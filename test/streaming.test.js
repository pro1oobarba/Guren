import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GroqProvider } from '../providers/groq.js';

function sseChunk(deltaText) {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: deltaText } }] })}\n\n`;
}

function makeStream(parts) {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < parts.length) {
        controller.enqueue(encoder.encode(parts[i]));
        i++;
        return;
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
}

test('_openAIChatStream собирает дельты в полный текст и вызывает onToken на каждый кусок', async (t) => {
  const provider = new GroqProvider({ apiKey: 'test-key' });
  const received = [];
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(makeStream([sseChunk('Привет'), sseChunk(', мир!')]), { status: 200 });
  t.after(() => {
    global.fetch = originalFetch;
  });

  const result = await provider.chat('some-model', [{ role: 'user', content: 'hi' }], {
    stream: true,
    onToken: (delta) => received.push(delta),
  });

  assert.equal(result.content, 'Привет, мир!');
  assert.deepEqual(received, ['Привет', ', мир!']);
  assert.equal(result.toolCalls, null);
});

test('_openAIChatStream: битый JSON-кусок пропускается, не роняет весь стрим', async (t) => {
  const provider = new GroqProvider({ apiKey: 'test-key' });
  const originalFetch = global.fetch;
  const encoder = new TextEncoder();
  global.fetch = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(sseChunk('до, ')));
          controller.enqueue(encoder.encode('data: {не валидный json\n\n'));
          controller.enqueue(encoder.encode(sseChunk('после')));
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      }),
      { status: 200 },
    );
  t.after(() => {
    global.fetch = originalFetch;
  });

  const result = await provider.chat('m', [{ role: 'user', content: 'hi' }], { stream: true, onToken: () => {} });
  assert.equal(result.content, 'до, после');
});

test('_openAIChatStream: обрыв после частичного текста бросает ошибку с partialContent', async (t) => {
  const provider = new GroqProvider({ apiKey: 'test-key' });
  const encoder = new TextEncoder();
  let pulls = 0;
  const stream = new ReadableStream({
    pull(controller) {
      pulls += 1;
      if (pulls === 1) {
        controller.enqueue(encoder.encode(sseChunk('часть ответа')));
        return;
      }
      controller.error(new Error('connection reset'));
    },
  });

  const originalFetch = global.fetch;
  global.fetch = async () => new Response(stream, { status: 200 });
  t.after(() => {
    global.fetch = originalFetch;
  });

  await assert.rejects(
    () => provider.chat('m', [{ role: 'user', content: 'hi' }], { stream: true, onToken: () => {} }),
    (err) => {
      assert.equal(err.partialContent, 'часть ответа');
      return true;
    },
  );
});

test('_openAIChatStream: обрыв ДО первого токена не выставляет partialContent', async (t) => {
  const provider = new GroqProvider({ apiKey: 'test-key' });
  const stream = new ReadableStream({
    pull(controller) {
      controller.error(new Error('connection refused'));
    },
  });

  const originalFetch = global.fetch;
  global.fetch = async () => new Response(stream, { status: 200 });
  t.after(() => {
    global.fetch = originalFetch;
  });

  await assert.rejects(
    () => provider.chat('m', [{ role: 'user', content: 'hi' }], { stream: true, onToken: () => {} }),
    (err) => {
      assert.equal(err.partialContent, undefined, 'без единого токена не должно быть partialContent — обычный fallback-путь');
      return true;
    },
  );
});
