import { Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common'
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
  projects(@Query() query: Record<string, unknown>) {
    return this.admin.projects(query)
  }

  @Post('projects/:slug/stop')
  @HttpCode(200)
  stop(@CurrentUser() user: AuthUser, @Param('slug') slug: string) {
    return this.admin.stop(user, slug)
  }

  @Post('projects/:slug/hide')
  @HttpCode(200)
  hide(@Param('slug') slug: string) {
    return this.admin.hide(slug)
  }
}
