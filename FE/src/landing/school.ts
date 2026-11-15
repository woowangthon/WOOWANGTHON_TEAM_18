// 실제 값이다(샘플 아님). 화면에는 출처와 읽을 때 주의를 함께 보인다.
// 강의실 사용 시간: docs/classroom-usage.md (PC가 있는 강의실 4곳의 수업 시간표, 팀 집계). 평일 5일 × 24시간 × 4곳 = 480시간.
// PC 사양: docs/system-definition.md "장소 · 가동"의 PC 사양 행 (2026-11-03 확인, 학교에서 빌린 클러스터 PC 3대).
export const CLASSROOM_SOURCE = 'PC가 있는 강의실 4곳의 수업 시간표 · 2026-1 · 2026-2학기 · 평일 24시간 기준'

export type ClassroomRow = { id: string; label: string; used: number; total: number }

export const CLASSROOM_ROWS: ClassroomRow[] = [
  { id: '2026-2', label: '2026-2학기', used: 46, total: 480 },
  { id: '2026-1', label: '2026-1학기', used: 46, total: 480 },
]

export const PC_SPEC = [
  { label: 'CPU', value: 'Intel i7-13700K (16코어 24스레드)' },
  { label: '메모리', value: '125GiB' },
  { label: 'GPU', value: 'RTX 3080' },
  { label: '저장 장치', value: 'NVMe 약 876GB' },
]
