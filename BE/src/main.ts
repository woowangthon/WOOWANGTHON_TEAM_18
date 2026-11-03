import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module.js'
import { setupApp } from './app.setup.js'

const app = await NestFactory.create(AppModule)
setupApp(app)
await app.listen(process.env.PORT ?? 3000)
