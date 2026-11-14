"""대역 게이트웨이: api.md "MCP 게이트웨이 — 도구"의 인자 · 결과 모양을 따르는 FastMCP 서버.

도구는 BE가 실제로 여는 것(`BE/src/gateway/tools.ts` TOOLS)만 둔다. 없는 도구를 두면
playbook이 없는 도구를 불러도 테스트가 통과한다(test_gateway_tools_match_the_platform).

테스트는 `script`로 도구마다 돌려줄 결과를 정하고 `calls`로 무엇이 불렸는지 본다.
거절은 api.md대로 `isError: true`와 `structuredContent: { code, message }`다.
"""

from typing import Any

from fastmcp import FastMCP
from fastmcp.tools.base import ToolResult

from ai_server.agent.gateway import GatewayToolset

Json = dict[str, Any]

DEFAULTS: dict[str, Json] = {
    "run_build": {
        "ok": True,
        "reused": False,
        "build": None,
        "failedPhase": None,
        "logTail": [],
        "image": "ghcr.io/x@sha256:1",
    },
    # 게이트웨이의 run_render · run_deploy · run_verify 결과에는 failure가 늘 있다
    # (api.md "MCP 게이트웨이 — 도구").
    "run_render": {"ok": True, "status": None, "failure": None},
    "run_deploy": {
        "ok": True,
        "services": [{"service": "be", "ready": True, "reason": None}],
        "pods": [],
        "events": [],
        "failure": None,
    },
    "run_verify": {
        "ok": True,
        "ready": [{"service": "be", "ready": True}],
        "requests": [{"service": "be", "path": "/", "status": 200, "ms": 12, "error": None}],
        "failure": None,
    },
    "get_target_status": {"pods": [], "events": [], "rollouts": []},
    "read_pod_logs": {"lines": ["Server listening on port 3000"]},
    "read_repo": {
        "type": "dir",
        "entries": [{"name": "package.json", "type": "file", "size": 300}],
    },
    "edit_repo_file": {"source": {"commitSha": "b" * 40}, "files": ["src/a.ts"], "changedLines": 2},
    "open_pr": {"url": "https://github.com/student/app/pull/1"},
    "submit_result": {"accepted": True},
}


def reject(code: str, message: str = "rejected", fields: list[Json] | None = None) -> Json:
    body: Json = {"code": code, "message": message}
    if fields is not None:
        body["fields"] = fields
    return {"__reject__": body}


class _FakeToolset(GatewayToolset):
    """전송 오류를 흉내 낸다: `fake.broken[name]`번만큼 그 도구 호출이 전송에서 끊긴다."""

    def __init__(self, client: Any, *, fake: "FakeGateway") -> None:
        super().__init__(client)
        self.fake = fake

    async def _raw_call(self, name: str, args: dict[str, Any]) -> Any:
        if self.fake.broken.get(name, 0) > 0:
            self.fake.broken[name] -= 1
            self.fake.lost.append(name)
            raise ConnectionError(f"connection reset while calling {name}")
        return await super()._raw_call(name, args)


class FakeGateway:
    def __init__(self) -> None:
        self.calls: list[tuple[str, Json]] = []
        # 도구 이름 → 전송에서 끊길 횟수, 끊긴 호출의 기록
        self.broken: dict[str, int] = {}
        self.lost: list[str] = []
        # 도구 이름 → 차례로 돌려줄 결과. 다 쓰면 DEFAULTS. reject(...)는 거절이다.
        self.script: dict[str, list[Json]] = {}
        self.server = FastMCP("fake-gateway")
        self._register()

    @property
    def submitted(self) -> list[Json]:
        return [args["result"] for name, args in self.calls if name == "submit_result"]

    def tool_calls(self) -> list[str]:
        return [name for name, _ in self.calls if name != "submit_result"]

    def toolset(self) -> GatewayToolset:
        return _FakeToolset(self.server, fake=self)

    def _answer(self, name: str, args: Json) -> ToolResult:
        self.calls.append((name, {k: v for k, v in args.items() if v is not None}))
        queue = self.script.get(name) or []
        value = queue.pop(0) if queue else DEFAULTS[name]
        if "__reject__" in value:
            return ToolResult(structured_content=value["__reject__"], is_error=True)
        return ToolResult(structured_content=value)

    def _register(self) -> None:
        s = self.server
        a = self._answer

        @s.tool
        def run_build(
            service: str,
            specPatch: list[Json] | None = None,
            source: Json | None = None,
            buildOverrides: Json | None = None,
        ) -> ToolResult:
            return a(
                "run_build",
                {
                    "service": service,
                    "specPatch": specPatch,
                    "source": source,
                    "buildOverrides": buildOverrides,
                },
            )

        @s.tool
        def run_render(specPatch: list[Json] | None = None) -> ToolResult:
            return a("run_render", {"specPatch": specPatch})

        @s.tool
        def run_deploy(
            specPatch: list[Json] | None = None, source: Json | None = None
        ) -> ToolResult:
            return a("run_deploy", {"specPatch": specPatch, "source": source})

        @s.tool
        def run_verify() -> ToolResult:
            return a("run_verify", {})

        @s.tool
        def get_target_status(service: str | None = None) -> ToolResult:
            return a("get_target_status", {"service": service})

        @s.tool
        def read_pod_logs(
            service: str, lines: int | None = None, previous: bool | None = None
        ) -> ToolResult:
            return a("read_pod_logs", {"service": service, "lines": lines, "previous": previous})

        @s.tool
        def read_repo(path: str, source: Json | None = None) -> ToolResult:
            return a("read_repo", {"path": path, "source": source})

        @s.tool
        def edit_repo_file(files: list[Json], message: str) -> ToolResult:
            return a("edit_repo_file", {"files": files, "message": message})

        @s.tool
        def open_pr(source: Json, title: str, body: str) -> ToolResult:
            return a("open_pr", {"source": source, "title": title, "body": body})

        @s.tool
        def submit_result(result: Json) -> ToolResult:
            return a("submit_result", {"result": result})
