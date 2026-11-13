import NoticeBanner from '../components/NoticeBanner.tsx'

// 클러스터 문제는 두 가지로 가른다(docs/design/api.md "운영자 API").
// CLUSTER_UNREACHABLE: 리더에 닿지 못했다. CLUSTER_FORBIDDEN: 닿았지만 서버 계정에 권한이 없다. 그 밖의 코드는 null이다.
// retries: 이 화면이 알아서 다시 시도하는 읽기이면 true, 사용자가 다시 눌러야 하는 쓰기(강제 중지)이면 false다.
export function clusterAlert(code: string, note = '', retries = true) {
  if (code === 'CLUSTER_UNREACHABLE') {
    return (
      <NoticeBanner variant="warn" title="리더 무응답">
        리더의 쿠버네티스 API에 닿지 못했어요. {retries ? '자동으로 다시 시도해요.' : '잠시 뒤에 다시 눌러 주세요.'} {note}
      </NoticeBanner>
    )
  }
  if (code === 'CLUSTER_FORBIDDEN') {
    return (
      <NoticeBanner variant="warn" title="리더에는 닿았지만 서버 계정에 권한이 없어요">
        인프라 담당이 서버 계정에 권한을 줘야 해요. {note}
      </NoticeBanner>
    )
  }
  return null
}
