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

  // ── ESCAPE BEFORE INJECTING ───────────────────────────────────────────────
  //
  // A `<script>` element's content is RAW TEXT: the HTML parser does not decode
  // entities inside it, and it terminates the element at the first literal
  // `</script`. `JSON.stringify` does NOT escape `/` or `<`, so a name of
  // `</script><img src=x onerror=...>` closes this tag and injects live markup
  // into the page. The data here is not always ours: `name` comes from
  // Game.name / Product.name, which an operator types in /dev/products, so this
  // was a stored-XSS sink for anyone who could edit the catalogue.
  //
  // Escaping `<`, `>` and `&` as JSON unicode escapes is the documented safe
  // pattern: the value is unchanged once parsed as JSON, but no byte sequence in
  // the output can close the element or open a new tag.
  const safe = json
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  );
}
