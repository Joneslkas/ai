# AI 聊天机器人（ai）

本仓库为入门级的 AI 聊天机器人示例（Node.js + Redis + 浏览器 TTS）。此 README 补充了详细的“如何运行 / 部署”说明，帮助你在本地或使用 Docker 进行快速启动与测试，并给出扩展建议。

---

## 要点回顾

- 语言：JavaScript（Node.js）
- 最小运行环境：Node.js >= 16、Redis（默认 localhost:6379）
- 主要文件：
  - `backend/server.js`：Express 后端，提供 `/chat/:convId` 接口与 `/events/:convId`（SSE）推送
  - `backend/chat/order.js`：负责消息序号、锁、持久化到 Redis，以及一个简单的回复生成器（可替换为 OpenAI 等）
  - `frontend/index.html`：浏览器前端，使用 SSE 接收消息并通过 SpeechSynthesis 朗读回复
  - `package.json`：项目依赖与启动脚本

---

## 本地运行（开发 / 测试）

先决条件：
- Node.js >= 16
- Redis（本地或远程可访问）

步骤：

1. 克隆代码并进入项目根

```bash
git clone https://github.com/Joneslkas/ai.git
cd ai
```

2. 安装依赖

```bash
npm install
```

3. 启动 Redis（本机示例）

- macOS / Linux（如果已安装 redis）：

```bash
redis-server &
```

- 或使用 docker（如果未安装 redis）：

```bash
docker run -d --name ai-redis -p 6379:6379 redis:7
```

4. 启动服务

```bash
npm start
```

服务器默认监听： http://localhost:3000

5. 打开浏览器访问前端

- 打开： http://localhost:3000/index.html
- 在输入框中输入消息并发送，页面会展示对话并使用浏览器语音（SpeechSynthesis）朗读机器人回复。

---

## 快速命令行测试

- 发送消息给后端（替换 convId 或使用默认 `default`）

```bash
curl -X POST -H "Content-Type: application/json" -d '{"text":"你好"}' http://localhost:3000/chat/default
```

- 订阅 SSE 事件（在终端查看后端推送的消息）：

```bash
curl -N http://localhost:3000/events/default
```

- 在 Redis 中查看会话消息（保存为 JSON 字符串）

```bash
# 进入 redis cli
redis-cli
# 查看默认会话的消息列表
LRANGE conv:default:messages 0 -1
```

---

## Docker / Docker Compose（一键启动示例）

下面是一个示例 `docker-compose.yml`，用于在容器中运行 Redis 与本项目（需要在项目根准备 `Dockerfile`）。这个示例便于在没有全局安装 Redis 或 Node 的机器上运行。

```yaml
version: '3.8'
services:
  redis:
    image: redis:7
    ports:
      - "6379:6379"
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
    depends_on:
      - redis
```

示例 `Dockerfile`（项目根）：

```dockerfile
FROM node:18
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["node", "backend/server.js"]
```

启动：

```bash
docker-compose up --build
```

注意：当前代码里 `ioredis` 使用默认连接（`new Redis()`），在容器或远程 Redis 情况下，你可能需要通过 `REDIS_URL` 或环境变量并修改代码以接受自定义 Redis 配置（我可以根据需要提交这项改动）。

---

## 部署建议（生产就绪要点，简短）

- 不要把 Redis 暴露到公网；在云部署时使用私有网络或受控访问的托管 Redis 服务（如 AWS Elasticache、Azure Cache 等）。
- 使用环境变量管理配置（PORT、REDIS_URL、OPENAI_API_KEY 等），避免密钥写入源码。建议尽快把 `backend` 中的 Redis 连接改为从环境变量读取。
- 使用反向代理（nginx）和 TLS（HTTPS）对外暴露服务，处理负载均衡与静态文件缓存。
- 选择合适的进程管理工具（PM2 / systemd / Docker）来保证服务自动重启、日志管理与资源限制。
- 如果打算接入 OpenAI 或其它付费模型，请将 API Key 存放在安全的 secret 管理系统（不要写入仓库）。

---

## 可选增强（我可以帮你实现并提交）

- 把 `generateReplyFromModel` 替换为 OpenAI API 的调用（需要 `OPENAI_API_KEY`，并在 `package.json` 中添加 `openai` 依赖）。
- 支持从环境变量读取 Redis 连接（`REDIS_URL`）并回退到 localhost（当前为默认 localhost）。
- 用 WebSocket 替代 SSE（便于双向实时通信）。
- 增加会话列表与历史分页接口（数据库持久化到 Postgres/Mongo）。
- 添加 Docker Hub 发布配置或 GitHub Actions 自动部署流程。

---

## 常见问题（FAQ）

Q: 为什么浏览器没有发出声音？

A: 浏览器 TTS 使用 `SpeechSynthesis`，某些浏览器/平台可能需要用户与页面交互（点击）后才允许播放声音，或浏览器的语音合成不一定支持指定语言。检查浏览器控制台是否有报错并确保页面可见与已获得交互。

Q: 我想用 OpenAI 替换内置回复器，需要做什么？

A: 我可以帮你完成：
1. 在 `package.json` 中添加 `openai` 依赖并安装；
2. 在 `backend/chat/order.js` 中把 `generateReplyFromModel` 改为调用 OpenAI（传入 `OPENAI_API_KEY` 环境变量），并处理速率/超时；
3. 提交代码并在 README 中添加使用说明。

---

如果你希望我现在把上述一项增强（如 OpenAI 集成或 Dockerfile/compose 添加）实现并提交，请告诉我你想要的项，我会立刻开始并把改动提交到仓库。