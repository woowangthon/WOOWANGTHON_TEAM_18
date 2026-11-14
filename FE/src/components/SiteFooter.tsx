import Logo from './Logo.tsx'

// 랜딩과 로그인 뒤 화면이 같이 쓰는 아래쪽 띠.
function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-300 items-center gap-3 px-3 py-6 text-sm text-muted sm:px-4">
        <Logo className="size-6" />
        <span>2026 AI 우왕톤 · 왕가네식구들</span>
      </div>
    </footer>
  )
}

export default SiteFooter
