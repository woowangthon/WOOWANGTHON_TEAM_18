export interface RepoRef {
  owner: string
  repo: string
}

// GitHub에 그대로 붙여 쓰는 값이라 경로를 바꿀 수 있는 글자(/ % ? # 등)를 막는 데 목적이 있다.
// 실제로 있는 이름인지는 GitHub가 판단한다.
const OWNER = /^[A-Za-z0-9-]{1,39}$/
const REPO = /^[A-Za-z0-9._-]{1,100}$/

/** `https://github.com/<소유자>/<레포>`(끝의 `.git` · `/`는 허용)만 받는다. 그 밖의 모든 입력은 null이다. */
export function parseRepoUrl(input: unknown): RepoRef | null {
  if (typeof input !== 'string') return null
  const url = URL.parse(input)
  if (!url || url.protocol !== 'https:' || url.hostname !== 'github.com') return null
  if (url.username || url.password || url.port || url.search || url.hash) return null

  const parts = url.pathname.replace(/\/$/, '').split('/')
  if (parts.length !== 3) return null
  const owner = parts[1]
  const repo = parts[2].replace(/\.git$/, '')
  if (!OWNER.test(owner) || !REPO.test(repo) || repo === '.' || repo === '..') return null
  return { owner, repo }
}
