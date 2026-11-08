import { deliveryLabel } from './delivery-label.js';

describe('deliveryLabel', () => {
  it('uses the venue code, name and floor with a venue', () => {
    expect(
      deliveryLabel({
        buildingShortName: 'COM1',
        venue: { code: 'LT19', name: 'Seminar Room', floor: '3' },
      }),
    ).toBe('COM1 · LT19 · Seminar Room · Level 3');
  });

  it('skips a missing venue name', () => {
    expect(
      deliveryLabel({
        buildingShortName: 'COM1',
        venue: { code: 'LT19', name: null, floor: '3' },
      }),
    ).toBe('COM1 · LT19 · Level 3');
  });

  it('says Around for a building alone', () => {
    expect(deliveryLabel({ buildingShortName: 'COM1' })).toBe('Around COM1');
  });

  it('a pin wins over the building and venue', () => {
    expect(
      deliveryLabel({
        buildingShortName: 'Other',
        pin: true,
        venue: { code: 'X', name: null, floor: '1' },
      }),
    ).toBe('Requester Delivery Location');
  });
});
