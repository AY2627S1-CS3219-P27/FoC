import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { ReservationService } from './reservation.service.js';

@Module({
  imports: [DatabaseModule],
  providers: [ReservationService],
  exports: [ReservationService],
})
export class ReservationModule {}
