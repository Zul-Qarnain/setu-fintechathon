"""FastAPI entrypoint for Setu 桥 (SYNTHETIC DATA; sandbox only)."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.routes import actions, audit, auth, chat, dashboard, demo, documents, evidence, fx, payees
from app.sandbox_bank import api as sandbox_api


def _err(code: str, message: str, status: int, request_id: str, details: Any = None) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={
            "error": {"code": code, "message": message, "details": details or {}},
            "request_id": request_id,
        },
    )


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    from app import db as dbm
    from app.seed import seed_if_empty

    dbm.init_db()
    with dbm.session_factory()() as s:
        seed_if_empty(s)
        s.commit()
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        lifespan=lifespan,
        title="Setu 桥 API",
        version="0.1.0",
        description="Guarded cross-border finance agent. SYNTHETIC DATA / SANDBOX ONLY.",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def request_id_mw(request: Request, call_next: Any) -> Any:
        rid = request.headers.get("x-request-id") or f"req_{uuid.uuid4().hex[:12]}"
        request.state.request_id = rid
        resp = await call_next(request)
        resp.headers["x-request-id"] = rid
        return resp

    @app.exception_handler(HTTPException)
    async def http_exc(request: Request, exc: HTTPException) -> JSONResponse:
        rid = getattr(request.state, "request_id", "req_unknown")
        detail = exc.detail
        if isinstance(detail, dict) and "code" in detail:
            return _err(
                detail["code"],
                detail.get("message", ""),
                exc.status_code,
                rid,
                detail.get("details"),
            )
        return _err(f"http_{exc.status_code}", str(detail), exc.status_code, rid)

    @app.exception_handler(RequestValidationError)
    async def val_exc(request: Request, exc: RequestValidationError) -> JSONResponse:
        rid = getattr(request.state, "request_id", "req_unknown")
        errs = [{"loc": [str(x) for x in e["loc"]], "msg": e["msg"]} for e in exc.errors()]
        return _err("validation_error", "Request validation failed", 422, rid, {"errors": errs})

    @app.get("/health", tags=["meta"])
    def health() -> dict[str, Any]:
        return {
            "status": "ok",
            "offline_mode": settings.allow_offline,
            "llm_provider": settings.llm_provider,
            "fx_mode": settings.fx_mode,
            "synthetic_data": True,
            "version": "0.1.0",
        }

    routers = [auth, documents, chat, fx, actions, payees, audit, evidence, dashboard]
    for r in routers:
        app.include_router(r.router)
    app.include_router(sandbox_api.router)
    if settings.demo_mode:
        app.include_router(demo.router)

    return app


app = create_app()
