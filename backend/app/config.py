from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_host: str = "0.0.0.0"
    app_port: int = 8000
    cors_origins: str = "http://localhost:5173"
    ws_heartbeat_seconds: int = 20

    database_url: str
    database_pool_min_size: int = 1
    database_pool_max_size: int = 10
    backend_ingest_token: str

    # Authentication
    organization_email_domain: str = "resolutecorp.in"
    auth_cookie_name: str = "claude_usage_session"
    auth_session_hours: int = 8
    auth_cookie_secure: bool = False

    @property
    def allowed_origins(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]

    @property
    def normalized_organization_domain(self) -> str:
        return self.organization_email_domain.strip().lower().lstrip("@")


settings = Settings()
