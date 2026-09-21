import { Test, TestingModule } from '@nestjs/testing';
import { OtpController } from './otp.controller.js';
import { OtpService } from './otp.service.js';
import { REDIS } from '../redis/redis.provider.js';
import { SecretService } from '../secret/secret.service.js';

describe('OtpController', () => {
  let controller: OtpController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OtpController],
      providers: [
        OtpService,
        { provide: REDIS, useValue: {} },
        {
          provide: SecretService,
          useValue: { getServerSecret: () => 'test-secret' },
        },
      ],
    }).compile();

    controller = module.get<OtpController>(OtpController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
