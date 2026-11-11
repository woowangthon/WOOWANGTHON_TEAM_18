import { BadRequestException, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { AuthUser } from '../auth/auth.decorators.js'
import type { Env } from '../config/env.js'
import { isRecord } from '../common/is-record.js'
import { DeploysService } from './deploys.service.js'
import { DeploysStore } from './deploys.store.js'
import { SecretWriter } from './secret-writer.js'
import type { Spec } from './deploy-input.js'
import { type SecretStatus, secretStatus, serviceDigest, validateSecrets } from './secrets-input.js'

/** 비밀값 받기 · 상태 읽기(W3). 계약은 docs/design/api.md "비밀값", 값이 거치는 곳은 docs/design/auth.md "비밀값". */
@Injectable()
export class SecretsService {
  private readonly hashKey: string

  constructor(
    private readonly deploys: DeploysService,
    private readonly store: DeploysStore,
    private readonly writer: SecretWriter,
    config: ConfigService<Env, true>,
  ) {
    this.hashKey = config.get('SECRET_HASH_KEY', { infer: true })
  }

  /** 내 배포의 비밀값 상태. 없는 id · 남의 id는 404다(DeploysService.get과 같다). 리더는 부르지 않는다. */
  async status(user: AuthUser, id: string): Promise<SecretStatus> {
    const { spec } = await this.deploys.get(user, id)
    return this.statusOf(spec)
  }

  /** 소유자 확인 없이 spec의 비밀값 상태를 읽는다(배포 시작 쪽 #82가 이미 소유자를 확인한 뒤 부른다). */
  async statusOf(spec: Spec): Promise<SecretStatus> {
    return secretStatus(spec, await this.store.secretRows(spec.project.slug), this.hashKey)
  }

  /**
   * 서비스마다 그 서비스의 Secret을 통째로 바꾼다(서버는 읽을 수 없어 합치지 못한다). 서비스는 차례로 쓰며 `writing` → 리더에 쓰기 → `in` 순으로
   * 기록하므로 어디서 실패해도 `in`으로 남지 않는다. 쓴 뒤의 상태를 돌려주고 값은 돌려주지 않는다.
   */
  async put(user: AuthUser, id: string, body: unknown): Promise<SecretStatus> {
    const { spec } = await this.deploys.get(user, id)
    if (!isRecord(body)) throw new BadRequestException({ code: 'BAD_REQUEST', message: 'Body must be a JSON object' })
    const checked = validateSecrets(body.services, spec)
    if (!checked.ok) {
      throw new BadRequestException({
        code: 'INVALID_SECRETS',
        message: `secrets have invalid fields (first: ${checked.issues[0].path})`,
        fields: checked.issues,
      })
    }

    const { slug } = spec.project
    // key가 없는 서비스(`{}`)는 쓸 것이 없다.
    const writes = spec.services.flatMap(({ name }) => {
      const values = checked.values.get(name)
      return values !== undefined && Object.keys(values).length > 0 ? [{ name, values }] : []
    })
    if (writes.length > 0) {
      for (const { name, values } of writes) {
        const keys = Object.keys(values).sort()
        await this.store.setSecretState(slug, name, { keys, status: 'writing', digest: null })
        await this.writer.write(slug, name, values)
        await this.store.setSecretState(slug, name, { keys, status: 'in', digest: serviceDigest(values, this.hashKey) })
      }
    }
    return this.statusOf(spec)
  }
}
