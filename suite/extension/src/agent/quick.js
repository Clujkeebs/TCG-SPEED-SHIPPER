// The five big buttons. Each runs a goal the Agent already knows, so nobody has to type.
// "today" uses the Agent's weekly list of things worth doing (shown in plain words); the rest are goals.
export const QUICK_ACTIONS = [
  { id: 'today', label: 'What should I do today?' },
  { id: 'repeat', label: 'Who are my repeat buyers?', goal: 'Who are my repeat buyers?' },
  { id: 'ship', label: 'Where do I ship most?', goal: 'Where do I ship most?' },
  { id: 'weekly', label: 'Write my weekly summary', goal: 'Write my weekly summary' },
  { id: 'reply', label: 'Draft a reply', goal: 'Draft a reply to the oldest unanswered message' }
];
