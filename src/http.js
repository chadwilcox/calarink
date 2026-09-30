const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36';

// A build pulls every rink at once, and a big calendar feed can time out under that load
// (or a connection can drop), so a timeout or network error gets one more try. An HTTP
// error status is the site's answer and is not retried.
export async function fetchText(url, { timeoutMs = 30000, method = 'GET', body, headers } = {}) {
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        method, body,
        headers: { 'User-Agent': UA, Accept: 'text/html,text/calendar,*/*', ...headers },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return await res.text();
    } catch (err) {
      if (attempt < 2) continue;
      throw err;
    }
    throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  }
}
