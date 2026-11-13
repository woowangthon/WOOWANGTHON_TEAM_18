// 실제 설문 결과다(샘플 아님). 출처: docs/SRS.md §1.1과 설문 CSV. 화면에는 출처 문구를 함께 보인다.
export const SURVEY_SOURCE = '학과 대상 구글폼 설문 · 2026-10-28~31 · 응답 37명'

export type SurveyRow = { id: string; label: string; count: number; total: number; answer: string }

export const SURVEY_ROWS: SurveyRow[] = [
  { id: 'cost', label: '클라우드 비용이 걱정돼요', count: 29, total: 37, answer: '학교 PC 클러스터에서 실행해서 무료예요.' },
  { id: 'upkeep', label: '유지보수 · 관리가 부담돼요', count: 25, total: 37, answer: '서비스 상태 · 지표와 AI 동료가 운영을 도와요.' },
  { id: 'running', label: '배포해 본 학생 중 지금도 운영 중이에요', count: 7, total: 22, answer: '과목이 끝난 뒤에도 이어 갈 수 있어요.' },
  { id: 'security', label: '보안 취약점 · 데이터 유출이 걱정돼요', count: 16, total: 37, answer: '배포하기 전에 보안 검사를 해요.' },
  { id: 'help', label: '가장 바라는 도움은 비용 관리와 무료 배포 방법이에요', count: 28, total: 37, answer: '무료로 배포하는 방법 자체를 서비스로 만들었어요.' },
]

export const SURVEY_INTEREST = { yes: 26, maybe: 11, total: 37 }

export const percent = (count: number, total: number) => Math.round((count / total) * 100)
