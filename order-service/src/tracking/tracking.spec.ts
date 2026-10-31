import { randomUUID } from 'node:crypto';
import { FocAuthModule } from '@foc/auth';
import { Role } from '@foc/contracts';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { signAccessToken, testKeys } from '../../test/access-token.js';
import { environmentSchema } from '../config/environment.schema.js';
import { configureHttp } from '../http/configure-http.js';
import { SYSTEM, transition, user } from '../lifecycle/transition.js';
import { notifyCommitted, onTransitionCommitted } from '../lifecycle/transition-hooks.js';
import { ERRAND_READER, type TrackedErrand } from './errand-reader.js';
import { FakeTrackingStore } from './fake-tracking.store.spec-helper.js';
import {
  DESTINATION_RESOLVER,
  OsrmRoutingProvider,
  ROUTING_PROVIDER,
  type RoutingProvider,
} from './routing.js';
import { TRACKING_CONFIG, type TrackingConfig } from './tracking.config.js';
import { TrackingController } from './tracking.controller.js';
import { StreamLimiter } from './stream-limiter.js';
import { TrackingService } from './tracking.service.js';
import { TRACKING_STORE } from './tracking.store.js';

const COURIER = randomUUID();
const OTHER_COURIER = randomUUID();
const REQUESTER = randomUUID();
const STRANGER = randomUUID();
const ERRAND = randomUUID();
const CAMPUS = { lat: 1.3, lng: 103.8 };

const config: TrackingConfig = {
  locationTtlS: 120,
  minUpdateIntervalMs: 1000,
  sseKeepaliveMs: 50,
  bbox: [103.62, 1.22, 104.03, 1.47],
  routeTtlS: 600,
  rerouteDistanceM: 50,
  osrmBaseUrl: 'http://osrm:5000',
  osrmTimeoutMs: 50,
  maxStreamsPerErrand: 2,
  maxStreamsPerUser: 3,
};

const ROUTE = { polyline: [[103.8, 1.3], [103.81, 1.31]] as [number, number][], distanceM: 100, durationS: 70, computedAt: 1 };

describe('tracking', () => {
  let app: INestApplication;
  let base: string;
  let clock = 1_000_000;
  const store = new FakeTrackingStore(() => clock);
  let errand: TrackedErrand | null;
  let findCalls = 0;
  let findGate: Promise<void> | undefined;
  let onFind: (() => void) | undefined;
  let destination: { lat: number; lng: number } | null;
  const routing = { route: vi.fn() } satisfies RoutingProvider;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [FocAuthModule.register({ publicKey: testKeys.publicKey })],
      controllers: [TrackingController],
      providers: [
        TrackingService,
        StreamLimiter,
        { provide: TRACKING_CONFIG, useValue: config },
        { provide: TRACKING_STORE, useValue: store },
        { provide: ROUTING_PROVIDER, useValue: routing },
        { provide: DESTINATION_RESOLVER, useValue: { resolve: async () => destination } },
        { provide: ERRAND_READER, useValue: { find: async () => { findCalls++; await findGate; onFind?.(); return errand; } } },
      ],
    }).compile();
    // Deterministic server clock for ts / serverTime.
    (module.get(TrackingService) as unknown as { now: () => number }).now = () => clock;
    app = module.createNestApplication();
    configureHttp(app);
    await app.listen(0, '127.0.0.1');
    base = `${await app.getUrl()}/v1/errands/${ERRAND}`;
  });
  afterAll(() => app.close());
  beforeEach(() => {
    clock += 10_000;
    errand = { id: ERRAND, requesterId: REQUESTER, courierId: COURIER, status: 'Picked Up' };
    destination = null;
    onFind = undefined;
    findGate = undefined;
    store.ready = true;
    store.failSetPosition = undefined;
    store.rateReleases = 0;
    routing.route.mockReset();
    store.positions.clear();
    store.routes.clear();
    store.published.length = 0;
  });

  const token = (sub: string, roles: Role[]) => signAccessToken({ sub, roles });
  const post = async (body: unknown, sub = COURIER, roles = [Role.Courier]) =>
    fetch(`${base}/location`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${await token(sub, roles)}` },
      body: JSON.stringify(body),
    });
  const get = async (path: string, sub = REQUESTER, roles = [Role.Requester]) =>
    fetch(`${base}/${path}`, { headers: { authorization: `Bearer ${await token(sub, roles)}` } });

  describe('POST location', () => {
    it('stores the position with TTL and publishes it (204)', async () => {
      const res = await post({ ...CAMPUS, accuracy: 5, heading: 90, speed: 1.2 });
      expect(res.status).toBe(204);
      expect(store.positions.get(ERRAND)).toEqual({
        value: { ...CAMPUS, accuracy: 5, heading: 90, speed: 1.2, ts: clock },
        ttlS: 120,
      });
      expect(store.published[0].event).toMatchObject({ type: 'location', ...CAMPUS });
    });

    it('rejects unauthenticated and requester-only callers', async () => {
      expect((await fetch(`${base}/location`, { method: 'POST' })).status).toBe(401);
      expect((await post(CAMPUS, REQUESTER, [Role.Requester])).status).toBe(403);
    });

    it.each([
      [{ lat: 91, lng: 103.8 }],
      [{ lat: -91, lng: 103.8 }],
      [{ lat: 1.3, lng: 181 }],
      [{ lat: 1.3, lng: -181 }],
      [{ ...CAMPUS, accuracy: -1 }],
      [{ ...CAMPUS, heading: 361 }],
      [{ ...CAMPUS, heading: -1 }],
      [{ ...CAMPUS, speed: -0.1 }],
      [{ lat: '1.3', lng: 103.8 }],
      [{ lat: 1.3 }],
    ])('rejects invalid DTO %j with 400', async (body) => {
      const res = await post(body);
      expect(res.status).toBe(400);
      // Nest's default ValidationPipe shape: no INVALID_FIELDS code.
      const json = await res.json();
      expect(json).toMatchObject({ statusCode: 400, error: 'Bad Request' });
      expect(Array.isArray(json.message)).toBe(true);
      expect(json).not.toHaveProperty('code');
      expect(store.positions.size).toBe(0);
    });

    it('accepts boundary values inside the bbox', async () => {
      expect((await post({ lat: 1.22, lng: 103.62, heading: 0, accuracy: 0, speed: 0 })).status).toBe(204);
      clock += 2000;
      expect((await post({ lat: 1.47, lng: 104.03, heading: 360 })).status).toBe(204);
    });

    it('rejects a position outside TRACKING_BBOX with INVALID_FIELDS', async () => {
      const res = await post({ lat: 51.5, lng: -0.12 });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'INVALID_FIELDS' });
      expect(store.positions.size).toBe(0);
    });

    it('accepts but drops updates faster than the minimum interval', async () => {
      expect((await post(CAMPUS)).status).toBe(204);
      clock += 500;
      expect((await post({ lat: 1.31, lng: 103.81 })).status).toBe(204);
      expect(store.published).toHaveLength(1);
      expect(store.positions.get(ERRAND)!.value.lat).toBe(1.3);
      clock += 600;
      expect((await post({ lat: 1.32, lng: 103.81 })).status).toBe(204);
      expect(store.positions.get(ERRAND)!.value.lat).toBe(1.32);
    });

    it('releases the rate slot if storing the position fails', async () => {
      store.failSetPosition = new Error('redis');
      expect((await post(CAMPUS)).status).toBe(500);
      expect(store.rateReleases).toBe(1);
      store.failSetPosition = undefined;
      expect((await post(CAMPUS)).status).toBe(204); // same instant: slot was given back
    });

    it('leaves no position behind when the errand is delivered mid-POST', async () => {
      let calls = 0;
      onFind = () => {
        if (++calls === 2) errand = { ...errand!, status: 'Delivered' };
      };
      expect((await post(CAMPUS)).status).toBe(204);
      expect(store.positions.size).toBe(0);
      expect(store.published.filter((p) => p.event.type === 'location')).toHaveLength(0);
    });

    it('auth matrix', async () => {
      const unknown = await (async () => {
        errand = null;
        return post(CAMPUS);
      })();
      expect(unknown.status).toBe(404);

      errand = { id: ERRAND, requesterId: REQUESTER, courierId: COURIER, status: 'Picked Up' };
      const other = await post(CAMPUS, OTHER_COURIER);
      expect(other.status).toBe(403);
      expect(await other.json()).toMatchObject({ code: 'FORBIDDEN' });

      for (const status of ['Accepted', 'Delivered', 'Cancelled'] as const) {
        errand = { id: ERRAND, requesterId: REQUESTER, courierId: COURIER, status };
        const res = await post(CAMPUS);
        expect(res.status).toBe(409);
        expect(await res.json()).toMatchObject({ code: 'STATE_MISMATCH' });
      }
      expect(store.positions.size).toBe(0);
    });
  });

  describe('GET snapshot', () => {
    it('has the contracted shape for requester and courier', async () => {
      await post({ ...CAMPUS, accuracy: 3 });
      for (const [sub, roles] of [[REQUESTER, [Role.Requester]], [COURIER, [Role.Courier]]] as const) {
        const res = await get('tracking/snapshot', sub, [...roles]);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({
          errandId: ERRAND,
          status: 'Picked Up',
          tracking: true,
          position: { ...CAMPUS, accuracy: 3, heading: null, speed: null, ts: clock },
          route: null,
          destination: null,
          serverTime: clock,
        });
      }
    });

    it('is 404 for strangers and other couriers', async () => {
      expect((await get('tracking/snapshot', STRANGER, [Role.Requester])).status).toBe(404);
      expect((await get('tracking/snapshot', OTHER_COURIER, [Role.Courier])).status).toBe(404);
      errand = null;
      expect((await get('tracking/snapshot')).status).toBe(404);
    });

    it('reports tracking:false and no position outside Picked Up', async () => {
      store.positions.set(ERRAND, { value: { ...CAMPUS, accuracy: null, heading: null, speed: null, ts: 1 }, ttlS: 1 });
      errand = { ...errand!, status: 'Transferring-Credit' };
      const body = await (await get('tracking/snapshot')).json();
      expect(body).toMatchObject({ status: 'Completed', tracking: false, position: null, route: null });
    });
  });

  describe('routing', () => {
    const settle = () => new Promise((r) => setTimeout(r, 10));

    it('computes nothing without a destination', async () => {
      await post(CAMPUS);
      await settle();
      expect(routing.route).not.toHaveBeenCalled();
    });

    it('caches the route, publishes it, and reroutes only past the threshold', async () => {
      destination = { lat: 1.35, lng: 103.9 };
      routing.route.mockResolvedValue(ROUTE);
      await post(CAMPUS);
      await settle();
      expect(routing.route).toHaveBeenCalledTimes(1);
      expect(store.routes.get(ERRAND)!.ttlS).toBe(600);
      expect(store.published.map((p) => p.event.type)).toEqual(['location', 'route']);

      // ~11 m away: cached route reused.
      clock += 2000;
      await post({ lat: 1.3001, lng: 103.8 });
      await settle();
      expect(routing.route).toHaveBeenCalledTimes(1);

      // ~111 m away: recomputed.
      clock += 2000;
      await post({ lat: 1.301, lng: 103.8 });
      await settle();
      expect(routing.route).toHaveBeenCalledTimes(2);

      // Cache expiry forces a recompute even without movement.
      store.routes.clear();
      clock += 2000;
      await post({ lat: 1.301, lng: 103.8 });
      await settle();
      expect(routing.route).toHaveBeenCalledTimes(3);

      const snap = await (await get('tracking/snapshot')).json();
      expect(snap.route).toEqual(ROUTE);
      expect(snap.route).not.toHaveProperty('origin');
      expect(snap.destination).toEqual(destination);
    });

    it('backs off OSRM for the failure cooldown, then retries', async () => {
      destination = { lat: 1.35, lng: 103.9 };
      routing.route.mockResolvedValue(null);
      await post(CAMPUS);
      await settle();
      expect(routing.route).toHaveBeenCalledTimes(1);
      clock += 2000; // within ROUTE_FAILURE_COOLDOWN_MS (10 s)
      await post({ lat: 1.3001, lng: 103.8 });
      await settle();
      expect(routing.route).toHaveBeenCalledTimes(1);
      clock += 10_000; // past it
      await post({ lat: 1.3002, lng: 103.8 });
      await settle();
      expect(routing.route).toHaveBeenCalledTimes(2);
    });

    it('caches no route when tracking ended while routing was in flight', async () => {
      destination = { lat: 1.35, lng: 103.9 };
      routing.route.mockImplementation(async () => {
        errand = { ...errand!, status: 'Delivered' };
        return ROUTE;
      });
      await post(CAMPUS);
      await settle();
      expect(store.routes.size).toBe(0);
      expect(store.published.some((p) => p.event.type === 'route')).toBe(false);
    });

    it('removes a route cached just as tracking ended, without publishing it', async () => {
      destination = { lat: 1.35, lng: 103.9 };
      routing.route.mockResolvedValue(ROUTE);
      const orig = store.setRoute.bind(store);
      const spy = vi.spyOn(store, 'setRoute').mockImplementationOnce(async (...a) => {
        await orig(...a);
        errand = { ...errand!, status: 'Delivered' };
      });
      await post(CAMPUS);
      await settle();
      spy.mockRestore();
      expect(store.routes.size).toBe(0);
      expect(store.published.some((p) => p.event.type === 'route')).toBe(false);
    });

    it('prunes stale routing failures', async () => {
      destination = { lat: 1.35, lng: 103.9 };
      routing.route.mockResolvedValue(null);
      const failures = (app.get(TrackingService) as unknown as { routeFailedAt: Map<string, number> }).routeFailedAt;
      await post(CAMPUS);
      await settle();
      expect(failures.size).toBe(1);
      clock += 20_000;
      destination = null; // next refresh does nothing but must still prune
      await post({ lat: 1.3001, lng: 103.8 });
      await settle();
      expect(failures.size).toBe(0);
    });

    it('degrades to no route when routing fails, and still stores the position', async () => {
      destination = { lat: 1.35, lng: 103.9 };
      routing.route.mockResolvedValue(null);
      expect((await post(CAMPUS)).status).toBe(204);
      await settle();
      expect(store.routes.size).toBe(0);
      expect(store.positions.size).toBe(1);
      const snap = await (await get('tracking/snapshot')).json();
      expect(snap.route).toBeNull();
    });
  });

  describe('SSE stream', () => {
    // Reads an SSE response into parsed events until `until` returns true.
    async function open(sub = REQUESTER, roles = [Role.Requester]) {
      const ctl = new AbortController();
      const res = await fetch(`${base}/tracking`, {
        headers: { authorization: `Bearer ${await token(sub, roles)}`, accept: 'text/event-stream' },
        signal: ctl.signal,
      });
      return { res, ctl };
    }
    async function collect(res: Response, until: (events: { event: string; data: string }[]) => boolean) {
      const events: { event: string; data: string }[] = [];
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = '';
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline && !until(events)) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value);
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = /^event: (.*)$/m.exec(chunk)?.[1] ?? 'message';
          const data = /^data: (.*)$/m.exec(chunk)?.[1] ?? '';
          events.push({ event: ev, data });
        }
      }
      reader.releaseLock();
      return events;
    }
    const waitFor = async (fn: () => boolean) => {
      for (let i = 0; i < 100 && !fn(); i++) await new Promise((r) => setTimeout(r, 20));
      expect(fn()).toBe(true);
    };

    it('is 404 for a stranger before any stream opens', async () => {
      const { res } = await open(STRANGER);
      expect(res.status).toBe(404);
      expect(store.listenerCount).toBe(0);
    });

    it('sends snapshot, forwards location/route, keepalives, then ended and completes', async () => {
      await post(CAMPUS);
      const { res } = await open();
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      expect(res.headers.get('cache-control')).toContain('no-cache');
      expect(res.headers.get('x-accel-buffering')).toBe('no');

      const done = collect(res, (e) => e.some((x) => x.event === 'ended'));
      await waitFor(() => store.listenerCount === 1);
      await new Promise((r) => setTimeout(r, 150)); // let keepalives tick
      await store.publish(ERRAND, { type: 'location', lat: 1.31, lng: 103.81, accuracy: null, heading: null, speed: null, ts: 5 });
      await store.publish(ERRAND, { type: 'route', ...ROUTE });
      await store.publish(ERRAND, { type: 'ended', reason: 'DELIVERED', status: 'Delivered' });
      const events = await done;

      expect(events[0].event).toBe('snapshot');
      expect(JSON.parse(events[0].data)).toMatchObject({ errandId: ERRAND, tracking: true, position: CAMPUS });
      expect(events.some((e) => e.event === 'keepalive')).toBe(true);
      const loc = events.find((e) => e.event === 'location')!;
      expect(JSON.parse(loc.data)).toEqual({ lat: 1.31, lng: 103.81, accuracy: null, heading: null, speed: null, ts: 5 });
      expect(JSON.parse(events.find((e) => e.event === 'route')!.data)).toEqual(ROUTE);
      const ended = events.at(-1)!;
      expect(ended.event).toBe('ended');
      expect(JSON.parse(ended.data)).toEqual({ reason: 'DELIVERED', status: 'Delivered' });
      await waitFor(() => store.listenerCount === 0);
    });

    it('ends the stream on a keepalive tick when the errand left Picked Up without an ended event', async () => {
      const { res } = await open();
      const done = collect(res, (e) => e.some((x) => x.event === 'ended'));
      await waitFor(() => store.listenerCount === 1);
      errand = { ...errand!, status: 'Delivered' }; // end hook "missed"
      const events = await done;
      const ended = events.at(-1)!;
      expect(ended.event).toBe('ended');
      expect(JSON.parse(ended.data)).toEqual({ reason: 'NOT_TRACKING', status: 'Delivered' });
      await waitFor(() => store.listenerCount === 0);
    });

    it('releases the subscription when the client disconnects', async () => {
      const { res, ctl } = await open();
      const reading = collect(res, () => false).catch(() => []);
      await waitFor(() => store.listenerCount === 1);
      ctl.abort();
      await reading;
      await waitFor(() => store.listenerCount === 0);
    });

    it('ends immediately when the errand is not being tracked', async () => {
      errand = { ...errand!, status: 'Accepted' };
      const { res } = await open();
      const events = await collect(res, (e) => e.some((x) => x.event === 'ended'));
      expect(events.map((e) => e.event)).toEqual(['snapshot', 'ended']);
      expect(JSON.parse(events[0].data).tracking).toBe(false);
      await waitFor(() => store.listenerCount === 0);
    });
  });

  describe('SSE hardening', () => {
    const limiter = () => app.get(StreamLimiter);
    const openOn = async (errandId: string, sub = REQUESTER, roles = [Role.Requester]) => {
      const ctl = new AbortController();
      const res = await fetch(`${base.replace(ERRAND, errandId)}/tracking`, {
        headers: { authorization: `Bearer ${await token(sub, roles)}` },
        signal: ctl.signal,
      });
      return { res, ctl };
    };
    const drain = (res: Response) => void res.body?.getReader().read().catch(() => undefined);
    const waitFor = async (fn: () => boolean) => {
      for (let i = 0; i < 100 && !fn(); i++) await new Promise((r) => setTimeout(r, 20));
      expect(fn()).toBe(true);
    };

    it('caps streams per errand (429) and frees a slot on disconnect', async () => {
      const a = await openOn(ERRAND);
      const b = await openOn(ERRAND);
      drain(a.res);
      drain(b.res);
      await waitFor(() => limiter().open === 2);
      const c = await openOn(ERRAND);
      expect(c.res.status).toBe(429);
      expect(await c.res.json()).toMatchObject({ code: 'TOO_MANY_STREAMS' });
      a.ctl.abort();
      await waitFor(() => limiter().open === 1);
      const d = await openOn(ERRAND);
      expect(d.res.status).toBe(200);
      drain(d.res);
      b.ctl.abort();
      d.ctl.abort();
      await waitFor(() => limiter().open === 0);
    });

    it('caps streams per user across errands', async () => {
      const ids = [ERRAND, randomUUID(), randomUUID()];
      const open = [await openOn(ids[0]), await openOn(ids[0]), await openOn(ids[1])];
      open.forEach((o) => drain(o.res));
      await waitFor(() => limiter().open === 3);
      const over = await openOn(ids[2]);
      expect(over.res.status).toBe(429);
      expect(await over.res.json()).toMatchObject({ code: 'TOO_MANY_STREAMS' });
      open.forEach((o) => o.ctl.abort());
      await waitFor(() => limiter().open === 0);
    });

    it('frees the slot when the stream ends and when setup fails', async () => {
      const spy = vi.spyOn(store, 'subscribe').mockRejectedValueOnce(new Error('redis'));
      const failed = await openOn(ERRAND);
      expect(failed.res.status).toBe(200);
      await failed.res.text(); // completes without events
      await waitFor(() => limiter().open === 0);
      spy.mockRestore();

      const ok = await openOn(ERRAND);
      const body = ok.res.text();
      await waitFor(() => store.listenerCount === 1);
      await store.publish(ERRAND, { type: 'ended', reason: 'DELIVERED', status: 'Delivered' });
      expect(await body).toContain('event: ended');
      await waitFor(() => limiter().open === 0);
    });

    it('does not end the stream on a transient lookup error during keepalive', async () => {
      const { res, ctl } = await openOn(ERRAND);
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let text = '';
      const readUntil = async (pred: () => boolean) => {
        const deadline = Date.now() + 3000;
        while (!pred() && Date.now() < deadline) text += dec.decode((await reader.read()).value);
      };
      await readUntil(() => text.includes('event: snapshot'));
      onFind = () => {
        throw new Error('db hiccup');
      };
      text = '';
      await readUntil(() => (text.match(/event: keepalive/g) ?? []).length >= 3);
      expect(text).not.toContain('event: ended');
      expect(store.listenerCount).toBe(1);
      // A definite NotFound does end it.
      onFind = undefined;
      errand = null;
      text = '';
      await readUntil(() => text.includes('event: ended'));
      expect(text).toContain('event: ended');
      ctl.abort();
      await waitFor(() => limiter().open === 0);
    });

    it('runs at most one keepalive status check at a time', async () => {
      const { res, ctl } = await openOn(ERRAND);
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let text = '';
      while (!text.includes('event: snapshot')) text += dec.decode((await reader.read()).value);
      const before = findCalls;
      let open!: () => void;
      findGate = new Promise<void>((r) => (open = r));
      await new Promise((r) => setTimeout(r, 250)); // ~5 ticks at 50 ms
      expect(findCalls - before).toBe(1);
      findGate = undefined;
      open();
      ctl.abort();
      await waitFor(() => limiter().open === 0);
    });

    it('answers 503 TRACKING_UNAVAILABLE on all routes while Redis is down', async () => {
      store.ready = false;
      const checks = [await post(CAMPUS), await get('tracking/snapshot'), await get('tracking')];
      for (const res of checks) {
        expect(res.status).toBe(503);
        expect(await res.json()).toMatchObject({ code: 'TRACKING_UNAVAILABLE' });
      }
      expect(limiter().open).toBe(0);
    });
  });

  describe('end-of-tracking hook', () => {
    const svc = () => app.get(TrackingService);
    const wait = () => new Promise((r) => setTimeout(r, 10));

    it('cleans up and publishes ended after Picked Up -> Delivered / Cancelled', async () => {
      for (const [to, reason] of [['Delivered', 'DELIVERED'], ['Cancelled', 'CANCELLED']] as const) {
        await store.setPosition(ERRAND, { ...CAMPUS, accuracy: null, heading: null, speed: null, ts: 1 }, 1);
        await store.setRoute(ERRAND, { ...ROUTE, origin: CAMPUS }, 1);
        store.published.length = 0;
        notifyCommitted(
          { errandId: ERRAND, expected: 'Picked Up', to, actor: { kind: 'system' } },
          { ok: true, sequenceNumber: 9 },
        );
        await wait();
        expect(store.positions.size).toBe(0);
        expect(store.routes.size).toBe(0);
        expect(store.published[0].event).toEqual({ type: 'ended', reason, status: to });
      }
    });

    it('ignores other edges, replays and refusals', async () => {
      store.positions.set(ERRAND, { value: { ...CAMPUS, accuracy: null, heading: null, speed: null, ts: 1 }, ttlS: 1 });
      const actor = { kind: 'system' } as const;
      notifyCommitted({ errandId: ERRAND, expected: 'Accepted', to: 'Picked Up', actor }, { ok: true, sequenceNumber: 1 });
      notifyCommitted({ errandId: ERRAND, expected: 'Picked Up', to: 'Delivered', actor }, { ok: true, sequenceNumber: 1, replayed: true });
      notifyCommitted({ errandId: ERRAND, expected: 'Picked Up', to: 'Delivered', actor }, { ok: false, reason: 'FORBIDDEN' });
      await wait();
      expect(store.positions.size).toBe(1);
      expect(store.published).toHaveLength(0);
    });

    it('swallows store errors', async () => {
      store.failWith = new Error('redis down');
      try {
        await expect(svc().endTracking(ERRAND, 'DELIVERED', 'Delivered')).resolves.toBeUndefined();
        expect(() =>
          notifyCommitted(
            { errandId: ERRAND, expected: 'Picked Up', to: 'Delivered', actor: { kind: 'system' } },
            { ok: true, sequenceNumber: 2 },
          ),
        ).not.toThrow();
        await wait();
      } finally {
        store.failWith = undefined;
      }
    });

    it('swallows throwing listeners', async () => {
      const off = onTransitionCommitted(() => {
        throw new Error('boom');
      });
      const off2 = onTransitionCommitted(async () => {
        throw new Error('async boom');
      });
      try {
        expect(() =>
          notifyCommitted(
            { errandId: ERRAND, expected: 'Picked Up', to: 'Delivered', actor: { kind: 'system' } },
            { ok: true, sequenceNumber: 2 },
          ),
        ).not.toThrow();
        await wait();
      } finally {
        off();
        off2();
      }
    });
  });
});

describe('transition() post-commit hook (real transition(), mocked db)', () => {
  const userActor = user(COURIER);
  const deliver = { errandId: ERRAND, expected: 'Picked Up', to: 'Delivered', actor: userActor, set: { deliveredAt: new Date() } } as const;
  const cancel = { errandId: ERRAND, expected: 'Picked Up', to: 'Cancelled', actor: SYSTEM, set: { cancellationReason: 'PICKUP_TIME_EXCEEDED' } } as const;
  const dbReturning = (result: unknown) => ({ transaction: vi.fn(async () => result) }) as never;
  const flush = () => new Promise((r) => setTimeout(r, 5));
  let seen: unknown[];
  let off: () => void;
  beforeEach(() => {
    seen = [];
    off = onTransitionCommitted((t) => void seen.push(t));
  });
  afterEach(() => off());

  it('fires after a committed Picked Up -> Delivered / Cancelled', async () => {
    const ok = { ok: true, sequenceNumber: 7 };
    expect(await transition(dbReturning(ok), deliver)).toEqual(ok);
    expect(await transition(dbReturning(ok), cancel)).toEqual(ok);
    await flush();
    expect(seen).toEqual([
      { errandId: ERRAND, expected: 'Picked Up', to: 'Delivered', type: undefined },
      { errandId: ERRAND, expected: 'Picked Up', to: 'Cancelled', type: undefined },
    ]);
  });

  it('does not fire on a replay or a refused result', async () => {
    await transition(dbReturning({ ok: true, sequenceNumber: 7, replayed: true }), deliver);
    await transition(dbReturning({ ok: false, reason: 'FORBIDDEN' }), deliver);
    await transition(dbReturning({ ok: false, reason: 'STATE_MISMATCH', currentStatus: 'Delivered' }), deliver);
    await flush();
    expect(seen).toEqual([]);
  });

  it('does not fire when the input is refused before the transaction', async () => {
    const db = dbReturning({ ok: true, sequenceNumber: 1 });
    const r = await transition(db, { ...deliver, set: {} });
    expect(r).toEqual({ ok: false, reason: 'INVALID_FIELDS' });
    await flush();
    expect(seen).toEqual([]);
  });

  it('leaves the result unchanged when a listener throws or rejects', async () => {
    const offs = [
      onTransitionCommitted(() => { throw new Error('sync'); }),
      onTransitionCommitted(async () => { throw new Error('async'); }),
    ];
    try {
      const ok = { ok: true, sequenceNumber: 9 };
      await expect(transition(dbReturning(ok), deliver)).resolves.toEqual(ok);
      await flush();
      expect(seen).toHaveLength(1); // the well-behaved listener still ran
    } finally {
      offs.forEach((f) => f());
    }
  });

  it('propagates a transaction failure and notifies nobody', async () => {
    const db = { transaction: vi.fn(async () => { throw new Error('db down'); }) } as never;
    await expect(transition(db, deliver)).rejects.toThrow('db down');
    await flush();
    expect(seen).toEqual([]);
  });
});

describe('OsrmRoutingProvider', () => {
  const from = { lat: 1.3, lng: 103.8 };
  const to = { lat: 1.35, lng: 103.9 };
  const ok = (body: unknown, status = 200) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status }));
  const make = (fetchFn: typeof fetch, timeoutMs = 50) =>
    new OsrmRoutingProvider({ baseUrl: 'http://osrm:5000/', timeoutMs, fetchFn, now: () => 42 });

  it('calls the foot profile with lng,lat order and maps the route', async () => {
    const f = ok({ code: 'Ok', routes: [{ distance: 12, duration: 3, geometry: { coordinates: [[103.8, 1.3], [103.9, 1.35]] } }] });
    const r = await make(f as never).route(from, to);
    expect(f).toHaveBeenCalledWith(
      'http://osrm:5000/route/v1/foot/103.8,1.3;103.9,1.35?overview=full&geometries=geojson',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(r).toEqual({ polyline: [[103.8, 1.3], [103.9, 1.35]], distanceM: 12, durationS: 3, computedAt: 42 });
  });

  it('returns null on NoRoute, non-200, malformed bodies, network errors and timeouts', async () => {
    expect(await make(ok({ code: 'NoRoute', routes: [] }) as never).route(from, to)).toBeNull();
    expect(await make(ok({ code: 'Ok' }, 500) as never).route(from, to)).toBeNull();
    expect(await make(ok({ nonsense: true }) as never).route(from, to)).toBeNull();
    expect(await make((async () => { throw new TypeError('down'); }) as never).route(from, to)).toBeNull();
    const hang = ((_: string, init: RequestInit) =>
      new Promise((_res, rej) => init.signal!.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))))) as never;
    expect(await make(hang, 20).route(from, to)).toBeNull();
  });
});

describe('tracking env', () => {
  const base = {
    DB_HOST: 'h', DB_PORT: '5432', DB_USERNAME: 'u', DB_DATABASE: 'd', DB_PASSWORD_FILE: '/p',
    JWT_PUBLIC_KEY_FILE: '/k', RABBITMQ_USER: 'u', RABBITMQ_HOST: 'r', RABBITMQ_PORT: '5672',
    RABBITMQ_VHOST: '/', RABBITMQ_PASSWORD_FILE: '/p',
    REDIS_HOST: 'redis', REDIS_PORT: '6379', REDIS_USERNAME: 'order',
  };
  it('applies the contracted defaults', () => {
    const { value, error } = environmentSchema.validate(base);
    expect(error).toBeUndefined();
    expect(value).toMatchObject({
      REDIS_DB_INDEX: 1, TRACKING_LOCATION_TTL_S: 120, TRACKING_MIN_UPDATE_INTERVAL_MS: 1000,
      TRACKING_SSE_KEEPALIVE_MS: 20000, TRACKING_BBOX: [103.62, 1.22, 104.03, 1.47],
      TRACKING_ROUTE_TTL_S: 600, TRACKING_REROUTE_DISTANCE_M: 50,
      OSRM_BASE_URL: 'http://osrm:5000', OSRM_TIMEOUT_MS: 3000,
    });
  });
  it('defaults the stream caps and validates them', () => {
    expect(environmentSchema.validate(base).value).toMatchObject({
      TRACKING_MAX_STREAMS_PER_ERRAND: 5,
      TRACKING_MAX_STREAMS_PER_USER: 10,
    });
    expect(environmentSchema.validate({ ...base, TRACKING_MAX_STREAMS_PER_USER: '0' }).error).toBeDefined();
  });
  it('requires REDIS_HOST/PORT/USERNAME', () => {
    for (const k of ['REDIS_HOST', 'REDIS_PORT', 'REDIS_USERNAME']) {
      const { [k as keyof typeof base]: _, ...rest } = base;
      expect(environmentSchema.validate(rest).error).toBeDefined();
    }
  });
  it('parses and validates the bbox', () => {
    expect(environmentSchema.validate({ ...base, TRACKING_BBOX: '1,2,3,4' }).value.TRACKING_BBOX).toEqual([1, 2, 3, 4]);
    for (const bad of ['1,2,3', '3,2,1,4', '1,4,3,2', 'a,b,c,d', '1,2,3,', '1,2,3,4,5', '-200,0,0,1', '0,0,10,95']) {
      expect(environmentSchema.validate({ ...base, TRACKING_BBOX: bad }).error).toBeDefined();
    }
  });
});
