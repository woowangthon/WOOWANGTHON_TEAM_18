"""플랫폼 서버와 주고받는 모양.

정본은 docs/design/AIagent.md §5 · §6 · §7과 api.md "AI 에이전트".
"""

from typing import Annotated, Any, Literal, Self

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel

CommitSha = Annotated[str, Field(pattern=r"^[0-9a-f]{40}$")]
NonEmpty = Annotated[str, Field(min_length=1)]
Stage = Literal["build", "prepare", "render", "apply"]
ResultStatus = Literal["verified", "pr_opened", "needs_user", "gave_up"]
JsonObject = dict[str, Any]


class Wire(BaseModel):
    """JSON 칸은 camelCase이고, 모르는 칸은 거부한다(오타가 조용히 무시되지 않게)."""

    model_config = ConfigDict(alias_generator=to_camel, validate_by_name=True, extra="forbid")


# ---- §5 문제 티켓 ----


class K8sRaw(Wire):
    pod: JsonObject | None
    events: list[JsonObject]


class TicketRaw(Wire):
    # CodeBuild · k3s 출력은 원본 그대로라 안쪽 모양은 고정하지 않는다.
    codebuild: JsonObject | None
    # to_camel은 "k8s"를 "k8S"로 바꾸므로 이름을 직접 준다.
    k8s: K8sRaw | None = Field(alias="k8s")


class TicketLogs(Wire):
    from_: AwareDatetime = Field(alias="from")
    to: AwareDatetime
    lines: list[str] = Field(max_length=200)


class PreviousTicket(Wire):
    ticket_id: NonEmpty
    status: NonEmpty
    summary: str


class Ticket(Wire):
    ticket_id: NonEmpty
    commit_sha: CommitSha
    stage: Stage
    service: NonEmpty | None
    target_slot: Literal["a", "b"]
    deploy_input: JsonObject
    error_message: str
    raw: TicketRaw
    logs: TicketLogs
    previous: PreviousTicket | None


class GatewayGrant(Wire):
    token: NonEmpty
    expires_at: AwareDatetime


class TicketRequest(Wire):
    """`POST /agent/tickets` 본문."""

    ticket: Ticket
    gateway: GatewayGrant


# ---- §7 종료 알림 ----


class CloseNotice(Wire):
    ticket_id: NonEmpty
    commit_sha: CommitSha
    reason: Literal["success", "superseded", "stopped"]


# ---- §6 해결 결과 ----

# build · runtime 아래 전부, 서비스 name, project slug만 고칠 수 있다(§6 스키마의 pattern 그대로).
SPEC_PATCH_PATH = r"^/spec/(services/[0-9]+/(build|runtime)/|services/[0-9]+/name$|project/slug$)"


class Classification(Wire):
    method: Literal["code", "llm"]
    case_id: str | None
    path: Literal["playbook", "replan_after_playbook", "plan"]


class Action(Wire):
    tool: NonEmpty
    args: JsonObject | None = None
    ok: bool
    result: str | None = None


class SpecPatchOp(Wire):
    op: Literal["replace", "add", "remove"]
    path: Annotated[str, Field(pattern=SPEC_PATCH_PATH)]
    value: Any = None


class BuildOverrides(Wire):
    compute_type: str | None = None
    timeout_minutes: Annotated[int, Field(ge=1, le=30)] | None = None
    image: str | None = None
    cache: bool | None = None


class PullRequest(Wire):
    url: str | None = None
    files: list[str] = Field(default_factory=list, max_length=5)
    changed_lines: Annotated[int, Field(ge=0, le=50)] | None = None


class UserRequest(Wire):
    message: NonEmpty
    secret_keys: list[str] = Field(default_factory=list)


class Evidence(Wire):
    ref: str | None = None
    text: str | None = None


class AgentResult(Wire):
    """해결 결과. 에이전트의 output_type이라 모양이 틀리면 에이전트가 다시 만든다(§6)."""

    ticket_id: NonEmpty
    commit_sha: CommitSha
    status: ResultStatus
    classification: Classification
    actions: list[Action]
    spec_patch: list[SpecPatchOp] | None = None
    build_overrides: BuildOverrides | None = None
    pr: PullRequest | None = None
    user_request: UserRequest | None = None
    evidence: list[Evidence] = Field(default_factory=list)
    summary: NonEmpty

    @model_validator(mode="after")
    def _required_for_status(self) -> Self:
        # §6 표: status마다 플랫폼이 읽는 칸이 있어야 한다.
        needed = {"verified": "spec_patch", "pr_opened": "pr", "needs_user": "user_request"}
        field = needed.get(self.status)
        if field is not None and getattr(self, field) is None:
            alias = to_camel(field)
            raise ValueError(f"status {self.status} requires {alias}")
        return self
