import { Module } from '@nestjs/common';
import { LifecycleService } from './lifecycle.service.js';

@Module({ providers: [LifecycleService], exports: [LifecycleService] })
export class LifecycleModule {}
