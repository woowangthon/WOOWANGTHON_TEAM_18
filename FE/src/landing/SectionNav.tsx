const SECTIONS = [
  { href: '#survey', label: '설문' },
  { href: '#showcase', label: '기능 소개' },
  { href: '#types', label: '지원 범위' },
  { href: '#how', label: '사용 방법' },
]

// 랜딩의 구역으로 건너뛰는 메뉴. 상단 바에서 빼서, 로그인 상태에 따라 바뀌는 버튼과 섞이지 않게 한다.
// 본문(최대 75rem) 옆에 자리가 나는 아주 넓은 화면(2xl)에서는 오른쪽에 떠 있고, 그보다 좁으면 본문을 가리지 않도록 헤더 아래에 붙는 띠가 된다.
function SectionNav() {
  return (
    <nav
      aria-label="페이지 바로가기"
      className="sticky top-0 z-10 flex gap-4 overflow-x-auto border-b border-line bg-bg px-3 py-2 text-sm 2xl:fixed 2xl:top-1/2 2xl:right-3 2xl:-translate-y-1/2 2xl:flex-col 2xl:gap-1 2xl:overflow-visible 2xl:rounded-md 2xl:border 2xl:p-2"
    >
      {SECTIONS.map(({ href, label }) => (
        <a key={href} href={href} className="rounded-sm px-2 py-1 whitespace-nowrap text-muted hover:text-fg">
          {label}
        </a>
      ))}
    </nav>
  )
}

export default SectionNav
