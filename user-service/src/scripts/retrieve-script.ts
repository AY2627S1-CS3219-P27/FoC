import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
//
// Redis scripts live as raw Lua files in ../scripts so they can be edited with
// Lua IDE tooling (language server, luacheck, etc.). The Nest CLI copies them
// into dist alongside the compiled output (see nest-cli.json `assets`), so the
// same relative path resolves both in src (tests) and dist (production).
const loadScript = (name: string) =>
  readFileSync(
    fileURLToPath(new URL(`../scripts/${name}`, import.meta.url)),
    'utf8',
  );

export const getCreateOtpScript = () => {
  return loadScript('create-otp.lua');
};

export const getValidateOtpScript = () => {
  return loadScript('validate-otp.lua');
};

export const getRegisterUserScript = () => {
  return loadScript('register-user.lua');
};
