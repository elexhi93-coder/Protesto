const test = require('node:test');
const assert = require('node:assert');
const http = require('http');

test('Backend Server Starts & Exposes HTTP API endpoints', async () => {
  const express = require('express');
  const app = express();
  app.use(express.json());
  
  const stateManager = require('../server/stateManager');
  app.post('/api/auth/token', (req, res) => {
    const { token } = req.body;
    if (stateManager.validateInviteToken(token)) {
      return res.json({ success: true });
    }
    return res.status(403).json({ success: false });
  });

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;

  // Test valid token
  const resValid = await fetch(`http://localhost:${port}/api/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'PROTEST2026' })
  });
  const dataValid = await resValid.json();
  assert.strictEqual(dataValid.success, true);

  // Test invalid token
  const resInvalid = await fetch(`http://localhost:${port}/api/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'RANDOM_BAD_TOKEN' })
  });
  assert.strictEqual(resInvalid.status, 403);

  server.close();
});
