export const PIN_LABEL = 'Requester Delivery Location';

// Display label snapshotted on the errand (spec section 3): pin, else venue, else building only.
export function deliveryLabel(i: {
  buildingShortName: string;
  pin?: boolean;
  venue?: { code: string; name: string | null; floor: string };
}): string {
  if (i.pin) return PIN_LABEL;
  if (!i.venue) return `Around ${i.buildingShortName}`;
  const { code, name, floor } = i.venue;
  return [i.buildingShortName, code, name, `Level ${floor}`].filter(Boolean).join(' · ');
}
