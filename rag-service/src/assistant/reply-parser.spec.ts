import { parseReply } from './reply-parser.js';

describe('parseReply', () => {
  it('splits the answer from its sources', () => {
    expect(parseReply('Yes you can.\n\nSOURCES: 1,3', 4)).toEqual({
      kind: 'answer',
      answer: 'Yes you can.',
      sectionIndexes: [0, 2],
    });
  });

  it.each([
    ['extra spaces', 'A.\nSOURCES:  2 , 1 ', [0, 1]],
    ['lower case', 'A.\nsources: 2', [1]],
    ['a repeat', 'A.\nSOURCES: 2,2', [1]],
    ['numbers it was never given', 'A.\nSOURCES: 2,9,0,-1', [1]],
  ])('handles %s', (_case, raw, sectionIndexes) => {
    expect(parseReply(raw, 2)).toMatchObject({ sectionIndexes });
  });

  it.each([
    ['no line', 'A.'],
    ['only invalid numbers', 'A.\nSOURCES: 9'],
    ['words instead of numbers', 'A.\nSOURCES: the first one'],
  ])('lists every section sent when there is %s', (_case, raw) => {
    expect(parseReply(raw, 2)).toMatchObject({ sectionIndexes: [0, 1] });
  });

  it('does not mistake the word "sources" in a sentence for the line', () => {
    expect(parseReply('The sources: are fine.\nSOURCES: 1', 2)).toEqual({
      kind: 'answer',
      answer: 'The sources: are fine.',
      sectionIndexes: [0],
    });
  });

  it.each([
    ['exactly the marker', '[NO_ANSWER]'],
    ['the marker with spaces', '  [NO_ANSWER]\n'],
    ['the marker after words', 'Sorry. [NO_ANSWER]'],
  ])('treats %s as declined', (_case, raw) => {
    expect(parseReply(raw, 2)).toEqual({ kind: 'no-answer' });
  });

  it.each([
    ['nothing', ''],
    ['only spaces', '  \n '],
    ['only a sources line', 'SOURCES: 1'],
  ])('treats %s as empty', (_case, raw) => {
    expect(parseReply(raw, 2)).toEqual({ kind: 'empty' });
  });
});
