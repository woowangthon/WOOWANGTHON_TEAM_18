import { Meter } from '../components/ui/Meter.tsx'
import { percent, SURVEY_INTEREST, SURVEY_ROWS, SURVEY_SOURCE } from './survey.ts'

// 학생 설문 결과와 우리의 답을 한 줄씩 짝지어 보인다. 막대는 Meter(가로 막대)이고 숫자는 글자로도 적는다.
function Survey() {
  const { yes, maybe, total } = SURVEY_INTEREST
  return (
    <section id="survey" className="border-t border-line">
      <div className="mx-auto grid max-w-300 gap-10 px-4 py-16 sm:px-8 lg:grid-cols-5 lg:gap-16">
        <div className="flex flex-col gap-3 lg:col-span-2">
          <h2 className="text-2xl">학생들에게 물어봤어요</h2>
          <p className="text-lg text-muted">배포가 어려운 이유는 기술만이 아니었어요. 비용, 그 뒤의 관리, 보안이 걱정이었어요.</p>
          <p className="text-sm text-muted">출처: {SURVEY_SOURCE}</p>
        </div>
        <div className="flex flex-col gap-6 lg:col-span-3">
          <ul className="m-0 flex list-none flex-col gap-6 p-0">
            {SURVEY_ROWS.map((r) => (
              <li key={r.id} className="flex flex-col gap-2">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <span className="font-bold">{r.label}</span>
                  <span className="text-sm text-muted">
                    {r.total}명 중 {r.count}명 ({percent(r.count, r.total)}%)
                  </span>
                </div>
                <Meter aria-label={`${r.label}: ${r.total}명 중 ${r.count}명`} value={r.count} max={r.total} />
                <p className="text-sm text-muted">
                  <span className="font-bold text-accent-text">우리의 답</span> · {r.answer}
                </p>
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-2 rounded-md bg-surface p-4">
            <p className="font-bold">이런 서비스가 있다면 쓰겠어요?</p>
            <Meter aria-label={`${total}명 모두 긍정`} value={yes + maybe} max={total} />
            <p className="text-sm text-muted">
              {total}명 모두 긍정이에요 · 사용하고 싶다 {yes}명, 기회가 되면 쓰겠다 {maybe}명
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

export default Survey
