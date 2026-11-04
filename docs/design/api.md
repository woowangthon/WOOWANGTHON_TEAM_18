# API 계약

- **상태**: 초안
- **관련**: SRS [§2.4 인터페이스](../SRS.md#24-인터페이스)

FE·BE·AI가 서로를 기다리지 않도록 **요청·응답 모양을 먼저 고정**한다. API를 바꾸기 전에 이 문서를 먼저 고치고, 같은 PR에 코드 변경을 싣는다. 그룹 단위 구성은 SRS §2.4, 공통 규칙(오류 응답, 시간 형식)도 거기 있다. 엔드포인트에 따로 적지 않은 오류의 `code`는 HTTP 상태 이름(`NOT_FOUND`, `BAD_REQUEST` 등)이고, 예상하지 못한 서버 오류는 내용을 숨긴 `500 INTERNAL_ERROR`다.

## 인증 (SRS §2.4)

헬스 체크(`GET /api/health`)를 뺀 모든 API는 `Authorization: Bearer <access token>` 헤더가 있어야 한다. 토큰은 FE가 로그인해서 받은 것이고, 검증 방법은 [`auth.md`](auth.md)에 있다. 헤더가 없거나 토큰이 틀리면 어느 API든 아래 `401`을 받는다.

### `GET /api/me` — 로그인한 사용자 (NFR-SEC-03)

요청: 본문 없음 (헤더만).

응답 `200`:

```json
{ "id": "0b6f0c1e-4a52-4d8e-9a1b-3f7d2c5e8a90", "email": "student@example.com", "isAdmin": false }
```

오류: `401 AUTH_REQUIRED` 헤더가 없거나 `Bearer` 형식이 아님 / `401 INVALID_TOKEN` 서명 · 만료 · 발급자 등 검증 실패 / `503 AUTH_UNAVAILABLE` 인증 서버의 공개 키를 받지 못함 — 오류 응답 모양은 SRS §2.4.

## <그룹명> (SRS §2.4)

### `METHOD /path` — 한 줄 설명 (FR-NNN)

요청:

```json
{}
```

응답 `200`:

```json
{}
```

오류: `400` 입력 오류 / `502` AI 호출 실패 — 오류 응답 모양은 SRS §2.4.

<!-- 엔드포인트마다 위 블록을 복사 -->
