import { Link } from 'react-router'

// 관리자가 아닌 사람이 Admin Page에 들어왔을 때(라우트 보호), 그리고 서버가 403을 줬을 때 같은 화면을 쓴다.
function ForbiddenNotice() {
  return (
    <section className="flex flex-col gap-3">
      <h1 className="text-2xl">권한이 없어요</h1>
      <p>이 화면은 운영자만 볼 수 있어요.</p>
      <Link to="/dashboard" className="self-start text-accent-text underline">
        대시보드로 가기
      </Link>
    </section>
  )
}

export default ForbiddenNotice
