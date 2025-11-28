const axios = require('axios');

// 1. [설정] 키워드 및 점수 규칙
const RULES = {
  // 검색어 (쿼리가 없을 때 사용)
  SEARCH_QUERY: "관세청|세관|통관|마약밀수|무역안보|관세행정|해외직구",
  
  // 점수판
  SCORES: { TOP_TITLE: 6, TOP_BODY: 3, SUB_TITLE: 4, SUB_BODY: 2 },
  
  // 키워드 목록
  TOP_KEYWORDS: ["이명구", "관세청", "관세청장", "관세행정", "이종욱", "고광효"],
  SUB_KEYWORDS: ["세관", "통관", "수출", "수입", "FTA", "원산지", "마약", "조사", "심사", "적발", "밀수", "AI", "혁신", "직구", "특송"],
  EXCLUDE_KEYWORDS: ["노동자", "백해룡", "임은정", "합수팀", "국수본", "김건희"],
  MUST_HAVE_KEYWORDS: ["관세청", "세관", "관세", "통관"]
};

// 2. [함수] 점수 계산기
function calculateScore(title, description) {
  let score = 0;
  const content = (title + " " + description);

  // 제외 키워드 체크 (-1점 = 탈락)
  for (const kw of RULES.EXCLUDE_KEYWORDS) {
    if (content.includes(kw)) return -1;
  }
  // 필수 키워드 체크
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

// 3. [함수] 날짜 필터 (최근 7일로 확대)
function isRecentNews(pubDateString) {
  const pubDate = new Date(pubDateString);
  const now = new Date();
  
  // [수정 포인트] 주말/공휴일 대비 7일 전 뉴스까지 허용
  const cutoffDate = new Date(now);
  cutoffDate.setDate(now.getDate() - 7); 
  cutoffDate.setHours(0, 0, 0, 0);

  return pubDate >= cutoffDate;
}

// 4. 메인 핸들러
exports.handler = async function(event, context) {
  try {
    const params = event.queryStringParameters || {};
    let query = params.query;

    if (!query || query.trim() === "") {
      query = RULES.SEARCH_QUERY;
    }

    const apiURL = 'https://openapi.naver.com/v1/search/news.json';
    
    const response = await axios.get(apiURL, {
      params: {
        query: query,
        display: 100, // 100개 스캔
        sort: 'date'  // 최신순
      },
      headers: {
        'X-Naver-Client-Id': process.env.NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET
      }
    });

    if (response.data.total === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({ items: [], message: "검색 결과 없음" })
      };
    }

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

    // 필터링 적용
    processedItems = processedItems.filter(item => {
      if (item.score === -1) return false;
      if (!isRecentNews(item.pubDate)) return false; // 7일 이내만 통과
      return true;
    });

    // 정렬 (점수 높은 순)
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
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
