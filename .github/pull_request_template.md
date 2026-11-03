<!-- 한국어로 작성합니다. 섹션 제목은 영어로 두고 내용만 한국어로 씁니다. -->

## Summary

<!-- 무엇을 바꿨는지 한두 문장. -->

## Why

<!-- SRS의 FR-NNN 또는 tasks/active/의 todo 파일 링크. 결정이 있었다면 ADR 링크. -->

## Linked Issues

Fixes #

## Author checklist

- [ ] 기존 이슈와 PR을 검색해 중복이 아님을 확인했다.
- [ ] diff를 한 줄씩 읽었고, 각 변경이 왜 필요한지 설명할 수 있다.
- [ ] `docs/conventions.md`를 따랐다. 어긴 부분은 위 *Why*에 이유를 적었다.
- [ ] AI 도구의 도움을 받았다면 아래 *Notes for Reviewers*에 어느 부분인지 적었다.

## Scope changes

- [ ] AI 모델·외부 API·라이브러리·데이터셋을 추가·교체·제거했다 → `docs/ai-scope.md` 갱신
- [ ] `MOCK(...)` / `SAMPLE(...)` 표식을 추가·제거했다 → `docs/ai-scope.md` 갱신
- [ ] FE/BE/AI 사이의 API를 바꿨다 → `docs/design/api.md` 갱신
- [ ] 요구사항이나 결정이 바뀌었다 → `docs/SRS.md` 또는 ADR 갱신
- [ ] 해당 없음

## Verification

- [ ] 바뀐 동작의 테스트를 추가했고 통과한다
- [ ] 바뀐 코드에 뮤테이션 테스트를 돌렸다. 살아남은 mutant는 테스트로 막았거나 아래에 이유를 적었다
- [ ] `/code-review`와 `/simplify`를 돌렸다 (생략했다면 아래에 이유를 적는다)
- [ ] UI나 흐름이 바뀌었다면 데모 경로를 직접 확인했다

살아남은 mutant / 생략한 단계와 이유:

## Risk Assessment

- 사용자에게 미치는 위험:
- 데이터·보안 위험:
- 되돌리는 방법:

## Notes for Reviewers

- UI 변경 (해당하면 스크린샷·GIF):
- 알려진 한계 (블로킹이 아니어서 그대로 둔 리뷰 지적):
- 후속 작업 (있다면):
