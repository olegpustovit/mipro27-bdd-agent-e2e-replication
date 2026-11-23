const response = await fetch('http://127.0.0.1:3001/testData/seed', { method: 'POST', signal: AbortSignal.timeout(15000) });
if (!response.ok) throw new Error(`Fixture reset failed: HTTP ${response.status}`);
console.log('Synthetic application state reset. Use a new browser context.');
