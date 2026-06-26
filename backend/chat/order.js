// Add sequence and queue logic for chat ordering
// Files changed:
// - backend/chat/order.js

const Redis = require('ioredis');
const { v4: uuidv4 } = require('uuid');

const redis = new Redis();

async function nextSeq(convId) {
  const key = `conv:${convId}:seq`;
  return Number(await redis.incr(key));
}

// Simple lock using set NX PX
async function withLock(key, fn) {
  const lockKey = `lock:${key}`;
  const token = uuidv4();
  const ok = await redis.set(lockKey, token, 'NX', 'PX', 5000);
  if (!ok) {
    // wait and retry
    await new Promise(r => setTimeout(r, 100));
    return withLock(key, fn);
  }
  try {
    return await fn();
  } finally {
    const cur = await redis.get(lockKey);
    if (cur === token) await redis.del(lockKey);
  }
}

async function handleUserMessage(convId, userMsg, publish) {
  return withLock(convId, async () => {
    const replyText = await generateReplyFromModel(userMsg);
    const seq = await nextSeq(convId);
    const msg = { id: uuidv4(), convId, seq, role: 'assistant', text: replyText, ts: Date.now() };
    // TODO: saveMessageToDb
    await publish(JSON.stringify(msg));
    return msg;
  });
}

module.exports = { handleUserMessage };
