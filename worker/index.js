// Cloudflare Worker in front of calarink.com (GitHub Pages).
// Tells the page which US state the visitor appears to be in, so a first-time visitor
// from Maine opens Maine. Cloudflare already knows this from the request (request.cf),
// so no IP address goes anywhere else. Everything else passes through untouched.
//
// The page decides: a state in the address wins, then the visitor's last choice,
// then this hint, then the default state.

export default {
  async fetch(request) {
    const res = await fetch(request);
    const type = res.headers.get('content-type') || '';
    const cf = request.cf || {};
    if (!type.includes('text/html') || cf.country !== 'US' || !cf.regionCode) return res;

    const region = String(cf.regionCode).replace(/[^A-Z]/g, '').slice(0, 2);
    const out = new HTMLRewriter()
      .on('head', { element: el => el.append(`<meta name="visitor-region" content="${region}">`, { html: true }) })
      .transform(res);
    // The page now differs by visitor, so no shared cache may keep one visitor's copy.
    const headers = new Headers(out.headers);
    headers.set('Cache-Control', 'private, no-store');
    headers.append('Vary', 'CF-IPCountry');
    return new Response(out.body, { status: out.status, statusText: out.statusText, headers });
  },
};
