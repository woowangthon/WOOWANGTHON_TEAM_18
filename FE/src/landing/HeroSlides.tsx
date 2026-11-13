import { Address, Checks, Cluster, Repo } from './HeroIllustrations.tsx'

// 히어로 캐러셀의 4단계. 실제 제품이 오늘 하는 일만 적는다(승인 단계는 없다).
export const SLIDES = [
  { title: '레포를 내면 설정 초안이 채워져요', desc: '읽은 값에는 출처가 붙고, 읽지 못한 값은 확인 필요로 표시돼요.', art: <Repo /> },
  { title: '빌드하고 보안을 검사해요', desc: '이미지를 빌드하고, 비밀값과 의존성 취약점을 살펴봐요.', art: <Checks /> },
  { title: '학교 PC 클러스터에서 실행돼요', desc: '클라우드 비용 없이 과목이 끝난 뒤에도 이어 갈 수 있어요.', art: <Cluster /> },
  { title: '접속 주소를 받고, 막히면 AI 동료가 도와요', desc: '실패하면 AI가 원인을 찾아 고치고 바꾼 내용을 알려 줘요.', art: <Address /> },
]
