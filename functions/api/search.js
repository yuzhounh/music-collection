// 将「歌名 歌手」解析为 YouTube Music 的歌曲视频 ID：GET /api/search?q=...
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS, ...extra },
  });
}

export async function onRequest({ request }) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const q = (new URL(request.url).searchParams.get("q") || "").trim().slice(0, 200);
  if (!q) return json({ error: "missing q" }, 400);

  const cache = caches.default;
  const cacheKey = new Request(`https://cache.invalid/ytm-search?q=${encodeURIComponent(q)}`);
  const hit = await cache.match(cacheKey);
  if (hit) return new Response(hit.body, { status: hit.status, headers: { ...Object.fromEntries(hit.headers), ...CORS } });

  const upstream = await fetch("https://music.youtube.com/youtubei/v1/search?prettyPrint=false", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://music.youtube.com" },
    body: JSON.stringify({
      context: { client: { clientName: "WEB_REMIX", clientVersion: "1.20241001.01.00", hl: "en" } },
      query: q,
      params: "EgWKAQIIAWoKEAkQBRAKEAMQBA==", // 仅「歌曲」结果
    }),
  });
  if (!upstream.ok) return json({ error: "upstream" }, 502);

  const match = (await upstream.text()).match(/"videoId":\s*"([\w-]{11})"/);
  if (!match) return json({ error: "not found" }, 404);

  const response = json({ id: match[1] }, 200, { "Cache-Control": "public, max-age=2592000" });
  await cache.put(cacheKey, response.clone());
  return response;
}
