/** UUID 모양(버전 · 대소문자 무관). 경로의 id를 DB 질의에 넣기 전에 거른다. */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 경로의 id가 UUID면 소문자로 맞춰 돌려주고, 아니면 undefined(호출한 쪽이 404로 답한다). */
export function parseUuid(id: string): string | undefined {
  return UUID.test(id) ? id.toLowerCase() : undefined
}
