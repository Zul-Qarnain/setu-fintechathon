from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app import schemas as s
from app.agents.graph import run_chat
from app.db import get_session
from app.deps import current_user, rate_limit
from app.models import User

router = APIRouter(prefix="/chat", tags=["chat"], dependencies=[Depends(rate_limit)])


@router.post("", response_model=s.ChatResponse)
def chat(body: s.ChatRequest, user: User = Depends(current_user), db: Session = Depends(get_session)) -> s.ChatResponse:
    return run_chat(db, user, body)
