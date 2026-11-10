"""테스트용 티켓 · 결과. 플랫폼 서버가 보내는 모양(AIagent.md §5 · §6)을 그대로 따른다."""

import copy
from typing import Any

SHA = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"


def ticket(**overrides: Any) -> dict[str, Any]:
    t: dict[str, Any] = {
        "ticketId": "t_0013",
        "commitSha": SHA,
        "stage": "apply",
        "service": "be",
        "targetSlot": "b",
        "deployInput": {"commitSha": SHA, "deploy_condition": {}, "spec": {}},
        "errorMessage": 'deployment "be-b" exceeded its progress deadline',
        "raw": {"codebuild": None, "k8s": {"pod": {}, "events": []}},
        "logs": {"from": "2026-11-10T13:02:00Z", "to": "2026-11-10T13:12:00Z", "lines": []},
        "previous": None,
    }
    t.update(copy.deepcopy(overrides))
    return t


def ticket_request(**overrides: Any) -> dict[str, Any]:
    return {
        "ticket": ticket(**overrides),
        "gateway": {"token": "gw_abc", "expiresAt": "2026-11-10T13:27:00Z"},
    }


def result(**overrides: Any) -> dict[str, Any]:
    r: dict[str, Any] = {
        "ticketId": "t_0013",
        "commitSha": SHA,
        "status": "gave_up",
        "classification": {"method": "code", "caseId": "A1", "path": "playbook"},
        "actions": [{"tool": "run_verify", "ok": False}],
        "summary": "포트를 찾지 못함",
    }
    r.update(copy.deepcopy(overrides))
    return r
