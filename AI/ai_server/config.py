from pydantic import AnyHttpUrl, Field, SecretStr, ValidationError
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """AI 서버 설정. 값은 env와 `AI/.env`에서 읽고, 빈 값은 없는 것으로 본다(`.env.example`)."""

    model_config = SettingsConfigDict(env_file=".env", env_ignore_empty=True, extra="ignore")

    host: str = "127.0.0.1"
    port: int = Field(default=8000, ge=1, le=65535)
    # 플랫폼 서버 → AI 서버 요청의 Bearer 토큰. 비밀값이라 오류 메시지에도 값을 넣지 않는다.
    agent_api_token: SecretStr = Field(min_length=32)
    # 플랫폼 서버 MCP 게이트웨이 주소. 요청 본문으로 받지 않고 여기로만 고정한다
    # (받은 주소로 토큰을 보내지 않게, api.md "AI 에이전트").
    gateway_url: AnyHttpUrl


class ConfigError(Exception):
    """설정이 틀려 부팅을 멈춰야 할 때. 메시지에는 변수 이름과 이유만 담는다."""


def load_settings(env_file: str | None = ".env") -> Settings:
    try:
        return Settings(_env_file=env_file)
    except ValidationError as e:
        # pydantic의 기본 메시지는 입력값을 그대로 보여 주므로 쓰지 않는다(토큰이 로그에 남는다).
        problems = [
            f"{'.'.join(str(p) for p in err['loc']).upper()}: {err['msg']}" for err in e.errors()
        ]
        raise ConfigError("AI 서버 설정이 잘못됐다 — " + "; ".join(problems)) from None
