import type { ReactNode } from 'react'
import { AdminPreview, AgentPreview, MetricsPreview, SecurityPreview, SlotsPreview } from './Previews.tsx'

type Feature = { id: string; title: string; lead: string; points: string[]; preview: ReactNode }

const FEATURES: Feature[] = [
  {
    id: 'agent',
    title: '막히면 AI 동료가 이어서 해요',
    lead: '준비 확인이 실패하면 AI가 로그에서 원인을 찾고, 새 슬롯의 설정을 고친 뒤 다시 확인해요. 통과하면 주소를 바꾸고, 무엇을 왜 바꿨는지 화면에 남겨요.',
    points: ['데모 레포에서 실제로 보인 경우예요. 앱은 3000번 포트인데 설정은 8080이었어요.', '내가 해야 할 일이 있으면 그렇다고 알려 줘요.', '못 고치면 해결하지 못했다고 솔직히 말해요.'],
    preview: <AgentPreview />,
  },
  {
    id: 'security',
    title: '올라가기 전에 위험한 것을 알려 줘요',
    lead: '레포에 비밀값이나 .env 파일이 올라가 있는지, 쓰는 라이브러리에 알려진 취약점이 있는지 검사해요. 찾으면 무엇을 어떻게 고칠지 한국어로 알려 줘요.',
    points: ['비밀값은 gitleaks로, 의존성은 Trivy로 살펴봐요.', '찾은 문제가 없으면 없다고 말해요.'],
    preview: <SecurityPreview />,
  },
  {
    id: 'slots',
    title: '서비스가 끊기지 않게 바꿔요',
    lead: '새 버전은 비어 있는 슬롯에 먼저 올려요. 준비 확인을 통과한 뒤에야 공개 주소가 새 슬롯으로 옮겨 가요. 실패한 배포는 공개 주소를 건드리지 않아요.',
    points: ['슬롯 A와 B를 번갈아 써요.', '이전 버전은 새 버전이 통과할 때까지 그대로 서비스해요.'],
    preview: <SlotsPreview />,
  },
  {
    id: 'metrics',
    title: '배포한 뒤에도 잘 도는지 봐요',
    lead: '서비스마다 실행 상태, 다시 시작된 횟수, 지금 쓰는 CPU와 메모리를 보여 주고 최근 1시간 그래프를 그려요. 아직 모으지 못한 값은 0으로 꾸미지 않고 그렇다고 말해요.',
    points: ['15초마다 새로 읽어요.', '계속 꺼지는 서비스는 이유를 쉬운 말로 알려 줘요.'],
    preview: <MetricsPreview />,
  },
  {
    id: 'admin',
    title: '운영자는 클러스터를 한눈에 봐요',
    lead: '운영자 화면에서 노드마다 CPU와 메모리 사용량을 막대로 보고, 서비스 목록에서 문제 있는 서비스를 강제로 멈출 수 있어요.',
    points: ['노드 상태와 용량을 한곳에서 봐요.', '프로젝트별 서비스 사용량과 다시 시작 횟수를 봐요.'],
    preview: <AdminPreview />,
  },
]

// "무엇을 만들었나" 소개. 기능마다 짧은 설명과, 실제 화면의 컴포넌트에 예시 데이터를 넣은 미리보기를 둔다. 좌우를 번갈아 놓는다.
function Showcase() {
  return (
    <section id="showcase" className="border-t border-line">
      <div className="mx-auto flex max-w-300 flex-col gap-16 px-4 py-16 sm:px-8">
        <div className="flex max-w-2xl flex-col gap-3">
          <h2 className="text-2xl">처음이라 어려운 배포, AI 동료가 도와줘요</h2>
          <p className="text-lg text-muted">아래 화면은 모두 예시 데이터로 그린 것이에요. 모양과 흐름은 실제 서비스와 같아요.</p>
        </div>
        {FEATURES.map((f, i) => (
          <article key={f.id} aria-labelledby={`feature-${f.id}`} className="grid items-start gap-8 lg:grid-cols-2 lg:gap-16">
            <div className={`flex min-w-0 flex-col gap-4 lg:sticky lg:top-8 ${i % 2 === 1 ? 'lg:order-2' : ''}`}>
              <h3 id={`feature-${f.id}`} className="text-xl">
                {f.title}
              </h3>
              <p className="text-lg text-muted">{f.lead}</p>
              <ul className="m-0 flex list-disc flex-col gap-2 pl-5 text-muted marker:text-accent-ui">
                {f.points.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
            <div className="min-w-0">{f.preview}</div>
          </article>
        ))}
      </div>
    </section>
  )
}

export default Showcase
