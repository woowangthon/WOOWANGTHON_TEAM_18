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
export type AdminService = { name: string; slot: 'a' | 'b' | null; replicas: number; readyReplicas: number; pods: AdminPod[] }
export type AdminProject = {
  slug: string
  repo: string
  ownerId: string
  liveSlot: 'a' | 'b' | null
  url: string | null
  lastStop: { at: string; by: string } | null
  // 이 프로젝트의 공간만 읽지 못했을 때의 이유. 그러면 services는 []이고, 다른 프로젝트는 그대로 온다.
  clusterError: 'CLUSTER_FORBIDDEN' | 'CLUSTER_UNREACHABLE' | null
  services: AdminService[]
}
export type ProjectsResponse = { projects: AdminProject[] }

export type StopResponse = { slug: string; scaled: string[]; failed: string[] }
