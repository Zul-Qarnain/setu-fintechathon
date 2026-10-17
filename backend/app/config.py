"""Runtime configuration (env-driven; no secrets in code)."""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    allow_offline: bool = True
    llm_provider: str = "scripted"  # scripted | gemini | groq
    database_url: str = "sqlite:///./setu.db"
    # DEV-ONLY defaults so the offline demo works with zero setup. Override in any real env.
    jwt_secret: str = "dev-only-jwt-secret-change-me-0123456789abcdef"
    hmac_key: str = "dev-only-hmac-key-change-me-0123456789abcdef"
    aes_key_b64: str = "ZGV2LW9ubHktYWVzLWtleS0zMi1ieXRlcy1sb25nISE="  # 32 bytes, dev only
    jwt_ttl_seconds: int = 3600
    cors_origins: str = "http://localhost:3000"
    demo_mode: bool = True  # exposes /demo/* helpers (tamper, totp peek). Never in prod.
    fx_mode: str = "fixture"  # fixture | live
    fx_cache_ttl_seconds: int = 86400
    gemini_api_key: str = ""
    groq_api_key: str = ""
    rate_limit_per_minute: int = 120
    cooling_off_hours: int = 24
    t2_cap_cny: str = "2000"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
