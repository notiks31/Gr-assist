// script.js

// config.js에서 키 가져오기
const KAKAO_KEY = API_KEYS.KAKAO_MAP_JAVASCRIPT_KEY;
const TMAP_KEY = API_KEYS.TMAP_API_KEY; 

const bottomSheet = document.getElementById('bottomSheet');
const sheetHeader = document.getElementById('sheetHeader');
const minimizedSearchBar = document.getElementById('minimizedSearchBar');
const searchRouteBtn = document.getElementById('searchRouteBtn');
const startTripBtn = document.getElementById('startTripBtn');
const currentLocationBtn = document.getElementById('currentLocationBtn'); 
const routeSummaryList = document.getElementById('route-summary-list');
const mapOverlay = document.getElementById('mapOverlay'); 

// 입력 필드와 교환 버튼 변수
const startInput = document.getElementById('startInput'); 
const endInput = document.getElementById('endInput');     
const swapBtn = document.querySelector('.btn-swap');      

let currentStage = 1; 
let currentPositionMarker = null; 
let routePolyline = null; 
let selectedRouteData = null; // 선택된 경로 상세 데이터를 저장


// --- Geolocation 및 지도 이동 (유지) ---

function displayMarker(locPosition, message) {
    if (currentPositionMarker) {
        currentPositionMarker.setMap(null);
    }
    
    const marker = new kakao.maps.Marker({  
        map: window.kakaoMap, 
        position: locPosition
    });
    currentPositionMarker = marker; 

    const iwContent = `<div style="padding:5px; font-size:12px;">${message || ''}</div>`,
          iwRemoveable = true;

    const infowindow = new kakao.maps.InfoWindow({
        content : iwContent,
        removable : iwRemoveable
    });
    
    kakao.maps.event.addListener(marker, 'click', function() {
        if (infowindow.getMap()) {
            infowindow.close();
        } else {
            infowindow.open(window.kakaoMap, marker); 
        }
    });
    
    if (message) {
         infowindow.open(window.kakaoMap, marker);
    }
}

function moveToCurrentLocation(isInitialLoad = false) {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            function(position) {
                const lat = position.coords.latitude;
                const lon = position.coords.longitude;
                const locPosition = new kakao.maps.LatLng(lat, lon);

                window.kakaoMap.setCenter(locPosition);
                window.kakaoMap.setLevel(4); 

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
                timeout: 15000, 
                maximumAge: 0
            }
        );
    } else {
        alert("이 브라우저는 위치 정보(Geolocation)를 지원하지 않습니다.");
    }
}


// --- 카카오 맵 초기화 (유지) ---

function initMap() {
    const container = document.getElementById('map');
    const options = {
        center: new kakao.maps.LatLng(37.566826, 126.9786567), 
        level: 4
    };

    window.kakaoMap = new kakao.maps.Map(container, options);
    window.ps = new kakao.maps.services.Places(); 
    
    moveToCurrentLocation(true); 
}

function loadKakaoMapScript() {
    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.src = `//dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_KEY}&libraries=services,clusterer,drawing&autoload=false`; 
    
    script.onload = () => {
        kakao.maps.load(initMap); 
    };
    document.head.appendChild(script);
}

// --- TMAP 경로 검색 및 지도 그리기 (유지) ---

async function searchRoute() {
    const startAddress = startInput.value;
    const endAddress = endInput.value;
    
    if (routePolyline) {
        routePolyline.setMap(null);
        routePolyline = null;
    }

    routeSummaryList.innerHTML = '<h4>경로 검색 중... 잠시만 기다려주세요.</h4>';
    switchScreen(2); 

    const startCoords = await getCoordsFromAddress(startAddress);
    const endCoords = await getCoordsFromAddress(endAddress);

    if (!startCoords || !endCoords) {
        routeSummaryList.innerHTML = '<h4>출발지 또는 도착지를 찾을 수 없습니다. 주소를 정확히 입력해 주세요.</h4>';
        return;
    }

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
            throw new Error(`Proxy 호출 실패: ${response.status} (${errorData.error})`);
        }

        const data = await response.json();
        const routes = data.itineraries || (data.metaData ? data.metaData.plan.itineraries : null);

        if (routes && routes.length > 0) {
            // 📢 첫 번째 경로 데이터를 selectedRouteData에 저장
            selectedRouteData = routes[0]; 
            displayRoutes(routes);
            
            // 첫 번째 경로의 Polyline을 지도에 바로 그립니다.
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
            selectedRouteData = route; // 선택된 경로 데이터 업데이트
            const polylineCoordinates = await getPolylineFromRoute(route.legs);
            drawPolyline(polylineCoordinates);
            alert(`${index + 1}번째 경로를 지도에 표시했습니다.`);
        });
    });
}

function drawPolyline(coords) {
    if (routePolyline) {
        routePolyline.setMap(null);
    }
    
    const linePath = coords.map(c => new kakao.maps.LatLng(c[1], c[0]));
    
    routePolyline = new kakao.maps.Polyline({
        path: linePath, 
        strokeWeight: 6, 
        strokeColor: '#0076a8', 
        strokeOpacity: 0.8, 
        strokeStyle: 'solid' 
    });

    routePolyline.setMap(window.kakaoMap);
    
    const bounds = new kakao.maps.LatLngBounds();
    linePath.forEach(p => bounds.extend(p));
    window.kakaoMap.setBounds(bounds);
}

async function getPolylineFromRoute(legs) {
    let coordinates = [];

    legs.forEach(leg => {
        if (leg.start && leg.start.lon && leg.start.lat) {
            coordinates.push([leg.start.lon, leg.start.lat]);
        }
        
        if (leg.passStopList && leg.passStopList.stations) {
            leg.passStopList.stations.forEach(station => {
                coordinates.push([station.lon, station.lat]);
            });
        }
        
        if (leg.end && leg.end.lon && leg.end.lat) {
            coordinates.push([leg.end.lon, leg.end.lat]);
        }
    });

    const uniqueCoords = Array.from(new Set(coordinates.map(JSON.stringify)), JSON.parse);
    return uniqueCoords;
}


// --- 새로운 기능: 출발/도착지 교환 (유지) ---

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
        
        bottomSheet.classList.remove('expanded');
        bottomSheet.classList.add('initial-minimized');
        document.querySelector('.floating-buttons').style.display = 'flex';

        const content = document.getElementById('expandedSheetContent');
        if (content) {
             content.style.opacity = 0; // 내용 숨기기 시작
             // CSS transition 완료 후 display: none 처리됨
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
    else if (stage === 3) {
        // 📢 Stage 3 진입 시, 상세 경로 타임라인을 표시합니다.
        targetScreen = document.getElementById('trip-in-progress-screen');
        displayDetailedRoute(); 
    }
    else if (stage >= 4 && stage <= 8) {
        targetScreen = document.getElementById('trip-in-progress-screen');
        updateTripInfo(stage); // Stage 4~8의 상세 이동 안내
    }
    else if (stage === 9) targetScreen = document.getElementById('trip-complete-screen');
    
    if (targetScreen) {
        targetScreen.classList.add('active'); 
        expandSheet();
    }
}

/**
 * 📢 상세 경로 타임라인을 표시하는 함수 (이미지 2 참고)
 */
function displayDetailedRoute() {
    const infoDiv = document.getElementById('current-stage-info');
    
    // TMAP API 응답 데이터 (selectedRouteData)를 사용하여 실제 타임라인을 구성해야 하지만,
    // 현재는 디자인 시뮬레이션을 위해 하드코딩된 데이터로 HTML을 생성합니다.
    
    if (!selectedRouteData) {
        infoDiv.innerHTML = "<h4>경로 데이터가 없습니다. 홈으로 돌아가 검색해주세요.</h4>";
        return;
    }

    // 📢 이미지 2를 모방한 HTML 구조 생성
    let html = `
        <div class="screen-header">
             <button id="backToResultsBtn" class="btn-icon back-btn">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>
            </button>
            <h2 class="section-title">PM 9:13 ~ PM 9:26 (13분)</h2>
        </div>
        <div class="summary-meta" style="margin-bottom: 20px;">
             <span class="mode-tag" style="background-color:#008000;">부산진구6-1</span>
             <span class="mode-tag" style="background-color:#008000;">부산진구6</span>
             <span class="mode-tag" style="background-color:#008000;">부산진구9</span>
             <p style="font-size:0.9em; color:var(--color-text-sub); margin-top:5px;">₩1,480 | 🚶 3분 | 4분마다</p>
        </div>

        <div class="timeline-container">
            <div class="timeline-item">
                <div class="timeline-time">PM 9:13</div>
                <div class="timeline-icon"><span class="timeline-dot" style="border-color:var(--color-secondary);"></span></div>
                <div class="timeline-details">
                    <h4>동의대학교 제2효민생활관</h4>
                    <p>176 엄광로 가야3동 부산진구 부산광역시</p>
                </div>
                <div class="timeline-path" style="background-color:var(--color-secondary);"></div>
            </div>

            <div class="timeline-item">
                <div class="timeline-time"></div>
                <div class="timeline-icon">🚶</div>
                <div class="timeline-details">
                    <p style="color:var(--color-secondary);">도보</p>
                    <p style="font-size:0.8em; margin-top:0;">약 3분, 180 미터</p>
                </div>
                <div class="timeline-path" style="background-color:var(--color-secondary);"></div>
            </div>

            <div class="timeline-item">
                <div class="timeline-time">PM 9:21</div>
                <div class="timeline-icon"><span class="timeline-dot" style="border-color:var(--color-secondary);"></span></div>
                <div class="timeline-details">
                    <h4>동의대학교자연대학</h4>
                    <p>버스 <span class="mode-tag" style="background-color:#008000; color:white;">부산진구6-1</span> 동의대지하철역</p>
                    <p style="font-size:0.8em; margin-top:0;">5분 (정류장 3개)</p>
                </div>
                <div class="timeline-path" style="background-color:var(--color-secondary);"></div>
            </div>
            
            <div class="timeline-item">
                <div class="timeline-time">PM 9:26</div>
                <div class="timeline-icon"><span class="timeline-dot" style="border-color:var(--color-secondary); background-color:var(--color-secondary);"></span></div>
                <div class="timeline-details">
                    <h4>동의대역</h4>
                    <p>부산광역시</p>
                </div>
            </div>
        </div>
    `;
    
    // 기존 내용을 상세 타임라인으로 대체
    infoDiv.innerHTML = html;

    // 📢 상세 화면에서 결과 목록으로 돌아가기 버튼 리스너 추가
    document.getElementById('backToResultsBtn').addEventListener('click', () => {
        // Stage 3 -> Stage 2 (경로 결과 목록)으로 복귀
        switchScreen(2); 
    });
}

function updateTripInfo(stage) {
    const infoDiv = document.getElementById('current-stage-info');
    
    if (stage === 3) {
        // 📢 Stage 3 진입 시 바로 상세 경로 타임라인을 표시하도록 displayDetailedRoute를 호출
        displayDetailedRoute();
    } else {
        infoDiv.innerHTML = `<h3>이동 중 정보 (${stage}단계)</h3><p>현재 단계의 상세 로직 구현이 필요합니다.</p>`;
    }
}


// --- 이벤트 리스너 ---

document.addEventListener('DOMContentLoaded', () => {
    loadKakaoMapScript();
    
    const backToHomeBtn1 = document.getElementById('backToHomeBtn1');
    const backToHomeBtn2 = document.getElementById('backToHomeBtn2');
    const endTripBtn = document.getElementById('endTripBtn');
    const returnToHomeBtn = document.getElementById('returnToHomeBtn');
    
    minimizedSearchBar.addEventListener('click', expandSheet);
    sheetHeader.addEventListener('click', toggleSheet); 
    
    currentLocationBtn.addEventListener('click', () => {
        moveToCurrentLocation(false);
    });
    
    if (swapBtn) {
        swapBtn.addEventListener('click', swapLocations);
    }
    
    searchRouteBtn.addEventListener('click', () => {
        searchRoute(); 
    });
    
    // 📢 Stage 2에서 이 경로로 이동 버튼 누르면 Stage 3 (상세 경로 타임라인)으로 이동
    startTripBtn.addEventListener('click', () => {
        switchScreen(3);
        // toggleSheet(); // Stage 3 진입 후 시트 축소는 선택 사항
    });
    
    if (backToHomeBtn1) backToHomeBtn1.addEventListener('click', goBack);
    if (backToHomeBtn2) backToHomeBtn2.addEventListener('click', goBack);
    
    if (endTripBtn) endTripBtn.addEventListener('click', goBack); 
    if (returnToHomeBtn) returnToHomeBtn.addEventListener('click', goBack); 
    
    switchScreen(1);
    toggleSheet();
});
