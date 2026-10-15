// Made-up buyer messages for the unanswered-message trigger and the support flow. Fake people, fake text.
export function makeMessages() {
  return [
    { id: 'msg-1', orderId: 'ORD-1010', receivedAt: '2026-10-10T09:00:00Z', text: 'Hi, where is my order? It has been a week.', answered: false },
    { id: 'msg-2', orderId: 'ORD-1020', receivedAt: '2026-10-11T15:30:00Z', text: 'The card arrived creased and bent.', answered: true },
    { id: 'msg-3', orderId: 'ORD-1030', receivedAt: '2026-10-14T20:00:00Z', text: 'Can you tell me when my order will arrive?', answered: false },
  ];
}
