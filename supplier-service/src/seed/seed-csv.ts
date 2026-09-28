const utf8 = new TextDecoder('utf-8', { fatal: true });
const windows1252 = new TextDecoder('windows-1252');

/** One data row of the seed file, keyed by header name. */
export interface SeedCsvRow {
  /** Line number in the file (the header is line 1), for rejection reports. */
  line: number;
  values: Record<string, string>;
  /** Set when the row has a different number of cells from the header. */
  cellCountMismatch?: { expected: number; found: number };
}

/**
 * Decodes the seed file line by line: each line is read as UTF-8, and a line
 * that is not valid UTF-8 is read as Windows-1252 instead (F12.3). The seed
 * file mixes both, e.g. "Prince George\x92s Park". Text is NFC-normalised.
 */
export function decodeSeedLines(bytes: Uint8Array): string[] {
  const lines: string[] = [];
  let start = 0;
  for (let index = 0; index <= bytes.length; index += 1) {
    if (index === bytes.length || bytes[index] === 0x0a) {
      let end = index;
      if (end > start && bytes[end - 1] === 0x0d) {
        end -= 1;
      }
      lines.push(decodeLine(bytes.subarray(start, end)).normalize('NFC'));
      start = index + 1;
    }
  }
  // A trailing newline leaves one empty final line.
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }
  return lines;
}

function decodeLine(bytes: Uint8Array): string {
  try {
    return utf8.decode(bytes);
  } catch {
    return windows1252.decode(bytes);
  }
}

/**
 * Splits one CSV line into cells per RFC 4180: fields may be wrapped in
 * double quotes to contain commas, and "" inside quotes is a literal quote.
 * The seed file has no quoted line breaks, so rows never span lines.
 */
export function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      cells.push(cell);
      cell = '';
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

/** Reads the whole seed file into header-keyed rows, skipping blank lines. */
export function readSeedCsv(bytes: Uint8Array): SeedCsvRow[] {
  const [headerLine, ...dataLines] = decodeSeedLines(bytes);
  if (headerLine === undefined) {
    return [];
  }
  const header = parseCsvLine(headerLine).map((name) => name.trim());

  const rows: SeedCsvRow[] = [];
  dataLines.forEach((text, offset) => {
    if (text.trim() === '') {
      return;
    }
    const cells = parseCsvLine(text);
    const values: Record<string, string> = {};
    header.forEach((name, column) => {
      values[name] = (cells[column] ?? '').trim();
    });
    rows.push({
      line: offset + 2,
      values,
      ...(cells.length !== header.length && {
        cellCountMismatch: { expected: header.length, found: cells.length },
      }),
    });
  });
  return rows;
}
