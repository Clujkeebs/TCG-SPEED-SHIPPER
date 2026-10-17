// What the stub "model" answers during a measurement run: it replays the scripted scenario steps (the same ones the offline
// eval uses), picking the scenario from the question, and reports invented token counts. Test use and --stub only.
import { scenarios } from './scenarios.js';

export function stubScript({ perCall = (step) => ({ inputTokens: 2600 + step * 700, outputTokens: 140 }), overrides = {} } = {}) {
  return (messages, tools, step) => {
    const sc = scenarios.find((s) => s.user === messages[0].content);
    if (!sc) return { content: [{ type: 'text', text: 'I do not know how to help with that.' }], usage: perCall(step) };
    const custom = overrides[sc.id];
    if (custom) return { ...custom(messages, step), usage: perCall(step) };
    const s = sc.script[step];
    return { content: typeof s === 'function' ? s(messages) : s, usage: perCall(step) };
  };
}
