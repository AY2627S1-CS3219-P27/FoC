#!/usr/bin/env node
// Prints a login token for the evaluation and for Postman, signed with
// user-service's private key, exactly as its login would issue one. For local
// use only: the key never leaves this machine, and the token lasts 1 hour.
//   node rag-service/scripts/sign-eval-token.mjs [path-to-private-key]
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const keyPath =
  process.argv[2] ??
  new URL('../../user-service/secrets/jwt_private_key.secret', import.meta.url)
    .pathname;
const encode = (value) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');
const now = Math.floor(Date.now() / 1000);

const unsigned = [
  encode({ alg: 'RS256', typ: 'JWT' }),
  encode({
    sub: 'e7a10000-0000-4000-8000-000000000001',
    email: 'rag-eval@u.nus.edu',
    displayName: 'RAG Evaluation',
    isAdmin: false,
    roles: [],
    iss: 'user-service',
    iat: now,
    exp: now + 3600,
  }),
].join('.');

const signature = createSign('RSA-SHA256')
  .update(unsigned)
  .sign(readFileSync(keyPath), 'base64url');
console.log(`${unsigned}.${signature}`);
