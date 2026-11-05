import { Global, Module } from '@nestjs/common';
import { SecretService } from './secret.service.js';

/**
 * Lazy secret loader, available service-wide (TypeORM config and broker
 * credentials both consume files referenced by env vars).
 */
@Global()
@Module({
  providers: [SecretService],
  exports: [SecretService],
})
export class SecretModule {}
