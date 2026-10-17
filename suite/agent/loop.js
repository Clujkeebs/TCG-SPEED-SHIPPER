// The agent loop. `model.complete(messages, toolSpecs)` returns
//   { content: [{type:'text',text} | {type:'tool_use',id,name,input}], costCents?: integer }
// Tests give it a scripted fake; adapters/anthropic.js is the real one.
import { UNTRUSTED_NOTICE } from './untrusted.js';

export async function runAgent({ model, registry, messages, ctx = {}, maxSteps = 8, system, onCall }) {
  const limits = registry.limits;
  const run = ctx.run || (ctx.run = limits.newRun());
  const convo = [...messages];
  const calls = [];
  let steps = 0;

  while (true) {
    if (limits.isKilled()) return { status: 'stopped', reason: 'kill switch', text: '', calls, messages: convo };
    if (steps >= maxSteps) return { status: 'step-limit', text: '', calls, messages: convo };
    steps += 1;

    const reply = await model.complete(convo, registry.specs(), system);
    const content = Array.isArray(reply && reply.content) ? reply.content : [];
    if (Number.isInteger(reply && reply.costCents) && reply.costCents > 0) {
      const gate = limits.check(run, reply.costCents);
      limits.record(run, reply.costCents, { countCall: false });
      if (!gate.ok) return { status: 'stopped', reason: gate.reason, text: '', calls, messages: convo };
    }
    convo.push({ role: 'assistant', content });

    const uses = content.filter((b) => b.type === 'tool_use');
    if (!uses.length) {
      const text = content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      return { status: 'done', text, calls, messages: convo };
    }
    const results = [];
    for (const use of uses) {
      const out = await registry.run(use.name, use.input || {}, ctx);
      calls.push({ name: use.name, input: use.input || {}, ok: out.ok, denied: !!out.denied });
      if (onCall) onCall({ tool: use.name, ok: out.ok, denied: !!out.denied }, out); // `out` (with the raw result) is for the device only
      results.push({ type: 'tool_result', tool_use_id: use.id, content: JSON.stringify(out.ok ? (out.untrusted ? { notice: UNTRUSTED_NOTICE, data: out.result } : out.result) : { error: out.error }), is_error: !out.ok });
    }
    convo.push({ role: 'user', content: results });
  }
}

// A scripted stand-in for a model. Each step is a content array, or a function(messages) returning one.
export function scriptedModel(steps) {
  let i = 0;
  return {
    async complete(messages) {
      if (i >= steps.length) throw new Error('script ran out of steps');
      const step = steps[i++];
      return { content: typeof step === 'function' ? step(messages) : step };
    },
    get used() { return i; },
  };
}
