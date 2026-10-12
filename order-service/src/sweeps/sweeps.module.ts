import { Module } from '@nestjs/common';
import { SweepsLifecycle } from './sweeps.lifecycle.js';

@Module({ providers: [SweepsLifecycle] })
export class SweepsModule {}
