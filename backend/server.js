// backend/server.js
// Minimal Express server with SSE for pushing assistant messages and a POST /chat/:convId endpoint.
// Serves frontend from /frontend folder.

const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const { handleUserMessage } = require('./chat/order');

const app = express();
app.use(bodyParser.json());
app.use(require('cors')());

// Serve static frontend
app.use('/', express.static(path.join(__dirname, '..', 'frontend')));

// In-memory subscribers per convId for SSE
const subscribers = new Map();

function publishToConv(convId, data) {
  const subs = subscribers.get(convId);
  if (!subs) return;
  for (const res of subs) {
    res.write(`data: ${data}\n\n`);
  }
}

// SSE endpoint: client connects to receive assistant messages
app.get('/events/:convId', (req, res) => {
  const convId = req.params.convId || 'default';
  // Headers for SSE
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();

  // send a ping comment every 20s to keep connection alive
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 20000);

  if (!subscribers.has(convId)) subscribers.set(convId, []);
  subscribers.get(convId).push(res);

  req.on('close', () => {
    clearInterval(keepAlive);
    const arr = subscribers.get(convId) || [];
    const idx = arr.indexOf(res);
    if (idx >= 0) arr.splice(idx, 1);
    if (arr.length === 0) subscribers.delete(convId);
  });
});

// Chat endpoint: accept user message and respond via published events
app.post('/chat/:convId', async (req, res) => {
  const convId = req.params.convId || 'default';
  const { text } = req.body || {};
  if (typeof text !== 'string') return res.status(400).json({ error: 'missing text in body' });
  try {
    const msg = await handleUserMessage(convId, text, (payload) => publishToConv(convId, payload));
    // return assistant message immediately as well (in case client wants sync)
    res.json(msg);
  } catch (err) {
    console.error('handleUserMessage error', err);
    res.status(500).json({ error: 'internal error' });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
  console.log(`Frontend available at http://localhost:${port}/index.html`);
});
