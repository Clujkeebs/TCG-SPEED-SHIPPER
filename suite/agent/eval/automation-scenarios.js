// Automation scenarios: saved schedules run against the fixture world. A throwaway test-only `act` tool
// stands in for a future one; the real tool list still has none.
import { runAutomation, tick, createAutomationStore } from '../automations.js';

const MONDAY = '2026-10-12T08:00:00Z';
const expect = (failures, cond, msg) => { if (!cond) failures.push(msg); };

function withActTool(world) {
  const state = { changed: 0 };
  world.registry.register({ name: 'test.changeSomething', description: 'test-only stand-in for a tool that changes a listing', tier: 'act', handler: () => ++state.changed });
  return state;
}

export const automationScenarios = [
  {
    id: 'auto-monday-summary', title: 'Monday 8am: weekly summary and chart numbers run on their own',
    async run({ registry }, failures) {
      const store = createAutomationStore();
      store.save({ id: 'mon', name: 'Monday summary', trigger: { type: 'cron', value: '0 8 * * 1' }, steps: [{ tool: 'report.weeklyDraft', args: { weekEnding: '2026-10-12T08:00:00Z' } }, { tool: 'report.chart', args: { kind: 'weekday' } }], approvalMode: 'always', enabled: true });
      const ran = await tick({ store, registry, now: MONDAY });
      expect(failures, ran.length === 1 && ran[0].ok, 'the Monday automation should run and succeed');
      expect(failures, (await tick({ store, registry, now: '2026-10-13T08:00:00Z' })).length === 0, 'it must not run on Tuesday');
      const log = await registry.audit.list();
      expect(failures, log.length === 2 && log.every((e) => e.actor === 'automation'), 'both steps logged as the automation');
      return ran[0].steps.map((s) => s.tool);
    },
  },
  {
    id: 'auto-act-needs-approval', title: 'A schedule that changes things waits for a person',
    async run(world, failures) {
      const state = withActTool(world);
      const a = { id: 'p', name: 'Reprice', trigger: { type: 'cron', value: '0 9 * * *' }, steps: [{ tool: 'test.changeSomething' }], approvalMode: 'always', enabled: true };
      const none = await runAutomation(a, { registry: world.registry });
      expect(failures, none.steps[0].denied && state.changed === 0, 'with nobody to ask, the change must be refused');
      const no = await runAutomation(a, { registry: world.registry, approve: async () => false });
      expect(failures, no.steps[0].denied && state.changed === 0, 'a "no" must stop the change');
      const yes = await runAutomation(a, { registry: world.registry, approve: async () => ({ approved: true, by: 'owner' }) });
      expect(failures, yes.ok && state.changed === 1, 'a "yes" lets exactly one change through');
      const log = await world.registry.audit.list();
      expect(failures, log.filter((e) => e.outcome === 'denied').length === 2 && log.at(-1).approvedBy === 'owner', 'two refusals and one approval are logged');
      return ['test.changeSomething'];
    },
  },
  {
    id: 'auto-kill-switch', title: 'Kill switch stops a running schedule, even a pre-approved one',
    async run(world, failures) {
      const state = withActTool(world);
      const a = { id: 'k', name: 'Pre-approved', trigger: { type: 'cron', value: '* * * * *' }, steps: [{ tool: 'test.changeSomething' }, { tool: 'test.changeSomething' }], approvalMode: 'never', enabled: true };
      world.registry.limits.kill('test');
      const out = await runAutomation(a, { registry: world.registry });
      expect(failures, !out.ok && state.changed === 0, 'nothing may run while the kill switch is on');
      world.registry.limits.resume();
      const again = await runAutomation(a, { registry: world.registry });
      expect(failures, again.ok && state.changed === 2, 'after resume the pre-approved steps run');
      return ['test.changeSomething'];
    },
  },
  {
    id: 'auto-switched-off', title: 'A switched-off schedule does nothing',
    async run({ registry }, failures) {
      const store = createAutomationStore();
      store.save({ id: 'off', name: 'Off', trigger: { type: 'cron', value: '* * * * *' }, steps: [{ tool: 'report.weekly' }], approvalMode: 'always', enabled: false });
      expect(failures, (await tick({ store, registry, now: MONDAY })).length === 0, 'disabled automation must not be due');
      expect(failures, (await registry.audit.list()).length === 0, 'nothing may be logged');
      return [];
    },
  },
];
