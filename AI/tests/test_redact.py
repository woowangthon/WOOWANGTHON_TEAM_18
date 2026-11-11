import pytest

from ai_server.agent.redact import MASK, redact, redact_value

SECRETS = [
    ("DATABASE_PASSWORD=s3cr3t-value", "DATABASE_PASSWORD=" + MASK),
    ('"apiKey": "abc123def456"', '"apiKey": "' + MASK + '"'),
    ("JWT_SECRET: hunter2", "JWT_SECRET: " + MASK),
    ("export DATABASE_URL='postgres://u:p@h/db'", "export DATABASE_URL='" + MASK + "'"),
    ("token=xyz789", "token=" + MASK),
    ("Authorization: Bearer abcdefgh12345678", "Authorization: Bearer " + MASK),
    ("redis://default:pa55word@cache:6379", "redis://default:" + MASK + "@cache:6379"),
    ("using ghp_" + "a" * 36, "using " + MASK),
    ("github_pat_" + "B" * 30, MASK),
    ("key sk-" + "c" * 24, "key " + MASK),
    ("AKIA" + "D" * 16, MASK),
    ("xoxb-1234567890-abc", MASK),
    ("sb_secret_" + "e" * 20, MASK),
    ("gw_" + "f" * 20, MASK),
    ("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlMTIz", MASK),
    ("-----BEGIN RSA PRIVATE KEY-----\nMIIE\nabc\n-----END RSA PRIVATE KEY-----", MASK),
]


@pytest.mark.parametrize(("text", "expected"), SECRETS)
def test_secrets_are_masked(text: str, expected: str) -> None:
    assert redact(text) == expected


@pytest.mark.parametrize(
    "text",
    [
        "Server listening on port 3000",
        "npm ERR! code ERESOLVE",
        'Readiness probe failed: Get "http://10.42.0.5:8080/health"',
        "https://github.com/student/app/pull/1",
        "commit a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
        "secretKeys missing: DATABASE_URL",  # 이름만 있고 값은 없다
    ],
)
def test_ordinary_text_is_kept(text: str) -> None:
    assert redact(text) == text


def test_redact_value_walks_json() -> None:
    value = {"env": {"API_KEY": "k1", "PORT": 3000}, "lines": ["password=p1", 5, None], "ok": True}
    assert redact_value(value) == {
        "env": {"API_KEY": MASK, "PORT": 3000},
        "lines": ["password=" + MASK, 5, None],
        "ok": True,
    }
