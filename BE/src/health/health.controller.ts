import { Controller, Get } from '@nestjs/common'
import { Public } from '../auth/auth.decorators.js'

@Public()
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok' }
  }
}
