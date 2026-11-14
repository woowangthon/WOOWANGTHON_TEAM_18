import { Link } from 'react-router'
import { isAdmin } from '../auth/isAdmin.ts'
import { useAuth } from '../auth/useAuth.ts'
import { primaryLinkClass } from '../components/primaryLinkClass.ts'
import { Card } from '../components/ui/Card.tsx'
import Logo from '../components/Logo.tsx'
import HeroCarousel from '../landing/HeroCarousel.tsx'
import ProjectTypes from '../landing/ProjectTypes.tsx'
import Showcase from '../landing/Showcase.tsx'
import SectionNav from '../landing/SectionNav.tsx'
import SiteFooter from '../components/SiteFooter.tsx'
import Survey from '../landing/Survey.tsx'

const outlineLinkClass =
  'inline-flex h-8 items-center rounded-sm border border-line-strong px-3 text-sm font-bold text-fg hover:border-fg'

const steps = [
  { title: 'GitHub를 연동해요', desc: '프로필에서 한 번만 연동하면 내 공개 레포를 제출할 수 있어요.' },
  { title: '레포를 제출해요', desc: '레포 주소를 넣으면 배포 설정 초안이 채워져요. 서비스 유형은 직접 골라요.' },
  { title: '설정을 확인해요', desc: '초안을 확인하고, 필요하면 비밀값을 넣어요.' },
  { title: '배포하고 주소를 받아요', desc: '진행 상황이 화면에 보이고, 끝나면 접속 주소가 나와요.' },
]

// 공개 첫 화면. 로그인한 사용자도 볼 수 있고, 그때는 로그인 · 시작하기 대신 대시보드로 가는 링크가 보인다(관리자는 /admin). 세션을 읽는 동안에는 아무것도 그리지 않는다.
function LandingPage() {
  const { state } = useAuth()
  if (state.status === 'loading') return null
  const home = state.status === 'signedIn' ? (isAdmin(state.session) ? '/admin' : '/dashboard') : null

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line bg-bg">
        <div className="mx-auto flex min-h-16 max-w-300 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 sm:px-4">
          <Link to="/" className="flex items-center py-2">
            <Logo />
          </Link>
          <div className="flex items-center gap-2 py-2">
            {home ? (
              <Link to={home} className={primaryLinkClass}>
                대시보드로
              </Link>
            ) : (
              <>
                <Link to="/login" className={outlineLinkClass}>
                  로그인
                </Link>
                <Link to="/signup" className={primaryLinkClass}>
                  시작하기
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <SectionNav />

      <main className="flex-1">
        <section className="mx-auto grid max-w-300 items-center gap-10 px-3 py-16 sm:px-4 sm:py-24 lg:grid-cols-2 lg:gap-16">
          <div className="flex flex-col gap-6">
            <h1 className="max-w-2xl text-2xl sm:text-3xl">GitHub 레포 하나로, 학교 PC에 배포까지</h1>
            <p className="max-w-2xl text-lg text-muted">
              공개 레포를 제출하면 학교 PC 클러스터에 배포해 줘요. 배포가 막히면 AI 동료가 원인을
              찾아 고쳐 보고, 끝나면 접속 주소를 받아요.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Link to={home ?? '/signup'} className={primaryLinkClass}>
                {home ? '대시보드로' : '시작하기'}
              </Link>
              <a href="#showcase" className={outlineLinkClass}>
                기능 둘러보기
              </a>
            </div>
            <p className="text-sm text-muted">공개 개인 레포만 지원해요 · GitHub 연동이 필요해요</p>
          </div>
          <HeroCarousel />
        </section>

        <Survey />

        <Showcase />

        <ProjectTypes />

        <section id="how" className="border-t border-line">
          <div className="mx-auto flex max-w-300 flex-col gap-6 px-3 py-16 sm:px-4">
            <h2 className="text-xl">이렇게 배포돼요</h2>
            <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {steps.map((step, index) => (
                <li key={step.title}>
                  <Card className="flex h-full flex-col gap-2 p-6">
                  <span
                    aria-hidden="true"
                    className="flex size-7 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-fg"
                  >
                    {index + 1}
                  </span>
                  <h3 className="font-bold">{step.title}</h3>
                  <p className="text-sm text-muted">{step.desc}</p>
                  </Card>
                </li>
              ))}
            </ol>
          </div>
        </section>


        <section className="border-t border-line bg-surface">
          <div className="mx-auto flex max-w-300 flex-col items-start gap-6 px-3 py-20 sm:px-4">
            <h2 className="max-w-2xl text-2xl sm:text-3xl">첫 배포, 지금 해 보세요</h2>
            <p className="max-w-2xl text-lg text-muted">GitHub 레포 주소만 있으면 돼요. 막히면 AI 동료가 도와줘요.</p>
            <div className="flex flex-wrap items-center gap-3">
              {home ? (
                <Link to={home} className={primaryLinkClass}>
                  대시보드로
                </Link>
              ) : (
                <>
                  <Link to="/signup" className={primaryLinkClass}>
                    시작하기
                  </Link>
                  <Link to="/login" className={outlineLinkClass}>
                    로그인
                  </Link>
                </>
              )}
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  )
}

export default LandingPage
