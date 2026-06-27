// backend/chat/order.js
// 负责消息序号、锁、保存与生成简单回复（可替换为 OpenAI/本地模型调用）

const Redis = require('ioredis');
const { v4: uuidv4 } = require('uuid');

const redis = new Redis(); // 默认连接 localhost:6379

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

// Persist message to Redis list for the conversation
async function saveMessageToDb(convId, msg) {
  const key = `conv:${convId}:messages`;
  // store as JSON string
  await redis.rpush(key, JSON.stringify(msg));
}

// Very small "model" — replace this with OpenAI API or local model call if desired
async function generateReplyFromModel(userMsg) {
  // Simple rule-based or echo + modifier
  const text = (userMsg || '').trim();
  if (!text) return "你刚才没有说什么，能再输入一次吗？";
  // some basic canned responses
  const lower = text.toLowerCase();
  if (lower.includes('笑话') || lower.includes('讲个笑话')) {
    return "好呀：有一天，一只程序员走进了酒吧，酒保问：要不要调试？程序员回答：不要，我只要一杯咖啡就好。";
  }
  if (lower.includes('你好') || lower.includes('嗨')) {
    return "你好！我是一个小机器人，我可以帮你回答问题或讲笑话。";
  }
  // fallback: echo with small transformation
  return `你说的是：「${text}」。这是我理解后的回应。`;
}

async function handleUserMessage(convId, userMsg, publish) {
  return withLock(convId, async () => {
    const seq = await nextSeq(convId);
    // create user message record
    const userMessageObj = { id: uuidv4(), convId, seq: seq * 1 - 1, role: 'user', text: userMsg, ts: Date.now() };
    await saveMessageToDb(convId, userMessageObj);

    const replyText = await generateReplyFromModel(userMsg);
    const assistantSeq = await nextSeq(convId);
    const msg = { id: uuidv4(), convId, seq: assistantSeq, role: 'assistant', text: replyText, ts: Date.now() };
    await saveMessageToDb(convId, msg);

    // publish to subscribers (SSE/WebSocket)
    if (publish) await publish(JSON.stringify(msg));
    return msg;
  });
}

module.exports = { handleUserMessage, generateReplyFromModel, saveMessageToDb };
