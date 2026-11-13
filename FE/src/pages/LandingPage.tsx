import { Link, Navigate } from 'react-router'
import { useAuth } from '../auth/useAuth.ts'
import { primaryLinkClass } from '../components/primaryLinkClass.ts'
import { Card } from '../components/ui/Card.tsx'
import { Table, Td, Th, THead } from '../components/ui/Table.tsx'

const outlineLinkClass =
  'inline-flex h-8 items-center rounded-sm border border-line-strong px-3 text-sm font-bold text-fg hover:border-fg'

const steps = [
  { title: 'GitHub를 연동해요', desc: '프로필에서 한 번만 연동하면 내 공개 레포를 제출할 수 있어요.' },
  { title: '레포를 제출해요', desc: '레포 주소를 넣으면 배포 설정 초안이 채워져요. 서비스 유형은 직접 골라요.' },
  { title: '설정을 확인해요', desc: '초안을 확인하고, 필요하면 비밀값을 넣어요.' },
  { title: '배포하고 주소를 받아요', desc: '진행 상황이 화면에 보이고, 끝나면 접속 주소가 나와요.' },
]

const features = [
  { title: '학교 PC에 무료로', desc: '클라우드 비용 없이 과목이 끝난 뒤에도 서비스를 이어 갈 수 있어요.' },
  { title: '막히면 AI 동료가', desc: '빌드나 배포가 실패하면 AI가 원인을 찾아 고쳐 보고 결과를 알려 줘요.' },
  { title: '한 화면에서', desc: '배포 진행 상황과 내 배포 목록을 한곳에서 확인해요.' },
]

// 공개 첫 화면. 로그인한 사용자는 대시보드로 보낸다. 세션을 읽는 동안에는 아무것도 그리지 않는다.
function LandingPage() {
  const { state } = useAuth()
  if (state.status === 'loading') return null
  if (state.status === 'signedIn') return <Navigate to="/dashboard" replace />

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line bg-bg">
        <div className="mx-auto flex min-h-16 max-w-300 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 sm:px-8">
          <div className="flex flex-wrap items-center gap-x-6">
            <Link to="/" className="flex items-center py-2">
              {/* 임시: 로고가 흰 배경이라 다크에서는 밝은 칩 위에 올린다. 투명 배경 로고가 생기면 칩을 뺀다. */}
              <img
                src="/logo.svg"
                alt="WCP"
                className="size-10 rounded-md object-contain dark:bg-fg dark:p-0.5"
              />
            </Link>
            <nav aria-label="페이지 바로가기" className="flex gap-4 text-sm text-muted">
              <a href="#types" className="py-2 hover:text-fg">
                지원 범위
              </a>
              <a href="#how" className="py-2 hover:text-fg">
                사용 방법
              </a>
              <a href="#features" className="py-2 hover:text-fg">
                기능
              </a>
            </nav>
          </div>
          <div className="flex items-center gap-2 py-2">
            <Link to="/login" className={outlineLinkClass}>
              로그인
            </Link>
            <Link to="/signup" className={primaryLinkClass}>
              시작하기
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto flex max-w-300 flex-col gap-6 px-4 py-16 sm:px-8 sm:py-24">
          <h1 className="max-w-2xl text-2xl">GitHub 레포 하나로, 학교 PC에 배포까지</h1>
          <p className="max-w-2xl text-lg text-muted">
            공개 레포를 제출하면 학교 PC 클러스터에 배포해 줘요. 배포가 막히면 AI 동료가 원인을
            찾아 고쳐 보고, 끝나면 접속 주소를 받아요.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link to="/signup" className={primaryLinkClass}>
              시작하기
            </Link>
            <a href="#how" className={outlineLinkClass}>
              사용 방법 보기
            </a>
          </div>
          <p className="text-sm text-muted">공개 개인 레포만 지원해요 · GitHub 연동이 필요해요</p>
        </section>

        <section id="types" className="border-t border-line">
          <div className="mx-auto flex max-w-300 flex-col gap-4 px-4 py-12 sm:px-8">
            <h2 className="text-xl">어떤 프로젝트를 올릴 수 있나요</h2>
            <p className="text-muted">서비스 유형은 레포를 제출할 때 직접 골라요.</p>
            <Table aria-label="지원하는 서비스 유형">
              <THead>
                <tr>
                  <Th>유형</Th>
                  <Th>받는 것</Th>
                </tr>
              </THead>
              <tbody>
                <tr>
                  <Td>정적 웹</Td>
                  <Td>웹 주소</Td>
                </tr>
                <tr>
                  <Td>서버</Td>
                  <Td>API 주소</Td>
                </tr>
                <tr>
                  <Td>웹 + 서버</Td>
                  <Td>웹 주소와 API 경로</Td>
                </tr>
              </tbody>
            </Table>
          </div>
        </section>

        <section id="how" className="border-t border-line">
          <div className="mx-auto flex max-w-300 flex-col gap-6 px-4 py-12 sm:px-8">
            <h2 className="text-xl">이렇게 배포돼요</h2>
            <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {steps.map((step, index) => (
                <li key={step.title} className="flex flex-col gap-2">
                  <span
                    aria-hidden="true"
                    className="flex size-7 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-fg"
                  >
                    {index + 1}
                  </span>
                  <h3 className="font-bold">{step.title}</h3>
                  <p className="text-sm text-muted">{step.desc}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="features" className="border-t border-line">
          <div className="mx-auto flex max-w-300 flex-col gap-6 px-4 py-12 sm:px-8">
            <h2 className="text-xl">배포 전에도, 배포 후에도</h2>
            <ul className="grid gap-4 sm:grid-cols-3">
              {features.map((feature) => (
                <li key={feature.title}>
                  <Card className="flex h-full flex-col gap-2 p-6">
                    <h3 className="font-bold">{feature.title}</h3>
                    <p className="text-sm text-muted">{feature.desc}</p>
                  </Card>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto max-w-300 px-4 py-6 text-sm text-muted sm:px-8">
          2026 AI 우왕톤 · 왕가네식구들
        </div>
      </footer>
    </div>
  )
}

export default LandingPage
