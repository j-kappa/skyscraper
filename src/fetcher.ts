const PROXIES = [
  (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
];

export async function fetchHTML(url: string): Promise<string> {
  let lastError: Error | null = null;

  for (const makeProxyUrl of PROXIES) {
    try {
      const proxyUrl = makeProxyUrl(url);
      const res = await fetch(proxyUrl, {
        headers: { Accept: 'text/html' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastError = err as Error;
    }
  }

  throw new Error(
    `Failed to fetch the site. ${lastError?.message ?? 'All proxies failed.'}`,
  );
}
