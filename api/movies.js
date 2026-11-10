
// Cine-CR Backend - publicar em <repo>/api/movies.js na Vercel
// Token SOMENTE no servidor via process.env.TMDB_API_TOKEN - nunca no frontend
const TMDB = "https://api.themoviedb.org/3";
const TOKEN = process.env.TMDB_API_TOKEN;
const MOOD_TO_GENRES = { rir:"35", chorar:"18", tensao:"53,27,9648", maratonar:"10759,10765", acao:"28", comedia:"35", drama:"18", terror:"27", animacao:"16", ficcao:"878", romance:"10749", aventura:"12" };
const PROVIDER_MAP = {"Netflix":"Netflix","Amazon Prime Video":"Prime Video","Prime Video":"Prime Video","Disney Plus":"Disney+","Disney+":"Disney+","Max":"Max","HBO Max":"Max","Apple TV+":"Apple TV+","Apple TV Plus":"Apple TV+","Globoplay":"Globoplay","Paramount Plus":"Paramount+","Star Plus":"Star+","Hulu":"Hulu","YouTube":"YouTube","Claro TV+":"Claro TV+","MUBI":"MUBI","Telecine":"Telecine"};
function mapProviders(tmdbProviders){
  if(!tmdbProviders || !tmdbProviders.BR) return {providers:[], flatrate:[], rent:[], buy:[], watchLink:null};
  const br = tmdbProviders.BR;
  const cat = (arr)=> [...new Set((arr||[]).map(p=>PROVIDER_MAP[p.provider_name]||p.provider_name))];
  const flatrate = cat(br.flatrate), rent = cat(br.rent), buy = cat(br.buy);
  const providers = [...new Set([...flatrate, ...rent, ...buy])];
  return {providers, flatrate, rent, buy, watchLink: br.link || null}; // watchLink = campo "link" do TMDB para BR (JustWatch) - nunca construído manualmente
}

// ---- Trailers via YouTube Data API v3 (nunca via TMDB, nunca scraping) ----
// Cache em memória: evita repetir a mesma pesquisa (a busca custa 100 unidades de cota).
const TRAILER_CACHE = new Map();
const TRAILER_TTL_MS = 24 * 60 * 60 * 1000;
function normTxt(s){ return String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase(); }
function scoreTrailer(item, title, year){
  const t = normTxt(item?.snippet?.title), ch = normTxt(item?.snippet?.channelTitle);
  const titleN = normTxt(title);
  let score = 0;
  if(titleN && t.includes(titleN)) score += 25;                    // título do filme/série no título do vídeo
  if(year && t.includes(String(year))) score += 10;               // ano confere
  if(/official trailer|trailer oficial/.test(t)) score += 30;      // trailer oficial
  else if(/trailer/.test(t)) score += 15;
  if(/official|oficial/.test(ch)) score += 30;                     // canal oficial
  if(/pictures|studios|entertainment|films|movies|filmes|distribuidora|brasil/.test(ch)) score += 15; // estúdio/distribuidora
  if(/reaction|reacao|review|analise|explicado|gameplay|parodia|fan made|fanmade|teaser|featurette|behind the scenes|bastidores|entrevista|interview|making of/.test(t)) score -= 50; // conteúdo que NÃO é o trailer
  if(!/trailer/.test(t)) score -= 20;
  return score;
}
function json(res,status,obj){ res.status(status).setHeader("Content-Type","application/json"); res.setHeader("Access-Control-Allow-Origin","*"); res.json(obj); }
async function tmdb(path, params={}){
  if(!TOKEN) throw new Error("TMDB_API_TOKEN nao configurado na Vercel");
  const qs = new URLSearchParams({language:"pt-BR", ...params});
  const url = `${TMDB}${path}?${qs.toString()}`;
  const r = await fetch(url, {headers:{Authorization:`Bearer ${TOKEN}`, Accept:"application/json"}});
  const data = await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(data.status_message || `TMDB HTTP ${r.status}`);
  return {data, url, status:r.status};
}
function cleanParams(query){
  const out={};
  for(const [k,v] of Object.entries(query||{})){
    if(v!==undefined && v!==null && String(v).trim()!=="" && String(v).toLowerCase()!=="todas" && String(v).toLowerCase()!=="todas as epocas" && String(v).toLowerCase()!=="todos") out[k]=String(v).trim();
  }
  return out;
}
function pick(obj, keys){ const o={}; for(const k of keys){ if(obj[k]!==undefined) o[k]=obj[k]; } return o; }
export default async function handler(req,res){
  try{
    const q = cleanParams(req.query||{});
    const action = q.action;
    const lang = "pt-BR";
    if(action==="trending"){
      const {data}=await tmdb("/trending/all/week",{language:lang, page:q.page||"1"});
      return json(res,200,{ok:true, results:data.results||[]});
    }
    if(action==="popular"){
      const {data}=await tmdb("/movie/popular",{language:lang, page:q.page||"1"});
      return json(res,200,{ok:true, results:data.results||[]});
    }
    if(action==="search"){
      const {data}=await tmdb("/search/multi",{language:lang, query:q.query||"", page:q.page||"1", include_adult:"false"});
      return json(res,200,{ok:true, results:(data.results||[]).filter(x=>x.media_type==="movie"||x.media_type==="tv")});
    }
    if(action==="details"){
      const type = q.media_type==="tv" ? "tv" : "movie";
      const {data}=await tmdb(`/${type}/${q.id}`,{language:lang, append_to_response:"credits,watch/providers,content_ratings,release_dates"});
      const p = mapProviders(data["watch/providers"]);
      // Classificação BR: filme via release_dates, série via content_ratings
      let certification = null;
      try{
        if(type==="movie" && Array.isArray(data.release_dates?.results)){
          const br = data.release_dates.results.find(r=>r.iso_3166_1==="BR");
          certification = br?.release_dates?.find(r=>r.certification)?.certification || null;
        }
        if(type==="tv" && Array.isArray(data.content_ratings?.results)){
          const br = data.content_ratings.results.find(r=>r.iso_3166_1==="BR");
          certification = br?.rating || null;
        }
      }catch{}
      return json(res,200,{ok:true, result:{...data, providers:p.providers, platforms:p.providers, flatrate:p.flatrate, rent:p.rent, buy:p.buy, watchLink:p.watchLink, certification}});
    }

    if(action==="trailer"){
      const title = q.title || q.q || "";
      if(!title) return json(res,400,{ok:false, error:"Informe o titulo"});
      if(!process.env.YOUTUBE_API_KEY) return json(res,500,{ok:false, error:"YOUTUBE_API_KEY nao configurada na Vercel"});
      const year = q.year || "";
      const cacheKey = normTxt(title) + "|" + year + "|" + (q.media_type || "movie");
      const cached = TRAILER_CACHE.get(cacheKey);
      if(cached && Date.now() - cached.at < TRAILER_TTL_MS) return json(res,200,{ok:true, trailer:cached.trailer, cached:true});
      const query = [title, year, "official trailer"].filter(Boolean).join(" ");
      const qs = new URLSearchParams({part:"snippet", type:"video", videoEmbeddable:"true", maxResults:"10", safeSearch:"moderate", q:query, key:process.env.YOUTUBE_API_KEY});
      const r = await fetch(`https://www.googleapis.com/youtube/v3/search?${qs.toString()}`);
      const data = await r.json().catch(()=>({}));
      if(!r.ok) return json(res,200,{ok:true, trailer:null, error:data?.error?.message || `YouTube HTTP ${r.status}`});
      const ranked = (data.items||[])
        .map(it=>({...it, _score:scoreTrailer(it, title, year)}))
        .filter(it=>it._score > 0 && it.id?.videoId)
        .sort((x,y)=>y._score - x._score);
      const best = ranked[0];
      const trailer = best ? {videoId:best.id.videoId, title:best.snippet?.title || null, channelTitle:best.snippet?.channelTitle || null, thumbnail:best.snippet?.thumbnails?.high?.url || best.snippet?.thumbnails?.medium?.url || null, score:best._score} : null;
      TRAILER_CACHE.set(cacheKey, {at:Date.now(), trailer});
      return json(res,200,{ok:true, trailer});
    }
    if(action==="providers"){
      const type = q.type==="tv" ? "tv" : "movie";
      const {data}=await tmdb(`/${type}/${q.id}/watch/providers`,{language:lang});
      const p = mapProviders(data.results);
      // Enriquecer cada provedor com link oficial (homepage) + flag de que NÃO é link direto do título
      const enriched = p.providers.map(name=>({name[name]||null, direct:false}));
      return json(res,200,{ok:true, providers:p.providers, flatrate:p.flatrate, rent:p.rent, buy:p.buy, watchLink:p.watchLink, providersDetailed:enriched, id:q.id, type, region:"BR"});
    }
    if(action==="discover_movie"){
      // CORREÇÃO: repassar TODOS os filtros do frontend para o TMDB, antes eram ignorados e o Catálogo voltava sempre popular
      const params = {language:lang, page:q.page||"1", sort_by:q.sort_by||"popularity.desc", "vote_count.gte":q["vote_count.gte"]||"30", include_adult:q.include_adult||"false", ...pick(q, ["with_genres","with_original_language","with_watch_providers","primary_release_date.gte","primary_release_date.lte","first_air_date.gte","first_air_date.lte","certification_country","certification","certification.lte","with_certification","include_video","with_runtime.gte","with_runtime.lte"])};
      // Certification só vale se vier com country; se vier sem, TMDB ignora
      if(params.certification && !params.certification_country) params.certification_country = "BR";
      const {data}=await tmdb("/discover/movie", params);
      return json(res,200,{ok:true, results:data.results||[], page:data.page, total_pages:data.total_pages, total_results:data.total_results});
    }
    if(action==="discover_tv"){
      // CORREÇÃO: repassar filtros. Para TV, certification do TMDB usa content_ratings - NÃO aplicar certification aqui (zerava tudo). Frontend filtra idade por "Não informada" quando não há dado.
      const params = {language:lang, page:q.page||"1", sort_by:q.sort_by||"popularity.desc", "vote_count.gte":q["vote_count.gte"]||"30", include_null_first_air_dates:q.include_null_first_air_dates||"false", ...pick(q, ["with_genres","with_original_language","with_watch_providers","first_air_date.gte","first_air_date.lte","primary_release_date.gte","primary_release_date.lte","with_networks","with_status","include_adult"])};
      const {data}=await tmdb("/discover/tv", params);
      return json(res,200,{ok:true, results:data.results||[], page:data.page, total_pages:data.total_pages, total_results:data.total_results});
    }
    if(action==="recommend"){
      const type = q.type==="tv" ? "tv" : "movie";
      const exclude = new Set((q.exclude||"").split(",").map(s=>s.trim()).filter(Boolean));
      const genre = q.genre||""; const mood = q.mood||""; const epoca = q.epoca||"";
      let withGenres = genre; if(!withGenres && mood) withGenres = MOOD_TO_GENRES[mood.toLowerCase()]||"";
      const paramsBase={language:lang, sort_by:"popularity.desc", "vote_count.gte":"30", include_adult:"false"};
      if(withGenres) paramsBase.with_genres=withGenres;
      if(epoca && /^\d{4}$/.test(epoca)){
        if(type==="movie"){ paramsBase["primary_release_date.gte"]=`${epoca}-01-01`; paramsBase["primary_release_date.lte"]=`${epoca}-12-31`; }
        else { paramsBase["first_air_date.gte"]=`${epoca}-01-01`; paramsBase["first_air_date.lte"]=`${epoca}-12-31`; }
      }
      const triedPages=new Set();
      for(let attempt=0; attempt<10; attempt++){
        const page=1+Math.floor(Math.random()*100); if(triedPages.has(page)) continue; triedPages.add(page);
        const path = type==="tv" ? "/discover/tv" : "/discover/movie";
        const {data}=await tmdb(path,{...paramsBase, page:String(page)});
        const results=(data.results||[]).filter(r=>r && r.id && !exclude.has(String(r.id)));
        if(results.length){ const pick=results[Math.floor(Math.random()*results.length)]; return json(res,200,{ok:true, result:pick, page, tried:[...triedPages]}); }
      }
      return json(res,200,{ok:true, result:null, exhausted:true, message:"Nenhum titulo novo com essa combinacao. Ajuste um filtro e tente de novo."});
    }
    return json(res,400,{ok:false, error:"Acao invalida", validas:["trending","popular","search","details","providers","discover_movie","discover_tv","recommend","trailer"]});
  }catch(e){
    console.error("[Cine-CR backend]", String(e));
    return json(res,500,{ok:false, error:String(e.message||e)});
  }
}
