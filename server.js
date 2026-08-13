import http from 'node:http';

import { AI } from './kernel.js';
import { log } from './utils/logger.js';

const PORT = Number(process.env.PORT ?? 8787);
// Простой shared-secret между Prime Bot и этим сервером — не публикуем
// Kernel в интернет без него. Задаётся в .env, см. .env.example.
const API_KEY = process.env.KERNEL_API_KEY;

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
      const args = await readJsonBody(req);
      const result = await AI.generate(args);
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
  log.info('POST /generate  { prompt, task?, sessionId?, systemPrompt?, ... } — см. kernel.js GenerateArgs');
  log.info('GET  /health');
});
