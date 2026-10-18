import { readFileSync } from 'node:fs';

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), 'utf8');

/** Names set in an env file (KEY=value lines, comments ignored). */
function definedNames(envFile: string): Set<string> {
  return new Set(
    envFile
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => line.slice(0, line.indexOf('=')).trim()),
  );
}

/** Names compose.yml interpolates, e.g. ${RABBITMQ_HOST:-rabbitmq}. */
function interpolatedNames(composeFile: string): Set<string> {
  return new Set(
    [...composeFile.matchAll(/\$\{([A-Z0-9_]+)/g)].map(([, name]) => name),
  );
}

describe('env/supplier-service.env.example', () => {
  const example = definedNames(
    read('../../../env/supplier-service.env.example'),
  );
  const shared = definedNames(read('../../../env/shared.env.example'));
  const compose = interpolatedNames(read('../../compose.yml'));

  // Compose reads env/shared.env and env/supplier-service.env together, so an
  // unprefixed name here would override the shared value inside the container
  // (a RABBITMQ_HOST=localhost once hid the broker from the stack smoke test).
  // Only NODE_ENV is allowed: its value is the same in both files.
  it('sets no unprefixed variable that compose.yml takes from the shared settings', () => {
    const overriding = [...compose].filter(
      (name) =>
        !name.startsWith('SUPPLIER_') &&
        name !== 'NODE_ENV' &&
        example.has(name),
    );

    expect(overriding).toEqual([]);
  });

  it('takes the broker connection from the shared settings', () => {
    for (const name of ['RABBITMQ_HOST', 'RABBITMQ_PORT', 'RABBITMQ_VHOST']) {
      expect(compose.has(name)).toBe(true);
      expect(shared.has(name)).toBe(true);
    }
  });
});
