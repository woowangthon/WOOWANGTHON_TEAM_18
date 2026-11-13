import type { ReactNode } from 'react'

// 히어로 캐러셀의 일러스트 4장. 색은 CSS 변수(Tailwind 토큰)로만 칠해서 다크 모드에서 값만 바뀐다.
const box = 'fill-raise stroke-line-strong'
const ink = 'fill-fg'
const sub = 'fill-muted'

function Frame({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 400 260" aria-hidden="true" className="h-auto w-full">
      <rect x="0" y="0" width="400" height="260" className="fill-surface" />
      {children}
    </svg>
  )
}

function Check({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r="11" className="fill-accent" />
      <path d={`M${x - 5} ${y} l4 4 l7 -8`} fill="none" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="stroke-accent-fg" />
    </g>
  )
}

function Arrow({ x, y }: { x: number; y: number }) {
  return <path d={`M${x} ${y} h36 m-7 -6 l7 6 l-7 6`} fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="stroke-accent-ui" />
}

export function Repo() {
  return (
    <Frame>
      <rect x="20" y="36" width="140" height="188" rx="6" className={box} />
      <text x="34" y="64" fontSize="13" fontWeight="700" className={ink}>내 GitHub 레포</text>
      {['Dockerfile', 'package.json', 'README.md', 'src/'].map((name, i) => (
        <text key={name} x="34" y={94 + i * 26} fontSize="12" className={sub}>{name}</text>
      ))}
      <Arrow x={166} y={130} />
      <rect x="212" y="36" width="170" height="188" rx="6" className={box} />
      <text x="226" y="64" fontSize="13" fontWeight="700" className={ink}>배포 설정 초안</text>
      <text x="226" y="92" fontSize="11" className={sub}>포트</text>
      <text x="226" y="108" fontSize="12" className={ink}>8080 · Dockerfile</text>
      <text x="226" y="136" fontSize="11" className={sub}>시작 명령</text>
      <text x="226" y="152" fontSize="12" className={ink}>npm start · package.json</text>
      <text x="226" y="180" fontSize="11" className={sub}>서비스 유형</text>
      <rect x="226" y="190" width="62" height="20" rx="4" className="fill-bg stroke-warn" />
      <text x="237" y="204" fontSize="11" fontWeight="700" className="fill-warn">확인 필요</text>
    </Frame>
  )
}

export function Checks() {
  const rows = [
    { label: '이미지 빌드', result: '완료' },
    { label: '비밀값 검사 (gitleaks)', result: '찾은 문제 없음' },
    { label: '의존성 검사 (Trivy)', result: '찾은 문제 없음' },
  ]
  return (
    <Frame>
      {rows.map((r, i) => (
        <g key={r.label}>
          <rect x="30" y={34 + i * 68} width="340" height="54" rx="6" className={box} />
          <Check x={58} y={61 + i * 68} />
          <text x="82" y={58 + i * 68} fontSize="13" fontWeight="700" className={ink}>{r.label}</text>
          <text x="82" y={76 + i * 68} fontSize="11" className={sub}>{r.result}</text>
        </g>
      ))}
    </Frame>
  )
}

export function Cluster() {
  return (
    <Frame>
      <text x="28" y="34" fontSize="13" fontWeight="700" className={ink}>학교 PC 클러스터</text>
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <rect x={28 + i * 122} y="48" width="108" height="150" rx="6" className={box} />
          <text x={40 + i * 122} y="74" fontSize="12" fontWeight="700" className={ink}>PC {i + 1}</text>
          <rect x={40 + i * 122} y="88" width="84" height="8" rx="2" className="fill-bg stroke-line" />
          <rect x={40 + i * 122} y="88" width={[50, 28, 40][i]} height="8" rx="2" className="fill-accent-ui" />
          <rect x={40 + i * 122} y="108" width="84" height="8" rx="2" className="fill-bg stroke-line" />
          <rect x={40 + i * 122} y="108" width={[36, 60, 22][i]} height="8" rx="2" className="fill-accent-ui" />
        </g>
      ))}
      <rect x="40" y="134" width="84" height="26" rx="4" className="fill-accent-soft stroke-accent-ui" />
      <text x="50" y="151" fontSize="11" fontWeight="700" className={ink}>내 서비스</text>
      <text x="28" y="232" fontSize="12" className={sub}>클라우드 비용 없이 학교 PC에서 실행돼요</text>
    </Frame>
  )
}

export function Address() {
  return (
    <Frame>
      <rect x="30" y="28" width="340" height="104" rx="6" className={box} />
      <circle cx="46" cy="44" r="4" className="fill-line-strong" />
      <circle cx="60" cy="44" r="4" className="fill-line-strong" />
      <circle cx="74" cy="44" r="4" className="fill-line-strong" />
      <rect x="92" y="35" width="266" height="18" rx="4" className="fill-surface" />
      <text x="102" y="48" fontSize="11" className={sub}>내 서비스 접속 주소</text>
      <text x="48" y="92" fontSize="15" fontWeight="700" className={ink}>배포한 서비스가 열려요</text>
      <text x="48" y="112" fontSize="12" className={sub}>친구에게 주소를 보내 보세요</text>
      <rect x="30" y="148" width="340" height="84" rx="6" className="fill-accent-soft stroke-accent-ui" />
      <text x="46" y="174" fontSize="13" fontWeight="700" className={ink}>AI 동료</text>
      <text x="46" y="196" fontSize="12" className={ink}>막히면 원인을 찾아 고치고,</text>
      <text x="46" y="214" fontSize="12" className={ink}>무엇을 바꿨는지 알려 줘요.</text>
    </Frame>
  )
}
