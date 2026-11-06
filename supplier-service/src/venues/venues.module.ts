import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Venue } from '../database/entities/index.js';
import { VenuesService } from './venues.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Venue])],
  providers: [VenuesService],
  exports: [VenuesService],
})
export class VenuesModule {}
