// script.js

// config.js에서 키 가져오기
const KAKAO_KEY = API_KEYS.KAKAO_MAP_JAVASCRIPT_KEY;
const TMAP_KEY = API_KEYS.TMAP_API_KEY; // TMAP 키는 클라이언트에서는 사용하지 않음 (Proxy 서버에서 사용)

const bottomSheet = document.getElementById('bottomSheet');
const sheetHeader = document.getElementById('sheetHeader');
const minimizedSearchBar = document.getElementById('minimizedSearchBar');
const searchRouteBtn = document.getElementById('searchRouteBtn');
const startTripBtn = document.getElementById('startTripBtn');
const currentLocationBtn = document.getElementById('currentLocationBtn'); 
const routeSummaryList = document.getElementById('route-summary-list');
const mapOverlay = document.getElementById('mapOverlay'); // 지도 오버레이 변수

// 입력 필드와 교환 버튼 변수
const startInput = document.getElementById('startInput'); 
const endInput = document.getElementById('endInput');     
const swapBtn = document.querySelector('.btn-swap');      

let currentStage = 1; // 1: 홈, 2: 결과, 3+: 이동 중
let currentPositionMarker = null; // 현재 위치 마커 관리
let routePolyline = null; // 경로 선 관리


// --- Geolocation 및 지도 이동 ---

/**
 * 지도에 마커를 표시하고 기존 마커를 제거하는 헬퍼 함수
 */
function displayMarker(locPosition, message) {
    // 기존 마커가 있다면 제거
    if (currentPositionMarker) {
        currentPositionMarker.setMap(null);
    }
    
    // 새로운 마커 생성 및 표시
    const marker = new kakao.maps.Marker({  
        map: window.kakaoMap, 
        position: locPosition
    });
    currentPositionMarker = marker; 

    // 인포윈도우 텍스트를 메시지(message)로 설정하거나, 메시지가 없으면 빈 문자열로 설정
    const iwContent = `<div style="padding:5px; font-size:12px;">${message || ''}</div>`,
          iwRemoveable = true;

    // 인포윈도우 생성
    const infowindow = new kakao.maps.InfoWindow({
        content : iwContent,
        removable : iwRemoveable
    });
    
    // 마커 클릭 시 인포윈도우 토글
    kakao.maps.event.addListener(marker, 'click', function() {
        if (infowindow.getMap()) {
            infowindow.close();
        } else {
            infowindow.open(window.kakaoMap, marker); 
        }
    });
    
    // 메시지가 있을 경우에만 처음부터 인포윈도우 열기
    if (message) {
         infowindow.open(window.kakaoMap, marker);
    }
}

/**
 * 현재 위치로 지도를 이동합니다. (인포윈도우 텍스트는 빈 문자열 전달)
 */
function moveToCurrentLocation(isInitialLoad = false) {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            function(position) {
                const lat = position.coords.latitude;
                const lon = position.coords.longitude;
                const locPosition = new kakao.maps.LatLng(lat, lon);

                // 지도 중심을 현재 위치로 이동
                window.kakaoMap.setCenter(locPosition);
                window.kakaoMap.setLevel(4); // 확대 레벨 조정

                // 마커는 유지하고, 인포윈도우 텍스트를 제거하기 위해 빈 문자열 전달
                displayMarker(locPosition, ''); 
                
            },
            function(error) {
                console.error("현재 위치 가져오기 실패:", error);
                const message = "현재 위치를 찾을 수 없습니다. (위치 권한을 허용해주세요)";
                
                if (!isInitialLoad) {
                    alert(message);
                }
            },
            {
                enableHighAccuracy: true,
                timeout: 15000, // Timeout을 15초로 늘려 안정성 확보
                maximumAge: 0
            }
        );
    } else {
        alert("이 브라우저는 위치 정보(Geolocation)를 지원하지 않습니다.");
    }
}


// --- 카카오 맵 초기화 ---

function initMap() {
    const container = document.getElementById('map');
    const options = {
        center: new kakao.maps.LatLng(37.566826, 126.9786567), // 기본 위치: 서울 시청
        level: 4
    };

    window.kakaoMap = new kakao.maps.Map(container, options);
    window.ps = new kakao.maps.services.Places(); // Kakao Places Service 초기화
    
    moveToCurrentLocation(true); 
}

// 카카오 맵 SDK를 동적으로 로드 (services 라이브러리 추가)
function loadKakaoMapScript() {
    const script = document.createElement('script');
    script.type = 'text/javascript';
    // services 라이브러리 포함: 주소를 좌표로 변환하는 데 필요
    script.src = `//dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_KEY}&libraries=services,clusterer,drawing&autoload=false`; 
    
    script.onload = () => {
        kakao.maps.load(initMap); 
    };
    document.head.appendChild(script);
}

// --- TMAP 경로 검색 및 지도 그리기 ---

/**
 * TMAP API를 Vercel Proxy를 통해 호출하여 경로를 검색합니다.
 */
async function searchRoute() {
    const startAddress = startInput.value;
    const endAddress = endInput.value;
    
    // 이전에 그려진 경로선 제거
    if (routePolyline) {
        routePolyline.setMap(null);
        routePolyline = null;
    }
    
    routeSummaryList.innerHTML = '<h4>경로 검색 중... 잠시만 기다려주세요.</h4>';
    switchScreen(2); // 경로 조회 화면으로 먼저 이동

    // 1. 출발지/도착지 주소를 좌표로 변환 (Kakao Local API 사용)
    const startCoords = await getCoordsFromAddress(startAddress);
    const endCoords = await getCoordsFromAddress(endAddress);

    if (!startCoords || !endCoords) {
        routeSummaryList.innerHTML = '<h4>출발지 또는 도착지를 찾을 수 없습니다. 주소를 정확히 입력해 주세요.</h4>';
        return;
    }

    // 2. Vercel Proxy 엔드포인트 호출
    const proxyUrl = '/api/proxy'; 

    const requestBody = {
        'startX': startCoords.longitude,
        'startY': startCoords.latitude,
        'endX': endCoords.longitude,
        'endY': endCoords.latitude
    };

    try {
        const response = await fetch(proxyUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorData = await response.json();
            // Proxy에서 전달된 TMAP 오류를 상세히 표시
            throw new Error(`Proxy 호출 실패: ${response.status} (${errorData.error})`);
        }

        const data = await response.json();
        
        // TMAP 응답 구조 확인
        const routes = data.itineraries || (data.metaData ? data.metaData.plan.itineraries : null);


        if (routes && routes.length > 0) {
            displayRoutes(routes);
            
            // 📢 최선의 경로 (첫 번째 경로)를 지도에 바로 그립니다.
            const polylineCoordinates = await getPolylineFromRoute(routes[0].legs);
            drawPolyline(polylineCoordinates);

        } else {
            routeSummaryList.innerHTML = '<h4>검색된 대중교통 경로가 없습니다.</h4>';
        }
    } catch (error) {
        console.error("경로 검색 중 오류 발생:", error);
        routeSummaryList.innerHTML = `<h4>경로 검색 중 서버 오류가 발생했습니다.</h4><p style="color:red; font-size:0.9em;">${error.message}</p>`;
    }
}

/**
 * Kakao Local API를 사용하여 주소(또는 키워드)를 좌표로 변환합니다.
 */
function getCoordsFromAddress(address) {
    return new Promise((resolve) => {
        window.ps.keywordSearch(address, (data, status) => {
            if (status === kakao.maps.services.Status.OK) {
                resolve({ 
                    latitude: data[0].y, 
                    longitude: data[0].x 
                });
            } else {
                resolve(null);
            }
        });
    });
}

/**
 * 경로 요약을 화면에 표시하고 이벤트 리스너를 추가합니다.
 */
function displayRoutes(routes) {
    let html = '';

    routes.forEach((route, index) => {
        const totalTime = Math.round(route.totalTime / 60); 
        const payment = route.fare?.regular?.totalFare || 0; 
        
        const summary = route.legs.map(leg => {
            if (leg.mode === 'BUS') {
                return `🚌 ${leg.route}`;
            } else if (leg.mode === 'SUBWAY') {
                return `🚇 ${leg.route}`;
            } else if (leg.mode === 'WALK') {
                return `🚶 도보 ${Math.round(leg.distance / 60)}분`;
            }
            return '';
        }).filter(s => s).join(' → ');

        html += `
            <div class="route-card" data-index="${index}">
                <h3>${totalTime}분 | ₩${payment.toLocaleString()}</h3>
                <p>${summary}</p>
                <button class="btn-select-route btn-select-route-${index}" data-index="${index}">선택</button>
            </div>
        `;
    });

    routeSummaryList.innerHTML = html;
    
    // 경로 카드 선택 이벤트 리스너 추가
    routes.forEach((route, index) => {
        document.querySelector(`.btn-select-route-${index}`).addEventListener('click', async () => {
            const polylineCoordinates = await getPolylineFromRoute(route.legs);
            drawPolyline(polylineCoordinates);
            alert(`${index + 1}번째 경로를 지도에 표시했습니다.`);
        });
    });
}

/**
 * 📢 Kakao 지도에 경로선(Polyline)을 그립니다.
 */
function drawPolyline(coords) {
    // 기존 경로선 제거
    if (routePolyline) {
        routePolyline.setMap(null);
    }
    
    // Kakao LatLng 객체 배열 생성 (좌표들을 이어서 선을 표시)
    const linePath = coords.map(c => new kakao.maps.LatLng(c[1], c[0]));
    
    // Polyline 객체 생성
    routePolyline = new kakao.maps.Polyline({
        path: linePath, 
        strokeWeight: 6, 
        strokeColor: '#0076a8', // 네이버 블루 계열 색상
        strokeOpacity: 0.8, 
        strokeStyle: 'solid' 
    });

    routePolyline.setMap(window.kakaoMap);
    
    // 경로가 한눈에 보이도록 지도 범위 조정
    const bounds = new kakao.maps.LatLngBounds();
    linePath.forEach(p => bounds.extend(p));
    window.kakaoMap.setBounds(bounds);
}

/**
 * TMAP 경로 결과에서 Polyline을 위한 좌표 배열을 추출합니다.
 */
async function getPolylineFromRoute(legs) {
    let coordinates = [];

    legs.forEach(leg => {
        // 출발 지점 좌표
        if (leg.start && leg.start.lon && leg.start.lat) {
            coordinates.push([leg.start.lon, leg.start.lat]);
        }
        
        // 경유 정류장 목록 좌표
        if (leg.passStopList && leg.passStopList.stations) {
            leg.passStopList.stations.forEach(station => {
                coordinates.push([station.lon, station.lat]);
            });
        }
        
        // 도착 지점 좌표
        if (leg.end && leg.end.lon && leg.end.lat) {
            coordinates.push([leg.end.lon, leg.end.lat]);
        }
    });

    // 중복 좌표 제거 및 반환
    const uniqueCoords = Array.from(new Set(coordinates.map(JSON.stringify)), JSON.parse);
    return uniqueCoords;
}


// --- 새로운 기능: 출발/도착지 교환 (생략) ---

function swapLocations() {
    const tempValue = startInput.value;
    startInput.value = endInput.value;
    endInput.value = tempValue;
    console.log("출발지와 도착지가 교환되었습니다.");
}


// --- Bottom Sheet 및 UI 제어 (모션 개선) ---

function toggleSheet() {
    // 시트 축소 (지도 화면으로 복귀)
    if (bottomSheet.classList.contains('expanded')) {
        
        // 1. 축소 클래스 추가 및 CSS transition 시작
        bottomSheet.classList.remove('expanded');
        bottomSheet.classList.add('initial-minimized');
        document.querySelector('.floating-buttons').style.display = 'flex';

        // 📢 모션 개선: display: none 제어를 CSS에 완전히 맡깁니다.
        const content = document.getElementById('expandedSheetContent');
        if (content) {
             content.style.opacity = 0; // 내용 숨기기 시작
        }
    }
}

function expandSheet() {
    // 시트 확장
    if (bottomSheet.classList.contains('initial-minimized')) {
        const content = document.getElementById('expandedSheetContent');
        if (content) {
            content.style.display = 'block'; // 먼저 보이게 설정
            content.style.opacity = 1; // 내용 보이게 설정 (CSS transition 발동)
        }

        bottomSheet.classList.remove('initial-minimized');
        bottomSheet.classList.add('expanded');
        document.querySelector('.floating-buttons').style.display = 'none';
        switchScreen(currentStage);
    }
}

function switchScreen(stage) {
    currentStage = stage;
    const screens = document.querySelectorAll('.app-screen');
    
    // 비활성화 되는 화면은 transform과 opacity를 초기 상태로 되돌림
    screens.forEach(screen => {
        if (screen.classList.contains('active')) {
             screen.classList.remove('active');
        }
    });

    let targetScreen;
    if (stage === 1) targetScreen = document.getElementById('home-screen');
    else if (stage === 2) {
        targetScreen = document.getElementById('route-results-screen');
    }
    else if (stage >= 3 && stage <= 8) {
        targetScreen = document.getElementById('trip-in-progress-screen');
        if (stage === 3) updateTripInfo(3);
    }
    else if (stage === 9) targetScreen = document.getElementById('trip-complete-screen');
    
    if (targetScreen) {
        // active 클래스가 CSS transition을 통해 opacity: 1, transform: translateY(0) 적용
        targetScreen.classList.add('active'); 
        expandSheet();
    }
}

/**
 * 📢 뒤로 가기 및 이동 종료 로직
 */
function goBack() {
    if (currentStage === 2) {
        // 경로 조회 결과 화면 (Stage 2) -> 홈 화면 (Stage 1)
        switchScreen(1);
    } else if (currentStage >= 3 && currentStage <= 8) {
        // 이동 중 화면 (Stage 3-8) -> 홈 화면 (Stage 1)
        alert("이동 안내를 종료하고 홈 화면으로 돌아갑니다.");
        switchScreen(1);
    } else if (currentStage === 9) {
        // 이동 완료 화면 (Stage 9) -> 홈 화면 (Stage 1)
         switchScreen(1);
    }
}


/**
 * 이동 중 단계별 정보를 업데이트합니다. (Stage 3 로직 시뮬레이션)
 */
function updateTripInfo(stage) {
    const infoDiv = document.getElementById('current-stage-info');
    
    if (stage === 3) {
        infoDiv.innerHTML = `
            <h3>🚌 버스 탑승 전 (시뮬레이션)</h3>
            <p><strong>102번 버스</strong> 도착까지 **3분 15초** 남았습니다.</p>
            <p>정류장까지 **도보 2분** 거리입니다.</p>
        `;
    } else {
        infoDiv.innerHTML = `<h3>이동 중 정보 (${stage}단계)</h3><p>현재 단계의 상세 로직 구현이 필요합니다.</p>`;
    }
}


// --- 이벤트 리스너 ---

document.addEventListener('DOMContentLoaded', () => {
    loadKakaoMapScript();
    
    // 📢 버튼 변수 정의 (DOMContentLoaded 내에서)
    const backToHomeBtn1 = document.getElementById('backToHomeBtn1');
    const backToHomeBtn2 = document.getElementById('backToHomeBtn2');
    const endTripBtn = document.getElementById('endTripBtn');
    const returnToHomeBtn = document.getElementById('returnToHomeBtn');
    
    // Bottom Sheet 제어
    minimizedSearchBar.addEventListener('click', expandSheet);
    
    // 지도 오버레이 클릭 시 시트 축소 (지도 화면 복귀)
    sheetHeader.addEventListener('click', toggleSheet); 
    
    // 플로팅 버튼 클릭 시 현재 위치 이동
    currentLocationBtn.addEventListener('click', () => {
        moveToCurrentLocation(false);
    });
    
    // 출발/도착지 교환 버튼 이벤트 리스너 추가
    if (swapBtn) {
        swapBtn.addEventListener('click', swapLocations);
    }
    
    // 1. 경로 찾기 버튼 (Stage 1 -> 2)
    searchRouteBtn.addEventListener('click', () => {
        searchRoute(); // TMAP 경로 검색 함수 호출 및 UI 전환
    });
    
    // 2. 이 경로로 이동 버튼 (Stage 2 -> 3)
    startTripBtn.addEventListener('click', () => {
        // 이동 시작 로직
        switchScreen(3);
        toggleSheet(); 
    });
    
    // 📢 뒤로 가기 버튼 이벤트 리스너 연결
    if (backToHomeBtn1) backToHomeBtn1.addEventListener('click', goBack);
    if (backToHomeBtn2) backToHomeBtn2.addEventListener('click', goBack);
    
    // 📢 이동 종료/홈 복귀 버튼 이벤트 리스너 연결
    if (endTripBtn) endTripBtn.addEventListener('click', goBack); 
    if (returnToHomeBtn) returnToHomeBtn.addEventListener('click', goBack); 
    
    // 초기 로드시 Bottom Sheet는 최소화 상태로 시작 (Home Screen을 Active 상태로 유지)
    switchScreen(1);
    toggleSheet();
});
