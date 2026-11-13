// Minimal GitHub REST client (Node 24 global fetch, no dependencies). Errors are thrown; each script's main reports them.

// sleep is injectable so tests do not wait; backoffMs holds the pause before each retry (so its length + 1 attempts).
export type GitHubOptions = { token: string; baseUrl?: string; sleep?: (ms: number) => Promise<void>; backoffMs?: readonly number[] };
export type RequestOptions = { method?: string; body?: unknown };
export type GitHub = {
  request<T>(path: string, init?: RequestOptions): Promise<T>;
  // All items of a list endpoint, at most maxPages pages of 100.
  paginate<T>(path: string, maxPages: number): Promise<T[]>;
};

const DEFAULT_BASE_URL = 'https://api.github.com';
export const PAGE_SIZE = 100;
const MAX_ERROR_BODY = 500;
const BACKOFF_MS: readonly number[] = [1000, 3000];
const sleepFor = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function github({ token, baseUrl = DEFAULT_BASE_URL, sleep = sleepFor, backoffMs = BACKOFF_MS }: GitHubOptions): GitHub {
  if (!token) throw new Error('GitHub token is empty');

  // One attempt. A 5xx or a network error is retryable; a 4xx is not (the request itself is wrong).
  async function attempt<T>(path: string, method: string, init: RequestOptions): Promise<{ value: T } | { error: Error; retry: boolean }> {
    let response: Response;
    try {
      response = await fetch(baseUrl + path, {
        method,
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${token}`,
          'x-github-api-version': '2022-11-28',
          ...(init.body ? { 'content-type': 'application/json' } : {}),
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
      });
    } catch (error) {
      return { error: new Error(`GitHub API ${method} ${path} -> network error: ${(error as Error).message}`), retry: true };
    }
    if (!response.ok) {
      const body = (await response.text()).slice(0, MAX_ERROR_BODY);
      return { error: new Error(`GitHub API ${method} ${path} -> ${response.status}: ${body}`), retry: response.status >= 500 };
    }
    return { value: (await response.json()) as T };
  }

  async function request<T>(path: string, init: RequestOptions = {}): Promise<T> {
    const method = init.method ?? 'GET';
    for (let tries = 0; ; tries++) {
      const outcome = await attempt<T>(path, method, init);
      if ('value' in outcome) return outcome.value;
      if (!outcome.retry || tries >= backoffMs.length) throw outcome.error;
      console.error(`${outcome.error.message.split(': ')[0]}; retry ${tries + 1} of ${backoffMs.length} in ${backoffMs[tries]} ms`);
      await sleep(backoffMs[tries]);
    }
  }

  async function paginate<T>(path: string, maxPages: number): Promise<T[]> {
    const items: T[] = [];
    const separator = path.includes('?') ? '&' : '?';
    for (let page = 1; page <= maxPages; page++) {
      const batch = await request<T[]>(`${path}${separator}per_page=${PAGE_SIZE}&page=${page}`);
      items.push(...batch);
      if (batch.length < PAGE_SIZE) break;
    }
    return items;
  }

  return { request, paginate };
}

// The client a script builds from the Actions environment.
export function githubFromEnv(env: Record<string, string | undefined>): GitHub {
  const token = env.GITHUB_TOKEN?.trim();
  if (!token) throw new Error('GITHUB_TOKEN is not set');
  return github({ token, baseUrl: env.GITHUB_API_URL?.trim() || undefined });
}
