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
