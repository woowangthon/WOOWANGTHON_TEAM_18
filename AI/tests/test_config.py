from pathlib import Path

import pytest

from ai_server.config import ConfigError, load_settings

TOKEN = "s3cret-" + "x" * 25  # 32자


@pytest.fixture(autouse=True)
def base_env(monkeypatch: pytest.MonkeyPatch) -> None:
    # 개발자의 실제 env가 섞이지 않게 비우고, 필수값만 채운다. 각 테스트는 보려는 값만 덮어쓴다.
    for name in ("HOST", "PORT", "AGENT_API_TOKEN", "GATEWAY_URL"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("AGENT_API_TOKEN", TOKEN)
    monkeypatch.setenv("GATEWAY_URL", "http://platform:4000/mcp")


def test_defaults_and_required_values() -> None:
    s = load_settings(env_file=None)
    assert s.host == "127.0.0.1"
    assert s.port == 8000
    assert s.agent_api_token.get_secret_value() == TOKEN
    assert str(s.gateway_url) == "http://platform:4000/mcp"


def test_empty_values_fall_back_to_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOST", "")
    monkeypatch.setenv("PORT", "")
    s = load_settings(env_file=None)
    assert (s.host, s.port) == ("127.0.0.1", 8000)


def test_reads_host_and_port(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOST", "0.0.0.0")
    monkeypatch.setenv("PORT", "65535")
    s = load_settings(env_file=None)
    assert (s.host, s.port) == ("0.0.0.0", 65535)


@pytest.mark.parametrize("port", ["abc", "0", "65536", "80.5", "-1"])
def test_rejects_bad_port(monkeypatch: pytest.MonkeyPatch, port: str) -> None:
    monkeypatch.setenv("PORT", port)
    with pytest.raises(ConfigError, match="PORT"):
        load_settings(env_file=None)


@pytest.mark.parametrize("name", ["AGENT_API_TOKEN", "GATEWAY_URL"])
@pytest.mark.parametrize("value", [None, ""])
def test_required(monkeypatch: pytest.MonkeyPatch, name: str, value: str | None) -> None:
    if value is None:
        monkeypatch.delenv(name)
    else:
        monkeypatch.setenv(name, value)
    with pytest.raises(ConfigError, match=f"{name}: Field required"):
        load_settings(env_file=None)


def test_rejects_short_token_without_showing_it(monkeypatch: pytest.MonkeyPatch) -> None:
    short = "leaky-token-" + "y" * 19  # 31자
    monkeypatch.setenv("AGENT_API_TOKEN", short)
    with pytest.raises(ConfigError, match="AGENT_API_TOKEN") as e:
        load_settings(env_file=None)
    assert short not in str(e.value)
    assert e.value.__cause__ is None and e.value.__suppress_context__


@pytest.mark.parametrize("url", ["platform:4000", "ftp://platform/mcp", "not a url"])
def test_rejects_non_http_gateway_url(monkeypatch: pytest.MonkeyPatch, url: str) -> None:
    monkeypatch.setenv("GATEWAY_URL", url)
    with pytest.raises(ConfigError, match="GATEWAY_URL"):
        load_settings(env_file=None)


def test_reads_env_file(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.delenv("GATEWAY_URL")
    env = tmp_path / ".env"
    env.write_text("GATEWAY_URL=https://gw.internal/mcp\n")
    assert str(load_settings(env_file=str(env)).gateway_url) == "https://gw.internal/mcp"
