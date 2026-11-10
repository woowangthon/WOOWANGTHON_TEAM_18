"""장기 메모리: case와 코드 분류(§8). case 데이터는 cases.json."""

import json
import re
from pathlib import Path
from typing import Annotated, Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, field_validator, model_validator

from ai_server.agent.models import Stage, Ticket, Wire

CASES_FILE = Path(__file__).with_name("cases.json")

_SEGMENT = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)((?:\[(?:\*|[0-9]+)\])*)$")
_INDEX = re.compile(r"\[(\*|[0-9]+)\]")


def select(doc: Any, path: str) -> list[Any]:
    """`raw.k8s.events[*].reason` 같은 경로가 가리키는 값을 모두 돌려준다. 없는 칸은 빈 목록이다."""
    values = [doc]
    for segment in path.split("."):
        m = _SEGMENT.match(segment)
        if m is None:
            raise ValueError(f"bad path segment {segment!r} in {path!r}")
        key, indexes = m.group(1), m.group(2)
        values = [v[key] for v in values if isinstance(v, dict) and key in v]
        for index in _INDEX.findall(indexes):
            if index == "*":
                values = [item for v in values if isinstance(v, list) for item in v]
            else:
                i = int(index)
                values = [v[i] for v in values if isinstance(v, list) and i < len(v)]
    return values


class _Cond(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PathCond(_Cond):
    """경로가 가리키는 값 하나라도 조건에 맞으면 참이다."""

    path: str
    equals: Any = None
    not_equals: Any = Field(default=None, alias="notEquals")
    regex: str | None = None

    @field_validator("path")
    @classmethod
    def _path_parses(cls, v: str) -> str:
        select({}, v)
        return v

    @field_validator("regex")
    @classmethod
    def _regex_compiles(cls, v: str | None) -> str | None:
        if v is not None:
            try:
                re.compile(v)
            except re.error as e:  # ValueError가 아니라 pydantic이 검증 오류로 바꾸지 않는다
                raise ValueError(f"bad regex {v!r}: {e}") from None
        return v

    @model_validator(mode="after")
    def _one_test(self) -> Self:
        tests = [t for t in ("equals", "not_equals", "regex") if t in self.model_fields_set]
        if len(tests) != 1:
            raise ValueError(f"condition on {self.path} needs exactly one test, got {tests}")
        return self

    def holds(self, doc: Any) -> bool:
        for value in select(doc, self.path):
            if "equals" in self.model_fields_set:
                if value == self.equals:
                    return True
            elif "not_equals" in self.model_fields_set:
                if value != self.not_equals:
                    return True
            elif isinstance(value, str) and re.search(self.regex or "", value):
                return True
        return False


class AllCond(_Cond):
    all: list["Cond"] = Field(min_length=1)

    def holds(self, doc: Any) -> bool:
        return all(c.holds(doc) for c in self.all)


class AnyCond(_Cond):
    any: list["Cond"] = Field(min_length=1)

    def holds(self, doc: Any) -> bool:
        return any(c.holds(doc) for c in self.any)


Cond = PathCond | AllCond | AnyCond


class PlaybookStep(Wire):
    tool: str
    # 어떤 때 이 단계를 하는지 에이전트에게 주는 설명. 코드가 판정하지 않는다.
    when: str | None = None
    args: dict[str, Any] = Field(default_factory=dict)


class CaseStats(Wire):
    hits: int = 0
    solved: int = 0


class Case(Wire):
    case_id: Annotated[str, Field(pattern=r"^[A-Z][0-9]+$")]
    stage: Stage
    category: Literal["spec", "repo", "user"]
    title: str
    match: Cond
    playbook: list[PlaybookStep] = Field(min_length=1)
    stats: CaseStats = Field(default_factory=CaseStats)


_CASES = TypeAdapter(list[Case])


def load_cases(path: Path = CASES_FILE) -> list[Case]:
    cases = _CASES.validate_python(json.loads(path.read_text(encoding="utf-8")))
    ids = [c.case_id for c in cases]
    if len(ids) != len(set(ids)):
        raise ValueError("duplicate caseId in cases")
    return cases


class CaseMemory:
    """case 목록과 통계.

    simple: 통계는 메모리에만 있어 재시작하면 0부터다 — 데모에는 충분하다.
    """

    def __init__(self, cases: list[Case]) -> None:
        self.cases = cases
        self._by_id = {c.case_id: c for c in cases}

    def get(self, case_id: str) -> Case | None:
        return self._by_id.get(case_id)

    def classify(self, ticket: Ticket) -> Case | None:
        """① 코드 분류: 같은 단계의 case를 파일 순서대로 대조해 처음 맞는 것.

        맞으면 hits를 올린다. 더 좁은 case(OOMKilled)를 넓은 case(CrashLoopBackOff) 앞에 둔다.
        """
        doc = ticket.model_dump(mode="json", by_alias=True)
        for case in self.cases:
            if case.stage == ticket.stage and case.match.holds(doc):
                case.stats.hits += 1
                return case
        return None

    def record_solved(self, case_id: str) -> None:
        case = self._by_id.get(case_id)
        if case is not None:
            case.stats.solved += 1
