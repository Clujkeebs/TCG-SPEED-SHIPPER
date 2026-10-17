// The adapter the Agent uses for a REAL model: it talks to our own server door, POST /api/agent/messages
// (contract and limits: docs/suite/AGENT-PROXY.md, "How to call it"). The server holds the key, picks the model and the
// system prompt, counts the money, and renames tool names between "." and "__" for us.
//   - sends ONLY { messages, tools }. Never a system prompt, model name, token cap or key (the server ignores them anyway)
//   - the login token comes from getToken() on every call and is never stored or put in an error
//   - tools are sent exactly as the registry gives them (names with dots); a tool name containing "__" is refused here
//   - a conversation is ONE question plus its tool steps, at most 8 model calls, and is checked before anything is sent
//   - returns { content, costCents, costMillicents, usage, remaining, stopReason }; `remaining` is also kept as model.remaining
//   - every failure is a ProxyError with the server's plain words, its code, and resetsAt when it gave one
export const MAX_MODEL_CALLS = 8;
export const MAX_BODY_BYTES = 60 * 1024;

export class ProxyError extends Error {
  constructor({ status = 0, code, message, resetsAt }) {
    super(message);
    this.name = 'ProxyError';
    this.status = status;
    if (code) this.code = code;
    if (resetsAt) this.resetsAt = resetsAt;
  }
}

// What to tell the seller when the server gave no sentence of its own.
const DEFAULT_WORDS = {
  400: 'That request could not be understood.',
  401: 'Please log in again.',
  402: 'Your plan does not include the assistant.',
  403: 'The assistant is switched off for this account.',
  413: 'That question needed too much to send.',
  429: 'You have reached a limit for now.',
  502: 'The assistant could not answer right now. Nothing was done.',
  503: 'The assistant is not available right now.',
};
const words = (status) => DEFAULT_WORDS[status] || 'Something went wrong talking to the assistant.';

// Is this a proper "one question and its tool steps" conversation? Throws a plain sentence when not.
export function checkConversation(messages) {
  const bad = (m) => { throw new ProxyError({ status: 400, code: 'bad_request', message: m }); };
  if (!Array.isArray(messages) || messages.length === 0) bad('There is nothing to ask.');
  if (messages.length % 2 === 0) bad('A conversation has to end on your message or on tool results.');
  const steps = (messages.length + 1) / 2;
  if (steps > MAX_MODEL_CALLS) throw new ProxyError({ status: 429, code: 'steps', message: `One question can use at most ${MAX_MODEL_CALLS} steps.` });
  const first = messages[0];
  if (!first || first.role !== 'user' || typeof first.content !== 'string' || !first.content.trim()) bad('The first message must be your question as plain text.');
  for (let i = 1; i < messages.length; i += 2) {
    const a = messages[i], u = messages[i + 1];
    if (!a || a.role !== 'assistant' || !Array.isArray(a.content)) bad('The conversation is out of order.');
    const uses = a.content.filter((b) => b && b.type === 'tool_use').map((b) => b.id);
    if (!uses.length) bad('Only a step that used tools can be followed by more.');
    if (!u || u.role !== 'user' || !Array.isArray(u.content)) bad('Tool results must follow the step that used the tools.');
    const results = u.content.filter((b) => b && b.type === 'tool_result').map((b) => b.tool_use_id);
    if (results.length !== uses.length || uses.some((id) => !results.includes(id))) bad('Each set of tool results must answer exactly the tools that were used.');
  }
}

function checkTools(tools) {
  if (!Array.isArray(tools)) throw new ProxyError({ status: 400, code: 'bad_request', message: 'The tool list is missing.' });
  for (const t of tools) {
    if (!t || typeof t.name !== 'string' || !t.name) throw new ProxyError({ status: 400, code: 'bad_request', message: 'A tool has no name.' });
    if (t.name.includes('__')) throw new ProxyError({ status: 400, code: 'bad_request', message: `The tool name "${t.name}" contains "__", which the server reserves.` });
  }
}

export function createProxyModel({ baseUrl, getToken, fetchImpl = globalThis.fetch, timeoutMs = 60000 }) {
  if (typeof baseUrl !== 'string' || !/^https?:\/\//.test(baseUrl)) throw new Error('baseUrl is required (the site address)');
  if (typeof getToken !== 'function') throw new Error('getToken must be a function that returns the login token');
  const root = baseUrl.replace(/\/+$/, '');
  let remaining = null;

  async function call(method, path, body) {
    const token = await getToken();
    if (!token) throw new ProxyError({ status: 401, message: words(401) });
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(root + path, { method, headers: { authorization: 'Bearer ' + token, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body } : {}), signal: ctl.signal });
    } catch (err) {
      throw new ProxyError({ status: 0, code: 'network', message: err && err.name === 'AbortError' ? 'The assistant took too long to answer. Nothing was done.' : 'Could not reach the assistant. Check your connection.' });
    } finally { clearTimeout(timer); }
    let data = null;
    try { data = await res.json(); } catch { /* not JSON */ }
    if (!res.ok) throw new ProxyError({ status: res.status, code: data && data.code, message: (data && typeof data.error === 'string' && data.error) || words(res.status), resetsAt: data && data.resetsAt });
    if (!data || typeof data !== 'object') throw new ProxyError({ status: 502, code: 'model_error', message: words(502) });
    return data;
  }

  return {
    // The third argument (a system prompt) is accepted so the loop can call every adapter the same way, and is ignored.
    async complete(messages, tools /* , system */) {
      checkConversation(messages);
      checkTools(tools);
      const body = JSON.stringify({ messages, tools });
      if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) throw new ProxyError({ status: 413, code: 'too_big', message: words(413) });
      const data = await call('POST', '/api/agent/messages', body);
      if (!Array.isArray(data.content)) throw new ProxyError({ status: 502, code: 'model_error', message: words(502) });
      if (data.remaining) remaining = data.remaining;
      return { content: data.content, costCents: Number.isInteger(data.costCents) ? data.costCents : 0, costMillicents: data.costMillicents, usage: data.usage, stopReason: data.stopReason, remaining: data.remaining };
    },
    // GET /api/agent/status: spends nothing. { available, code?, limits, remaining }
    async status() {
      const data = await call('GET', '/api/agent/status');
      if (data.remaining) remaining = data.remaining;
      return data;
    },
    get remaining() { return remaining; },
  };
}
