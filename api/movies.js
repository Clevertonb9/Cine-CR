
module.exports = async (req, res) => {
  const token = process.env.TMDB_ACCESS_TOKEN;

  if (!token) {
    return res.status(500).json({
      error: "TMDB_ACCESS_TOKEN não configurado"
    });
  }

  const {
    action = "trending",
    query,
    page = "1",
    id,
    media_type = "movie"
  } = req.query;

  const language = "pt-BR";
  let endpoint;

  if (action === "trending") {
    endpoint = `/trending/all/week?language=${language}&page=${page}`;
  } else if (action === "search" && query) {
    endpoint = `/search/multi?query=${encodeURIComponent(query)}&page=${page}&language=${language}`;
  } else if (action === "popular") {
    endpoint = `/movie/popular?page=${page}&language=${language}`;
  } else if (action === "details" && id) {
    endpoint = `/${media_type}/${id}?language=${language}&append_to_response=credits,videos`;
  } else {
    return res.status(400).json({
      error: "Parâmetros inválidos"
    });
  }

  try {
    const response = await fetch(
      `https://api.themoviedb.org/3${endpoint}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          accept: "application/json"
        }
      }
    );

    const data = await response.json();
    return res.status(response.status).json(data);

  } catch (error) {
    return res.status(500).json({
      error: "Erro ao consultar a TMDB"
    });
  }
};
