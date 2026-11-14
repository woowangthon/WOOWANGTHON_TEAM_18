import type { SVGProps } from 'react'

// 상태 기호. 글자(✓ !)는 글꼴에 따라 모양이 달라져 작은 SVG로 그린다. 색은 부모의 글자색(currentColor)을 따른다.
const base = {
  width: 14,
  height: 14,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const

export const CheckIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M3 8.5l3.2 3.2L13 4.5" />
  </svg>
)
export const CrossIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
)
export const WarnIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M8 2.5l6 10.5H2z" />
    <path d="M8 6.5v3M8 11.3v.1" />
  </svg>
)
export const InfoIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 7.3v3.4M8 5.1v.1" />
  </svg>
)

// 프로필 구역 · 버튼에 쓰는 그림. 선 그림은 위와 같은 선 굵기이고, 브랜드 그림(GitHub · Discord)은 채운 그림이다.
export const PersonIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <circle cx="8" cy="5.5" r="2.5" />
    <path d="M3 13.5c.6-2.6 2.6-4 5-4s4.4 1.4 5 4" />
  </svg>
)
export const LockIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <rect x="3.5" y="7" width="9" height="6.5" rx="1" />
    <path d="M5.5 7V5a2.5 2.5 0 015 0v2" />
  </svg>
)
export const BookIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M2.5 3.5h4A1.5 1.5 0 018 5v8a1.5 1.5 0 00-1.5-1.5h-4z" />
    <path d="M13.5 3.5h-4A1.5 1.5 0 008 5v8a1.5 1.5 0 011.5-1.5h4z" />
  </svg>
)
export const RefreshIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M13 8a5 5 0 11-1.6-3.7" />
    <path d="M13 2.5v3h-3" />
  </svg>
)
export const GithubIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} fill="currentColor" stroke="none" {...p}>
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
  </svg>
)
// 말풍선 모양에 두 눈을 뚫은 단순한 Discord 그림(공식 로고가 아니다).
export const DiscordIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} fill="currentColor" stroke="none" {...p}>
    <path
      fillRule="evenodd"
      d="M3 4.2C4.2 3.4 5.4 3 6.4 2.9l.3.6c.9-.1 1.7-.1 2.6 0l.3-.6c1 .1 2.2.5 3.4 1.3 1.2 2 1.8 4.2 1.6 6.9-1.2.9-2.4 1.4-3.5 1.7l-.7-1.2c.4-.1.8-.3 1.2-.5l-.3-.2c-2.3 1.1-4.9 1.1-7.2 0l-.3.2c.4.2.8.4 1.2.5l-.7 1.2c-1.1-.3-2.3-.8-3.5-1.7-.2-2.7.4-4.9 1.6-6.9zM6.2 7.2a1.1 1.3 0 100 2.6 1.1 1.3 0 000-2.6zM9.8 7.2a1.1 1.3 0 100 2.6 1.1 1.3 0 000-2.6z"
    />
  </svg>
)
