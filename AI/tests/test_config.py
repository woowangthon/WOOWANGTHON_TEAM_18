from pathlib import Path

import pytest

from ai_server.config import ConfigError, load_settings

TOKEN = "s3cret-" + "x" * 25  # 32자


@pytest.fixture(autouse=True)
def base_env(monkeypatch: pytest.MonkeyPatch) -> None:
    # 개발자의 실제 env가 섞이지 않게 비우고, 필수값만 채운다. 각 테스트는 보려는 값만 덮어쓴다.
    for name in (
        "HOST",
        "PORT",
        "AGENT_API_TOKEN",
        "GATEWAY_URL",
        "AGENT_MAX_RUNS",
        "LOCAL_MODEL_URL",
        "LOCAL_MODEL_NAME",
        "LOCAL_MODEL_API_KEY",
        "PLANNER_MODEL_URL",
        "PLANNER_MODEL_NAME",
        "PLANNER_MODEL_API_KEY",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("AGENT_API_TOKEN", TOKEN)
    monkeypatch.setenv("GATEWAY_URL", "http://platform:4000/mcp")
    monkeypatch.setenv("LOCAL_MODEL_URL", "http://vllm:8000/v1")
    monkeypatch.setenv("LOCAL_MODEL_NAME", "Qwen/Qwen3-8B-AWQ")


def test_defaults_and_required_values() -> None:
    s = load_settings(env_file=None)
    assert s.host == "127.0.0.1"
    assert s.port == 8000
    assert s.agent_api_token.get_secret_value() == TOKEN
    assert str(s.gateway_url) == "http://platform:4000/mcp"
    assert s.agent_max_runs == 2
    assert (str(s.local_model_url), s.local_model_name) == (
        "http://vllm:8000/v1",
        "Qwen/Qwen3-8B-AWQ",
    )
    assert s.local_model_api_key is None
    assert (s.planner_model_url, s.planner_model_name, s.planner_model_api_key) == (
        None,
        None,
        None,
    )


def test_planner_model(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PLANNER_MODEL_URL", "https://api.example.com/v1")
    monkeypatch.setenv("PLANNER_MODEL_NAME", "reasoner")
    monkeypatch.setenv("PLANNER_MODEL_API_KEY", "sk-" + "z" * 20)
    s = load_settings(env_file=None)
    assert (str(s.planner_model_url), s.planner_model_name) == (
        "https://api.example.com/v1",
        "reasoner",
    )
    assert s.planner_model_api_key is not None


@pytest.mark.parametrize("name", ["PLANNER_MODEL_URL", "PLANNER_MODEL_NAME"])
def test_planner_url_and_name_go_together(monkeypatch: pytest.MonkeyPatch, name: str) -> None:
    monkeypatch.setenv(name, "https://api.example.com/v1" if name.endswith("URL") else "reasoner")
    with pytest.raises(ConfigError, match="PLANNER_MODEL_URL and PLANNER_MODEL_NAME"):
        load_settings(env_file=None)


def test_local_model_is_optional(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("LOCAL_MODEL_URL")
    monkeypatch.delenv("LOCAL_MODEL_NAME")
    s = load_settings(env_file=None)
    assert (s.local_model_url, s.local_model_name) == (None, None)


@pytest.mark.parametrize("name", ["LOCAL_MODEL_URL", "LOCAL_MODEL_NAME"])
def test_local_url_and_name_go_together(monkeypatch: pytest.MonkeyPatch, name: str) -> None:
    monkeypatch.delenv(name)
    with pytest.raises(ConfigError, match="LOCAL_MODEL_URL and LOCAL_MODEL_NAME"):
        load_settings(env_file=None)


def test_planner_key_is_not_shown(monkeypatch: pytest.MonkeyPatch) -> None:
    key = "sk-leaky" + "q" * 20
    monkeypatch.setenv("PLANNER_MODEL_URL", "not a url")
    monkeypatch.setenv("PLANNER_MODEL_NAME", "reasoner")
    monkeypatch.setenv("PLANNER_MODEL_API_KEY", key)
    with pytest.raises(ConfigError, match="PLANNER_MODEL_URL") as e:
        load_settings(env_file=None)
    assert key not in str(e.value)


def test_agent_max_runs(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGENT_MAX_RUNS", "1")
    assert load_settings(env_file=None).agent_max_runs == 1
    monkeypatch.setenv("AGENT_MAX_RUNS", "0")
    with pytest.raises(ConfigError, match="AGENT_MAX_RUNS"):
        load_settings(env_file=None)


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
