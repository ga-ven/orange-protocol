// 大模型只负责「说话」，不参与任何数值。
// 服务端没配令牌、接口超时、返回乱码——一律返回 null，调用方继续用本地模板。
const PROBE_TIMEOUT = 4000;
// 必须比服务端的 NPC_TIMEOUT_MS（20s）长，否则会出现"服务端还在算、客户端先放弃"，
// 表现就是明明没报错却拿不到文案。实测复盘偶发 16.8s，卡在旧的 16s 上就会丢。
const ASK_TIMEOUT = 30000;

export class NpcVoice {
  constructor(endpoint = '/api/npc') {
    this.endpoint = endpoint;
    this.enabled = false;
    this.model = '';
    this.lastLatency = 0;
  }

  async probe() {
    try {
      const response = await fetch(this.endpoint, { signal: AbortSignal.timeout(PROBE_TIMEOUT) });
      if (!response.ok) return false;
      const data = await response.json();
      this.enabled = Boolean(data && data.enabled);
      this.model = (data && data.model) || '';
      return this.enabled;
    } catch (error) {
      this.enabled = false;
      return false;
    }
  }

  async ask(kind, context) {
    if (!this.enabled) return null;
    const started = performance.now();
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, ...context }),
        signal: AbortSignal.timeout(ASK_TIMEOUT),
      });
      this.lastLatency = Math.round(performance.now() - started);
      if (!response.ok) return null;
      const data = await response.json();
      return data && data.ok ? data : null;
    } catch (error) {
      this.lastLatency = Math.round(performance.now() - started);
      return null;
    }
  }

  // 战后复盘：返回一段可直接显示的中文
  async debrief(context) {
    const result = await this.ask('debrief', context);
    return result && typeof result.text === 'string' ? result.text : null;
  }

  // 波次提醒：返回一句短台词
  async banter(context) {
    const result = await this.ask('banter', context);
    return result && typeof result.text === 'string' ? result.text : null;
  }

  // 兜底解析：本地解析器没看懂时才调用，返回六种意图之一
  async parseIntent(text) {
    const result = await this.ask('intent', { text });
    if (!result || !result.intent) return null;
    return result;
  }
}
