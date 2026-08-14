import http from 'node:http';
import crypto from 'node:crypto';

import { AI, AIKernel } from './kernel.js';
import { log } from './utils/logger.js';

const PORT = Number(process.env.PORT ?? 8787);
// Простой shared-secret между Prime Bot и этим сервером — не публикуем
// Kernel в интернет без него. Задаётся в .env, см. .env.example.
const API_KEY = process.env.KERNEL_API_KEY;

// BYOK: если вызывающий передаёт byokEnv (свои ключи провайдеров), запросы
// этого пользователя идут ТОЛЬКО через его ключи — не через общие ключи
// владельца, иначе смысл BYOK теряется. Инстансы кешируются по хэшу набора
// ключей, чтобы не гонять health-check (несколько секунд) на каждый запрос.
const BYOK_CACHE_TTL_MS = 60 * 60 * 1000;
const byokCache = new Map(); // hash -> { kernel, initializedAt }

function hashEnv(env) {
  return crypto.createHash('sha256').update(JSON.stringify(env, Object.keys(env).sort())).digest('hex').slice(0, 16);
}

async function getKernelFor(byokEnv) {
  if (!byokEnv || !Object.keys(byokEnv).length) return AI;

  const key = hashEnv(byokEnv);
  const cached = byokCache.get(key);
  if (cached && Date.now() - cached.initializedAt < BYOK_CACHE_TTL_MS) return cached.kernel;

  const kernel = new AIKernel(byokEnv);
  await kernel.init({ saveReport: false });
  byokCache.set(key, { kernel, initializedAt: Date.now() });
  return kernel;
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(json);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return send(res, 200, { ok: true, providers: Object.values(AI.providers).filter((p) => p.enabled).map((p) => p.name) });
  }

  if (req.method === 'POST' && req.url === '/generate') {
    if (API_KEY && req.headers.authorization !== `Bearer ${API_KEY}`) {
      return send(res, 401, { error: 'unauthorized' });
    }
    try {
      const { byokEnv, ...args } = await readJsonBody(req);
      // Транскрипция всегда через общий Groq-ключ, не через BYOK — BYOK
      // сейчас покрывает только текст/vision (gemini/openrouter), у Groq
      // отдельный multipart-эндпоинт, который в BYOK-обвязку ещё не завели.
      if (args.audioBase64) {
        const text = await AI.providers.groq.transcribe(args.audioBase64, args.filename);
        return send(res, 200, { text, provider: 'groq', modelId: 'whisper-large-v3-turbo' });
      }
      const kernel = await getKernelFor(byokEnv);
      const result = args.images ? await kernel.generateVision(args) : await kernel.generate(args);
      return send(res, 200, result);
    } catch (err) {
      log.error(`POST /generate: ${err.message}`);
      return send(res, err.message?.includes('обязателен') ? 400 : 502, { error: err.message });
    }
  }

  send(res, 404, { error: 'not found' });
});

await AI.init();

server.listen(PORT, () => {
  log.title(`AI Kernel HTTP — слушаю на http://localhost:${PORT}`);
  log.info('POST /generate  { prompt, task?, sessionId?, systemPrompt?, byokEnv?, ... } — см. kernel.js GenerateArgs');
  log.info('GET  /health');
});
