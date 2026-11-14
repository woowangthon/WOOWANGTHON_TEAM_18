// 줄 단위로 두 글의 차이를 센다(edit_repo_file의 "50줄" 상한, api.md "레포 수정 · 끝내기").
// 바뀐 줄 = 지운 줄 + 넣은 줄(git diff의 +/- 줄 수와 같다): 한 줄을 고치면 2줄이다.

export interface LineDiff {
  added: string[]
  removed: string[]
}

/** 줄 목록. 끝의 줄바꿈은 마지막 줄의 끝이지 빈 줄이 아니다. */
const toLines = (text: string): string[] => (text === '' ? [] : (text.endsWith('\n') ? text.slice(0, -1) : text).split('\n'))

/**
 * `before` → `after`의 최소 편집(Myers O(ND))을 구한다. 지운 줄 + 넣은 줄이 `limit`을 넘으면 null이다.
 * 한도를 걸어 두므로 큰 파일에서도 (줄 수 × limit)로 끝난다.
 */
export function lineDiff(before: string, after: string, limit: number): LineDiff | null {
  const a = toLines(before)
  const b = toLines(after)
  const n = a.length
  const m = b.length
  const max = Math.min(n + m, limit)
  const offset = max + 1
  const v = new Int32Array(2 * max + 3)
  // trace[d] = d번째 단계를 마친 v. 거슬러 올라가며 편집을 읽는다.
  const trace: Int32Array[] = []
  for (let d = 0; d <= max; d++) {
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      v[offset + k] = x
      if (x >= n && y >= m) {
        trace.push(v.slice())
        return backtrack(a, b, trace, d, offset)
      }
    }
    trace.push(v.slice())
  }
  return null
}

function backtrack(a: string[], b: string[], trace: Int32Array[], last: number, offset: number): LineDiff {
  const added: string[] = []
  const removed: string[] = []
  let x = a.length
  let y = b.length
  for (let d = last; d > 0; d--) {
    const prev = trace[d - 1]
    const k = x - y
    const prevK = k === -d || (k !== d && prev[offset + k - 1] < prev[offset + k + 1]) ? k + 1 : k - 1
    const prevX = prev[offset + prevK]
    const prevY = prevX - prevK
    // 같은 줄(대각선)을 건너 편집이 있던 자리까지.
    while (x > prevX && y > prevY) {
      x--
      y--
    }
    if (x === prevX) added.push(b[prevY])
    else removed.push(a[prevX])
    x = prevX
    y = prevY
  }
  return { added: added.reverse(), removed: removed.reverse() }
}
