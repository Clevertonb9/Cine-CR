
// Cine-CR Backend - publicar em <repo>/api/movies.js na Vercel
// Token SOMENTE no servidor via process.env.TMDB_API_TOKEN - nunca no frontend
const TMDB = "https://api.themoviedb.org/3";
const TOKEN = process.env.TMDB_API_TOKEN;
const MOOD_TO_GENRES = { rir:"35", chorar:"18", tensao:"53,27,9648", maratonar:"10759,10765", acao:"28", comedia:"35", drama:"18", terror:"27", animacao:"16", ficcao:"878", romance:"10749", aventura:"12" };
// Rótulos em português -> IDs de gênero do TMDB (o Me Indica envia o rótulo quando o filtro vem de cache/localStorage).
const GENRE_PT = { "ação":28, "aventura":12, "animação":16, "comédia":35, "crime":80, "documentário":99, "drama":18, "família":10751, "fantasia":14, "história":36, "terror":27, "mistério":9648, "romance":10749, "ficção":878, "ficção científica":878, "suspense":53, "guerra":10752, "faroeste":37, "musical":10402, "novela":10766, "soap":10766 };
// Época aceita: "2020" (ano), "2020s" (década) ou "classicos". Retorna [anoInicio, anoFim] ou null.
function epocaRange(e){ if(!e) return null; const s=String(e).trim().toLowerCase(); if(s==="todas"||s==="todas as epocas"||s==="todas as épocas"||s==="todos") return null; if(/^\d{4}$/.test(s)) return [s,s]; const dec={"2020s":[2020,2029],"2010s":[2010,2019],"2000s":[2000,2009],"1990s":[1990,1999],"1980s":[1980,1989]}; if(dec[s]) return dec[s]; if(s==="classicos"||s==="clássicos"||s==="classico"||s==="clássico") return [1900,1979]; return null; }
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

    if(action==="christmas"){
      const terms=["Christmas","Natal","Christmas family","Christmas comedy"];
      const searches=await Promise.all(terms.map(async query=>{
        try{const {data}=await tmdb("/search/multi",{query,include_adult:"false",page:"1"});return data.results||[]}
        catch(error){console.warn("Cine-CR: busca natalina indisponível",query,error);return []}
      }));
      const merged=new Map();
      searches.flat().forEach(item=>{
        if(!item||!item.id||!["movie","tv"].includes(item.media_type))return;
        const title=String(item.title||item.name||"").toLowerCase();
        const overview=String(item.overview||"").toLowerCase();
        const titleTheme=/christmas|xmas|natal|noel|papai noel|grinch|scrooge|holiday/.test(title);
        const synopsisTheme=/christmas|xmas|natal|noel|papai noel|véspera de natal|espírito natalino|holiday season/.test(overview);
        if(title==="natal"||title==="pai natal"||(!titleTheme&&!synopsisTheme)||(!synopsisTheme&&(Number(item.vote_count)||0)<100))return;
        const key=item.media_type+"_"+item.id;
        if(!merged.has(key))merged.set(key,item);
      });
      const results=[...merged.values()].sort((a,b)=>(Number(b.vote_count)||0)-(Number(a.vote_count)||0)||(Number(b.vote_average)||0)-(Number(a.vote_average)||0));
      return json(res,200,{ok:true,results:results.slice(0,60)});
    }
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
    if(action==="season"){
      const id=String(q.id||"").trim(),seasonNumber=String(q.season_number??"").trim(),showName=String(q.name||"").trim();
      if(!/^\d+$/.test(id)||!/^\d+$/.test(seasonNumber)) return json(res,400,{ok:false,error:"Série ou temporada inválida"});
      const normalize=value=>String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]/g,"");
      const merged=new Map();
      // Fonte primária: TMDB em português e inglês.
      const tmdbResults=await Promise.all(["pt-BR","en-US"].map(async language=>{
        try{const result=await tmdb(`/tv/${id}/season/${seasonNumber}`,{language});return result.data.episodes||[]}
        catch(error){return []}
      }));
      tmdbResults.forEach((list,index)=>list.forEach(ep=>{
        const number=Number(ep.episode_number),title=String(ep.name||ep.original_name||"").trim();
        if(!Number.isFinite(number))return;
        const previous=merged.get(number)||{episode_number:number,name:""};
        if(title&&(!previous.name||index===0))previous.name=title;
        merged.set(number,previous);
      }));
      // Busca pelo título localizado e original, sem aceitar correspondência aproximada de outra série.
      const showNames=[showName,q.original_name].map(value=>String(value||"").trim()).filter((value,index,list)=>value&&list.findIndex(other=>normalize(other)===normalize(value))===index);
      for(const candidateName of showNames){
        try{
          const searchResponse=await fetch("https://api.tvmaze.com/search/shows?q="+encodeURIComponent(candidateName),{headers:{Accept:"application/json"}});
          if(!searchResponse.ok)continue;
          const candidates=await searchResponse.json();
          const exact=(Array.isArray(candidates)?candidates:[]).find(item=>item?.show&&normalize(item.show.name)===normalize(candidateName));
          if(!exact?.show?.id)continue;
          const episodesResponse=await fetch("https://api.tvmaze.com/shows/"+exact.show.id+"/episodes?specials=1",{headers:{Accept:"application/json"}});
          if(!episodesResponse.ok)continue;
          const episodes=await episodesResponse.json();
          (Array.isArray(episodes)?episodes:[]).filter(ep=>Number(ep.season)===Number(seasonNumber)).forEach(ep=>{
            const number=Number(ep.number),title=String(ep.name||"").trim();
            if(!Number.isFinite(number)||!title)return;
            const previous=merged.get(number)||{episode_number:number,name:""};
            if(!previous.name)previous.name=title;
            merged.set(number,previous);
          });
          if(Array.isArray(episodes)&&episodes.some(ep=>Number(ep.season)===Number(seasonNumber)))break;
        }catch(tvmazeError){console.warn("Cine-CR: TVmaze indisponível para complementar episódios",tvmazeError)}
      }
      return json(res,200,{ok:true,episodes:[...merged.values()].sort((x,y)=>x.episode_number-y.episode_number),sources:["TMDB","TVmaze"]});
    }
    if(action==="personalized_catalog"){
      const rawGenres=String(q.genres||"").split(",").map(x=>x.trim()).filter(x=>/^\d+$/.test(x));
      const genres=[...new Set(rawGenres)].slice(0,6);
      const ratedIds=String(q.rated||"").split(",").map(x=>x.trim()).filter(x=>/^\d+$/.test(x)).slice(0,8);
      const ratedGenreIds=new Set();
      await Promise.all(ratedIds.map(async id=>{try{const {data}=await tmdb("/movie/"+id,{language:lang});(data.genres||[]).forEach(g=>{if(g&&g.id)ratedGenreIds.add(String(g.id))})}catch{}}));
      const allGenres=[...new Set([...genres,...ratedGenreIds])].slice(0,10);
      const pages=new Set();
      while(pages.size<6) pages.add(1+Math.floor(Math.random()*500));
      const resultsMap=new Map();
      await Promise.all([...pages].map(async page=>{
        const params={language:lang,page:String(page),sort_by:"popularity.desc","vote_count.gte":"30",include_adult:"false"};
        if(allGenres.length) params.with_genres=allGenres.join("|");
        const {data}=await tmdb("/discover/movie",params);
        (data.results||[]).forEach(item=>{if(item&&item.id)resultsMap.set(String(item.id),item)});
      }));
      return json(res,200,{ok:true,results:[...resultsMap.values()],pagesChecked:[...pages],personalizedBy:allGenres});
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
      const year = q.year || "";
      const mediaType = q.media_type === "tv" ? "tv" : "movie";
      const cacheKey = normTxt(title) + "|" + year + "|" + mediaType;
      const cached = TRAILER_CACHE.get(cacheKey);
      if(cached && Date.now() - cached.at < TRAILER_TTL_MS) return json(res,200,{ok:true, trailer:cached.trailer, cached:true});

      // Prioriza a busca direta no YouTube quando a chave estiver configurada.
      if(process.env.YOUTUBE_API_KEY){
        const query = [title, year, "official trailer"].filter(Boolean).join(" ");
        const qs = new URLSearchParams({part:"snippet", type:"video", videoEmbeddable:"true", maxResults:"10", safeSearch:"moderate", q:query, key:process.env.YOUTUBE_API_KEY});
        const yt = await fetch(`https://www.googleapis.com/youtube/v3/search?${qs.toString()}`);
        const data = await yt.json().catch(()=>({}));
        if(yt.ok){
          const ranked = (data.items||[])
            .map(it=>({...it, _score:scoreTrailer(it, title, year)}))
            .filter(it=>it._score > 0 && it.id?.videoId)
            .sort((x,y)=>y._score - x._score);
          const best = ranked[0];
          if(best){
            const trailer = {videoId:best.id.videoId, title:best.snippet?.title || null, channelTitle:best.snippet?.channelTitle || null, thumbnail:best.snippet?.thumbnails?.high?.url || best.snippet?.thumbnails?.medium?.url || null, score:best._score, source:"youtube"};
            TRAILER_CACHE.set(cacheKey, {at:Date.now(), trailer});
            return json(res,200,{ok:true, trailer});
          }
        }
      }

      // Fallback sem chave adicional: usa os vídeos do TMDB, que apontam para trailers hospedados no YouTube.
      const searchParams = {query:title, include_adult:"false"};
      if(year) searchParams[mediaType === "movie" ? "year" : "first_air_date_year"] = year;
      const {data:searchData} = await tmdb(`/search/${mediaType}`, searchParams);
      const candidates = Array.isArray(searchData.results) ? searchData.results : [];
      const normalize = value => normTxt(value).replace(/[^a-z0-9]/g,"");
      const target = normalize(title);
      const match = candidates
        .map(item => {
          const candidateTitle = normalize(item.title || item.name || "");
          const exact = candidateTitle === target ? 100 : candidateTitle.includes(target) || target.includes(candidateTitle) ? 50 : 0;
          const date = String(item.release_date || item.first_air_date || "").slice(0,4);
          return {...item, _matchScore:exact + (year && date === String(year) ? 20 : 0)};
        })
        .sort((a,b)=>b._matchScore-a._matchScore)[0];
      let trailer = null;
      if(match?.id){
        let videos = await tmdb(`/${mediaType}/${match.id}/videos`,{language:"pt-BR"});
        let items = Array.isArray(videos.data.results) ? videos.data.results : [];
        if(!items.some(item=>item.site==="YouTube" && item.type==="Trailer")){
          videos = await tmdb(`/${mediaType}/${match.id}/videos`,{language:"en-US"});
          items = Array.isArray(videos.data.results) ? videos.data.results : [];
        }
        const ytVideos = items.filter(item=>item.site==="YouTube" && item.key && item.type==="Trailer");
        const best = ytVideos.find(item=>item.official) || ytVideos[0];
        if(best) trailer = {videoId:best.key, title:best.name || null, channelTitle:best.official ? "Canal oficial" : null, thumbnail:`https://img.youtube.com/vi/${best.key}/hqdefault.jpg`, source:"tmdb-youtube"};
      }
      TRAILER_CACHE.set(cacheKey, {at:Date.now(), trailer});
      return json(res,200,{ok:true, trailer});
    }
    if(action==="providers"){
      const type = q.type==="tv" ? "tv" : "movie";
      const {data}=await tmdb(`/${type}/${q.id}/watch/providers`,{language:lang});
      const p = mapProviders(data.results);
      // Enriquecer cada provedor com link oficial (homepage) + flag de que NÃO é link direto do título
      const enriched = p.providers.map(name=>({name: name || null, direct:false}));
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
      const params = {language:lang, page:q.page||"1", sort_by:q.sort_by||"popularity.desc", "vote_count.gte":q["vote_count.gte"]||"30", include_null_first_air_dates:q.include_null_first_air_dates||"false", ...pick(q, ["with_genres","with_original_language","with_watch_providers","first_air_date.gte","first_air_date.lte","primary_release_date.gte","primary_release_date.lte","with_networks","with_status","with_origin_country","include_adult"])};
      const {data}=await tmdb("/discover/tv", params);
      return json(res,200,{ok:true, results:data.results||[], page:data.page, total_pages:data.total_pages, total_results:data.total_results});
    }
    if(action==="recommend"){
      const type = q.type==="tv" ? "tv" : "movie";
      const exclude = new Set((q.exclude||"").split(",").map(s=>s.trim()).filter(Boolean));
      const genre = q.genre||""; const mood = q.mood||q.humor||""; const epoca = q.epoca||""; const tempo = q.tempo||"";
      // Gênero pode chegar como rótulo ("Terror") ou ID ("27"): normaliza para ID, senão o TMDB rejeita with_genres com HTTP 422.
      let withGenres = "";
      if(mood){ const moodKey=String(mood).trim().toLowerCase(); withGenres = moodKey==="tensao" && type==="tv" ? "9648|80|10759" : (MOOD_TO_GENRES[moodKey]||""); }
      if(!withGenres){ withGenres = genre; if(withGenres && !/^\d/.test(String(withGenres).trim())){ const g = String(withGenres).trim().toLowerCase(); withGenres = String(GENRE_PT[g] ?? MOOD_TO_GENRES[g] ?? ""); } }
      const paramsBase={language:lang, sort_by:"popularity.desc", "vote_count.gte":"30", include_adult:"false"};
      if(withGenres) paramsBase.with_genres=withGenres;
      // Tempo disponível: com runtime (filmes) / duração do episódio (séries).
      if(tempo==="curto") paramsBase["with_runtime.lte"]="120";
      else if(tempo==="medio") paramsBase["with_runtime.lte"]="150";
      const er = epocaRange(epoca);
      if(er){
        if(type==="movie"){ paramsBase["primary_release_date.gte"]=`${er[0]}-01-01`; paramsBase["primary_release_date.lte"]=`${er[1]}-12-31`; }
        else { paramsBase["first_air_date.gte"]=`${er[0]}-01-01`; paramsBase["first_air_date.lte"]=`${er[1]}-12-31`; }
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
