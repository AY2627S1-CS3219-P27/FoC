import {
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { CreditOperationWorker } from './credit-operation.worker.js';

@Injectable()
export class CreditOperationWorkerLifecycle
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  constructor(private readonly worker: CreditOperationWorker) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.worker.start();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker.close();
  }
}
