
// Cine-CR Backend - publicar em <repo>/api/movies.js na Vercel
// Rotas preservadas: trending, popular, search, details
// Rotas novas: discover_movie, discover_tv, recommend
// Token SOMENTE no servidor via process.env.TMDB_API_TOKEN - nunca no frontend
// language=pt-BR em todas as chamadas

const TMDB = "https://api.themoviedb.org/3";
const TOKEN = process.env.TMDB_API_TOKEN;

const MOOD_TO_GENRES = {
  rir: "35",
  chorar: "18",
  tensao: "53,27,9648",
  maratonar: "10759,10765",
  acao: "28",
  comedia: "35",
  drama: "18",
  terror: "27",
  animacao: "16",
  ficcao: "878",
  romance: "10749",
  aventura: "12",
};

function json(res, status, obj) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.json(obj);
}

async function tmdb(path, params = {}) {
  if (!TOKEN) throw new Error("TMDB_API_TOKEN nao configurado na Vercel");
  const qs = new URLSearchParams({ language: "pt-BR", ...params });
  const url = `${TMDB}${path}?${qs.toString()}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.status_message || `TMDB HTTP ${r.status}`);
  return { data, url, status: r.status };
}

function cleanParams(query) {
  // Filtros vazios NAO sao enviados
  const out = {};
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && String(v).trim() !== "" && String(v).toLowerCase() !== "todas" && String(v).toLowerCase() !== "todas as epocas" && String(v).toLowerCase() !== "todos") out[k] = String(v).trim();
  }
  return out;
}

export default async function handler(req, res) {
  try {
    const q = cleanParams(req.query || {});
    const action = q.action;
    const lang = "pt-BR";

    if (action === "trending") {
      const { data } = await tmdb("/trending/all/week", { language: lang, page: q.page || "1" });
      return json(res, 200, { ok: true, results: data.results || [] });
    }
    if (action === "popular") {
      const { data } = await tmdb("/movie/popular", { language: lang, page: q.page || "1" });
      return json(res, 200, { ok: true, results: data.results || [] });
    }
    if (action === "search") {
      const { data } = await tmdb("/search/multi", { language: lang, query: q.query || "", page: q.page || "1", include_adult: "false" });
      return json(res, 200, { ok: true, results: (data.results || []).filter(x => x.media_type === "movie" || x.media_type === "tv") });
    }
    if (action === "details") {
      const type = q.media_type === "tv" ? "tv" : "movie";
      const { data } = await tmdb(`/${type}/${q.id}`, { language: lang, append_to_response: "credits,videos,watch/providers" });
      return json(res, 200, { ok: true, result: data });
    }
    if (action === "discover_movie") {
      const { data } = await tmdb("/discover/movie", { language: lang, page: q.page || "1", sort_by: "popularity.desc", "vote_count.gte": "30", include_adult: "false" });
      return json(res, 200, { ok: true, results: data.results || [], page: data.page, total_pages: data.total_pages });
    }
    if (action === "discover_tv") {
      const { data } = await tmdb("/discover/tv", { language: lang, page: q.page || "1", sort_by: "popularity.desc", "vote_count.gte": "30", include_null_first_air_dates: "false" });
      return json(res, 200, { ok: true, results: data.results || [], page: data.page, total_pages: data.total_pages });
    }
    if (action === "recommend") {
      const type = q.type === "tv" ? "tv" : "movie";
      const exclude = new Set((q.exclude || "").split(",").map(s => s.trim()).filter(Boolean));
      const genre = q.genre || "";
      const mood = q.mood || "";
      const tempo = q.tempo || "";
      const epoca = q.epoca || "";
      // Mapeia humor -> generos, sem bloquear se nao houver
      let withGenres = genre;
      if (!withGenres && mood) withGenres = MOOD_TO_GENRES[mood.toLowerCase()] || "";
      // Tempo: so aplica se for numerico, nunca bloqueia tudo
      const paramsBase = { language: lang, sort_by: "popularity.desc", "vote_count.gte": "30", include_adult: "false" };
      if (withGenres) paramsBase.with_genres = withGenres;
      // Todas as epocas = sem restricao de data. So aplica se epoca for ano valido.
      if (epoca && /^\d{4}$/.test(epoca)) {
        if (type === "movie") { paramsBase["primary_release_date.gte"] = `${epoca}-01-01`; paramsBase["primary_release_date.lte"] = `${epoca}-12-31`; }
        else { paramsBase["first_air_date.gte"] = `${epoca}-01-01`; paramsBase["first_air_date.lte"] = `${epoca}-12-31`; }
      }
      // Varre ate 10 paginas aleatorias ate achar ID inedito
      const triedPages = new Set();
      for (let attempt = 0; attempt < 10; attempt++) {
        const page = 1 + Math.floor(Math.random() * 100);
        if (triedPages.has(page)) continue;
        triedPages.add(page);
        const path = type === "tv" ? "/discover/tv" : "/discover/movie";
        const { data } = await tmdb(path, { ...paramsBase, page: String(page) });
        const results = (data.results || []).filter(r => r && r.id && !exclude.has(String(r.id)));
        if (results.length) {
          const pick = results[Math.floor(Math.random() * results.length)];
          return json(res, 200, { ok: true, result: pick, page, tried: [...triedPages] });
        }
      }
      return json(res, 200, { ok: true, result: null, exhausted: true, message: "Nenhum titulo novo com essa combinacao. Ajuste um filtro e tente de novo." });
    }
    return json(res, 400, { ok: false, error: "Acao invalida", validas: ["trending","popular","search","details","discover_movie","discover_tv","recommend"] });
  } catch (e) {
    console.error("[Cine-CR backend]", String(e));
    return json(res, 500, { ok: false, error: String(e.message || e) });
  }
        }

