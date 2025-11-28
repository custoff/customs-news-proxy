const axios = require('axios');

// ===================================================================
// 1. [설정] gNUsead 키워드 및 점수 규칙 정의
// ===================================================================
const RULES = {
  // [검색 키워드]: 네이버 API에 요청할 검색어 (OR 연산)
  SEARCH_QUERY: "관세청|세관|통관|수출입|무역통계|FTA|관세행정|관세협상|관세청 AI|마약밀수|관세청 조사",

  // [점수판]
  SCORES: {
    TOP_TITLE: 6,    // TOP 키워드가 제목에 있음
    TOP_BODY: 3,     // TOP 키워드가 본문에 있음
    SUB_TITLE: 4,    // SUB 키워드가 제목에 있음
    SUB_BODY: 2      // SUB 키워드가 본문에 있음
  },

  // [키워드 목록]
  TOP_KEYWORDS: ["이명구", "관세청", "관세청장", "관세행정", "이종욱"],
  
  SUB_KEYWORDS: [
    "세관", "통관", "수출", "수입", "FTA", "원산지", "관세평가", "AEO", 
    "업무협약", "디지털", "AI", "인공지능", "조직개편", "간담회", "현장방문", 
    "인천공항본부세관", "서울본부세관", "부산본부세관", "KOTRA", "무역협정", 
    "필로폰", "코카인", "위조상품", "지식재산권", "마약", "조사", "심사"
  ],

  // [제외 키워드]: 제목이나 본문에 있으면 무조건 탈락
  EXCLUDE_KEYWORDS: ["노동자", "백해룡", "임은정", "합수팀", "국수본", "김건희"],
  
  // [필수 키워드]: 제목이나 본문에 하나라도 없으면 탈락
  MUST_HAVE_KEYWORDS: ["관세청", "세관", "관세", "통관", "관세행정", "무역안보", "법원"]
};

// ===================================================================
// 2. [함수] 점수 계산기 (gNUsead 로직 이식)
// ===================================================================
function calculateScore(title, description) {
  let score = 0;
  const content = (title + " " + description); // 검색 편의를 위해 합침

  // 1) 제외 키워드 체크 (발견 시 -1점 반환하여 탈락 신호)
  for (const kw of RULES.EXCLUDE_KEYWORDS) {
    if (content.includes(kw)) return -1;
  }

  // 2) 필수 키워드 체크 (하나라도 없으면 -1점 반환)
  const hasMustHave = RULES.MUST_HAVE_KEYWORDS.some(kw => content.includes(kw));
  if (!hasMustHave) return -1;

  // 3) 점수 계산 (TOP)
  RULES.TOP_KEYWORDS.forEach(kw => {
    if (title.includes(kw)) score += RULES.SCORES.TOP_TITLE;
    if (description.includes(kw)) score += RULES.SCORES.TOP_BODY;
  });

  // 4) 점수 계산 (SUB)
  RULES.SUB_KEYWORDS.forEach(kw => {
    if (title.includes(kw)) score += RULES.SCORES.SUB_TITLE;
    if (description.includes(kw)) score += RULES.SCORES.SUB_BODY;
  });

  return score;
}

// ===================================================================
// 3. [함수] 날짜 필터 (오늘/어제 뉴스만 통과)
// ===================================================================
function isRecentNews(pubDateString) {
  const pubDate = new Date(pubDateString);
  const now = new Date();
  
  // 한국 시간(KST) 보정 (서버 위치에 따라 다를 수 있으므로 안전하게 계산)
  // 어제 0시 0분 0초보다 이후인 뉴스만 통과 (즉, 오늘과 어제 뉴스)
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);

  return pubDate >= yesterday;
}

// ===================================================================
// 4. 메인 핸들러
// ===================================================================
exports.handler = async function(event, context) {
  // GPT가 보낸 쿼리가 없으면 기본값 사용
  const query = event.queryStringParameters.query || RULES.SEARCH_QUERY;
  
  const apiURL = 'https://openapi.naver.com/v1/search/news.json';

  try {
    // 1. 네이버 API 호출 (최대 100개 가져옴 - 많이 가져와서 걸러내기 위함)
    const response = await axios.get(apiURL, {
      params: {
        query: query,
        display: 100, // gNUsead처럼 많이 가져옵니다.
        sort: 'date'  // 최신순으로 가져옵니다.
      },
      headers: {
        'X-Naver-Client-Id': process.env.NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET
      }
    });

    // 2. 데이터 정제, 필터링, 채점 (Process)
    let processedItems = response.data.items.map(item => {
      // HTML 태그 제거
      const cleanTitle = item.title.replace(/<[^>]*>?|&quot;|&#39;/gm, '');
      const cleanDesc = item.description.replace(/<[^>]*>?|&quot;|&#39;/gm, '');
      
      // 점수 계산
      const score = calculateScore(cleanTitle, cleanDesc);

      return {
        title: cleanTitle,
        link: item.link,
        description: cleanDesc,
        pubDate: item.pubDate,
        score: score // 계산된 점수 추가
      };
    });

    // 3. 필터링 (제외 키워드/필수 키워드 탈락자 & 날짜 지난 뉴스 제거)
    processedItems = processedItems.filter(item => {
      // 점수가 -1이면(제외/필수 조건 위배) 탈락
      if (item.score === -1) return false;
      // 날짜가 오래됐으면 탈락
      if (!isRecentNews(item.pubDate)) return false;
      return true;
    });

    // 4. 정렬 (점수 높은 순 -> 같다면 최신순)
    processedItems.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score; // 점수 내림차순
      return new Date(b.pubDate) - new Date(a.pubDate);  // 최신순
    });

    // 5. 상위 15개 선정 (GPT에게 보낼 최종 정예 요원)
    // gNUsead의 '추천 뉴스' 개념 적용
    const finalItems = processedItems.slice(0, 15);

    // 6. 결과 반환
    return {
      statusCode: 200,
      body: JSON.stringify({
        total_scanned: response.data.total, // 검색된 전체 수
        filtered_count: processedItems.length, // 조건 통과한 수
        items: finalItems // 점수 상위 15개
      }),
      headers: { "Content-Type": "application/json" }
    };

  } catch (error) {
    console.error(error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "API 처리 중 오류 발생" })
    };
  }
};
