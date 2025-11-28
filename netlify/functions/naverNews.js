const axios = require('axios');

exports.handler = async function(event, context) {
  // 1. GPT 스키마에서 보낸 파라미터 추출
  const { query, display, sort } = event.queryStringParameters;

  // 2. 네이버 뉴스 API 설정
  const apiURL = 'https://openapi.naver.com/v1/search/news.json';
  
  // 3. 필수 파라미터 검증
  if (!query) {
    return { statusCode: 400, body: JSON.stringify({ error: "검색어(query)는 필수입니다." }) };
  }

  try {
    // 4. 네이버 API 호출 (환경변수 사용으로 보안 해결)
    const response = await axios.get(apiURL, {
      params: {
        query: query,
        display: display || 30, // GPT가 필터링할 수 있도록 넉넉히 가져옴 (기본 30개)
        sort: sort || 'sim'     // 기본값: 정확도순
      },
      headers: {
        'X-Naver-Client-Id': process.env.NAVER_CLIENT_ID,     // Netlify에 저장된 ID
        'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET // Netlify에 저장된 Secret
      }
    });

    // 5. 데이터 정제 (GPT 토큰 절약 및 분석 정확도 향상)
    // 네이버는 검색어에 <b> 태그를 붙여서 주는데, 이를 제거해야 [지침]의 키워드 매칭이 정확해짐
    const cleanItems = response.data.items.map(item => ({
      title: item.title.replace(/<[^>]*>?/gm, ''),      // HTML 태그 제거
      link: item.link,
      originallink: item.originallink,
      description: item.description.replace(/<[^>]*>?/gm, ''), // HTML 태그 제거
      pubDate: item.pubDate
    }));

    // 6. 결과 반환
    return {
      statusCode: 200,
      body: JSON.stringify({
        lastBuildDate: response.data.lastBuildDate,
        total: response.data.total,
        items: cleanItems
      }),
      headers: { "Content-Type": "application/json" }
    };

  } catch (error) {
    console.error(error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "네이버 API 호출 실패" })
    };
  }
};