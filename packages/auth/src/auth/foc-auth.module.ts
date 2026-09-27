import {
  DynamicModule,
  Module,
  type FactoryProvider,
  type ModuleMetadata,
} from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ACCESS_TOKEN_ISSUER } from '@foc/contracts';
import { AccessTokenVerifier } from '../access-token/access-token-verifier.js';
import { AdminGuard } from './guards/admin.guard.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { RolesGuard } from './guards/roles.guard.js';

export interface FocAuthModuleOptions {
  /**
   * PEM contents of the public key used to verify user-service access tokens
   */
  publicKey: string;
}

export interface FocAuthModuleAsyncOptions {
  /**
   * Modules to import so the injected dependencies (e.g. the service's secret
   * module) are resolvable, mirroring Nest's JwtModule.registerAsync.
   */
  imports?: ModuleMetadata['imports'];
  inject?: FactoryProvider['inject'];
  useFactory: (
    ...args: any[]
  ) => FocAuthModuleOptions | Promise<FocAuthModuleOptions>;
}

/**
 * Registers the shared access-token verifier and the standard guards
 * (JwtAuthGuard, RolesGuard, AdminGuard) for FocAuth consuming services.
 *
 * The module is global: a service imports it once (typically in AppModule)
 * and any controller can apply the guards with `@UseGuards` without importing
 * the module again.
 */
@Module({})
export class FocAuthModule {
  static register(options: FocAuthModuleOptions): DynamicModule {
    return {
      module: FocAuthModule,
      global: true,
      imports: [
        JwtModule.register({
          publicKey: options.publicKey,
          verifyOptions: {
            algorithms: ['RS256'],
            issuer: ACCESS_TOKEN_ISSUER,
          },
        }),
      ],
      providers: [AccessTokenVerifier, JwtAuthGuard, RolesGuard, AdminGuard],
      exports: [AccessTokenVerifier, JwtAuthGuard, RolesGuard, AdminGuard],
    };
  }

  static registerAsync(asyncOptions: FocAuthModuleAsyncOptions): DynamicModule {
    const { imports = [], inject = [], useFactory } = asyncOptions;

    return {
      module: FocAuthModule,
      global: true,
      imports: [
        // We use JwtModule's register async factory to nest the
        // user-provided factory in. We obtain the public key
        // from the user-provided factory and return a
        // JwtModuleOptions object.
        JwtModule.registerAsync({
          // Forward user-provided imports so user factory doesn't
          // fail to resolve its imports/injects
          imports,
          inject,
          useFactory: async (...args: unknown[]) => {
            // Call user-provided factory to obtain public key
            const { publicKey } = await useFactory(...args);
            return {
              publicKey,
              verifyOptions: {
                algorithms: ['RS256'],
                issuer: ACCESS_TOKEN_ISSUER,
              },
            };
          },
        }),
      ],
      providers: [AccessTokenVerifier, JwtAuthGuard, RolesGuard, AdminGuard],
      exports: [AccessTokenVerifier, JwtAuthGuard, RolesGuard, AdminGuard],
    };
  }
}
