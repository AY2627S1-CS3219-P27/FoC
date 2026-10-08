import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FocAuthModule } from '@foc/auth';
import { AccountInitializationModule } from './account-initialization/account-initialization.module.js';
import { AuthKeyModule } from './auth/auth-key.module.js';
import { AuthKeyService } from './auth/auth-key.service.js';
import { environmentSchema } from './config/environment.js';
import { CreditsModule } from './credits/credits.module.js';
import { OutboxModule } from './outbox/outbox.module.js';
import { ReservationModule } from './reservation/reservation.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validationSchema: environmentSchema,
    }),
    AuthKeyModule,
    FocAuthModule.registerAsync({
      imports: [AuthKeyModule],
      inject: [AuthKeyService],
      useFactory: (authKeyService: AuthKeyService) => ({
        publicKey: authKeyService.getJwtPublicKey(),
      }),
    }),
    AccountInitializationModule,
    CreditsModule,
    ReservationModule,
    OutboxModule,
  ],
})
export class AppModule {}
