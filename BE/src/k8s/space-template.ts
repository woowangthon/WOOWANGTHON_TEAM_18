/**
 * 학생 공간 양식. Infra/student/space.yaml과 같은 값이고, 이름만 proj-<slug>로 바뀐다(검사 규칙이 양식과 같은 값만 통과시킨다,
 * docs/design/cluster.md §8). 양식을 고치면 여기도 같이 고친다. 순서는 공간 먼저, 읽기 권한 연결(RoleBinding) 마지막이다.
 */
export interface SpaceObject {
  /** 만들 요청의 경로 */
  path: string
  body: object
}

export function spaceObjects(slug: string): SpaceObject[] {
  const ns = `proj-${slug}`
  const inNs = `/namespaces/${ns}`
  return [
    {
      path: '/api/v1/namespaces',
      body: {
        apiVersion: 'v1',
        kind: 'Namespace',
        metadata: {
          name: ns,
          // 보안 등급 둘뿐이다. 더 붙으면 검사 규칙이 거절한다.
          labels: {
            'pod-security.kubernetes.io/enforce': 'baseline',
            'pod-security.kubernetes.io/warn': 'restricted',
          },
        },
      },
    },
    {
      path: `/api/v1${inNs}/limitranges`,
      body: {
        apiVersion: 'v1',
        kind: 'LimitRange',
        metadata: { name: 'container-defaults', namespace: ns },
        spec: {
          limits: [
            {
              type: 'Container',
              defaultRequest: { cpu: '250m', memory: '256Mi', 'ephemeral-storage': '1Gi' },
              default: { cpu: '2', memory: '4Gi', 'ephemeral-storage': '8Gi' },
            },
          ],
        },
      },
    },
    {
      path: `/api/v1${inNs}/resourcequotas`,
      body: {
        apiVersion: 'v1',
        kind: 'ResourceQuota',
        metadata: { name: 'project-cap', namespace: ns },
        spec: {
          hard: {
            'requests.cpu': '4',
            'limits.cpu': '8',
            'requests.memory': '16Gi',
            'limits.memory': '32Gi',
            'requests.ephemeral-storage': '10Gi',
            'limits.ephemeral-storage': '40Gi',
            pods: '10',
            persistentvolumeclaims: '0',
            'requests.storage': '0',
            'services.nodeports': '0',
            'services.loadbalancers': '0',
          },
        },
      },
    },
    {
      path: `/apis/networking.k8s.io/v1${inNs}/networkpolicies`,
      body: {
        apiVersion: 'networking.k8s.io/v1',
        kind: 'NetworkPolicy',
        metadata: { name: 'project-isolation', namespace: ns },
        spec: {
          podSelector: {},
          policyTypes: ['Ingress', 'Egress'],
          ingress: [
            { from: [{ podSelector: {} }] },
            {
              from: [
                {
                  namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'kube-system' } },
                  podSelector: { matchLabels: { 'app.kubernetes.io/name': 'traefik' } },
                },
              ],
            },
          ],
          egress: [
            { to: [{ podSelector: {} }] },
            {
              to: [
                {
                  namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'kube-system' } },
                  podSelector: { matchLabels: { 'k8s-app': 'kube-dns' } },
                },
              ],
              ports: [
                { port: 53, protocol: 'UDP' },
                { port: 53, protocol: 'TCP' },
              ],
            },
            {
              to: [
                {
                  ipBlock: {
                    cidr: '0.0.0.0/0',
                    except: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10', '169.254.0.0/16'],
                  },
                },
              ],
            },
          ],
        },
      },
    },
    {
      path: `/apis/rbac.authorization.k8s.io/v1${inNs}/rolebindings`,
      body: {
        apiVersion: 'rbac.authorization.k8s.io/v1',
        kind: 'RoleBinding',
        metadata: { name: 'platform-server-read', namespace: ns },
        roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'ClusterRole', name: 'proj-reader' },
        subjects: [{ kind: 'ServiceAccount', name: 'platform-server', namespace: 'platform' }],
      },
    },
  ]
}
