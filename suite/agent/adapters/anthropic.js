// Adapter for the Anthropic Messages API with tool use. Never used by tests with a real network.
// The key and the model name come from the environment (ANTHROPIC_API_KEY, ANTHROPIC_MODEL): nothing is
// stored in the repo. In production this runs behind a small server-side proxy so the key never
// reaches a browser (docs/suite/PLAN.md 4.3).
const URL = 'https://api.anthropic.com/v1/messages';

export function createAnthropicModel({ env = process.env, fetchImpl = globalThis.fetch, maxTokens = 1024, centsPerMillionIn = 0, centsPerMillionOut = 0 } = {}) {
  const key = env.ANTHROPIC_API_KEY;
  const model = env.ANTHROPIC_MODEL;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set');
  if (!model) throw new Error('ANTHROPIC_MODEL is not set');
  return {
    async complete(messages, tools, system) {
      const body = { model, max_tokens: maxTokens, messages, tools };
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
      return { content: data.content || [], costCents };
    },
  };
}
