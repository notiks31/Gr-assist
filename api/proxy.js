// api/proxy.js

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
    // 📢 TMAP_API_KEY로 변수 이름 수정
    const TMAP_APP_KEY = process.env.TMAP_API_KEY; 

    if (!TMAP_APP_KEY) {
        // 📢 에러 메시지도 수정
        return res.status(500).json({ error: "서버 오류: TMAP_API_KEY 환경 변수가 설정되지 않았거나 불러올 수 없습니다." });
    }

    try {
        const { startX, startY, endX, endY } = req.body;
        
        // 📢 TMAP API URL을 문서에 제시된 transit/routes로 복원합니다.
        const tmapUrl = "https://apis.openapi.sk.com/transit/routes";
        
        const payload = {
            startX: startX, startY: startY,
            endX: endX, endY: endY,
            // transit/routes API는 count를 지원하지 않을 수 있으므로, 해당 파라미터는 제거하는 것이 안전합니다.
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
            
            // 📢 TMAP API가 반환한 오류를 클라이언트에게 투명하게 전달합니다.
            return res.status(response.status).json({ 
                error: "TMAP API 호출 실패 (TMAP 서버 응답)", 
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
