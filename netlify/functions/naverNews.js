const axios = require('axios');

exports.handler = async function(event, context) {
  const { query, display, sort } = event.queryStringParameters;
  const apiURL = 'https://openapi.naver.com/v1/search/news.json';

  if (!query) {
    return { statusCode: 400, body: JSON.stringify({ error: "검색어가 없습니다." }) };
  }

  try {
    const response = await axios.get(apiURL, {
      params: {
        query: query,
        display: display || 50, // 필터링을 위해 넉넉히 50개 가져옴 (최대 100)
        sort: sort || 'sim'
      },
      headers: {
        'X-Naver-Client-Id': process.env.NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET
      }
    });

    // [중요] GPT가 점수 계산을 잘하도록 HTML 태그 완벽 제거
    const cleanItems = response.data.items.map(item => {
      return {
        title: item.title.replace(/<[^>]*>?|&quot;|&#39;/gm, ''), 
        link: item.link,
        originallink: item.originallink,
        description: item.description.replace(/<[^>]*>?|&quot;|&#39;/gm, ''),
        pubDate: item.pubDate
      };
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ items: cleanItems }),
      headers: { "Content-Type": "application/json" }
    };

  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: "API 호출 실패" }) };
  }
};