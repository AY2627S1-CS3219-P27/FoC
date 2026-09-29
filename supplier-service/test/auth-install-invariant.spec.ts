import { existsSync, lstatSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const serviceDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const authPackageDir = resolve(serviceDir, 'node_modules/@foc/auth');

/**
 * Guards the @foc/auth packaging invariant (docs/adr/0001): the package must
 * be installed as a packed copy inside the service's own node_modules, with
 * its NestJS dependencies resolving to the SAME copies the service uses.
 * A second @nestjs/common copy breaks Nest's exception handling — thrown
 * UnauthorizedExceptions are missed by the app's filter and surface as 500s.
 */
describe('@foc/auth installation', () => {
  it('is installed as a packed copy, not a symlink, with no nested deps', () => {
    expect(existsSync(authPackageDir)).toBe(true);
    expect(lstatSync(authPackageDir).isSymbolicLink()).toBe(false);
    expect(existsSync(resolve(authPackageDir, 'node_modules'))).toBe(false);
  });

  it('resolves NestJS from the same copies the service uses', () => {
    // Resolution is anchored at each package so this runs regardless of which
    // spec file path vitest reports.
    const requireFromService = createRequire(
      resolve(serviceDir, 'package.json'),
    );
    const requireFromAuth = createRequire(
      resolve(authPackageDir, 'package.json'),
    );

    for (const moduleName of ['@nestjs/common', '@nestjs/core']) {
      const fromService = requireFromService.resolve(moduleName);
      const fromAuth = requireFromAuth.resolve(moduleName);
      expect(
        fromAuth,
        `${moduleName} must not be duplicated for @foc/auth`,
      ).toBe(fromService);
    }
  });
});
