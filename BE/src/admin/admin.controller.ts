import { Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common'
import { CurrentUser } from '../auth/auth.decorators.js'
import type { AuthUser } from '../auth/auth.decorators.js'
import { AdminGuard } from './admin.guard.js'
import { AdminService } from './admin.service.js'

@UseGuards(AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('nodes')
  nodes() {
    return this.admin.nodes()
  }

  @Get('projects')
  projects() {
    return this.admin.projects()
  }

  @Post('projects/:slug/stop')
  @HttpCode(200)
  stop(@CurrentUser() user: AuthUser, @Param('slug') slug: string) {
    return this.admin.stop(user, slug)
  }
}
