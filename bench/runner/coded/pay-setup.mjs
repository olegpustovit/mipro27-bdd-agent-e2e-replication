import { request } from 'playwright';

const requests = {
  'hold-06': { amount: 25, description: 'Concert tickets' },
  'hold-07': { amount: 30, description: 'Pizza night' },
};

async function signIn(context, username) {
  const reply = await context.post('/login', { data: { username, password: 's3cret' } });
  if (!reply.ok()) throw new Error(`Payment fixture login failed: HTTP ${reply.status()}`);
  return (await reply.json()).user;
}

export async function setupPayment(scenario) {
  if (process.env.BENCH_PAY_PREPARED === '1') return;
  const fixture = Object.hasOwn(requests, scenario) && requests[scenario];
  if (!fixture) return;
  const api = new URL(process.env.BENCH_PAY_API_URL ?? 'http://localhost:3001');
  const context = await request.newContext({ baseURL: api.origin, timeout: 10_000 });
  try {
    const ted = await signIn(context, 'Heath93');
    const lia = await signIn(context, 'Judah_Dietrich50');
    const reply = await context.post('/transactions', {
      data: { transactionType: 'request', receiverId: ted.id, ...fixture },
    });
    if (!reply.ok()) throw new Error(`Payment fixture request failed: HTTP ${reply.status()}`);
    const { transaction } = await reply.json();
    if (transaction?.senderId !== lia.id || transaction.receiverId !== ted.id ||
        transaction.amount !== fixture.amount * 100 || transaction.description !== fixture.description ||
        transaction.requestStatus !== 'pending') {
      throw new Error('Payment fixture did not create the expected pending request');
    }
  } finally {
    await context.dispose();
  }
}
