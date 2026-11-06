import { readFileSync } from 'node:fs';
import { environmentSchema } from './environment.schema.js';

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

/** Names compose.yml interpolates, e.g. ${RAG_LOG_LEVEL:-log}. */
function interpolatedNames(composeFile: string): Set<string> {
  return new Set(
    [...composeFile.matchAll(/\$\{([A-Z0-9_]+)/g)].map(([, name]) => name),
  );
}

describe('env/rag-service.env.example', () => {
  const example = definedNames(read('../../../env/rag-service.env.example'));
  const shared = definedNames(read('../../../env/shared.env.example'));
  const compose = interpolatedNames(read('../../compose.yml'));

  // Compose reads env/shared.env and env/rag-service.env together, so a shared
  // name set here would override the shared value inside the container. Only
  // NODE_ENV is allowed: its value is the same in both files.
  it('overrides no shared setting that compose.yml reads', () => {
    const overriding = [...compose].filter(
      (name) => shared.has(name) && name !== 'NODE_ENV' && example.has(name),
    );

    expect(overriding).toEqual([]);
  });

  // Every setting the app reads is listed (AGENTS.md): plain for a host run,
  // RAG_-prefixed for compose.
  it('lists every setting the app reads', () => {
    const keys = Object.keys(environmentSchema.describe().keys ?? {});
    const missing = keys.filter(
      (name) =>
        !example.has(name) && !example.has(`RAG_${name}`) && !shared.has(name),
    );

    expect(keys.length).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });
});
