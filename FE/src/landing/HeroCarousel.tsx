import { useEffect, useRef, useState } from 'react'
import { Card } from '../components/ui/Card.tsx'
import { ChevronLeftIcon, ChevronRightIcon, PauseIcon, PlayIcon } from '../components/ui/Icons.tsx'
import { SLIDES } from './HeroSlides.tsx'

export const CAROUSEL_MS = 6500

// 이만큼(px) 넘게 끌어야 넘김으로 본다. 그보다 짧은 움직임은 누르기나 떨림이다.
const SWIPE_PX = 40

const sideButton =
  'absolute top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full border border-line-strong bg-bg/90 text-fg hover:border-fg'

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

// 배포 흐름 4단계를 한 장씩 보이는 캐러셀. 6.5초마다 넘어가고, 좌우 화살표나 끌어서(스와이프) 넘길 수 있고, 마우스를 올리거나 안에 포커스가 있는 동안, 사용자가 멈춘 동안에는 넘기지 않는다.
// 모션을 줄인 환경에서는 처음부터 자동으로 넘기지 않는다.
function HeroCarousel() {
  const [index, setIndex] = useState(0)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [playing, setPlaying] = useState(() => !prefersReducedMotion())
  const dragFrom = useRef<number | null>(null)
  const go = (step: number) => setIndex((i) => (i + step + SLIDES.length) % SLIDES.length)

  useEffect(() => {
    if (!playing || hovered || focused) return
    // 직접 넘긴 뒤에는 그 장을 CAROUSEL_MS만큼 보이도록 index가 바뀔 때마다 다시 센다.
    const id = window.setInterval(() => go(1), CAROUSEL_MS)
    return () => window.clearInterval(id)
  }, [playing, hovered, focused, index])

  const slide = SLIDES[index]
  const toggleLabel = playing ? '자동 넘김 멈추기' : '자동 넘김 켜기'
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
        <div
          className="relative touch-pan-y border-b border-line select-none"
          onPointerDown={(e) => {
            // 화살표 버튼에서 시작한 누름은 끌기가 아니다. 포인터를 붙잡으면 버튼이 click을 못 받는다.
            if ((e.target as Element).closest('button')) return
            dragFrom.current = e.clientX
            e.currentTarget.setPointerCapture?.(e.pointerId)
          }}
          onPointerUp={(e) => {
            const from = dragFrom.current
            dragFrom.current = null
            if (from === null) return
            const moved = e.clientX - from
            if (Math.abs(moved) >= SWIPE_PX) go(moved < 0 ? 1 : -1)
          }}
          onPointerCancel={() => {
            dragFrom.current = null
          }}
        >
          {slide.art}
          <button type="button" aria-label="이전 단계" onClick={() => go(-1)} className={`${sideButton} left-2`}>
            <ChevronLeftIcon width={16} height={16} />
          </button>
          <button type="button" aria-label="다음 단계" onClick={() => go(1)} className={`${sideButton} right-2`}>
            <ChevronRightIcon width={16} height={16} />
          </button>
        </div>
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
            aria-label={toggleLabel}
            title={toggleLabel}
            onClick={() => setPlaying((p) => !p)}
            className="flex size-8 items-center justify-center rounded-sm text-muted hover:text-fg"
          >
            {playing ? <PauseIcon width={16} height={16} /> : <PlayIcon width={16} height={16} />}
          </button>
        </div>
      </Card>
    </div>
  )
}

export default HeroCarousel
