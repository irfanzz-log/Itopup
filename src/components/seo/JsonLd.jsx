// ============================================================================
// One JSON-LD <script> tag.
//
// Usage: <JsonLd data={websiteJsonLd()} />
//
// A page composes ONE graph in its server component and renders this once.
// Splitting it across components risks emitting two nodes of the same type for
// one page, which Search Console reports as a duplicate structured data error.
// If a page needs several nodes it builds a { "@context", "@graph": [...] }
// object itself and passes it here.
// ============================================================================
export default function JsonLd({ data }) {
  if (!data) return null;

  let json;
  try {
    json = JSON.stringify(data);
  } catch {
    // Never render a malformed script tag: it would be reported as invalid
    // structured data. Dropping it is the only safe degradation.
    return null;
  }

  return (
    <script
      type="application/ld+json"
      // JSON.stringify output cannot contain "</script>" unless the data
      // contains a literal closing tag, which this builder never produces.
      // React escapes "<" in children by default; keeping the script body as a
      // raw string here is the standard pattern for JSON-LD.
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
