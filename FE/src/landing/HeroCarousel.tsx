import { useEffect, useState } from 'react'
import { Card } from '../components/ui/Card.tsx'
import { SLIDES } from './HeroSlides.tsx'

export const CAROUSEL_MS = 5000

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

// 배포 흐름 4단계를 한 장씩 보이는 캐러셀. 5초마다 넘어가고, 마우스를 올리거나 안에 포커스가 있는 동안, 사용자가 멈춘 동안에는 넘기지 않는다.
// 모션을 줄인 환경에서는 처음부터 자동으로 넘기지 않는다.
function HeroCarousel() {
  const [index, setIndex] = useState(0)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [playing, setPlaying] = useState(() => !prefersReducedMotion())

  useEffect(() => {
    if (!playing || hovered || focused) return
    const id = window.setInterval(() => setIndex((i) => (i + 1) % SLIDES.length), CAROUSEL_MS)
    return () => window.clearInterval(id)
  }, [playing, hovered, focused])

  const slide = SLIDES[index]
  return (
    <div
      role="group"
      aria-roledescription="캐러셀"
      aria-label="배포 흐름 4단계"
      // 터치는 손을 떼도 pointerleave가 오지 않는 환경이 있어 마우스일 때만 멈춘다.
      onPointerEnter={(e) => setHovered(e.pointerType === 'mouse')}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false)
      }}
    >
      <Card className="flex flex-col gap-4 overflow-hidden p-0">
        <div className="border-b border-line">{slide.art}</div>
        <div className="flex flex-col gap-1 px-4" aria-live="polite" aria-atomic="true">
          <p className="text-sm text-muted">
            {index + 1} / {SLIDES.length}
          </p>
          <p className="font-bold">{slide.title}</p>
          <p className="text-sm text-muted">{slide.desc}</p>
        </div>
        <div className="flex items-center justify-between gap-2 px-4 pb-4">
          <div className="flex items-center">
            {SLIDES.map((s, i) => (
              <button
                key={s.title}
                type="button"
                aria-label={`${i + 1}단계 보기: ${s.title}`}
                aria-current={i === index ? 'true' : undefined}
                onClick={() => setIndex(i)}
                className="group flex h-8 w-6 items-center justify-center"
              >
                <span
                  className={`h-2 rounded-full ${i === index ? 'w-5 bg-accent-ui' : 'w-2 bg-line-strong group-hover:bg-fg'}`}
                />
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            className="h-8 rounded-sm px-2 text-sm font-bold text-muted hover:text-fg"
          >
            {playing ? '자동 넘김 멈추기' : '자동 넘김 켜기'}
          </button>
        </div>
      </Card>
    </div>
  )
}

export default HeroCarousel
