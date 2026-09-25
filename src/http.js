const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36';

export async function fetchText(url, { timeoutMs = 30000 } = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,text/calendar,*/*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res.text();
}
