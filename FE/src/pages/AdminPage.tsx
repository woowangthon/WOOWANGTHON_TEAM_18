import { Alert } from '../components/ui/Alert.tsx'

// Admin Page의 뼈대. 노드 현황 · 실행 중인 서비스 · 강제 중지는 BE의 운영자 API 계약(#100)이 정해진 뒤에 채운다.
// 계약 전이라 숫자나 목록을 보여 주지 않는다. 가짜 값을 두지 않기 위해서다.
function AdminPage() {
  return (
    <>
      <h1 className="text-xl">관리자</h1>
      <section aria-labelledby="nodes-heading" className="flex flex-col gap-2">
        <h2 id="nodes-heading" className="text-lg">
          노드 현황
        </h2>
        <Alert variant="info" title="아직 데이터에 연결되지 않았어요">
          클러스터 노드의 상태와 자원 사용량이 여기에 보여요.
        </Alert>
      </section>
      <section aria-labelledby="services-heading" className="flex flex-col gap-2">
        <h2 id="services-heading" className="text-lg">
          실행 중인 서비스
        </h2>
        <Alert variant="info" title="아직 데이터에 연결되지 않았어요">
          학생 서비스의 상태가 여기에 보이고, 여기서 강제로 중지할 수 있어요.
        </Alert>
      </section>
    </>
  )
}

export default AdminPage
