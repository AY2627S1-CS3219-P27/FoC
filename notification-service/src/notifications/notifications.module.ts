import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountEventContractValidator } from '@foc/contracts';
import { Notification } from '../database/entities/notification.entity.js';
import { Subscription } from '../database/entities/subscription.entity.js';
import { NotifyHandler } from './notify.handler.js';
import {
  NOTIFY_TRANSFORMERS,
  NotifyTransformerRegistry,
} from './notify-transformer.registry.js';
import {
  NOTIFICATION_SENDER,
  StubNotificationSender,
} from './notification.sender.js';

@Module({
  imports: [TypeOrmModule.forFeature([Notification, Subscription])],
  providers: [
    NotifyHandler,
    NotifyTransformerRegistry,
    // The transformer registry ships empty: tapping a producing service's
    // event later is one binding plus one entry here.
    { provide: NOTIFY_TRANSFORMERS, useValue: new Map() },
    // NS2 replaces the stub with the real Web Push sender.
    { provide: NOTIFICATION_SENDER, useClass: StubNotificationSender },
    {
      provide: AccountEventContractValidator,
      useFactory: () => new AccountEventContractValidator(),
    },
  ],
  exports: [NotifyHandler],
})
export class NotificationsModule {}
