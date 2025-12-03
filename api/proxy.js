// api/proxy.js

// fetch는 Vercel Node.js 런타임에서 기본적으로 전역 변수로 제공됩니다.

export default async function handler(req, res) {
    // 1. CORS 헤더 설정
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // 2. OPTIONS (예비 요청) 처리
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // 3. TMAP API 키를 Vercel 환경 변수에서 가져옵니다.
    const TMAP_APP_KEY = process.env.TMAP_API_KEY; 

    if (!TMAP_APP_KEY) {
        return res.status(500).json({ error: "서버 오류: TMAP_API_KEY 환경 변수가 설정되지 않았거나 불러올 수 없습니다." });
    }
    
    try {
        // req.body는 Vercel 환경에서 자동으로 파싱되지 않을 수 있으므로, Node.js 기본 req 객체에서 가져옵니다.
        // 현재 req 객체가 Vercel의 요청 객체 형태를 따른다고 가정하고 destructuring을 사용합니다.
        const { startX, startY, endX, endY } = req.body;
        
        // 📢 [A, B 문제 해결] 최신 TMAP 대중교통 경로 검색 엔드포인트와 필수 파라미터 reqType 추가
        const tmapUrl = "https://apis.openapi.sk.com/tmap/publictrans/transitInfo?version=1&format=json";
        
        const payload = {
            startX: startX, startY: startY,
            endX: endX, endY: endY,
            reqType: "TOTAL", // 📢 필수 파라미터: 전체 경로 검색 요청
            count: 5,         // 경로 개수를 5개로 늘려줍니다.
            format: "json"
        };

        // 5. TMAP 서버로 요청 보내기
        const response = await fetch(tmapUrl, {
            method: "POST",
            headers: {
                "appKey": TMAP_APP_KEY,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        // 6. TMAP API 응답 상태 확인
        if (!response.ok) {
            const errorText = await response.text();
            
            // 📢 TMAP API가 400 또는 403을 반환할 경우, 클라이언트에게도 해당 상태 코드를 전달
            return res.status(response.status).json({ 
                error: "TMAP API 호출 실패", 
                details: errorText,
                status: response.status 
            });
        }

        const data = await response.json();

        // 7. 결과를 프런트엔드로 돌려주기
        res.status(200).json(data);

    } catch (error) {
        console.error("PROXY ERROR:", error);
        res.status(500).json({ error: '서버 내부 오류가 발생했습니다.', details: error.message });
    }
}
