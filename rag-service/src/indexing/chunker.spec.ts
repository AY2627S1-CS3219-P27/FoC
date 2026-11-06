import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  chunkDocument,
  chunkFolder,
  embeddingInput,
  InvalidDocumentError,
} from './chunker.js';

const HEADER = `---
title: Errands
service: order-service
audience: user
---
`;

describe('chunkDocument', () => {
  it('makes one chunk per ## heading, keeping its title and service', () => {
    const chunks = chunkDocument(
      'errands.md',
      `${HEADER}
# Errands

Not indexed.

## What is an errand?

One request.

### A detail

Stays in the section.

## Can I cancel?

Yes.
`,
    );

    expect(chunks).toEqual([
      {
        document: 'errands.md',
        title: 'Errands',
        section: 'What is an errand?',
        service: 'order-service',
        text: 'One request.\n\n### A detail\n\nStays in the section.',
      },
      {
        document: 'errands.md',
        title: 'Errands',
        section: 'Can I cancel?',
        service: 'order-service',
        text: 'Yes.',
      },
    ]);
  });

  it('does not treat a line in a code block as a heading', () => {
    const [chunk] = chunkDocument(
      'a.md',
      `${HEADER}## Real\n\n\`\`\`\n## not a heading\n\`\`\`\n`,
    );

    expect(chunk.section).toBe('Real');
    expect(chunk.text).toContain('## not a heading');
  });

  it('drops HTML comments and skips a section left empty', () => {
    const chunks = chunkDocument(
      'a.md',
      `${HEADER}## Empty\n\n<!-- a note -->\n\n## Full\n\nWords <!-- gone -->here.\n`,
    );

    expect(chunks.map(({ section }) => section)).toEqual(['Full']);
    expect(chunks[0].text).toBe('Words here.');
  });

  it('handles Windows line endings', () => {
    const chunks = chunkDocument(
      'a.md',
      '---\r\ntitle: T\r\nservice: s\r\n---\r\n## One\r\n\r\nWords.\r\n',
    );

    expect(chunks).toMatchObject([{ section: 'One', text: 'Words.' }]);
  });

  it.each([
    ['no front matter', '## One\n\nWords.\n'],
    ['no title', '---\nservice: s\n---\n## One\n\nWords.\n'],
    ['no service', '---\ntitle: T\n---\n## One\n\nWords.\n'],
    ['a repeated heading', `${HEADER}## One\n\nA.\n\n## One\n\nB.\n`],
  ])('rejects a document with %s', (_case, content) => {
    expect(() => chunkDocument('a.md', content)).toThrow(InvalidDocumentError);
  });
});

describe('chunkFolder', () => {
  let folder: string;

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'rag-chunker-'));
  });

  afterEach(() => {
    rmSync(folder, { recursive: true, force: true });
  });

  it('reads only .md files, in a stable order', async () => {
    writeFileSync(join(folder, 'b.md'), `${HEADER}## B\n\nWords.\n`);
    writeFileSync(join(folder, 'a.md'), `${HEADER}## A\n\nWords.\n`);
    writeFileSync(join(folder, 'notes.txt'), 'ignored');

    const chunks = await chunkFolder(folder);

    expect(chunks.map(({ document }) => document)).toEqual(['a.md', 'b.md']);
  });

  it('refuses an empty folder, so it cannot wipe the index', async () => {
    await expect(chunkFolder(folder)).rejects.toThrow(InvalidDocumentError);
  });

  it('refuses a missing folder', async () => {
    await expect(chunkFolder(join(folder, 'nope'))).rejects.toThrow();
  });

  // The real documents: a broken one would stop every re-index.
  it('accepts every document in docs/support/', async () => {
    const chunks = await chunkFolder(
      new URL('../../../docs/support', import.meta.url).pathname,
    );

    expect(chunks.length).toBeGreaterThan(50);
    expect(new Set(chunks.map(({ document }) => document)).size).toBe(11);
  });
});

describe('embeddingInput', () => {
  it('includes the title and heading with the words', () => {
    expect(
      embeddingInput({
        document: 'a.md',
        title: 'Errands',
        section: 'Can I cancel?',
        service: 's',
        text: 'Yes.',
      }),
    ).toBe('Errands: Can I cancel?\n\nYes.');
  });
});
