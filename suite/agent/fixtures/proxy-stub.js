// A stand-in for our server door that ENFORCES THE CONTRACT in docs/suite/AGENT-PROXY.md, served over real HTTP on
// localhost so the adapter's real fetch code runs. No network beyond this machine, no key, no model.
//   script(messages, tools, stepIndex) -> { content, usage? }   what the "model" answers (a test supplies it)
// It checks: POST + path, bearer token, JSON, at most 60 KB, only { messages, tools } (anything else is recorded as
// `ignored`, like the server drops it), one question + tool steps shape, at most 8 steps, tool names without "__",
// and it keeps simple run/spend counters so `remaining` goes down. It can also be told to fail the next request.
import http from 'node:http';

export const PRICES = { inCentsPerMillion: 300, outCentsPerMillion: 1500 }; // an assumed price list for the stub only
const LIMITS = { runsPerDay: 5, centsPerDay: 25, centsPerMonth: 150 };

export async function createProxyStub({ token = 'test-token', script, plan = 'premium', limits = LIMITS } = {}) {
  const log = { requests: [], ignored: [], toolNames: new Set(), authHeaders: [] };
  const state = { runs: 0, millicentsDay: 0, millicentsMonth: 0, failures: [], script };
  const json = (res, status, body) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
  const err = (res, status, code, error, extra = {}) => json(res, status, { error, ...(code ? { code } : {}), ...extra });

  const server = http.createServer((req, res) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size <= 200000) chunks.push(c); });
    req.on('end', () => {
      log.authHeaders.push(req.headers.authorization || '');
      const raw = Buffer.concat(chunks).toString('utf8');
      log.requests.push({ method: req.method, url: req.url, bytes: size });
      const f = state.failures.shift();
      if (req.headers.authorization !== 'Bearer ' + token) return err(res, 401, undefined, 'Please log in.');
      if (req.url === '/api/agent/status' && req.method === 'GET') return json(res, 200, { available: true, limits, remaining: remaining() });
      if (req.url !== '/api/agent/messages') return err(res, 404, undefined, 'No such page.');
      if (req.method !== 'POST') return err(res, 405, undefined, 'Use POST.');
      if (f) return err(res, f.status, f.code, f.error === undefined ? 'Planned failure.' : f.error, f.extra || {});
      if (plan !== 'premium') return err(res, 402, 'plan', 'Your plan does not include the assistant.');
      if (size > 60 * 1024) return err(res, 413, 'too_big', 'That question is too big to send.');
      let body;
      try { body = JSON.parse(raw); } catch { return err(res, 400, 'bad_request', 'That request could not be understood.'); }
      if (!body || typeof body !== 'object' || !Array.isArray(body.messages) || !Array.isArray(body.tools)) return err(res, 400, 'bad_request', 'Send messages and tools.');
      for (const k of Object.keys(body)) if (!['messages', 'tools'].includes(k)) log.ignored.push(k);
      const { messages, tools } = body;
      if (messages.length % 2 === 0) return err(res, 400, 'bad_request', 'The conversation must end on a user message.');
      const step = (messages.length + 1) / 2;
      if (step > 8) return err(res, 429, 'steps', 'One question can use at most 8 steps.', { resetsAt: null });
      if (messages[0].role !== 'user' || typeof messages[0].content !== 'string') return err(res, 400, 'bad_request', 'The first message must be plain text.');
      for (let i = 1; i < messages.length; i += 2) {
        const uses = ((messages[i] && messages[i].content) || []).filter((b) => b.type === 'tool_use').map((b) => b.id);
        const results = ((messages[i + 1] && messages[i + 1].content) || []).filter((b) => b.type === 'tool_result').map((b) => b.tool_use_id);
        if (messages[i].role !== 'assistant' || !uses.length || uses.length !== results.length || uses.some((id) => !results.includes(id))) return err(res, 400, 'bad_request', 'Tool results must answer exactly the tools used.');
      }
      for (const t of tools) {
        if (typeof t.name !== 'string' || t.name.includes('__') || !/^[A-Za-z0-9_.-]+$/.test(t.name)) return err(res, 400, 'bad_request', 'A tool name is not allowed.');
        log.toolNames.add(t.name);
      }
      if (step === 1) {
        if (state.runs >= limits.runsPerDay) return err(res, 429, 'runs', `You have used your ${limits.runsPerDay} questions for today.`, { resetsAt: '2026-10-18T00:00:00Z' });
        state.runs += 1;
      }
      if (state.millicentsDay >= limits.centsPerDay * 1000) return err(res, 429, 'day', 'You have reached today\'s spending limit.', { resetsAt: '2026-10-18T00:00:00Z' });
      if (state.millicentsMonth >= limits.centsPerMonth * 1000) return err(res, 429, 'month', 'You have reached this month\'s spending limit.', { resetsAt: '2026-11-01T00:00:00Z' });
      const answer = state.script ? state.script(messages, tools, step - 1) : { content: [{ type: 'text', text: 'ok' }] };
      const usage = answer.usage || { inputTokens: 1200 + step * 400, outputTokens: 120 };
      const millicents = Math.ceil((usage.inputTokens * PRICES.inCentsPerMillion + usage.outputTokens * PRICES.outCentsPerMillion) / 1000);
      state.millicentsDay += millicents; state.millicentsMonth += millicents;
      const stopReason = answer.content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn';
      json(res, 200, { content: answer.content, stopReason, usage, costCents: Math.ceil(millicents / 1000), costMillicents: millicents, remaining: remaining() });
    });
  });
  function remaining() {
    return { runsToday: Math.max(0, limits.runsPerDay - state.runs), centsToday: Math.max(0, Math.floor(limits.centsPerDay - state.millicentsDay / 1000)), centsMonth: Math.max(0, Math.floor(limits.centsPerMonth - state.millicentsMonth / 1000)) };
  }
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: 'http://127.0.0.1:' + server.address().port,
    log, state,
    setScript(fn) { state.script = fn; },
    failNext(status, code, error, extra) { state.failures.push({ status, code, error, extra }); },
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
  };
}
