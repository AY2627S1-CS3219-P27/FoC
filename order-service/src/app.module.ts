import { FocAuthModule } from '@foc/auth';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthKeyModule } from './auth/auth-key.module.js';
import { AuthKeyService } from './auth/auth-key.service.js';
import { environmentSchema } from './config/environment.schema.js';
import { CreditRepliesModule } from './credit-replies/credit-replies.module.js';
import { DbModule } from './db/db.module.js';
import { ErrandsModule } from './errands/errands.module.js';
import { HealthController } from './health/health.controller.js';
import { LifecycleModule } from './lifecycle/lifecycle.module.js';
import { MessagingModule } from './messaging/messaging.module.js';
import { OutboxModule } from './outbox/outbox.module.js';
import { RoleBlocksModule } from './role-blocks/role-blocks.module.js';
import { SweepsModule } from './sweeps/sweeps.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validationSchema: environmentSchema,
    }),
    // Global: any controller can use @UseGuards(JwtAuthGuard | RolesGuard | AdminGuard).
    FocAuthModule.registerAsync({
      imports: [AuthKeyModule],
      inject: [AuthKeyService],
      useFactory: (keys: AuthKeyService) => ({
        publicKey: keys.getJwtPublicKey(),
      }),
    }),
    DbModule,
    CreditRepliesModule,
    ErrandsModule,
    LifecycleModule,
    MessagingModule,
    OutboxModule,
    RoleBlocksModule,
    SweepsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
