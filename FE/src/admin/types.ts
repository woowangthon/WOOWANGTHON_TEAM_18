// 운영자 API(#100, docs/design/api.md "운영자 API")의 응답 모양. 수량은 정수이고 읽지 못한 칸은 null이다.
export type Capacity = { capacityMillicores: number | null; allocatableMillicores: number | null }
export type ByteCapacity = { capacityBytes: number | null; allocatableBytes: number | null }

export type AdminNode = {
  name: string
  ready: boolean
  role: 'leader' | 'worker'
  cpu: Capacity
  memory: ByteCapacity
  disk: ByteCapacity
  // 사용량은 아직 수집하지 않는다(null). 수집되면 { cpuMillicores, memoryBytes }가 온다.
  usage: { cpuMillicores: number; memoryBytes: number } | null
}
export type NodesResponse = { usageStatus: string; nodes: AdminNode[] }

export type AdminPod = { name: string; phase: string; ready: boolean; node: string | null; restarts: number }
export type AdminService = {
  name: string
  slot: 'a' | 'b' | null
  replicas: number
  readyReplicas: number
  // 그 서비스 Pod들의 컨테이너 재시작 횟수의 합. 지금 떠 있는 Pod 기준이라 Pod가 새로 뜨면 0으로 돌아간다.
  restarts: number
  // 그 서비스 Pod들의 실제 사용량의 합. Pod가 없거나 아직 수집 전이거나 프로젝트의 usageStatus가 not_collected면 null이다.
  usage: { cpuMillicores: number; memoryBytes: number } | null
  pods: AdminPod[]
}
export type AdminProject = {
  slug: string
  repo: string
  ownerId: string
  liveSlot: 'a' | 'b' | null
  url: string | null
  lastStop: { at: string; by: string } | null
  // 이 프로젝트의 공간만 읽지 못했을 때의 이유. 그러면 services는 []이고, 다른 프로젝트는 그대로 온다.
  clusterError: 'CLUSTER_FORBIDDEN' | 'CLUSTER_UNREACHABLE' | null
  // 이 프로젝트의 Pod 사용량을 읽었는지. not_collected면 모든 서비스의 usage가 null이다.
  usageStatus: 'collected' | 'not_collected'
  services: AdminService[]
}
export type ProjectsResponse = { projects: AdminProject[] }

export type StopResponse = { slug: string; scaled: string[]; failed: string[] }
