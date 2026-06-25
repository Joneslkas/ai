# ai
第一次做，想做一个ai聊天机器人
import requests
import json
from typing import Optional, List, Dict
from datetime import datetime
import os
from abc import ABC, abstractmethod
# ======================== API 基类 ========================

class AIProvider(ABC):
    """AI 服务提供者抽象基类"""
    
    @abstractmethod
    def ask(self, question: str, use_web: bool = True) -> str:
        """
        提问
        
        Args:
            question: 问题内容
            use_web: 是否使用网络搜索
            
        Returns:
            AI 回答
        """
        pass
"""
FastAPI 对话机器人示例（使用 OpenAI Chat API）
运行:
  export OPENAI_API_KEY="sk-xxx"
  pip install -r requirements.txt
  uvicorn app:app --reload --port 8000
访问:
  打开 http://127.0.0.1:8000/
"""
import os
import uuid
from typing import List, Optional
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from dotenv import load_dotenv

load_dotenv()

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
if not OPENAI_API_KEY:
    raise RuntimeError("请设置 OPENAI_API_KEY 环境变量")

import openai
openai.api_key = OPENAI_API_KEY

app = FastAPI()
templates = Jinja2Templates(directory="templates")
app.mount("/static", StaticFiles(directory="static"), name="static")

# 简单内存会话管理：内存字典，生产请改用持久化存储（Redis/DB）
class ConversationManager:
    def __init__(self, max_history: int = 8):
        self.sessions = {}  # session_id -> list of {"role": "user"/"assistant", "content": "..."}
        self.max_history = max_history

    def get_or_create(self, session_id: Optional[str] = None) -> str:
        if session_id and session_id in self.sessions:
            return session_id
        sid = session_id or str(uuid.uuid4())
        if sid not in self.sessions:
            self.sessions[sid] = []
        return sid

    def append_user(self, session_id: str, text: str):
        self.sessions.setdefault(session_id, []).append({"role": "user", "content": text})
        self._truncate(session_id)

    def append_assistant(self, session_id: str, text:str):
        self.sessions.setdefault(session_id, []).append({"role": "assistant", "content": text})
        self._truncate(session_id)

    def history_messages(self, session_id: str) -> List[dict]:
        return self.sessions.get(session_id, [])

    def _truncate(self, session_id: str):
        # 保留最近 N 条（按 message 对计数），以“role/content”为单位
        hist = self.sessions.get(session_id, [])
        if len(hist) > self.max_history * 2:  # 每轮两条（user+assistant）
            # 只保留末尾的记录
            self.sessions[session_id] = hist[-self.max_history*2:]

conv_mgr = ConversationManager(max_history=6)

# API 请求模型
class ChatRequest(BaseModel):
    session_id: Optional[str] = None
    message: str
    system_prompt: Optional[str] = "你是一个有帮助、友善的中文助手。"

@app.get("/")
async def home(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

@app.post("/api/chat")
async def chat(req: ChatRequest):
    session_id = conv_mgr.get_or_create(req.session_id)
    # 加入用户最新输入
    conv_mgr.append_user(session_id, req.message)

    # 构建 messages：可先加入 system prompt
    messages = [{"role": "system", "content": req.system_prompt}] + conv_mgr.history_messages(session_id)

    # 调用 OpenAI ChatCompletion
    try:
        resp = openai.ChatCompletion.create(
            model="gpt-3.5-turbo",
            messages=messages,
            max_tokens=512,
            temperature=0.7,
            n=1,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    assistant_text = resp["choices"][0]["message"]["content"].strip()
    conv_mgr.append_assistant(session_id, assistant_text)

    return JSONResponse({"session_id": session_id, "reply": assistant_text})

@app.post("/api/reset")
async def reset(session_id: str):
    if session_id in conv_mgr.sessions:
        conv_mgr.sessions.pop(session_id, None)
        return {"status": "ok", "message": f"会话 {session_id} 已重置"}
    return {"status": "ok", "message": "会话不存在或已清空"}
