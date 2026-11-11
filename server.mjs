import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
// 容器里必须绑全网段，否则创空间的端口探测连不上；本地默认仍是回环
const port = Number(process.env.PORT || 8790);
const host = process.env.HOST || '127.0.0.1';

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

// 点开头的文件（.git / .env 等）任何情况下都不服务。
// checks/、screenshots/、node_modules/ 只在部署时屏蔽（STRICT=1），
// 本地留着是为了让 Playwright 脚本能取到 checks/iframe-harness.html。
const STRICT = process.env.STRICT === '1';
const DEV_ONLY = new Set(['checks', 'screenshots', 'node_modules']);

// ---------------------------------------------------------------- NPC 代理
// 模型只负责「说话」（战后复盘 / 波次提醒）和「听不懂时的兜底解析」，
// 绝不参与移动、伤害、波次等任何数值。没有配置令牌时整条链路自动关闭，
// 前端拿不到 enabled 就完全走本地模板，行为与之前一致。
const NPC_KEY = process.env.MODELSCOPE_API_KEY || '';
const NPC_MODEL = process.env.NPC_MODEL || 'Qwen/Qwen3.8-Flash-Next';
const NPC_UPSTREAM = process.env.NPC_UPSTREAM || 'https://api-inference.modelscope.cn/v1/chat/completions';
const NPC_TIMEOUT_MS = Number(process.env.NPC_TIMEOUT_MS || 25000);
const NPC_INTENTS = ['follow', 'defend', 'flank', 'focus', 'retreat', 'hold'];

const NPC_PROMPTS = {
  debrief: (ctx) => {
    const pressure = ctx.leakSide ? `压力最大在${ctx.leakSide}` : '没有明显缺口';
    return {
      system:
        '你是《橘光行动》里的 AI 队友，正在做战后复盘。用第二人称对玩家说话，2 句、不超过 80 字，' +
        '只挑最关键的两三个数字说，不要把所有数据罗列一遍，语气干脆，' +
        '不要 Markdown、不要引号、不要客套话。',
      user:
        `战况：${ctx.victory ? '守住核心' : '核心失守'}；评级 ${ctx.grade}；核心剩余 ${ctx.corePercent}%；` +
        `命中率 ${ctx.accuracy}%；击杀 ${ctx.kills}；下达指令 ${ctx.commands} 次；到达第 ${ctx.waveReached} 波。` +
        `全场${pressure}。同伴 ${ctx.allyName} 倒地 ${ctx.downed} 次。`,
    };
  },
  banter: (ctx) => {
    const pressure = ctx.leakSide ? `上一波压力最大在${ctx.leakSide}` : '上一波没有明显缺口';
    return {
      system:
        '你是《橘光行动》里的 AI 队友。用一句话向玩家交代下一波的打算，不超过 40 字，带一点个人语气，' +
        '不要 Markdown、不要引号、不要解释。',
      user:
        `即将开始第 ${ctx.wave} 波；${pressure}；` +
        `玩家最常用的指令是「${ctx.mostUsed || '守核心'}」；你自己倒地过 ${ctx.downed} 次。`,
    };
  },
  intent: (ctx) => ({
    system:
      '你是战术指令解析器。把玩家的一句话映射成 JSON，只输出 JSON，不要解释、不要代码块。' +
      '字段：intent（follow|defend|flank|focus|retreat|hold 之一，必须选最接近的一个）、' +
      'side（left|right|front|back|null）、enemyType（elite|gunner|runner|null）、allyName（橙橙|闪闪|null）。',
    user: String(ctx.text || ''),
  }),
};

// 简易限流：同一 IP 10 分钟内最多 40 次，避免把令牌额度打光
const npcBuckets = new Map();
function allowNpc(ip) {
  const now = Date.now();
  const bucket = npcBuckets.get(ip) || { count: 0, resetAt: now + 10 * 60 * 1000 };
  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + 10 * 60 * 1000;
  }
  bucket.count += 1;
  npcBuckets.set(ip, bucket);
  return bucket.count <= 40;
}

function sendJson(response, status, data) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(data));
}

function readBody(request, limit = 16384) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        resolve('');
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', () => resolve(''));
  });
}

async function callNpcUpstream(kind, ctx) {
  const prompt = NPC_PROMPTS[kind](ctx);
  const upstream = await fetch(NPC_UPSTREAM, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${NPC_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: NPC_MODEL,
      stream: true, // 该推理接口只提供流式，非流式会挂住
      temperature: kind === 'intent' ? 0 : 0.8,
      max_tokens: kind === 'intent' ? 80 : 200,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
    }),
    signal: AbortSignal.timeout(NPC_TIMEOUT_MS),
  });
  if (!upstream.ok || !upstream.body) throw new Error(`upstream ${upstream.status}`);

  let text = '';
  let buffer = '';
  const decoder = new TextDecoder();
  for await (const chunk of upstream.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const parsed = JSON.parse(payload);
        const choice = parsed.choices?.[0];
        text += choice?.delta?.content || choice?.message?.content || '';
      } catch {
        /* 分片被切断，跳过 */
      }
    }
  }
  return text;
}

function cleanLine(text, max) {
  return String(text)
    .replace(/[\r\n]+/g, ' ')
    .replace(/[`*#]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^["'「『]+|["'」』]+$/g, '')
    .trim()
    .slice(0, max);
}

function pickIntent(raw) {
  const match = String(raw).match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const data = JSON.parse(match[0]);
    if (!NPC_INTENTS.includes(data.intent)) return null;
    return {
      intent: data.intent,
      side: ['left', 'right', 'front', 'back'].includes(data.side) ? data.side : null,
      enemyType: ['elite', 'gunner', 'runner'].includes(data.enemyType) ? data.enemyType : null,
      allyName: ['橙橙', '闪闪'].includes(data.allyName) ? data.allyName : null,
    };
  } catch {
    return null;
  }
}

async function handleNpc(request, response, ip) {
  if (request.method === 'GET') {
    sendJson(response, 200, { enabled: Boolean(NPC_KEY), model: NPC_MODEL });
    return;
  }
  if (request.method !== 'POST') {
    sendJson(response, 405, { ok: false, reason: 'method' });
    return;
  }
  if (!NPC_KEY) {
    sendJson(response, 503, { ok: false, reason: 'no-key' });
    return;
  }
  if (!allowNpc(ip)) {
    sendJson(response, 429, { ok: false, reason: 'rate-limited' });
    return;
  }

  let payload;
  try {
    payload = JSON.parse((await readBody(request)) || '{}');
  } catch {
    sendJson(response, 400, { ok: false, reason: 'bad-json' });
    return;
  }

  const kind = payload.kind;
  if (!Object.hasOwn(NPC_PROMPTS, kind)) {
    sendJson(response, 400, { ok: false, reason: 'bad-kind' });
    return;
  }
  if (kind === 'intent') {
    payload.text = String(payload.text || '').slice(0, 200);
    if (!payload.text.trim()) {
      sendJson(response, 400, { ok: false, reason: 'empty-text' });
      return;
    }
  }

  const started = Date.now();
  try {
    const raw = await callNpcUpstream(kind, payload);
    const elapsed = Date.now() - started;
    console.log(`npc ${kind} ${elapsed}ms`);
    if (kind === 'intent') {
      const intent = pickIntent(raw);
      if (!intent) {
        sendJson(response, 200, { ok: false, reason: 'unparsed', ms: elapsed });
        return;
      }
      sendJson(response, 200, { ok: true, ...intent, ms: elapsed });
      return;
    }
    const text = cleanLine(raw, kind === 'debrief' ? 120 : 60);
    if (!text) {
      sendJson(response, 200, { ok: false, reason: 'empty', ms: elapsed });
      return;
    }
    sendJson(response, 200, { ok: true, text, model: NPC_MODEL, ms: elapsed });
  } catch (error) {
    console.log(`npc ${kind} failed: ${error.message}`);
    sendJson(response, 502, { ok: false, reason: 'upstream', ms: Date.now() - started });
  }
}


function isServed(relativePath) {
  const segments = relativePath.split(/[/\\]+/).filter(Boolean);
  return segments.every(
    (segment) => !segment.startsWith('.') && !(STRICT && DEV_ONLY.has(segment)),
  );
}

const server = http.createServer((request, response) => {
  const rawPath = decodeURIComponent((request.url || '/').split('?')[0]);

  if (rawPath === '/api/npc') {
    handleNpc(request, response, request.socket.remoteAddress || 'unknown').catch(() => {
      try {
        sendJson(response, 500, { ok: false, reason: 'server' });
      } catch {
        /* 响应已发出 */
      }
    });
    return;
  }

  if (rawPath === '/health') {
    response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('ok');
    return;
  }

  const requestPath = rawPath === '/' ? 'index.html' : rawPath;
  const safePath = path.normalize(requestPath).replace(/^([/\\])+/, '').replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(root, safePath);

  if (!filePath.startsWith(root) || !isServed(safePath)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500);
      response.end(error.code === 'ENOENT' ? 'Not found' : 'Server error');
      return;
    }
    response.writeHead(200, {
      'Content-Type': mime[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(data);
  });
});

server.listen(port, host, () => {
  console.log(`Orange Protocol running at http://${host}:${port}`);
});
