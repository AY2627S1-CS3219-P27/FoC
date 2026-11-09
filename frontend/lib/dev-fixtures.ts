// Dev-only API stand-in for /home?data=<dataset>. It is loaded only behind a NODE_ENV check, so it never ships.
// Lengths in the worst case come from the services' limits (user 255/2083, supplier 100/255/50/20, errand 200/1000/500, credits int32).

import type { Dataset } from "./dev-datasets";

const INT32_MAX = 2_147_483_647;
const ME = "9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f";

const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const LONG_LOCATION =
  "Yusof Ishak House, Level 3 — the study corner behind the vending machines, next to the noticeboard with the CCA posters. Call me at the lift lobby, the corridor door is card-access only";
const LONG_ITEMS =
  "1 large iced milo (less sugar, less ice)\n2 chicken rice — one with extra chilli, one without cucumber\n1 Kopi-O kosong\nAlso the printed lecture notes from the CS3219 folder at the counter, under 'Wiśniewska-Kowalczyk'. " +
  "If they have run out of milo please get the Horlicks instead, and if the chicken rice queue is longer than 15 minutes, skip it and just bring the drinks and the notes. ".repeat(4);
const LONG_REASON =
  "The courier marked this as delivered but the parcel was left at the wrong block (Block E instead of Block A) and the drinks had melted by the time I found it. I messaged twice through the app and got no reply. ".repeat(2);

const BUILDINGS = {
  demo: [
    { id: "b1", shortName: "COM2", canonicalName: "Computing 2", coordinates: { latitude: 1.2943, longitude: 103.7738 }, venueCount: 2, allowsPin: false },
    { id: "b2", shortName: "UTown", canonicalName: "University Town", coordinates: { latitude: 1.3042, longitude: 103.7733 }, venueCount: 0, allowsPin: false },
    { id: "b3", shortName: "PIN", canonicalName: "Other (map pin)", coordinates: { latitude: 1.295, longitude: 103.765 }, venueCount: 0, allowsPin: true },
  ],
  worst: [
    { id: "b1", shortName: "Kent Ridge Guild Hse", canonicalName: "Kent Ridge Guild House (Kent Ridge Campus) — Office of Student Affairs and Student Union Annex", coordinates: { latitude: 1.2991, longitude: 103.7745 }, venueCount: 0, allowsPin: false },
    { id: "b2", shortName: "E", canonicalName: "E", coordinates: { latitude: 1.2987, longitude: 103.7712 }, venueCount: 0, allowsPin: false },
    { id: "b3", shortName: "YIH", canonicalName: "Yusof Ishak House", coordinates: { latitude: 1.2985, longitude: 103.7747 }, venueCount: 0, allowsPin: false },
    { id: "b4", shortName: "PIN", canonicalName: "Other (map pin)", coordinates: { latitude: 1.295, longitude: 103.765 }, venueCount: 0, allowsPin: true },
  ],
};

const CATEGORIES = {
  demo: [
    { id: "c1", name: "Food" },
    { id: "c2", name: "Drinks" },
  ],
  worst: [
    { id: "c1", name: "Stationery, Printing & Photocopying (Self-service)" },
    { id: "c2", name: "Café" },
    ...["Halal", "Vegetarian", "Late night", "Bubble tea", "Groceries", "Pharmacy", "Electronics", "Books", "Laundry", "ATM"].map(
      (name, i) => ({ id: `c${i + 3}`, name }),
    ),
  ],
};

function supplier(n: number, over: Record<string, unknown> = {}) {
  return {
    id: uuid(1000 + n),
    name: `Supplier ${n}`,
    displayName: `Supplier ${n}`,
    kind: ["Store", "Facility", "Landmark"][n % 3],
    categories: [CATEGORIES.demo[n % 2]],
    building: BUILDINGS.demo[n % 2],
    floor: String((n % 9) + 1),
    status: "Active",
    photoUrl: null,
    locationDescription: "Next to the lift lobby",
    ...over,
  };
}

const SUPPLIERS = {
  demo: [
    supplier(1, { name: "Spinelli Coffee", displayName: "Spinelli Coffee", kind: "Store" }),
    supplier(2, { name: "Print Room", displayName: "Print Room", kind: "Facility" }),
    supplier(3, { name: "Clock Tower", displayName: "Clock Tower", kind: "Landmark" }),
  ],
  worst: [
    supplier(1, {
      name: "The Coffee Roastery & Artisan Bakehouse at Kent Ridge Guild House — Ground Floor Pop-up (Weekdays)",
      displayName: "The Coffee Roastery & Artisan Bakehouse at Kent Ridge Guild House — Ground Floor Pop-up (Weekdays)",
      kind: "Store",
      categories: CATEGORIES.worst,
      building: BUILDINGS.worst[0],
      floor: "B9",
      locationDescription:
        "Take the escalator down from the bus stop entrance, turn left past the bookshop and the ATM, continue through the glass doors marked 'Staff & Students only', and it's the counter with the green awning directly opposite the lift lobby — closed on public holidays and during exam week",
    }),
    supplier(2, { name: "Jo's", displayName: "Jo's", kind: "Facility", categories: [], building: BUILDINGS.worst[1], floor: "M" }),
    supplier(3, {
      name: "Đặng Thị Ngọc Hân Phở & Bánh Mì",
      displayName: "Đặng Thị Ngọc Hân Phở & Bánh Mì",
      kind: "Landmark",
      status: "Inactive",
      building: null,
      floor: "12",
    }),
    supplier(4, {
      name: "Kopi-O-Kosong-Takeaway-Counter-Benachrichtigungseinstellungen",
      displayName: "Kopi-O-Kosong-Takeaway-Counter-Benachrichtigungseinstellungen",
      categories: [CATEGORIES.worst[0]],
      building: BUILDINGS.worst[2],
    }),
    supplier(5, { name: "王秀英便利店", displayName: "王秀英便利店", photoUrl: "https://example.com/404.png" }),
  ],
};

function errand(n: number, over: Record<string, unknown> = {}) {
  return {
    id: uuid(n),
    status: "Open",
    supplierId: uuid(1001),
    pickupName: "Spinelli Coffee",
    pickupLocation: "COM2",
    pickupDescription: null,
    deliveryLocation: "UTown",
    deliveryDetail: "Level 3, 04-02",
    deliveryVenue: null,
    deliveryLatitude: null,
    deliveryLongitude: null,
    collectionItems: "1 iced latte",
    description: null,
    rewardCredits: 5,
    expiresAt: minutes(45),
    createdAt: minutes(-10),
    requesterId: n % 2 ? ME : uuid(9000 + n),
    courierId: n % 2 ? uuid(8000 + n) : ME,
    cancellationReason: null,
    ...over,
  };
}

const STATUSES = ["Pending", "Open", "Accepted", "Picked Up", "Delivered", "Completed", "Cancelled", "Incomplete"];

const ERRANDS = {
  demo: [
    errand(1),
    errand(2, { status: "Accepted", pickupName: "Print Room", collectionItems: "20 pages, double-sided", rewardCredits: 8 }),
    errand(3, { status: "Completed", rewardCredits: 3 }),
    // The three label shapes: venue, pin, building only.
    errand(4, {
      deliveryLocation: "COM2",
      deliveryVenue: "COM2 · SR1 · Seminar Room 1 · Level 1",
      deliveryDetail: "",
      deliveryLatitude: 1.2943,
      deliveryLongitude: 103.7738,
    }),
    errand(5, {
      deliveryLocation: "PIN",
      deliveryVenue: "Requester Delivery Location",
      deliveryDetail: "Bench outside the canteen",
      deliveryLatitude: 1.2975,
      deliveryLongitude: 103.7745,
    }),
    errand(6, { deliveryVenue: "Around UTown", deliveryDetail: "" }),
  ],
  worst: [
    errand(1, {
      status: "Picked Up",
      pickupName: SUPPLIERS.worst[0].displayName,
      pickupLocation: "Kent Ridge Guild Hse",
      pickupDescription: SUPPLIERS.worst[0].locationDescription,
      deliveryLocation: LONG_LOCATION,
      deliveryDetail: LONG_LOCATION.slice(0, 200),
      collectionItems: LONG_ITEMS,
      description: LONG_ITEMS.slice(0, 1000),
      rewardCredits: INT32_MAX,
      expiresAt: minutes(168 * 60),
    }),
    errand(2, {
      status: "Pending",
      pickupName: "Jo",
      pickupLocation: "E",
      deliveryLocation: "E",
      deliveryDetail: "1",
      collectionItems: "1",
      rewardCredits: 1,
      expiresAt: minutes(0.3),
    }),
    errand(3, {
      status: "Incomplete",
      pickupName: null,
      pickupLocation: null,
      supplierId: uuid(4040),
      deliveryLocation: null,
      collectionItems: "<script>alert(1)</script> &amp; **bold**",
      cancellationReason: LONG_REASON,
      expiresAt: minutes(-90),
    }),
    errand(4, {
      status: "Delivered",
      pickupName: "Kopi-O-Kosong-Takeaway-Counter-Benachrichtigungseinstellungen",
      deliveryLocation: "bartholomew.fitzgerald@northwind-industries-holdings.example.com",
      rewardCredits: 1_000_000,
      expiresAt: null,
    }),
    ...STATUSES.map((status, i) => errand(10 + i, { status, pickupName: "王秀英便利店", rewardCredits: 12 + i })),
  ],
};

function user(n: number, over: Record<string, unknown> = {}) {
  return {
    uuid: uuid(5000 + n),
    email: `e0${String(100000 + n)}@u.nus.edu`,
    displayName: `Student ${n}`,
    roles: ["requester"],
    profilePictureUrl: null,
    isAdmin: false,
    isLocked: false,
    isArchived: false,
    ...over,
  };
}

const USERS = {
  demo: [
    user(1, { uuid: ME, displayName: "Jane Tan", email: "e0123456@u.nus.edu", roles: ["requester", "courier"], isAdmin: true }),
    user(2, { displayName: "Wei Ling", roles: ["courier"] }),
  ],
  worst: [
    user(1, {
      uuid: ME,
      displayName: "Aleksandra Wiśniewska-Kowalczyk",
      email: "aleksandra.wisniewska-kowalczyk@u.nus.edu",
      roles: ["requester", "courier"],
      isAdmin: true,
      profilePictureUrl: "https://example.com/avatars/does-not-exist.png",
    }),
    user(2, { displayName: "Christopher Alexander Montgomery III", email: "bartholomew.fitzgerald@northwind-industries-holdings.example.com", isAdmin: true, roles: [] }),
    user(3, { displayName: "Jo", email: "a@b.co", roles: [] , isLocked: true }),
    user(4, { displayName: "🦊 Fox", roles: ["requester", "courier"], isArchived: true }),
    user(5, { displayName: "王秀英", email: "first.last+billing-notifications@example.com" }),
    user(6, { displayName: "نور الهدى عبد الرحمن" }),
    user(7, { displayName: "  Sam   Lee ", profilePictureUrl: "https://example.com/panorama-4000x200.jpg" }),
    user(8, { displayName: "Đặng Thị Ngọc Hân" }),
  ],
};

const REQUESTS = {
  worst: [
    {
      id: uuid(7001),
      type: "Create",
      state: "Pending",
      supplierId: null,
      supplierVersion: null,
      values: {
        name: SUPPLIERS.worst[0].name,
        kind: "Store",
        categoryIds: CATEGORIES.worst.map((c) => c.id),
        buildingId: "b1",
        floor: "B9",
        locationDescription: SUPPLIERS.worst[0].locationDescription,
        coordinates: { latitude: 1.2966426, longitude: 103.7763939 },
        photoUrl: "https://example.com/workspaces/acme/projects/q3-launch/docs/9f8e7d6c5b4a?tab=comments&filter=unresolved",
      },
      submittedBy: uuid(5002),
      submittedAt: minutes(-60 * 24 * 12),
    },
    {
      id: uuid(7002),
      type: "Update",
      state: "Pending",
      supplierId: uuid(1002),
      supplierVersion: 1284,
      values: { locationDescription: "Moved", categoryIds: ["c1", "c2", "c3", "c4"] },
      submittedBy: uuid(4040),
      submittedAt: minutes(-1),
    },
  ],
};

const MY_REQUESTS = {
  worst: [
    { ...REQUESTS.worst[0], state: "Denied", resolvedAt: minutes(-5), denialReason: LONG_REASON.slice(0, 500) },
    { ...REQUESTS.worst[1], state: "Pending", resolvedAt: null, denialReason: null },
  ],
};

const ADMIN_ERRANDS = {
  worst: ERRANDS.worst.slice(0, 6).map((e, i) => ({
    ...e,
    internalStatus: ["AWAITING_CREDIT_RESERVATION", "OPEN", "PICKED_UP", "CANCELLED_BY_REQUESTER", "DELIVERED", "INCOMPLETE"][i],
    pickedUpAt: null,
    deliveredAt: null,
    updatedAt: minutes(-i * 60),
    cancellationReason: i === 2 ? LONG_REASON : e.cancellationReason,
  })),
};

function many<T>(n: number, make: (i: number) => T): T[] {
  return Array.from({ length: n }, (_, i) => make(i + 1));
}

// What each dataset puts on screen, before server-side paging.
function data(dataset: Dataset) {
  const worstish = dataset === "worst" || dataset === "huge";
  const base = {
    me: dataset === "demo" ? USERS.demo[0] : USERS.worst[0],
    balance: dataset === "demo"
      ? { userId: ME, creditBalance: 42, reservedBalance: 8 }
      : dataset === "one"
        ? { userId: ME, creditBalance: 1, reservedBalance: 0 }
        : { userId: ME, creditBalance: 1284, reservedBalance: INT32_MAX },
    buildings: worstish ? BUILDINGS.worst : BUILDINGS.demo,
    categories: worstish ? CATEGORIES.worst : CATEGORIES.demo,
  };
  switch (dataset) {
    case "demo":
      return { ...base, suppliers: SUPPLIERS.demo, errands: ERRANDS.demo, users: USERS.demo, requests: [], mine: [], adminErrands: [] };
    case "worst":
      return { ...base, suppliers: SUPPLIERS.worst, errands: ERRANDS.worst, users: USERS.worst, requests: REQUESTS.worst, mine: MY_REQUESTS.worst, adminErrands: ADMIN_ERRANDS.worst };
    case "empty":
      return { ...base, buildings: [], categories: [], suppliers: [], errands: [], users: [USERS.worst[0]], requests: [], mine: [], adminErrands: [] };
    case "one":
      return {
        ...base,
        suppliers: SUPPLIERS.demo.slice(0, 1),
        errands: ERRANDS.demo.slice(0, 1),
        users: USERS.demo.slice(0, 1),
        requests: REQUESTS.worst.slice(0, 1),
        mine: MY_REQUESTS.worst.slice(1),
        adminErrands: ADMIN_ERRANDS.worst.slice(0, 1),
      };
    case "huge":
      return {
        ...base,
        suppliers: many(1000, (i) => supplier(i)),
        errands: many(1000, (i) => errand(i, { status: STATUSES[i % STATUSES.length], rewardCredits: i * 37 })),
        users: [USERS.worst[0], ...many(1283, (i) => user(i))],
        requests: many(50, (i) => ({ ...REQUESTS.worst[1], id: uuid(70000 + i) })),
        mine: [],
        adminErrands: many(50, (i) => ({ ...ADMIN_ERRANDS.worst[1], id: uuid(60000 + i) })),
      };
  }
}

// Mirrors each service's default and maximum page size, so "huge" shows what the UI really receives.
function page<T>(items: T[], params: URLSearchParams, defaultLimit: number, maxLimit: number) {
  const limit = Math.min(Number(params.get("limit") ?? defaultLimit), maxLimit);
  const offset = Number(params.get("offset") ?? 0);
  return { items: items.slice(offset, offset + limit), total: items.length, limit, offset };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

export function fixtureResponse(dataset: Dataset, input: string, init: RequestInit = {}): Response {
  const url = new URL(input, "http://fixture.local");
  const path = url.pathname;
  const q = url.searchParams;
  const method = (init.method ?? "GET").toUpperCase();
  const d = data(dataset);

  if (method === "POST" && path === "/api/credits/sufficiency") {
    const { amount } = JSON.parse(String(init.body ?? "{}")) as { amount: number };
    return json({ userId: ME, amount, sufficient: amount <= d.balance.creditBalance });
  }
  if (method !== "GET") {
    return json({ code: "FIXTURE_READ_ONLY", message: "Fixture data is read-only. Remove ?data= to use the real API." }, 409);
  }

  if (path === "/api/users/me") return json(d.me);
  if (path === "/api/users") return json(page(d.users, q, 25, 1000));
  if (path === "/api/credits/balance") return json(d.balance);
  if (path === "/api/buildings") return json(d.buildings);
  if (path.startsWith("/api/buildings/")) {
    return json([
      { id: "v1", code: "SR1", name: "Seminar Room 1", floor: "1", coordinates: { latitude: 1.2943, longitude: 103.7738 } },
      { id: "v2", code: "SR2", name: null, floor: "2", coordinates: { latitude: 1.2944, longitude: 103.7739 } },
    ]);
  }
  if (path === "/api/campus-boundary") {
    const ring = [[103.7715, 1.29], [103.779, 1.29], [103.779, 1.306], [103.7715, 1.306], [103.7715, 1.29]];
    return json({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } }] });
  }
  if (path === "/api/categories") return json(d.categories);
  if (path === "/api/suppliers") return json(page(d.suppliers, q, 25, 1000));
  if (path.startsWith("/api/suppliers/")) {
    const found = d.suppliers.find((s) => s.id === path.split("/")[3]);
    return found
      ? json({ ...found, coordinates: { latitude: 1.2966, longitude: 103.7764 }, thumbnailUrl: found.photoUrl }, 200, { ETag: '"1"' })
      : json({ message: "Supplier not found" }, 404);
  }
  if (path === "/api/errands" || path === "/api/errands/mine") return json(page(d.errands, q, 20, 50));
  if (path.startsWith("/api/errands/")) {
    const found = d.errands.find((e) => e.id === path.split("/")[3]);
    return found ? json(found) : json({ code: "ERRAND_NOT_FOUND", message: "Not found" }, 404);
  }
  if (path.startsWith("/api/admin/users/")) return json(page(d.adminErrands, q, 20, 50));
  if (path === "/api/supplier-requests/mine") return json(page(d.mine, q, 25, 100));
  if (path === "/api/supplier-requests") return json(page(d.requests, q, 25, 100));

  return json({ message: `No fixture for ${path}` }, 404);
}
