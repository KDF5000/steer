type RoutingOptions = {
  primary: string;
  fallback?: string;
  fetch?: typeof fetch;
  /** @deprecated Both routes are now probed concurrently. */
  preferenceDelay?: number;
  probeTimeout?: number;
  recoveryInterval?: number;
  routeEvaluationInterval?: number;
  routeHealthTTL?: number;
  switchMinSavings?: number;
  switchRatio?: number;
  failureThreshold?: number;
  headerTimeout?: number;
  onChange?: (base: string) => void;
};

type RouteHealth = {
  latency: number;
  lastSuccess: number;
  lastFailure: number;
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
// Route choice is based on real HTTPS reachability and latency. Browsers do not
// expose a dependable "has IPv6" API, so failed direct probes are the capability
// signal on IPv4-only networks.
export function createAPIRouter(options: RoutingOptions) {
  const primary = options.primary.replace(/\/$/, '');
  const fallback = options.fallback?.replace(/\/$/, '');
  const enabled = Boolean(fallback && fallback !== primary);
  const routes = enabled ? [primary, fallback!] : [primary];
  const send: typeof fetch = (...args) => (options.fetch ?? fetch)(...args);
  const evaluationInterval =
    options.routeEvaluationInterval ?? options.recoveryInterval ?? 60000;
  const healthTTL = options.routeHealthTTL ?? evaluationInterval * 2.5;
  const failureThreshold = options.failureThreshold ?? 2;
  const health = new Map<string, RouteHealth>(
    routes.map((base) => [
      base,
      { latency: Number.POSITIVE_INFINITY, lastSuccess: 0, lastFailure: 0 },
    ]),
  );
  const requestFailures = new Map(routes.map((base) => [base, 0]));
  const probes = new Map<string, Promise<string>>();
  let active = primary;
  let selected = !enabled;
  let selection: Promise<string> | undefined;
  let evaluating = false;
  let lastEvaluation = 0;

  function select(base: string) {
    const changed = active !== base;
    active = base;
    selected = true;
    if (changed) options.onChange?.(base);
    return base;
  }

  function alternate(base: string) {
    return enabled ? (base === primary ? fallback! : primary) : undefined;
  }

  function recentlyHealthy(base: string) {
    const state = health.get(base)!;
    return state.lastSuccess > 0 && Date.now() - state.lastSuccess <= healthTTL;
  }

  function recordProbeSuccess(base: string, latency: number) {
    const state = health.get(base)!;
    // Smooth probe jitter while still reacting quickly to large path changes.
    state.latency = Number.isFinite(state.latency)
      ? state.latency * 0.7 + latency * 0.3
      : latency;
    state.lastSuccess = Date.now();
  }

  function probe(base: string) {
    const existing = probes.get(base);
    if (existing) return existing;
    const started = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      options.probeTimeout ?? (base === primary ? 2500 : 20000),
    );
    const pending = send(`${base}/health`, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok || body.service !== 'steer' || body.status !== 'ok')
          throw new Error('Steer endpoint is unavailable.');
        recordProbeSuccess(base, performance.now() - started);
        return base;
      })
      .catch((error) => {
        health.get(base)!.lastFailure = Date.now();
        throw error;
      })
      .finally(() => {
        clearTimeout(timeout);
        probes.delete(base);
      });
    probes.set(base, pending);
    return pending;
  }

  function choose(): Promise<string> {
    if (selected) return Promise.resolve(active);
    if (selection) return selection;
    // Promise.any selects the first healthy route, which is both the quickest
    // startup and a real end-to-end latency comparison. The slower probe keeps
    // running so later evaluations have measurements for both routes.
    // The startup race itself is the first route evaluation.
    lastEvaluation = Date.now();
    selection = Promise.any(routes.map((base) => probe(base)))
      .then(select)
      .catch(() => {
        throw new Error('Neither Steer connection is reachable.');
      })
      .finally(() => {
        selection = undefined;
      });
    return selection;
  }

  function clearlyFaster(candidate: string, current: string) {
    const candidateLatency = health.get(candidate)!.latency;
    const currentLatency = health.get(current)!.latency;
    return (
      candidateLatency + (options.switchMinSavings ?? 100) < currentLatency &&
      candidateLatency < currentLatency * (options.switchRatio ?? 0.8)
    );
  }

  function evaluateRoutes() {
    if (
      !enabled ||
      evaluating ||
      Date.now() - lastEvaluation < evaluationInterval
    )
      return;
    evaluating = true;
    lastEvaluation = Date.now();
    const bases = [...routes];
    void Promise.allSettled(bases.map((base) => probe(base)))
      .then((results) => {
        const available = bases.filter(
          (_, index) => results[index].status === 'fulfilled',
        );
        if (!available.length) return;
        if (!available.includes(active)) {
          select(available[0]);
          return;
        }
        const candidate = available.find((base) => base !== active);
        if (candidate && clearlyFaster(candidate, active)) select(candidate);
      })
      .finally(() => {
        evaluating = false;
      });
  }

  // Transport failures are counted separately from health probes. One failure
  // can be ordinary network jitter; repeated failures open the circuit and move
  // future traffic, provided the alternate route was recently proven healthy.
  function failed(base: string) {
    if (!enabled) return;
    const failures = (requestFailures.get(base) ?? 0) + 1;
    requestFailures.set(base, failures);
    const target = alternate(base)!;
    if (
      base === active &&
      failures >= failureThreshold &&
      recentlyHealthy(target)
    )
      select(target);
  }

  function succeeded(base: string) {
    requestFailures.set(base, 0);
  }

  async function retryTarget(base: string) {
    const target = alternate(base);
    if (!target) return undefined;
    if (recentlyHealthy(target)) return target;
    try {
      return await probe(target);
    } catch {
      return undefined;
    }
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
      const routeWasSelected = selected;
      const base = await choose();
      init?.signal?.throwIfAborted();
      // The startup race already measured both paths. Do not immediately start
      // a duplicate evaluation when one of those probes happened to be slow.
      if (routeWasSelected) evaluateRoutes();
      const canRetry = retryable(init);
      try {
        const response = await fetchFrom(base, path, init);
        if (!enabled || ![502, 503, 504].includes(response.status)) {
          succeeded(base);
          return response;
        }
        failed(base);
        if (!canRetry) return response;
        const target = await retryTarget(base);
        if (!target) return response;
        await response.body?.cancel().catch(() => {});
        const retried = await fetchFrom(target, path, init);
        if (![502, 503, 504].includes(retried.status)) succeeded(target);
        return retried;
      } catch (error) {
        if (!enabled || init?.signal?.aborted) throw error;
        failed(base);
        // Writes without an idempotency key may already have been committed.
        if (!canRetry) throw error;
        const target = await retryTarget(base);
        if (!target) throw error;
        const retried = await fetchFrom(target, path, init);
        succeeded(target);
        return retried;
      }
    },
  };
}
