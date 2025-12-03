// script.js

// config.js에서 키 가져오기 (가정)
const API_KEYS = { 
    KAKAO_MAP_JAVASCRIPT_KEY: "d6a9086272b0c6871f25e0567fa6305b",
    TMAP_API_KEY: "gnU5nrLHve4KWYpaAWEJV5Tfuiw37F1w63icafR9" 
};
const KAKAO_KEY = API_KEYS.KAKAO_MAP_JAVASCRIPT_KEY;
// TMAP_KEY는 클라이언트에서 사용하지 않음 (Proxy 서버에서 사용)

const bottomSheet = document.getElementById('bottomSheet');
const sheetHeader = document.getElementById('sheetHeader');
const minimizedSearchBar = document.getElementById('minimizedSearchBar');
const searchRouteBtn = document.getElementById('searchRouteBtn');
const startTripBtn = document.getElementById('startTripBtn'); // Stage 2가 없어 사용하지 않지만, HTML 구조 유지를 위해 남김.
const currentLocationBtn = document.getElementById('currentLocationBtn'); 
const routeSummaryList = document.getElementById('route-summary-list');
const mapOverlay = document.getElementById('mapOverlay'); 

// 입력 필드와 교환 버튼 변수
const startInput = document.getElementById('startInput'); 
const endInput = document.getElementById('endInput');     
const swapBtn = document.querySelector('.btn-swap');      

let currentStage = 1; // 1: 홈, 2: 결과 (제거됨), 3+: 이동 중
let currentPositionMarker = null; // 현재 위치 마커 관리
let routePolyline = null; // 경로 선 관리

// 📢 경로 데이터 저장을 위한 전역 변수 (선택된 경로만 저장)
window.currentSelectedRoute = null;


// --- Geolocation 및 지도 이동 ---
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

function loadKakaoMapScript() {
    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.src = `//dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_KEY}&libraries=services,clusterer,drawing&autoload=false`; 
    
    script.onload = () => {
        kakao.maps.load(initMap); 
    };
    document.head.appendChild(script);
}

// --- TMAP 경로 검색 및 지도 그리기 ---

async function searchRoute() {
    const startAddress = startInput.value;
    const endAddress = endInput.value;
    
    // 기존 경로선 제거
    if (routePolyline) {
        routePolyline.setMap(null);
        routePolyline = null;
    }
    
    routeSummaryList.innerHTML = '<h4>경로 검색 중... 잠시만 기다려주세요.</h4>';
    // 📢 경로 결과 화면(Stage 2)은 건너뛰고, 바로 상세 화면(Stage 3) 로직으로 이동하기 위해 
    // Stage 3으로 전환하기 전에 UI를 확장합니다.
    expandSheet(); 

    // 1. 출발지/도착지 주소를 좌표로 변환 (Kakao Local API 사용)
    const startCoords = await getCoordsFromAddress(startAddress);
    const endCoords = await getCoordsFromAddress(endAddress);

    if (!startCoords || !endCoords) {
        routeSummaryList.innerHTML = '<h4>출발지 또는 도착지를 찾을 수 없습니다. 주소를 정확히 입력해 주세요.</h4>';
        switchScreen(1); // 실패 시 홈으로 복귀
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
            throw new Error(`Proxy 호출 실패: ${response.status} (${errorData.error})`);
        }

        const data = await response.json();
        const routes = data.itineraries || (data.metaData ? data.metaData.plan.itineraries : null);

        if (routes && routes.length > 0) {
            
            // 📢 1. 최선의 경로 (첫 번째 경로)의 Polyline을 지도에 그립니다. (Stage 2 생략)
            const firstRoute = routes[0];
            window.currentSelectedRoute = firstRoute; // 상세 화면에서 사용할 경로 저장
            
            const polylineCoordinates = await getPolylineFromRoute(firstRoute.legs);
            drawPolyline(polylineCoordinates);
            
            // 📢 2. UI를 '이동 중' 상세 경로 화면(Stage 3)으로 즉시 전환합니다.
            switchScreen(3);

        } else {
            routeSummaryList.innerHTML = '<h4>검색된 대중교통 경로가 없습니다.</h4>';
            switchScreen(1); // 경로가 없으면 홈으로 복귀
        }
    } catch (error) {
        console.error("경로 검색 중 오류 발생:", error);
        routeSummaryList.innerHTML = `<h4>경로 검색 중 서버 오류가 발생했습니다.</h4><p style="color:red; font-size:0.9em;">${error.message}</p>`;
        switchScreen(1); // 오류 시 홈으로 복귀
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
 * 📢 카카오 지도에 경로선(Polyline)을 그립니다.
 */
function drawPolyline(coords) {
    // 기존 경로선 제거
    if (routePolyline) {
        routePolyline.setMap(null);
    }
    
    // TMAP 응답은 [경도(Lng), 위도(Lat)] 순서이므로, Kakao (Lat, Lng)에 맞게 변환
    // coords는 [Lng, Lat] 배열의 배열입니다.
    const linePath = coords.map(c => new kakao.maps.LatLng(c[1], c[0]));
    
    // Polyline 객체 생성
    routePolyline = new kakao.maps.Polyline({
        path: linePath, 
        strokeWeight: 7, 
        strokeColor: '#0070c0', 
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


// --- 새로운 기능: 출발/도착지 교환 (유지) ---

function swapLocations() {
    const tempValue = startInput.value;
    startInput.value = endInput.value;
    endInput.value = tempValue;
    console.log("출발지와 도착지가 교환되었습니다.");
}

// 📢 goBack 함수 추가: Stage 3 -> Stage 1로 바로 복귀
function goBack() {
    if (currentStage > 1) {
        switchScreen(1); 
        toggleSheet(); // 시트 닫아 지도 화면을 크게 보여줌
    }
}


// --- Bottom Sheet 및 UI 제어 (모션 개선) ---

function toggleSheet() {
    if (bottomSheet.classList.contains('expanded')) {
        bottomSheet.classList.remove('expanded');
        bottomSheet.classList.add('initial-minimized');
        document.querySelector('.floating-buttons').style.display = 'flex';

        const content = document.getElementById('expandedSheetContent');
        if (content) {
             content.style.opacity = 0; 
        }
    }
}

function expandSheet() {
    if (bottomSheet.classList.contains('initial-minimized')) {
        const content = document.getElementById('expandedSheetContent');
        if (content) {
            content.style.display = 'block'; 
            content.style.opacity = 1; 
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
    // 📢 Stage 2 (route-results-screen)는 건너뜁니다.
    else if (stage === 3) {
        targetScreen = document.getElementById('trip-in-progress-screen');
        displayDetailedRoute(); 
    }
    else if (stage >= 4 && stage <= 8) {
        targetScreen = document.getElementById('trip-in-progress-screen');
        updateTripInfo(stage); 
    }
    else if (stage === 9) targetScreen = document.getElementById('trip-complete-screen');
    
    if (targetScreen) {
        targetScreen.classList.add('active'); 
        expandSheet();
    }
}

/**
 * 📢 상세 경로 타임라인을 표시하는 함수 (수정됨: 전역 변수 사용)
 */
function displayDetailedRoute() {
    const infoDiv = document.getElementById('current-stage-info');
    const route = window.currentSelectedRoute; // 전역 변수에서 경로 가져오기

    if (!route) {
        infoDiv.innerHTML = `<h4 style="color:red;">경로 데이터가 없습니다. 다시 검색해 주세요.</h4>`;
        return;
    }
    
    const totalTime = Math.round(route.totalTime / 60); 
    const payment = route.fare?.regular?.totalFare || 0; 

    let html = `
        <div class="screen-header">
             <button id="backToHomeBtn3" class="btn-icon back-btn">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>
            </button>
            <h2 class="section-title">총 ${totalTime}분 소요</h2>
        </div>
        <div class="summary-meta" style="margin-bottom: 20px;">
             ${route.legs.map(leg => {
                 if (leg.mode === 'BUS') return `<span class="mode-tag" style="background-color:#008000;">${leg.route}</span>`;
                 if (leg.mode === 'SUBWAY') return `<span class="mode-tag" style="background-color:#0000FF;">${leg.route}</span>`;
                 return '';
             }).join('')}
             <p style="font-size:0.9em; color:var(--color-text-sub); margin-top:5px;">₩${payment.toLocaleString()} | 🚶 ${Math.round(route.legs.find(l => l.mode === 'WALK')?.duration / 60) || 0}분</p>
        </div>

        <div class="timeline-container">
            ${route.legs.map((leg, index) => {
                let segmentHtml = '';
                
                // 1. 출발 지점 (첫 번째 Leg의 시작 지점)
                if (index === 0) {
                    segmentHtml += `
                        <div class="timeline-item">
                            <div class="timeline-time">출발</div>
                            <div class="timeline-icon"><span class="timeline-dot" style="border-color:var(--color-secondary);"></span></div>
                            <div class="timeline-details">
                                <h4>${leg.start.name || '출발지'}</h4>
                                <p>${leg.start.address || ''}</p>
                            </div>
                            <div class="timeline-path" style="background-color:var(--color-secondary);"></div>
                        </div>
                    `;
                }

                // 2. 이동 구간 (도보/대중교통)
                if (leg.mode === 'WALK') {
                    segmentHtml += `
                        <div class="timeline-item">
                            <div class="timeline-time"></div>
                            <div class="timeline-icon">🚶</div>
                            <div class="timeline-details">
                                <p style="color:var(--color-secondary);">도보</p>
                                <p style="font-size:0.8em; margin-top:0;">약 ${Math.round(leg.duration / 60)}분, ${leg.distance} 미터</p>
                            </div>
                            <div class="timeline-path" style="background-color:var(--color-secondary);"></div>
                        </div>
                    `;
                } else if (leg.mode === 'BUS' || leg.mode === 'SUBWAY') {
                    const modeTag = leg.mode === 'BUS' ? `<span class="mode-tag" style="background-color:#008000;">${leg.route}</span>` : `<span class="mode-tag" style="background-color:#0000FF;">${leg.route}</span>`;
                    const stops = leg.passStopList?.stations?.length || 0;
                    
                    segmentHtml += `
                        <div class="timeline-item">
                            <div class="timeline-time"></div>
                            <div class="timeline-icon">${leg.mode === 'BUS' ? '🚌' : '🚇'}</div>
                            <div class="timeline-details">
                                <h4>${leg.start.name || '탑승 정류장/역'}</h4>
                                <p>${modeTag} ${leg.end.name || '방면'}</p>
                                <p style="font-size:0.8em; margin-top:0;">${Math.round(leg.duration / 60)}분 (정류장 ${stops}개)</p>
                            </div>
                            <div class="timeline-path" style="background-color:var(--color-secondary);"></div>
                        </div>
                        <div class="timeline-item">
                            <div class="timeline-time"></div>
                            <div class="timeline-icon"><span class="timeline-dot" style="border-color:var(--color-secondary);"></span></div>
                            <div class="timeline-details">
                                <h4>${leg.end.name || '하차 정류장/역'}</h4>
                                <p>${leg.end.address || ''}</p>
                            </div>
                            ${index === route.legs.length - 1 ? '' : '<div class="timeline-path" style="background-color:var(--color-secondary);"></div>'}
                        </div>
                    `;
                }
                
                // 3. 최종 도착 지점 (마지막 Leg의 도착 지점)
                if (index === route.legs.length - 1) {
                     segmentHtml += `
                        <div class="timeline-item">
                            <div class="timeline-time">도착</div>
                            <div class="timeline-icon"><span class="timeline-dot" style="border-color:var(--color-secondary); background-color:var(--color-secondary);"></span></div>
                            <div class="timeline-details">
                                <h4>${leg.end.name || '목적지'}</h4>
                                <p>${leg.end.address || ''}</p>
                            </div>
                        </div>
                    `;
                }
                
                return segmentHtml;
            }).join('')}
        </div>
    `;

    infoDiv.innerHTML = html;

    // 📢 Stage 3의 뒤로가기 버튼을 홈 화면으로 복귀하도록 연결
    const backBtn = document.getElementById('backToHomeBtn3');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            switchScreen(1); 
            toggleSheet();
        });
    }
}

function updateTripInfo(stage) {
    const infoDiv = document.getElementById('current-stage-info');
    
    if (stage === 3) {
        displayDetailedRoute();
    } else {
        infoDiv.innerHTML = `<h3>이동 중 정보 (${stage}단계)</h3><p>현재 단계의 상세 로직 구현이 필요합니다.</p>`;
    }
}


// --- 이벤트 리스너 ---

document.addEventListener('DOMContentLoaded', () => {
    loadKakaoMapScript();
    
    // 📢 버튼 변수 정의
    const backToHomeBtn1 = document.getElementById('backToHomeBtn1'); // Home Screen에서 사용하는 뒤로가기 버튼 (Stage 2가 없으므로 무시)
    const backToHomeBtn2 = document.getElementById('backToHomeBtn2'); // Route Results Screen에서 사용하는 뒤로가기 버튼 (Stage 2가 없으므로 무시)
    const endTripBtn = document.getElementById('endTripBtn');
    const returnToHomeBtn = document.getElementById('returnToHomeBtn');
    
    // Bottom Sheet 제어
    minimizedSearchBar.addEventListener('click', expandSheet);
    sheetHeader.addEventListener('click', toggleSheet); 
    
    // 플로팅 버튼 클릭 시 현재 위치 이동
    currentLocationBtn.addEventListener('click', () => {
        moveToCurrentLocation(false);
    });
    
    // 출발/도착지 교환 버튼 이벤트 리스너 추가
    if (swapBtn) {
        swapBtn.addEventListener('click', swapLocations);
    }
    
    // 1. 경로 찾기 버튼 (Stage 1 -> 3으로 즉시 이동)
    searchRouteBtn.addEventListener('click', searchRoute);
    
    // 2. 이 경로로 이동 버튼 (Stage 2 -> 3) 로직은 제거됨. 이 버튼은 이제 Stage 3에서만 보입니다.
    // startTripBtn.addEventListener('click', ...); // 제거됨
    
    // 📢 뒤로 가기 버튼 이벤트 리스너 연결 (Stage 2, 3의 버튼 모두 goBack 처리)
    if (backToHomeBtn1) backToHomeBtn1.addEventListener('click', goBack);
    if (backToHomeBtn2) backToHomeBtn2.addEventListener('click', goBack);
    
    // 📢 이동 종료/홈 복귀 버튼 이벤트 리스너 연결
    if (endTripBtn) endTripBtn.addEventListener('click', goBack); 
    if (returnToHomeBtn) returnToHomeBtn.addEventListener('click', goBack); 
    
    // 초기 로드시 Bottom Sheet는 최소화 상태로 시작
    switchScreen(1);
    toggleSheet();
});
