const fs = require('fs');
const path = require('path');
const { parseBucketsXml, extractTag } = require('../../servicenow/discovery/lib/parseObsBucketsXml');

const fixtureXml = fs.readFileSync(
  path.join(__dirname, '../../servicenow/discovery/fixtures/obs-list-buckets-response.xml'),
  'utf8'
);

describe('parseBucketsXml', () => {
  it('parses every <Bucket> block into an object', () => {
    const buckets = parseBucketsXml(fixtureXml);
    expect(buckets).toEqual([
      { name: 'sandbox-1-obs', creationDate: '2026-07-24T03:12:45.032Z', location: 'af-south-1', bucketType: 'OBJECT' },
      { name: 'sandbox-1-obs-secondary', creationDate: '2026-07-20T09:01:11.500Z', location: 'af-south-1', bucketType: 'OBJECT' }
    ]);
  });

  it('returns an empty array for a response with no buckets', () => {
    const empty = '<ListAllMyBucketsResult><Owner><ID>x</ID></Owner><Buckets></Buckets></ListAllMyBucketsResult>';
    expect(parseBucketsXml(empty)).toEqual([]);
  });

  it('returns an empty array for empty/undefined input', () => {
    expect(parseBucketsXml('')).toEqual([]);
    expect(parseBucketsXml(undefined)).toEqual([]);
  });
});

describe('extractTag', () => {
  it('extracts a single tag value', () => {
    expect(extractTag('<Name>foo</Name>', 'Name')).toBe('foo');
  });

  it('returns empty string when the tag is missing', () => {
    expect(extractTag('<Other>foo</Other>', 'Name')).toBe('');
  });
});
