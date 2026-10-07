// R3: scheduled sweep that evicts idle free-tier accounts. Pages has no
// scheduled handler, so this tiny Worker POSTs to the Pages endpoint, which
// keeps all the in-flight-crawl guards in one place, and prunes the D1 rate-limit
// counters (replacing the opportunistic prune that used to live in
// rateLimitHorizon.ts).
export default {
  async scheduled(
    _event: ScheduledEvent,
    env: { HOMESTAND_ORIGIN: string; ADMIN_API_KEY: string; DB: D1Database }
  ) {
    const res = await fetch(`${env.HOMESTAND_ORIGIN}/api/admin/evict`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.ADMIN_API_KEY}` },
    });
    console.log(`[evict] ${res.status} ${await res.text()}`);

    await env.DB.prepare("DELETE FROM rate_limit_counters WHERE window_start < ?")
      .bind(Math.floor(Date.now() / 1000) - 2 * 24 * 60 * 60)
      .run();
  },
};