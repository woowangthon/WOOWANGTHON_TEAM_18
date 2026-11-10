import { run } from './exec.js'
import type { RenderTools } from './render.js'

/**
 * `kubectl apply --dry-run=server`. 실행기의 kubeconfig(KUBECONFIG)로 리더 k3s API에 닿는다.
 * kubectl은 실패하면 Status JSON이 아니라 "Error from server (...): ..." 문장만 낸다. Status 원본을 남기는 방법은 정하는 중이라
 * 지금은 status를 null로, 문장을 message로 넘긴다(Render는 이 함수 하나만 바꾸면 된다).
 */
export const kubectlDryRun: RenderTools['dryRun'] = async (manifest, namespace) => {
  try {
    await run('kubectl', ['apply', '--dry-run=server', '--namespace', namespace, '--filename', '-'], { input: manifest })
    return { ok: true }
  } catch (err) {
    return { ok: false, status: null, message: err instanceof Error ? err.message : String(err) }
  }
}
