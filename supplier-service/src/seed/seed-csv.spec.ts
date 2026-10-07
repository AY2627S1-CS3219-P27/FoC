import { decodeSeedLines, parseCsvLine, readSeedCsv } from './seed-csv.js';

const bytes = (...parts: (string | number[])[]) =>
  Uint8Array.from(
    parts.flatMap((part) =>
      typeof part === 'string' ? [...Buffer.from(part, 'utf8')] : part,
    ),
  );

describe('decodeSeedLines', () => {
  it('reads CRLF lines and drops the trailing empty line', () => {
    expect(decodeSeedLines(bytes('a,b\r\n1,2\r\n'))).toEqual(['a,b', '1,2']);
  });

  it('falls back to Windows-1252 only for lines that are not UTF-8 (F12.3)', () => {
    // 0x92 is a right single quote in Windows-1252 and invalid in UTF-8.
    const lines = decodeSeedLines(
      bytes('Café\r\n', 'Prince George', [0x92], 's Park\r\n'),
    );
    expect(lines).toEqual(['Café', 'Prince George’s Park']);
  });
});

describe('parseCsvLine', () => {
  it('splits on commas', () => {
    expect(parseCsvLine('Cool Spot,Food,Com2')).toEqual([
      'Cool Spot',
      'Food',
      'Com2',
    ]);
  });

  it('keeps commas inside quotes and unescapes doubled quotes', () => {
    expect(
      parseCsvLine('Supersnacks,"At level 1, Block 10","say ""hi"""'),
    ).toEqual(['Supersnacks', 'At level 1, Block 10', 'say "hi"']);
  });

  it('keeps empty cells', () => {
    expect(parseCsvLine('a,,c,')).toEqual(['a', '', 'c', '']);
  });
});

describe('readSeedCsv', () => {
  it('keys cells by trimmed header and numbers lines from the header', () => {
    const rows = readSeedCsv(
      bytes('Name, Floor\r\n Cool Spot ,1\r\n\r\nNUS Co-op,2\r\n'),
    );

    expect(rows).toEqual([
      { line: 2, values: { Name: 'Cool Spot', Floor: '1' } },
      { line: 4, values: { Name: 'NUS Co-op', Floor: '2' } },
    ]);
  });

  it('flags a row with the wrong number of cells', () => {
    const [row] = readSeedCsv(bytes('Name,Floor\r\nCool Spot,1,extra\r\n'));
    expect(row.cellCountMismatch).toEqual({ expected: 2, found: 3 });
  });
});
