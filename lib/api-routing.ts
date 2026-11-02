type RoutingOptions = {
  primary: string;
  fallback?: string;
  fetch?: typeof fetch;
  preferenceDelay?: number;
  probeTimeout?: number;
  recoveryInterval?: number;
  headerTimeout?: number;
  onChange?: (base: string) => void;
};

export async function readStreamChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  idleTimeout = 45000,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Steer stream heartbeat timed out.')),
          idleTimeout,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Both endpoints must serve the same installation and share authentication.
// Selection uses real HTTPS health responses, rather than IPv6 feature detection.
export function createAPIRouter(options: RoutingOptions) {
  const primary = options.primary.replace(/\/$/, '');
  const fallback = options.fallback?.replace(/\/$/, '');
  const enabled = Boolean(fallback && fallback !== primary);
  const send: typeof fetch = (...args) => (options.fetch ?? fetch)(...args);
  let active = primary;
  let selected = !enabled;
  let selection: Promise<string> | undefined;
  let lastRecovery = 0;
  let recovering = false;
  let generation = 0;

  function select(base: string) {
    if (base === fallback && active !== fallback) lastRecovery = Date.now();
    active = base;
    selected = true;
    options.onChange?.(base);
    return base;
  }

  async function probe(base: string, signal?: AbortSignal) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      options.probeTimeout ?? (base === primary ? 2500 : 20000),
    );
    try {
      const response = await send(`${base}/health`, {
        method: 'GET',
        cache: 'no-store',
        credentials: 'omit',
        signal: signal
          ? AbortSignal.any([signal, controller.signal])
          : controller.signal,
      });
      const body = await response.json();
      if (!response.ok || body.service !== 'steer' || body.status !== 'ok')
        throw new Error('Steer endpoint is unavailable.');
      return base;
    } finally {
      clearTimeout(timeout);
    }
  }

  function choose(): Promise<string> {
    if (selected) return Promise.resolve(active);
    if (selection) return selection;
    const currentGeneration = generation;
    const controller = new AbortController();
    selection = new Promise<string>((resolve, reject) => {
      let settled = false;
      let failures = 0;
      let fallbackStarted = false;
      const finish = (base: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        controller.abort();
        resolve(currentGeneration === generation ? select(base) : active);
      };
      const failed = () => {
        if (++failures === 2 && !settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error('Neither Steer connection is reachable.'));
        }
      };
      const startFallback = () => {
        if (fallbackStarted || settled) return;
        fallbackStarted = true;
        void probe(fallback!, controller.signal).then(finish, failed);
      };
      const timer = setTimeout(startFallback, options.preferenceDelay ?? 400);
      void probe(primary, controller.signal).then(finish, () => {
        failed();
        startFallback();
      });
    }).finally(() => {
      selection = undefined;
    });
    return selection;
  }

  function recoverDirect() {
    if (
      !enabled ||
      active === primary ||
      recovering ||
      Date.now() - lastRecovery < (options.recoveryInterval ?? 60000)
    )
      return;
    recovering = true;
    lastRecovery = Date.now();
    const currentGeneration = generation;
    void probe(primary)
      .then(() => {
        if (generation === currentGeneration) select(primary);
      })
      .catch(() => {})
      .finally(() => {
        recovering = false;
      });
  }

  function failed(base: string) {
    // A failing fallback is not evidence that the preferred route recovered.
    // Keep the circuit on fallback until its independent health probe proves
    // direct access is usable; otherwise concurrent requests oscillate between
    // two bad routes and create a preflight storm in IPv4-only browsers.
    if (!enabled || base !== active || base !== primary) return;
    generation++;
    lastRecovery = Date.now();
    select(fallback!);
  }

  function retryTarget(base: string) {
    if (base === primary) return fallback;
    // A preferred-route recovery probe may have succeeded while an older
    // fallback request was still in flight. Only that proven state permits a
    // retry from fallback to primary.
    return active !== base ? active : undefined;
  }

  function retryable(init?: RequestInit) {
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'GET' || method === 'HEAD') return true;
    return (
      new Headers(init?.headers).has('Idempotency-Key') &&
      !(init?.body instanceof ReadableStream)
    );
  }

  async function fetchFrom(base: string, path: string, init?: RequestInit) {
    if (!enabled) return send(`${base}${path}`, init);
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      options.headerTimeout ?? 30000,
    );
    try {
      return await send(`${base}${path}`, {
        ...init,
        signal: init?.signal
          ? AbortSignal.any([init.signal, controller.signal])
          : controller.signal,
      });
    } finally {
      // Only bound the wait for headers. Never impose a deadline on SSE bodies.
      clearTimeout(timer);
    }
  }

  return {
    get baseURL() {
      return active;
    },
    // Streams call this on transport failure; their owner resumes with its
    // existing event cursor. A route change must never create a new task.
    failed,
    async fetch(path: string, init?: RequestInit): Promise<Response> {
      init?.signal?.throwIfAborted();
      const base = await choose();
      init?.signal?.throwIfAborted();
      recoverDirect();
      const canRetry = retryable(init);
      try {
        const response = await fetchFrom(base, path, init);
        if (!enabled || ![502, 503, 504].includes(response.status))
          return response;
        failed(base);
        const target = retryTarget(base);
        if (!canRetry || !target) return response;
        await response.body?.cancel().catch(() => {});
        return fetchFrom(target, path, init);
      } catch (error) {
        if (!enabled || init?.signal?.aborted) throw error;
        failed(base);
        // Writes without an idempotency key may already have been committed.
        if (!canRetry) throw error;
        const target = retryTarget(base);
        if (!target) throw error;
        return fetchFrom(target, path, init);
      }
    },
  };
}
