import {
  checkOpeningHours,
  type DayKey,
  formatTime,
  fromRows,
  type Interval,
  type IntervalRow,
  openStatus,
  parseTime,
  singaporeWeekMinute,
  toRows,
} from './opening-hours.js';

/** An instant given in Singapore time. 2026-11-02 is a Monday. */
const sgt = (local: string) => new Date(`${local}+08:00`);

const every = (interval: Interval) =>
  Object.fromEntries(
    (['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as DayKey[]).map(
      (day) => [day, [interval]],
    ),
  );

const fields = (raw: unknown) => {
  const result = checkOpeningHours(raw);
  return result.valid ? [] : result.violations.map((v) => v.field);
};

describe('parseTime and formatTime (F2.1, F2.4.1)', () => {
  it.each([
    ['00:00', 0],
    ['09:05', 545],
    ['23:59', 1439],
  ])('reads %s as %i minutes', (text, minutes) => {
    expect(parseTime(text)).toBe(minutes);
    expect(formatTime(minutes)).toBe(text);
  });

  it.each([
    '24:00',
    '9:00',
    '09:60',
    '0900',
    '09:00:00',
    ' 09:00',
    '',
    'ab:cd',
  ])('refuses %j', (text) => {
    expect(parseTime(text)).toBeNull();
  });

  it.each([null, undefined, 900, {}, ['09:00']])(
    'refuses a non-string %j',
    (v) => {
      expect(parseTime(v)).toBeNull();
    },
  );
});

describe('checkOpeningHours (F2.1-F2.4)', () => {
  it('accepts open around the clock (F2.2)', () => {
    expect(checkOpeningHours({ open24Hours: true })).toEqual({
      valid: true,
      value: { open24Hours: true },
    });
  });

  it('returns canonical hours: week order, sorted intervals, closed days left out', () => {
    const result = checkOpeningHours({
      days: {
        sat: [{ opens: '09:00', closes: '13:00' }],
        mon: [
          { opens: '13:00', closes: '18:00' },
          { opens: '09:00', closes: '12:00' },
        ],
        sun: [],
      },
    });

    expect(result).toEqual({
      valid: true,
      value: {
        days: {
          mon: [
            { opens: '09:00', closes: '12:00' },
            { opens: '13:00', closes: '18:00' },
          ],
          sat: [{ opens: '09:00', closes: '13:00' }],
        },
      },
    });
    expect(
      Object.keys((result as { value: { days: object } }).value.days),
    ).toEqual(['mon', 'sat']);
  });

  it('accepts an overnight interval (F2.3)', () => {
    expect(
      checkOpeningHours({
        days: { fri: [{ opens: '22:00', closes: '02:00' }] },
      }),
    ).toMatchObject({ valid: true });
  });

  it('allows intervals that only touch, on one day and across midnight', () => {
    expect(
      checkOpeningHours({
        days: {
          mon: [
            { opens: '09:00', closes: '12:00' },
            { opens: '12:00', closes: '18:00' },
            { opens: '22:00', closes: '02:00' },
          ],
          tue: [{ opens: '02:00', closes: '08:00' }],
        },
      }),
    ).toMatchObject({ valid: true });
  });

  it.each([
    ['not an object', 'open all day'],
    ['an array', []],
    ['null', null],
  ])('refuses hours that are %s', (_, raw) => {
    expect(fields(raw)).toEqual(['openingHours']);
  });

  it('refuses an unknown field, naming it', () => {
    expect(fields({ open24Hours: true, timezone: 'UTC' })).toEqual([
      'openingHours.timezone',
    ]);
  });

  it('refuses open24Hours together with days (F2.2)', () => {
    expect(fields({ open24Hours: true, days: {} })).toEqual(['openingHours']);
  });

  it('refuses open24Hours that is not true', () => {
    expect(fields({ open24Hours: false })).toEqual([
      'openingHours.open24Hours',
    ]);
  });

  it.each([[{}], [{ days: {} }], [{ days: { mon: [], sun: [] } }]])(
    'refuses an empty schedule %j',
    (raw) => {
      expect(checkOpeningHours(raw).valid).toBe(false);
    },
  );

  it('refuses days that is not an object, an unknown day, and a day that is not a list', () => {
    expect(fields({ days: [] })).toEqual(['openingHours.days']);
    expect(fields({ days: { monday: [] } })).toEqual([
      'openingHours.days.monday',
    ]);
    expect(fields({ days: { mon: 'open' } })).toEqual([
      'openingHours.days.mon',
    ]);
  });

  it.each([
    ['an invalid opening time', { opens: '25:00', closes: '18:00' }, 'opens'],
    ['an invalid closing time', { opens: '09:00', closes: '9pm' }, 'closes'],
    ['a missing closing time', { opens: '09:00' }, 'closes'],
    ['a non-string time', { opens: 900, closes: '18:00' }, 'opens'],
  ])('refuses %s with its path (F2.4.1)', (_, interval, field) => {
    expect(fields({ days: { tue: [interval] } })).toEqual([
      `openingHours.days.tue[0].${field}`,
    ]);
  });

  it('refuses equal opening and closing times (F2.4.2)', () => {
    expect(
      fields({ days: { wed: [{ opens: '09:00', closes: '09:00' }] } }),
    ).toEqual(['openingHours.days.wed[0]']);
  });

  it('refuses an unknown interval field, and an interval that is not an object', () => {
    expect(
      fields({
        days: { mon: [{ opens: '09:00', closes: '18:00', note: 'x' }] },
      }),
    ).toEqual(['openingHours.days.mon[0].note']);
    expect(fields({ days: { mon: ['09:00-18:00'] } })).toEqual([
      'openingHours.days.mon[0]',
    ]);
  });

  it('refuses overlapping intervals on a day (F2.4.3)', () => {
    expect(
      fields({
        days: {
          thu: [
            { opens: '09:00', closes: '13:00' },
            { opens: '12:59', closes: '18:00' },
          ],
        },
      }),
    ).toEqual(['openingHours.days.thu[1]']);
  });

  it("refuses an overnight interval running into the next day's intervals (F2.4.3)", () => {
    expect(
      fields({
        days: {
          mon: [{ opens: '22:00', closes: '02:00' }],
          tue: [{ opens: '01:00', closes: '08:00' }],
        },
      }),
    ).toEqual(['openingHours.days.tue[0]']);
  });

  it('refuses overlap across the end of the week: Sunday night into Monday', () => {
    expect(
      fields({
        days: {
          sun: [{ opens: '23:00', closes: '03:00' }],
          mon: [{ opens: '02:00', closes: '09:00' }],
        },
      }),
    ).toEqual(['openingHours.days.sun[0]']);
  });

  it('refuses an overnight interval that overlaps itself around the clock', () => {
    expect(
      fields({
        days: {
          mon: [
            { opens: '08:00', closes: '07:00' },
            { opens: '06:00', closes: '09:00' },
          ],
        },
      }),
    ).not.toEqual([]);
  });

  it('refuses more than ten intervals on a day', () => {
    const many = Array.from({ length: 11 }, (_, i) => ({
      opens: formatTime(i * 60),
      closes: formatTime(i * 60 + 30),
    }));
    expect(fields({ days: { mon: many } })).toEqual(['openingHours.days.mon']);
  });

  it('lists every problem at once (F1.6.1)', () => {
    expect(
      fields({
        days: {
          mon: [{ opens: 'late', closes: '18:00' }],
          tue: [{ opens: '10:00', closes: '10:00' }],
          funday: [],
        },
      }),
    ).toEqual(
      expect.arrayContaining([
        'openingHours.days.funday',
        'openingHours.days.mon[0].opens',
        'openingHours.days.tue[0]',
      ]),
    );
  });
});

describe('toRows and fromRows', () => {
  const hours = {
    days: {
      mon: [
        { opens: '09:00', closes: '12:00' },
        { opens: '13:00', closes: '18:00' },
      ],
      sun: [{ opens: '22:00', closes: '02:00' }],
    },
  };

  it('turns hours into rows and back, losslessly', () => {
    const { open24Hours, intervals } = toRows(hours);

    expect(open24Hours).toBe(false);
    expect(intervals).toEqual([
      { day: 0, opensAt: 540, closesAt: 720 },
      { day: 0, opensAt: 780, closesAt: 1080 },
      { day: 6, opensAt: 1320, closesAt: 120 },
    ]);
    expect(fromRows(false, intervals)).toEqual(hours);
  });

  it('represents open around the clock without intervals', () => {
    expect(toRows({ open24Hours: true })).toEqual({
      open24Hours: true,
      intervals: [],
    });
    expect(fromRows(true, [])).toEqual({ open24Hours: true });
  });

  it('gives null for a supplier without hours (F1.2.8)', () => {
    expect(fromRows(false, [])).toBeNull();
  });
});

describe('singaporeWeekMinute (F2.1.1)', () => {
  it.each([
    ['2026-11-02T00:00:00+08:00', 0],
    ['2026-11-02T16:30:00Z', 1440 + 30], // 00:30 Tuesday in Singapore
    ['2026-11-08T23:59:00+08:00', 10079],
    ['2026-11-02T15:59:00Z', 1439], // 23:59 Monday in Singapore
  ])('reads %s as week minute %i', (instant, minute) => {
    expect(singaporeWeekMinute(new Date(instant))).toBe(minute);
  });
});

describe('openStatus (F2.5, F2.5.1)', () => {
  const weekdays = toRows({
    days: {
      mon: [{ opens: '09:00', closes: '18:00' }],
      tue: [{ opens: '09:00', closes: '18:00' }],
      wed: [{ opens: '09:00', closes: '18:00' }],
      thu: [{ opens: '09:00', closes: '18:00' }],
      fri: [{ opens: '09:00', closes: '18:00' }],
    },
  }).intervals;

  it('is not applicable without opening hours (F2.5.1)', () => {
    expect(openStatus([], false, sgt('2026-11-04T10:00:00'))).toEqual({
      isOpenNow: null,
      nextChangeAt: null,
    });
  });

  it('is open, and never changes, when open around the clock', () => {
    expect(openStatus([], true, sgt('2026-11-04T03:00:00'))).toEqual({
      isOpenNow: true,
      nextChangeAt: null,
    });
  });

  it('is open inside an interval, and says when it closes', () => {
    expect(openStatus(weekdays, false, sgt('2026-11-04T10:30:00'))).toEqual({
      isOpenNow: true,
      nextChangeAt: sgt('2026-11-04T18:00:00'),
    });
  });

  it('is closed before opening, and says when it opens', () => {
    expect(openStatus(weekdays, false, sgt('2026-11-04T08:00:00'))).toEqual({
      isOpenNow: false,
      nextChangeAt: sgt('2026-11-04T09:00:00'),
    });
  });

  it('is open at the opening minute and closed at the closing minute', () => {
    expect(
      openStatus(weekdays, false, sgt('2026-11-04T09:00:00')).isOpenNow,
    ).toBe(true);
    expect(
      openStatus(weekdays, false, sgt('2026-11-04T17:59:59')).isOpenNow,
    ).toBe(true);
    expect(
      openStatus(weekdays, false, sgt('2026-11-04T18:00:00')).isOpenNow,
    ).toBe(false);
  });

  it('reports the change on a minute boundary, whatever the seconds', () => {
    const { nextChangeAt } = openStatus(
      weekdays,
      false,
      sgt('2026-11-04T10:30:45'),
    );
    expect(nextChangeAt).toEqual(sgt('2026-11-04T18:00:00'));
  });

  it('is closed on a day without intervals, and points to the next opening', () => {
    // Saturday evening: closed all weekend, next opening is Monday 09:00.
    expect(openStatus(weekdays, false, sgt('2026-11-07T20:00:00'))).toEqual({
      isOpenNow: false,
      nextChangeAt: sgt('2026-11-09T09:00:00'),
    });
    // Friday after closing: the same.
    expect(openStatus(weekdays, false, sgt('2026-11-06T19:00:00'))).toEqual({
      isOpenNow: false,
      nextChangeAt: sgt('2026-11-09T09:00:00'),
    });
  });

  it('wraps from Sunday night to Monday for the next opening', () => {
    // Sunday 23:00 -> next opening Monday 09:00 (the week wraps).
    expect(openStatus(weekdays, false, sgt('2026-11-08T23:00:00'))).toEqual({
      isOpenNow: false,
      nextChangeAt: sgt('2026-11-09T09:00:00'),
    });
  });

  it('treats an overnight interval as open after midnight, on the next day (F2.3)', () => {
    const saturdayNight = toRows({
      days: { sat: [{ opens: '22:00', closes: '02:00' }] },
    }).intervals;

    expect(
      openStatus(saturdayNight, false, sgt('2026-11-07T23:00:00')),
    ).toEqual({
      isOpenNow: true,
      nextChangeAt: sgt('2026-11-08T02:00:00'),
    });
    expect(
      openStatus(saturdayNight, false, sgt('2026-11-08T01:30:00')),
    ).toEqual({
      isOpenNow: true,
      nextChangeAt: sgt('2026-11-08T02:00:00'),
    });
    expect(
      openStatus(saturdayNight, false, sgt('2026-11-08T02:00:00')).isOpenNow,
    ).toBe(false);
    // Sunday itself has no intervals, so Sunday 01:30 is open only because of Saturday.
    expect(
      openStatus(saturdayNight, false, sgt('2026-11-08T12:00:00')),
    ).toEqual({
      isOpenNow: false,
      nextChangeAt: sgt('2026-11-14T22:00:00'),
    });
  });

  it("carries Sunday night's overnight interval into Monday morning", () => {
    const sundayNight = toRows({
      days: { sun: [{ opens: '22:00', closes: '02:00' }] },
    }).intervals;

    expect(openStatus(sundayNight, false, sgt('2026-11-09T01:00:00'))).toEqual({
      isOpenNow: true,
      nextChangeAt: sgt('2026-11-09T02:00:00'),
    });
  });

  it('merges adjacent intervals, so a lunch-free handover is not a change', () => {
    const split = toRows({
      days: {
        wed: [
          { opens: '09:00', closes: '12:00' },
          { opens: '12:00', closes: '18:00' },
        ],
      },
    }).intervals;

    expect(openStatus(split, false, sgt('2026-11-04T11:00:00'))).toEqual({
      isOpenNow: true,
      nextChangeAt: sgt('2026-11-04T18:00:00'),
    });
  });

  it('sees a break between two intervals as closed, then reopening', () => {
    const lunch = toRows({
      days: {
        wed: [
          { opens: '09:00', closes: '12:00' },
          { opens: '13:00', closes: '18:00' },
        ],
      },
    }).intervals;

    expect(openStatus(lunch, false, sgt('2026-11-04T12:30:00'))).toEqual({
      isOpenNow: false,
      nextChangeAt: sgt('2026-11-04T13:00:00'),
    });
  });

  it('never changes when intervals cover the whole week', () => {
    const always = toRows({
      days: every({ opens: '00:00', closes: '12:00' }),
    });
    const evenings = toRows({
      days: every({ opens: '12:00', closes: '00:00' }),
    });
    const intervals = [...always.intervals, ...evenings.intervals].filter(
      (row): row is IntervalRow => row.opensAt !== row.closesAt,
    );

    expect(openStatus(intervals, false, sgt('2026-11-04T05:00:00'))).toEqual({
      isOpenNow: true,
      nextChangeAt: null,
    });
  });
});
