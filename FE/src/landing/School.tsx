import { Card } from '../components/ui/Card.tsx'
import { Meter } from '../components/ui/Meter.tsx'
import { CLASSROOM_ROWS, CLASSROOM_SOURCE, PC_SPEC } from './school.ts'
import { percent } from './survey.ts'

const OFFER = [
  { title: '학교가 준비하는 것', desc: '수업이 없는 시간의 PC와 유선 랜이에요. 학교망에 들어오는 포트는 열지 않아도 돼요.' },
  { title: 'WCP가 맡는 것', desc: '레포 빌드와 배포, 막히면 고치는 AI 동료, 운영 알림과 강제 중지를 맡아요.' },
  { title: '학생이 얻는 것', desc: '비용 걱정 없이 배포하고, 과목이 끝나도 서비스를 계속 운영해요.' },
]

// 학교에 하는 제안. 강의실 PC가 비어 있는 시간과 학교 PC의 사양을 근거로, 그 시간에 학생 클라우드를 제공하자고 말한다.
// 숫자는 school.ts(출처 문서는 그 파일의 주석). 24시간 기준이 이론치라는 점을 화면에 함께 적는다.
function School() {
  return (
    <section id="school" className="border-t border-line">
      <div className="mx-auto flex max-w-300 flex-col gap-10 px-3 py-16 sm:px-4">
        <div className="grid gap-10 lg:grid-cols-5 lg:gap-16">
          <div className="flex flex-col gap-3 lg:col-span-2">
            <p className="text-sm font-bold text-accent-text">학교에 제안해요</p>
            <h2 className="text-2xl">강의실 PC가 쉬는 시간, 학생의 클라우드로</h2>
            <p className="text-lg text-muted">
              PC가 있는 강의실은 평일 24시간 중 90%가 비어 있어요. 그 시간에 WCP를 돌리면 학교가 학생에게 클라우드를 줄 수
              있어요.
            </p>
            <p className="text-sm text-muted">출처: {CLASSROOM_SOURCE}</p>
            <p className="text-sm text-muted">
              수업 시간표만 센 이론치예요. 건물 개방 시간과 PC 전원은 학교와 함께 정해야 해요.
            </p>
          </div>
          <div className="flex flex-col gap-6 lg:col-span-3">
            <ul className="m-0 flex list-none flex-col gap-6 p-0">
              {CLASSROOM_ROWS.map((r) => (
                <li key={r.id} className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                    <span className="font-bold">{r.label} 비어 있는 시간</span>
                    <span className="text-sm text-muted">
                      주 {r.total}시간 중 수업 {r.used}시간 · 비어 있음 {percent(r.total - r.used, r.total)}%
                    </span>
                  </div>
                  <Meter
                    aria-label={`${r.label}: 주 ${r.total}시간 중 ${r.total - r.used}시간 비어 있음`}
                    value={r.total - r.used}
                    max={r.total}
                  />
                </li>
              ))}
            </ul>
            <Card className="flex flex-col gap-3 p-6">
              <h3 className="font-bold">학교 PC, 성능도 충분해요</h3>
              <dl className="m-0 flex flex-col gap-1 text-sm">
                {PC_SPEC.map((s) => (
                  <div key={s.label} className="flex gap-3">
                    <dt className="w-16 shrink-0 text-muted">{s.label}</dt>
                    <dd className="m-0 font-mono">{s.value}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-sm text-muted">
                학교에서 빌린 PC 3대의 사양이에요. 지금 이 3대를 동아리방에서 24시간 켜 두고 학생 서비스를 돌리고 있어요.
              </p>
            </Card>
          </div>
        </div>
        <ul className="m-0 grid list-none gap-4 p-0 md:grid-cols-3">
          {OFFER.map((o) => (
            <li key={o.title}>
              <Card className="flex h-full flex-col gap-2 p-6">
                <h3 className="font-bold">{o.title}</h3>
                <p className="text-sm text-muted">{o.desc}</p>
              </Card>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

export default School
