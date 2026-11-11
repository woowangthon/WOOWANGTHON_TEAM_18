import { describe, expect, it } from 'vitest'
import { ClusterError } from '../k8s/cluster-error.js'
import { UnwiredDeploymentScaler } from './deployment-scaler.js'

describe('UnwiredDeploymentScaler', () => {
  it('refuses every scale as a missing permission, until the real one is bound', async () => {
    await expect(new UnwiredDeploymentScaler().scaleToZero()).rejects.toMatchObject({ constructor: ClusterError, kind: 'forbidden' })
  })
})
