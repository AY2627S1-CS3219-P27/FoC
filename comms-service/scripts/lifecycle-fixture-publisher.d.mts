export interface FixtureRequest {
  list?: boolean;
  fixturePath?: string;
  routingKey?: string;
  selection?: string;
}

export const lifecycleFixtureManifest: Readonly<
  Record<string, { file: string; routingKey: string }>
>;
export const allowedLifecycleRoutingKeys: ReadonlySet<string>;
export function resolveFixtureRequest(
  arguments_: string[],
  cwd?: string,
): FixtureRequest;
export function publishFixture(input: {
  url: string | undefined;
  exchange?: string;
  routingKey: string;
  body: Buffer;
  connectBroker?: (url: string) => Promise<unknown> | unknown;
}): Promise<void>;
