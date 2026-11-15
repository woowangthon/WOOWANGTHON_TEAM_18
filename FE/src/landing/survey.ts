// 실제 설문 결과다(샘플 아님). 출처: docs/SRS.md §1.1과 설문 CSV. 화면에는 출처 문구를 함께 보인다.
export const SURVEY_SOURCE = '소프트웨어학부 대상 구글폼 설문 · 2026-10-28~11-01 · 응답 37명'

export type SurveyRow = { id: string; label: string; count: number; total: number }

export const SURVEY_ROWS: SurveyRow[] = [
  { id: 'cost', label: '클라우드 비용이 걱정돼요', count: 29, total: 37 },
  { id: 'upkeep', label: '유지보수 · 관리가 부담돼요', count: 25, total: 37 },
  { id: 'running', label: '배포해 본 학생 중 지금도 운영 중이에요', count: 7, total: 22 },
  { id: 'security', label: '보안 취약점 · 데이터 유출이 걱정돼요', count: 16, total: 37 },
  { id: 'help', label: '가장 바라는 도움은 비용 관리와 무료 배포 방법이에요', count: 28, total: 37 },
]

export const percent = (count: number, total: number) => Math.round((count / total) * 100)
