// backend/chat/order.js
// 负责消息序号、锁、保存与生成回复（优先使用 OpenAI，当不存在 API key 时回退到本地规则回复）

const Redis = require('ioredis');
const { v4: uuidv4 } = require('uuid');

// Redis: 支持 REDIS_URL 优先级，回退到 host/port 或 localhost
const redisUrl = process.env.REDIS_URL;
let redis;
if (redisUrl) {
  redis = new Redis(redisUrl);
} else {
  const host = process.env.REDIS_HOST || '127.0.0.1';
  const port = process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : 6379;
  redis = new Redis({ host, port });
}

// OpenAI 客户端（惰性初始化）
let openaiClient = null;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
if (OPENAI_KEY) {
  try {
    // Using the official OpenAI JS client (CommonJS)
    const OpenAI = require('openai');
    openaiClient = new OpenAI({ apiKey: OPENAI_KEY });
    console.log('OpenAI client initialized');
  } catch (err) {
    console.warn('OpenAI client could not be initialized. Ensure `openai` is installed. Falling back to local replies.', err && err.message ? err.message : err);
    openaiClient = null;
  }
}

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

// Local fallback reply generator
async function localReply(userMsg) {
  const text = (userMsg || '').trim();
  if (!text) return "你刚才没有说什么，能再输入一次吗？";
  const lower = text.toLowerCase();
  if (lower.includes('笑话') || lower.includes('讲个笑话')) {
    return "好呀：有一天，一只程序员走进了酒吧，酒保问：要不要调试？程序员回答：不要，我只要一杯咖啡就好。";
  }
  if (lower.includes('你好') || lower.includes('嗨')) {
    return "你好！我是一个小机器人，我可以帮你回答问题或讲笑话。";
  }
  return `你说的是：「${text}」。这是我理解后的回应。`;
}

// OpenAI-backed reply (if available). Falls back to localReply on error.
// This implementation tries to handle multiple shapes from different OpenAI client versions:
// - chat.completions.create (older/newer chat completion style)
// - responses.create (Responses API style)
async function aiReply(userMsg) {
  if (!openaiClient) return localReply(userMsg);
  try {
    let text = null;
    const model = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';

    // 1) Chat Completions style (client.chat.completions.create)
    if (openaiClient.chat && openaiClient.chat.completions && typeof openaiClient.chat.completions.create === 'function') {
      try {
        const resp = await openaiClient.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: '你是一个友好的中文助理，回答简洁明了。' },
            { role: 'user', content: userMsg }
          ],
          max_tokens: 512,
          temperature: 0.8,
        });
        if (resp && resp.choices && resp.choices[0]) {
          if (resp.choices[0].message && resp.choices[0].message.content) {
            text = resp.choices[0].message.content;
          } else if (typeof resp.choices[0].text === 'string') {
            text = resp.choices[0].text;
          }
        }
      } catch (err) {
        // swallow and try other styles
        console.warn('chat.completions path failed:', err && err.message ? err.message : err);
      }
    }

    // 2) Responses API style (client.responses.create)
    if (!text && openaiClient.responses && typeof openaiClient.responses.create === 'function') {
      try {
        const resp = await openaiClient.responses.create({
          model,
          input: userMsg,
        });

        // Try common shapes:
        if (resp) {
          // direct output_text (some wrappers)
          if (typeof resp.output_text === 'string' && resp.output_text.trim()) {
            text = resp.output_text;
          }

          // resp.output is often an array of items
          if (!text && Array.isArray(resp.output) && resp.output.length > 0) {
            for (const out of resp.output) {
              if (typeof out === 'string' && out.trim()) {
                text = out;
                break;
              }
              // out.content can be string or array
              if (out && out.content) {
                if (typeof out.content === 'string' && out.content.trim()) {
                  text = out.content;
                  break;
                }
                if (Array.isArray(out.content)) {
                  for (const c of out.content) {
                    if (typeof c === 'string' && c.trim()) {
                      text = c;
                      break;
                    } else if (c && typeof c.text === 'string' && c.text.trim()) {
                      text = c.text;
                      break;
                    }
                  }
                  if (text) break;
                }
                // some shapes: out.content[0].text
                if (out.content && out.content[0] && typeof out.content[0].text === 'string' && out.content[0].text.trim()) {
                  text = out.content[0].text;
                  break;
                }
              }
            }
          }

          // fallback check for choices.message
          if (!text && resp.choices && resp.choices[0] && resp.choices[0].message && resp.choices[0].message.content) {
            text = resp.choices[0].message.content;
          }
        }
      } catch (err) {
        console.warn('responses.create path failed:', err && err.message ? err.message : err);
      }
    }

    if (!text) return localReply(userMsg);
    return String(text).trim();
  } catch (err) {
    console.warn('OpenAI request failed or unexpected response shape, falling back to local reply:', err && err.message ? err.message : err);
    return localReply(userMsg);
  }
}

async function generateReplyFromModel(userMsg) {
  if (OPENAI_KEY && openaiClient) {
    return await aiReply(userMsg);
  }
  return await localReply(userMsg);
}

async function handleUserMessage(convId, userMsg, publish) {
  return withLock(convId, async () => {
    // get next seq for the user message
    const seq = await nextSeq(convId);

    // create user message record
    // seq should be the incremented value returned by nextSeq
    const userMessageObj = { id: uuidv4(), convId, seq, role: 'user', text: userMsg, ts: Date.now() };
    await saveMessageToDb(convId, userMessageObj);

    const replyText = await generateReplyFromModel(userMsg);

    // next sequence for assistant reply
    const assistantSeq = await nextSeq(convId);
    const msg = { id: uuidv4(), convId, seq: assistantSeq, role: 'assistant', text: replyText, ts: Date.now() };
    await saveMessageToDb(convId, msg);

    // publish to subscribers (SSE/WebSocket)
    if (publish) {
      try {
        await publish(JSON.stringify(msg));
      } catch (err) {
        // publishing errors should not prevent response
        console.warn('publish failed:', err && err.message ? err.message : err);
      }
    }
    return msg;
  });
}

module.exports = { handleUserMessage, generateReplyFromModel, saveMessageToDb };