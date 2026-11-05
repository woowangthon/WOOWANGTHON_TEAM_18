import { Controller, Get } from '@nestjs/common'
import { type AuthUser, CurrentUser } from './auth.decorators.js'

@Controller('me')
export class MeController {
  @Get()
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user
  }
}
