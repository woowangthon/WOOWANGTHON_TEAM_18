import { Component } from 'react'
import type { ReactNode } from 'react'
import NoticeBanner from '../components/NoticeBanner.tsx'
import { Button } from '../components/ui/Button.tsx'

// 화면 코드를 내려받지 못했을 때(새 빌드가 나가 옛 파일이 사라진 뒤 열어 둔 탭 등) 앱 전체가 빈 화면이 되지 않게 한다.
// 상단 바는 그대로 두고 그 자리에 안내와 새로고침 버튼을 보인다. 다른 화면으로 가면 key가 바뀌어 다시 그린다.
class ScreenErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <NoticeBanner title="화면을 불러오지 못했어요">
        <div className="flex flex-col gap-2">
          <p>새 버전이 나왔거나 연결이 끊겼을 수 있어요. 새로고침하면 대부분 해결돼요.</p>
          <Button
            variant="outline"
            className="self-start"
            onClick={() => {
              window.location.reload()
            }}
          >
            새로고침
          </Button>
        </div>
      </NoticeBanner>
    )
  }
}

export default ScreenErrorBoundary
