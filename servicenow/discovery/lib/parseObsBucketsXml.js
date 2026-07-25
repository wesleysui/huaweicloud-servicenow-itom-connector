/**
 * Pure XML parsing for OBS's ListBuckets response.
 *
 * OBS's response is XML, not JSON - the only Huawei API family in this
 * project that isn't JSON (every other endpoint here - ECS/VPC/EVS/ELB/
 * RDS - returns JSON). Per Huawei's official docs, the shape is:
 *
 *   <ListAllMyBucketsResult xmlns="...">
 *     <Owner><ID>...</ID></Owner>
 *     <Buckets>
 *       <Bucket>
 *         <Name>examplebucket01</Name>
 *         <CreationDate>2018-06-21T09:15:01.032Z</CreationDate>
 *         <Location>region</Location>
 *         <BucketType>OBJECT</BucketType>
 *       </Bucket>
 *     </Buckets>
 *   </ListAllMyBucketsResult>
 *
 * Deliberately regex-based, not a full namespace-aware XML DOM parse
 * (e.g. ServiceNow's XMLDocument2): the response declares a default XML
 * namespace (xmlns="http://obs.<region>.myhuaweicloud.com/doc/2015-06-30/"),
 * and this project has no established, real-PDI-confirmed pattern yet for
 * namespace-aware node lookup in a ServiceNow scoped script - untested
 * platform behavior here carries the same kind of risk this project
 * avoided by hand-rolling crypto instead of trusting GlideRSA/GlideDigest
 * (see lib/pureJsSha1.js's header comment). The XML shape itself is fixed,
 * known, non-adversarial API output (not user input), so a targeted regex
 * extraction is safe and simple here, same tradeoff already accepted for
 * `_canonicalURI`/`_percentEncode` elsewhere in this project.
 */

/**
 * @param {string} xml - raw ListBuckets response body
 * @returns {{name: string, creationDate: string, location: string, bucketType: string}[]}
 */
function parseBucketsXml(xml) {
  xml = xml || '';
  var buckets = [];
  var bucketBlocks = xml.match(/<Bucket>[\s\S]*?<\/Bucket>/g) || [];

  bucketBlocks.forEach(function (block) {
    buckets.push({
      name: extractTag(block, 'Name'),
      creationDate: extractTag(block, 'CreationDate'),
      location: extractTag(block, 'Location'),
      bucketType: extractTag(block, 'BucketType')
    });
  });

  return buckets;
}

/**
 * @param {string} block
 * @param {string} tagName
 * @returns {string} the tag's text content, or '' if not found
 */
function extractTag(block, tagName) {
  var match = block.match(new RegExp('<' + tagName + '>([\\s\\S]*?)<\\/' + tagName + '>'));
  return match ? match[1] : '';
}

module.exports = { parseBucketsXml: parseBucketsXml, extractTag: extractTag };
