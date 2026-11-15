// 이 브라우저에만 남기는 "닫은 · 숨긴" 알림 id 목록(학생 배너와 운영자 알림이 키만 달리 쓴다).
// 저장소를 못 쓰면(비공개 창 등) 이번 화면에서만 닫힌 채로 둔다.
const KEEP = 100

export const readClosed = (key: string): string[] => {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

const saveClosed = (key: string, ids: string[]) => {
  try {
    localStorage.setItem(key, JSON.stringify(ids.slice(-KEEP)))
  } catch {
    // 저장하지 못해도 이번 화면에서는 닫혀 있다.
  }
}

// 저장소의 순서(가장 최근 상태)를 따르고, 이 화면에만 남은 id(다른 탭이 100개를 넘겨 밀어낸 오래된 것)는 앞에 둔다.
// 그래야 마지막 100개를 고를 때 오래된 id가 더 최근 id를 밀어내지 않는다.
function merged(key: string, current: string[]): string[] {
  const stored = readClosed(key)
  return [...current.filter((x) => !stored.includes(x)), ...stored]
}

// id 하나를 더해 저장하고 새 목록을 돌려준다. 다른 탭이 그 사이 저장한 것도 합친다(덮어쓰지 않게). 이번 id는 맨 뒤(가장 최근).
export function addClosed(key: string, current: string[], id: string): string[] {
  const next = [...new Set([...merged(key, current).filter((x) => x !== id), id])].slice(-KEEP)
  saveClosed(key, next)
  return next
}

// id 하나를 빼고 저장한다(다시 보이게). 다른 탭이 저장한 것은 남긴다.
export function removeClosed(key: string, current: string[], id: string): string[] {
  const next = [...new Set(merged(key, current))].filter((x) => x !== id)
  saveClosed(key, next)
  return next
}
