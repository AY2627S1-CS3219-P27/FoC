import { BadRequestException, HttpException } from '@nestjs/common';
import { parseIfMatch } from './if-match.js';

describe('parseIfMatch', () => {
  it.each([
    ['"3"', 3],
    ['W/"12"', 12],
    ['7', 7],
    ['  "4"  ', 4],
  ])('reads %s as version %d', (header, version) => {
    expect(parseIfMatch(header)).toBe(version);
  });

  it('answers 428 when the header is missing', () => {
    for (const header of [undefined, '', '   ']) {
      const error = (() => {
        try {
          parseIfMatch(header);
        } catch (caught) {
          return caught;
        }
      })() as HttpException;

      expect(error.getStatus()).toBe(428);
      expect(error.getResponse()).toMatchObject({
        code: 'PRECONDITION_REQUIRED',
      });
    }
  });

  it.each(['"abc"', '"0"', '*', '"3", "4"', '-1'])(
    'rejects %s as malformed',
    (header) => {
      expect(() => parseIfMatch(header)).toThrow(BadRequestException);
    },
  );
});
