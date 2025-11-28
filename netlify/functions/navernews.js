const axios = require('axios');

// 1. [설정] gNUsead 키워드 및 점수 규칙
const RULES = {
  // 공백이나 특수문자 오류를 방지하기 위해 간단한 형태로 수정
  SEARCH_QUERY: "관세청|세관|통관|마약밀수|무역안보|관세행정",
  
  SCORES: { TOP_TITLE: 6, TOP_BODY: 3, SUB_TITLE: 4, SUB_BODY: 2 },
  
  TOP_KEYWORDS: ["이명구", "관세청", "관세청장", "관세행정", "이종욱"],
  SUB_KEYWORDS: ["세관", "통관", "수출", "수입", "FTA", "원산지", "마약", "조사", "심사", "적발", "밀수", "AI", "혁신"],
  EXCLUDE_KEYWORDS: ["노동자", "백해룡", "임은정", "합수팀", "국수본", "김건희"],
  MUST_HAVE_KEYWORDS: ["관세청", "세관", "관세", "통관"]
};

// 2. [함수] 점수 계산기
function calculateScore(title, description) {
  let score = 0;
  const content = (title + " " + description);

  for (const kw of RULES.EXCLUDE_KEYWORDS) {
    if (content.includes(kw)) return -1;
  }
  const hasMustHave = RULES.MUST_HAVE_KEYWORDS.some(kw => content.includes(kw));
  if (!hasMustHave) return -1;

  RULES.TOP_KEYWORDS.forEach(kw => {
    if (title.includes(kw)) score += RULES.SCORES.TOP_TITLE;
    if (description.includes(kw)) score += RULES.SCORES.TOP_BODY;
  });
  RULES.SUB_KEYWORDS.forEach(kw => {
    if (title.includes(kw)) score += RULES.SCORES.SUB_TITLE;
    if (description.includes(kw)) score += RULES.SCORES.SUB_BODY;
  });

  return score;
}

// 3. [함수] 날짜 필터 (오늘/어제)
function isRecentNews(pubDateString) {
  const pubDate = new Date(pubDateString);
  const now = new Date();
  // 어제 0시 0분부터 허용
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);
  return pubDate >= yesterday;
}

// 4. 메인 핸들러
exports.handler = async function(event, context) {
  try {
    // [중요 수정] 파라미터 안전 처리 (undefined 방지)
    const params = event.queryStringParameters || {};
    let query = params.query;

    // 검색어가 없거나 비어있으면 기본값 강제 적용
    if (!query || query.trim() === "") {
      query = RULES.SEARCH_QUERY;
    }

    const apiURL = 'https://openapi.naver.com/v1/search/news.json';
    
    // 네이버 API 호출
    const response = await axios.get(apiURL, {
      params: {
        query: query,
        display: 100,
        sort: 'date'
      },
      headers: {
        'X-Naver-Client-Id': process.env.NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET
      }
    });

    // 검색 결과가 0건이면 바로 반환 (GPT에게 상황 설명용)
    if (response.data.total === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          total_scanned: 0,
          filtered_count: 0,
          items: [],
          message: "네이버 검색 결과가 0건입니다. 검색어: " + query
        })
      };
    }

    // 데이터 정제 및 채점
    let processedItems = response.data.items.map(item => {
      const cleanTitle = item.title.replace(/<[^>]*>?|&quot;|&#39;/gm, '');
      const cleanDesc = item.description.replace(/<[^>]*>?|&quot;|&#39;/gm, '');
      return {
        title: cleanTitle,
        link: item.link,
        description: cleanDesc,
        pubDate: item.pubDate,
        score: calculateScore(cleanTitle, cleanDesc)
      };
    });

    // 필터링
    processedItems = processedItems.filter(item => {
      if (item.score === -1) return false;
      if (!isRecentNews(item.pubDate)) return false;
      return true;
    });

    // 정렬 (점수순)
    processedItems.sort((a, b) => b.score - a.score);

    // 상위 15개 반환
    const finalItems = processedItems.slice(0, 15);

    return {
      statusCode: 200,
      body: JSON.stringify({
        total_scanned: response.data.total,
        filtered_count: processedItems.length,
        items: finalItems
      }),
      headers: { "Content-Type": "application/json" }
    };

  } catch (error) {
    console.error("Error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server Error: " + error.message })
    };
  }
};