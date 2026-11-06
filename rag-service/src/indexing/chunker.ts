import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** One section of a help document, before it gets an embedding. */
export interface DocumentChunk {
  document: string;
  title: string;
  section: string;
  service: string;
  text: string;
}

/**
 * A document that breaks the format rules. Indexing stops rather than skipping
 * it, because a half-built index would make the bot lose whole topics.
 */
export class InvalidDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDocumentError';
  }
}

/** Reads the `key: value` lines of a document's header. */
function readFrontMatter(
  document: string,
  content: string,
): { fields: Map<string, string>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(content);
  if (!match) {
    throw new InvalidDocumentError(`${document} has no front matter`);
  }

  const fields = new Map<string, string>();
  for (const line of match[1].split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon > 0) {
      fields.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
    }
  }
  return { fields, body: content.slice(match[0].length) };
}

/**
 * Splits one Markdown document into one chunk per `##` heading. Words before
 * the first heading are not indexed. Lines inside a code block never count as
 * headings, and HTML comments are dropped.
 */
export function chunkDocument(
  document: string,
  content: string,
): DocumentChunk[] {
  const { fields, body } = readFrontMatter(document, content);
  const title = fields.get('title');
  const service = fields.get('service');
  if (!title || !service) {
    throw new InvalidDocumentError(
      `${document} needs a title and a service in its front matter`,
    );
  }

  const sections: { section: string; lines: string[] }[] = [];
  let inCodeBlock = false;
  for (const line of body.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/)) {
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
    }
    if (!inCodeBlock && line.startsWith('## ')) {
      sections.push({ section: line.slice(3).trim(), lines: [] });
    } else {
      sections.at(-1)?.lines.push(line);
    }
  }

  const seen = new Set<string>();
  const chunks: DocumentChunk[] = [];
  for (const { section, lines } of sections) {
    const text = lines.join('\n').trim();
    if (seen.has(section)) {
      throw new InvalidDocumentError(
        `${document} repeats the heading "${section}"`,
      );
    }
    seen.add(section);
    if (text.length > 0) {
      chunks.push({ document, title, section, service, text });
    }
  }
  return chunks;
}

/**
 * Every chunk of every `.md` file in a folder, in a stable order. Fails when
 * there is nothing to index: an empty or missing folder must never be able to
 * wipe the existing index.
 */
export async function chunkFolder(folder: string): Promise<DocumentChunk[]> {
  const names = (await readdir(folder))
    .filter((name) => name.endsWith('.md'))
    .sort();

  const chunks: DocumentChunk[] = [];
  for (const name of names) {
    chunks.push(
      ...chunkDocument(name, await readFile(join(folder, name), 'utf8')),
    );
  }
  if (chunks.length === 0) {
    throw new InvalidDocumentError(`No help documents found in ${folder}`);
  }
  return chunks;
}

/**
 * What the embedding model reads. The title and question-style heading go in
 * with the words, so a student's question can match the heading too.
 */
export function embeddingInput(chunk: DocumentChunk): string {
  return `${chunk.title}: ${chunk.section}\n\n${chunk.text}`;
}
