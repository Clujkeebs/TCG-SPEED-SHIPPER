// FOR LOCAL EXPERIMENTS ONLY. Do not use this for the real product.
// The real product talks to our own server door through adapters/proxy.js: the server holds the key, picks the model,
// counts the money and enforces the limits. This adapter calls the model provider directly with a key from the
// environment, so it would put a key in whatever runs it and has none of those protections. To make that hard to do by
// accident it refuses to start unless AGENT_LOCAL_EXPERIMENT=yes is set, and refuses to run inside a web page.
// Tool names: the provider only accepts letters, digits, "_" and "-", and all of ours contain a dot (orders.search).
// This adapter renames "." to "__" on the way out and back on the way in, the same way the server door does, and
// refuses a tool whose name already contains "__".
// The key and the model name come from the environment (ANTHROPIC_API_KEY, ANTHROPIC_MODEL); nothing is stored in the repo.
const URL = 'https://api.anthropic.com/v1/messages';
export const toWireName = (name) => name.replace(/\./g, '__');
export const fromWireName = (name) => name.replace(/__/g, '.');

export function createAnthropicModel({ env = process.env, fetchImpl = globalThis.fetch, maxTokens = 1024, centsPerMillionIn = 0, centsPerMillionOut = 0 } = {}) {
  if (typeof window !== 'undefined' || typeof document !== 'undefined') throw new Error('This adapter must never run in a web page: use adapters/proxy.js');
  if (env.AGENT_LOCAL_EXPERIMENT !== 'yes') throw new Error('This adapter is for local experiments only. Set AGENT_LOCAL_EXPERIMENT=yes to use it, or use adapters/proxy.js.');
  const key = env.ANTHROPIC_API_KEY;
  const model = env.ANTHROPIC_MODEL;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set');
  if (!model) throw new Error('ANTHROPIC_MODEL is not set');
  return {
    async complete(messages, tools, system) {
      for (const t of tools || []) if (t.name.includes('__')) throw new Error(`tool name "${t.name}" already contains "__"`);
      const wireTools = (tools || []).map((t) => ({ ...t, name: toWireName(t.name) }));
      const wireMessages = messages.map((m) => (Array.isArray(m.content) ? { ...m, content: m.content.map((b) => (b.type === 'tool_use' ? { ...b, name: toWireName(b.name) } : b)) } : m));
      const body = { model, max_tokens: maxTokens, messages: wireMessages, tools: wireTools };
      if (system) body.system = system;
      const res = await fetchImpl(URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('model request failed: HTTP ' + res.status);
      const data = await res.json();
      const u = data.usage || {};
      const costCents = Math.ceil(((u.input_tokens || 0) * centsPerMillionIn + (u.output_tokens || 0) * centsPerMillionOut) / 1e6);
      const content = (data.content || []).map((b) => (b.type === 'tool_use' ? { ...b, name: fromWireName(b.name) } : b));
      return { content, costCents };
    },
  };
}
