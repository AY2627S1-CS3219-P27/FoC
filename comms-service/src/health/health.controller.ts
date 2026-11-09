import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { RabbitMqConnectionService } from '../messaging/rabbitmq-connection.service.js';
import { RabbitMqConsumerTransport } from '../messaging/rabbitmq-consumer.transport.js';
import { RedisService } from '../redis/redis.service.js';
import { SocketRedisAdapterService } from '../redis/socket-redis-adapter.service.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly rabbitMq: RabbitMqConnectionService,
    private readonly rabbitMqConsumers: RabbitMqConsumerTransport,
    private readonly redis: RedisService,
    private readonly socketRedis: SocketRedisAdapterService,
  ) {}

  @Get('live')
  @ApiOperation({ summary: 'Process liveness' })
  @ApiResponse({ status: 200, description: 'The HTTP process is responsive.' })
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Service dependency and consumer readiness' })
  @ApiResponse({
    status: 200,
    description:
      'PostgreSQL, RabbitMQ, and all Redis connections are reachable.',
  })
  @ApiResponse({
    status: 503,
    description:
      'At least one dependency is unavailable or a lifecycle consumer is recovering.',
  })
  async ready(): Promise<{ status: 'ok' }> {
    try {
      await Promise.all([
        this.dataSource.query('SELECT 1'),
        this.rabbitMq.check(),
        this.rabbitMqConsumers.checkConsumers(),
        this.redis.check(),
        this.socketRedis.check(),
      ]);
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException({
        code: 'SERVICE_NOT_READY',
        message: 'A required dependency is unavailable',
      });
    }
  }
}
