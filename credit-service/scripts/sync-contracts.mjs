import { readFile, readdir, mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/**
 * Contract files used by Credit Service. Keeping this list explicit prevents
 * unrelated future contracts from being included in its deployment artifact.
 */
const CONTRACT_FILES = [
  'event-envelope.v1.schema.json',
  'user-registered.v1.schema.json',
  'credit-account-initialised.v1.schema.json',
];

const SOURCE_DIRECTORY = new URL('../../contracts/schemas/', import.meta.url);
const TARGET_DIRECTORIES = {
  source: new URL('../src/contracts/schemas/', import.meta.url),
  dist: new URL('../dist/contracts/schemas/', import.meta.url),
};

async function loadCanonicalContracts() {
  return Promise.all(
    CONTRACT_FILES.map(async (filename) => {
      const source = new URL(filename, SOURCE_DIRECTORY);
      let contents;

      try {
        contents = await readFile(source);
      } catch (error) {
        throw new Error(
          `Cannot read canonical contract ${fileURLToPath(source)}: ${error.message}`,
          { cause: error },
        );
      }

      try {
        JSON.parse(contents.toString('utf8'));
      } catch (error) {
        throw new Error(`Canonical contract ${filename} is not valid JSON`, {
          cause: error,
        });
      }

      return { filename, contents };
    }),
  );
}

async function clearGeneratedJson(targetDirectory) {
  const entries = await readdir(targetDirectory, { withFileTypes: true }).catch(
    (error) => {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    },
  );

  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => rm(new URL(entry.name, targetDirectory))),
  );
}

async function syncContracts(targetName) {
  const targetDirectory = TARGET_DIRECTORIES[targetName];
  if (!targetDirectory) {
    throw new Error(
      `Unknown target "${targetName ?? ''}". Expected one of: ${Object.keys(TARGET_DIRECTORIES).join(', ')}`,
    );
  }

  // Validate every canonical file before changing the generated directory so
  // a malformed contract cannot leave a partially refreshed schema set.
  const contracts = await loadCanonicalContracts();
  await mkdir(targetDirectory, { recursive: true });
  await clearGeneratedJson(targetDirectory);
  await Promise.all(
    contracts.map(({ filename, contents }) =>
      writeFile(new URL(filename, targetDirectory), contents),
    ),
  );

  console.log(
    `Synchronized ${contracts.length} contracts to ${fileURLToPath(targetDirectory)}`,
  );
}

syncContracts(process.argv[2]).catch((error) => {
  console.error(`Contract synchronization failed: ${error.message}`);
  process.exitCode = 1;
});
