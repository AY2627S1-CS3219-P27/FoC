import { pino } from 'pino';
import { loggerOptions } from './logger-options.js';

describe('loggerOptions', () => {
  it('never writes login tokens to the logs', () => {
    const lines: string[] = [];
    const { redact } = loggerOptions();
    const logger = pino(
      { redact },
      {
        write: (line: string) => {
          lines.push(line);
        },
      },
    );

    logger.info(
      {
        req: {
          url: '/assistant/questions',
          headers: {
            authorization: 'Bearer secret-token',
            cookie: 'access_token=secret-token',
            host: 'kept',
          },
        },
        res: { headers: { 'set-cookie': 'access_token=secret-token' } },
      },
      'request completed',
    );

    expect(lines[0]).not.toContain('secret-token');
    expect(lines[0]).toContain('kept');
    expect(lines[0]).toContain('/assistant/questions');
  });
});
