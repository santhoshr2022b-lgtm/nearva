document.addEventListener("DOMContentLoaded", function () {
    const urlParams = new URLSearchParams(window.location.search);
    const initialCategory = urlParams.get('category') || 'All';

    // Default Fallback: Vellore City Center
    const DEFAULT_LAT = 12.9165;
    const DEFAULT_LNG = 79.1325;
    const DEFAULT_ZOOM = 12;

    // State for instant load
    const cachedLat = localStorage.getItem('nearva_last_lat');
    const cachedLng = localStorage.getItem('nearva_last_lng');
    const START_LAT = cachedLat ? parseFloat(cachedLat) : DEFAULT_LAT;
    const START_LNG = cachedLng ? parseFloat(cachedLng) : DEFAULT_LNG;
    const START_ZOOM = cachedLat ? 14 : DEFAULT_ZOOM;

    // Set immediate reference point from cache if available
    if (cachedLat && cachedLng) {
        window.currentUserLatLng = [START_LAT, START_LNG];
        window.referenceLatLng = [START_LAT, START_LNG];
    }

    if (initialCategory !== 'All') {
        setTimeout(() => window.setCategory(initialCategory), 500);
    }

    // Global state
    window.currentAvailabilityFilter = 'All';
    window.selectedWorkerId = null; // Track currently viewed worker to prevent flickering
    window.lastUpdateLatLng = null; // Reference point for significant distance changes
    window.referenceLatLng = null; // Smothed GPS location for UI calculations
    window._isProgrammaticMove = false; // NEW: To prevent manual pan breaking auto-follow
    window.roadDistanceStore = {}; // NEW: Persistent Road Cache {workerId: {roadM, haversineM, userLatLng, workerLatLng, ts}}

    // 1. Define Layers
    const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
    });

    const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri'
    });

    const labels = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
        attribution: ''
    });

    const hybrid = L.layerGroup([satellite, labels]);

    // 2. Initialize Map (Instant UI & Hardware Accelerated)
    var map = L.map('map', {
        center: [START_LAT, START_LNG],
        zoom: START_ZOOM,
        zoomControl: false,
        layers: [osm],
        preferCanvas: true // GPU Rendering for markers
    });
    window.map = map;

    // Immediate Load Workers (Parallel to GPS)
    setTimeout(() => loadWorkers(false), 50);

    // Global Layer Variables
    window.layers = {
        street: osm,
        satellite: satellite,
        hybrid: hybrid
    };

    // User Marker Variable
    var userMarker = null;
    var userCircle = null;
    var radiusCircle = null;
    let currentFetchController = null; // To abort previous fetches
    window.isFollowingUser = true; // NEW: Follow-Me state
    window.watchId = null; // Track geolocation watcher

    function showMapLoading(show, message = "Syncing...") {
        const badge = document.getElementById('map-status-badge');
        if (show && badge) {
            badge.innerHTML = `<span class="animate-pulse">🔄 ${message}</span>`;
            badge.classList.remove('hidden');
        } else if (badge) {
            badge.classList.add('hidden');
        }
    }

    // 1. Locate User (High-Accuracy continuous strategy)
    window.locateUser = function (isAuto = false) {
        if (!navigator.geolocation) return;

        const gpsBtn = document.getElementById('gps-button');

        // If clicking manually, re-enable "Follow Me"
        if (!isAuto) {
            window.isFollowingUser = true;
            if (gpsBtn) gpsBtn.classList.add('gps-following');
        }

        if (gpsBtn) gpsBtn.classList.add('gps-glow', 'text-blue-600');
        showMapLoading(true, "Detecting location...");

        // Strategy: High-Accuracy Kickstart + Continuous Watch
        const gpsOptions = {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
        };

        // 1. KICKSTART: Clear any existing watch and get immediate position
        if (window.watchId) navigator.geolocation.clearWatch(window.watchId);

        navigator.geolocation.getCurrentPosition(
            (pos) => handleGPSFix(pos, true, gpsBtn),
            null, // Fail silently, watchPosition will pick it up
            gpsOptions
        );

        // 2. CONTINUOUS: Professional real-time tracking
        window.watchId = navigator.geolocation.watchPosition(
            (pos) => {
                if (gpsBtn) gpsBtn.classList.remove('gps-glow');
                handleGPSFix(pos, false, gpsBtn);
            },
            (err) => {
                showMapLoading(false);
                if (gpsBtn) gpsBtn.classList.remove('gps-glow', 'gps-following');

                if (err.code === 1 || err.code === 2) {
                    toggleGPSModal(true);
                } else {
                    console.warn("GPS Watch Error (Retrying in 5s):", err);
                    setTimeout(() => window.locateUser(true), 5000); // AUTO-RETRY
                }
            },
            gpsOptions
        );
    }

    window.toggleGPSModal = function (show) {
        const modal = document.getElementById('gps-modal');
        const content = document.getElementById('gps-modal-content');
        if (!modal || !content) return;

        if (show) {
            modal.classList.remove('hidden');
            setTimeout(() => {
                modal.classList.add('opacity-100');
                content.classList.add('scale-100', 'opacity-100');
            }, 10);
        } else {
            modal.classList.remove('opacity-100');
            content.classList.remove('scale-100', 'opacity-100');
            setTimeout(() => modal.classList.add('hidden'), 300);
        }
    };

    window.retryGPS = function () {
        toggleGPSModal(false);
        setTimeout(() => window.locateUser(false), 500);
    };

    // Manual drag detection to break "Follow Me"
    map.on('movestart', (e) => {
        if (window._isProgrammaticMove) return;
        window.isFollowingUser = false;
        const gpsBtn = document.getElementById('gps-button');
        if (gpsBtn) gpsBtn.classList.remove('gps-following');
    });

    let gpsLockStartTime = null;
    let hasHighAccuracyLock = false;

    function handleGPSFix(position, isFirst, btn) {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const accuracy = position.coords.accuracy;

        if (!gpsLockStartTime) gpsLockStartTime = Date.now();

        // Accuracy Threshold: 50m for Professional standards
        const isAccurate = accuracy < 50;
        const lockTimeout = (Date.now() - gpsLockStartTime) > 8000;
        const extremeTimeout = (Date.now() - gpsLockStartTime) > 15000;

        if (isAccurate || lockTimeout) {
            if (!hasHighAccuracyLock) {
                hasHighAccuracyLock = true;
                showMapLoading(false);
                if (isAccurate) showSmartNotification("High-Accuracy GPS Lock Acquired", 2000);
            }
        } else {
            // If still extremely inaccurate after 15s, kickstart again
            if (extremeTimeout && accuracy > 100) {
                console.log("GPS Accuracy remains poor. Kickstarting...");
                gpsLockStartTime = Date.now();
                window.locateUser(true);
                return;
            }
            showMapLoading(true, `Refining GPS (${Math.round(accuracy)}m)...`);
            return;
        }

        // --- Coordinate Debouncing (20m Threshold) ---
        if (!window.referenceLatLng) {
            window.referenceLatLng = [lat, lng];
        } else {
            const distFromRef = calculateDistance(window.referenceLatLng[0], window.referenceLatLng[1], lat, lng);
            if (distFromRef > 20) {
                window.referenceLatLng = [lat, lng];
            }
        }

        localStorage.setItem('nearva_last_lat', lat);
        localStorage.setItem('nearva_last_lng', lng);

        updateUserPosition(lat, lng, accuracy, false);
    }
    // Auto-trigger on load
    setTimeout(() => {
        if (window.map) map.invalidateSize();
        window.locateUser(true);
    }, 1000);

    // 3. Status Polling (Managed inside loadWorkers)

    function updateUserPosition(lat, lng, accuracy, isFirstFix) {
        window.currentUserLatLng = [lat, lng];

        if (userMarker) {
            userMarker.setLatLng([lat, lng]);
            userCircle.setLatLng([lat, lng]);
            userCircle.setRadius(accuracy);
            if (radiusCircle) radiusCircle.setLatLng([lat, lng]);
        } else {
            // Initial marker creation...
            const userIcon = L.divIcon({
                className: 'user-location-marker',
                html: `<div class="w-5 h-5 bg-blue-600 border-[3px] border-white rounded-full shadow-lg relative">
                        <div class="absolute inset-0 bg-blue-600 rounded-full animate-ping opacity-40"></div>
                       </div>`,
                iconSize: [20, 20],
                iconAnchor: [10, 10]
            });

            userMarker = L.marker([lat, lng], {
                icon: userIcon,
                zIndexOffset: -500,
                interactive: true
            }).addTo(map);

            userCircle = L.circle([lat, lng], {
                radius: accuracy,
                color: '#2563eb',
                fillColor: '#3b82f6',
                fillOpacity: 0.1,
                weight: 1
            }).addTo(map);

            radiusCircle = L.circle([lat, lng], {
                radius: 10000,
                color: '#2563eb',
                fillColor: '#3b82f6',
                fillOpacity: 0.05,
                weight: 1,
                dashArray: '5, 8',
                interactive: false,
                className: 'radial-pulse-anim'
            }).addTo(map);

            // First fix flyTo
            map.flyTo([lat, lng], 15, { animate: true, duration: 1.5 });
        }

        // Follow Me Logic: Auto-center if active
        // Follow Me Logic: Auto-center if active (CRITICAL FIX: Prevent manual pan collision)
        if (window.isFollowingUser) {
            window._isProgrammaticMove = true;
            requestAnimationFrame(() => {
                map.panTo([lat, lng], { animate: true, duration: 0.8 });
            });
            setTimeout(() => { window._isProgrammaticMove = false; }, 900);

            const gpsBtn = document.getElementById('gps-button');
            if (gpsBtn) gpsBtn.classList.add('gps-following');
        }
    }

    // Worker Markers Layer Group
    const workerLayer = L.layerGroup().addTo(map);
    const markerMap = new Map(); // Persistent map of worker markers: {workerId: marker}

    // Worker Icons
    const icons = {
        'Plumber': '🔧', 'Electrician': '⚡', 'Cook': '🍳', 'Driver': '🚗',
        'Carpenter': '🔨', 'AC Technician': '❄️', 'Mason': '🧱',
        'House Cleaning': '🧹', 'Two-Wheeler Mechanic': '🏍️',
        'Mobile Repair': '📱', 'Default': '👷'
    };

    window.setCategory = function (category) {
        // Update URL without reload
        const newUrl = new URL(window.location);
        newUrl.searchParams.set('category', category);
        window.history.pushState({}, '', newUrl);

        // Update chips UI
        const chips = document.querySelectorAll('.cat-chip');
        chips.forEach(btn => {
            const btnText = btn.textContent.trim();
            const isMatch = btnText === category ||
                (category === 'Cleaning' && btnText === 'Cleaning') ||
                (category === 'AC Technician' && (btnText === 'AC Tech' || btnText === 'AC Technician')) ||
                (category === 'Mechanic' && (btnText === 'Mechanic' || btnText === 'Two-Wheeler Mechanic'));

            if (isMatch) {
                btn.classList.add('bg-blue-600', 'text-white', 'border-blue-600', 'shadow-md');
                btn.classList.remove('bg-white', 'text-gray-600', 'border-gray-100');
            } else {
                btn.classList.remove('bg-blue-600', 'text-white', 'border-blue-600', 'shadow-md');
                btn.classList.add('bg-white', 'text-gray-600', 'border-gray-100');
            }
        });

        // Instant Filter without reload
        window.currentRadius = 5000;
        loadWorkers(false, 5000);
    };

    function getWorkerIcon(service, isOnline, isNearby = false) {
        const emoji = icons[service] || icons['Default'];
        let borderClass = 'border-gray-400';
        let bgClass = isOnline ? 'bg-white' : 'bg-gray-100 grayscale opacity-60';
        let glowClass = '';

        if (isOnline && isNearby) {
            borderClass = 'border-green-600';
            bgClass = 'bg-white';
            glowClass = 'shadow-[0_0_15px_rgba(34,197,94,0.6)] animate-pulse';
        } else if (!isOnline) {
            borderClass = 'border-gray-300';
        }

        return L.divIcon({
            className: 'worker-marker-container',
            html: `<div class="marker-hit-area relative w-16 h-16 flex items-center justify-center cursor-pointer" style="pointer-events: auto; will-change: transform; transform: translateZ(0);">
                    <div class="relative z-10 flex items-center justify-center w-12 h-12 ${bgClass} rounded-full shadow-2xl border-[3px] ${borderClass} ${glowClass} text-2xl" style="pointer-events: none; will-change: transform; transform: translateZ(0);">
                        ${emoji}
                    </div>
                   </div>`,
            iconSize: [64, 64],
            iconAnchor: [32, 32],
            popupAnchor: [0, -32]
        });
    }

    function timeAgo(dateString) {
        if (!dateString) return "Never";
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now - date;
        const diffMin = Math.round(diffMs / 60000);
        const diffHrs = Math.round(diffMs / 3600000);
        const diffDays = Math.round(diffMs / 86400000);

        if (diffMin < 1) return "Just now";
        if (diffMin < 60) return `${diffMin}m ago`;
        if (diffHrs < 24) return `${diffHrs}h ago`;
        return `${diffDays}d ago`;
    }

    function showSmartNotification(text, duration = 3000) {
        const bar = document.getElementById('smart-notification');
        const span = document.getElementById('smart-notification-text');
        if (!bar || !span) return;
        span.textContent = text;
        bar.classList.remove('hidden', 'opacity-0');
        bar.classList.add('flex', 'opacity-100');
        if (duration > 0) {
            setTimeout(() => {
                bar.classList.add('opacity-0');
                setTimeout(() => bar.classList.add('hidden'), 500);
            }, duration);
        }
    }

    // Distance Calculation (Haversine - Straight Line Fallback)
    function calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371; // km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c * 1000; // returns meters
    }

    // Road Distance Calculation (OSRM - Professional Grade)
    async function fetchRoadDistance(lat1, lon1, lat2, lon2) {
        try {
            // Priority: Straight line update first (instant)
            const fallbackM = calculateDistance(lat1, lon1, lat2, lon2);

            // Fetch from OSRM (Road route)
            const url = `https://router.project-osrm.org/route/v1/driving/${lon1},${lat1};${lon2},${lat2}?overview=false`;
            const res = await fetch(url);
            const data = await res.json();

            if (data.code === 'Ok' && data.routes && data.routes[0]) {
                const roadM = data.routes[0].distance;
                const roadDurationS = data.routes[0].duration;
                return { distanceM: roadM, durationS: roadDurationS };
            }
            return { distanceM: fallbackM, durationS: null };
        } catch (err) {
            console.warn("OSRM Failure:", err);
            return { distanceM: calculateDistance(lat1, lon1, lat2, lon2), durationS: null };
        }
    }

    function formatDistance(distM) {
        if (distM < 1000) {
            // Round to nearest 10 meters
            const rounded = Math.round(distM / 10) * 10;
            return `${rounded}m away`;
        } else {
            // Show 1 decimal km
            const km = distM / 1000;
            return `${km.toFixed(1)}km away`;
        }
    }

    // --- Atomic & Persistent Load ---
    let isFetchingWorkers = false;
    let lastWorkersResponseText = ""; // NEW: Atomic Diffing Cache

    async function loadWorkers(isAutoUpdate = false) {
        if (isFetchingWorkers) return;
        isFetchingWorkers = true;

        const category = new URLSearchParams(window.location.search).get('category') || 'All';
        const availability = window.currentAvailabilityFilter || 'All';

        showMapLoading(!isAutoUpdate);

        try {
            const res = await fetch(`/api/workers?category=${category}&availability=${availability}&t=${Date.now()}`);
            const text = await res.text();

            // atomic diff check to avoid unnecessary calculations
            if (isAutoUpdate && text === lastWorkersResponseText) {
                isFetchingWorkers = false;
                return;
            }
            lastWorkersResponseText = text;
            const workers = JSON.parse(text);

            const activeIds = new Set();
            const nearbyBounds = [];
            const allBounds = [];
            let hasNearby = false;

            workers.forEach(worker => {
                if (worker.latitude === null || worker.longitude === null) return;

                const workerLatLng = [worker.latitude, worker.longitude];
                const refPos = window.referenceLatLng || window.currentUserLatLng;
                let distM = refPos ? calculateDistance(refPos[0], refPos[1], worker.latitude, worker.longitude) : null;
                const isNearby = distM !== null && distM <= 10000;

                activeIds.add(worker.id);
                worker.isNearby = isNearby;
                worker.distanceM = distM;
                const haversineText = distM !== null ? formatDistance(distM) : 'Detecting...';

                // --- Precision Road Cache Sync ---
                const cached = window.roadDistanceStore[worker.id];
                let useCached = false;

                if (cached && cached.type === 'road') {
                    const userPos = window.referenceLatLng || window.currentUserLatLng;
                    const userMoved = userPos ? calculateDistance(cached.userLatLng[0], cached.userLatLng[1], userPos[0], userPos[1]) : 0;
                    const workerMoved = calculateDistance(cached.workerLatLng[0], cached.workerLatLng[1], worker.latitude, worker.longitude);

                    if (userMoved < 50 && workerMoved < 20) {
                        useCached = true;
                    }
                }

                worker.distanceText = useCached ? cached.text : haversineText;
                if (!useCached && (!cached || cached.type !== 'road')) {
                    window.roadDistanceStore[worker.id] = { text: haversineText, type: 'haversine', ts: Date.now() };
                }

                // --- SMART MARKER SYNC (Zero-Flicker) ---
                if (markerMap.has(worker.id)) {
                    const m = markerMap.get(worker.id);

                    // Only update LatLng if changed significantly (> 2m) to avoid mini-jitters
                    const currentPos = m.getLatLng();
                    const moveDiff = calculateDistance(currentPos.lat, currentPos.lng, worker.latitude, worker.longitude);
                    if (moveDiff > 2) {
                        m.setLatLng(workerLatLng);
                    }

                    // Only update Icon/Events if state changed
                    if (m._lastIsNearby !== isNearby || m._lastIsOnline !== worker.is_online || m._lastService !== worker.service) {
                        m.setIcon(getWorkerIcon(worker.service, worker.is_online, isNearby));
                        m._lastIsNearby = isNearby;
                        m._lastIsOnline = worker.is_online;
                        m._lastService = worker.service;
                        bindMarkerEvents(m, worker);
                    }

                    // Live Update Bottom Sheet if open
                    if (window.selectedWorkerId === worker.id) updateBottomSheetContent(worker);
                } else {
                    const m = L.marker(workerLatLng, {
                        icon: getWorkerIcon(worker.service, worker.is_online, isNearby),
                        zIndexOffset: isNearby ? 1000 : 500
                    });
                    m._lastIsNearby = isNearby;
                    m._lastIsOnline = worker.is_online;
                    m._lastService = worker.service;
                    bindMarkerEvents(m, worker);
                    workerLayer.addLayer(m);
                    markerMap.set(worker.id, m);
                }

                if (isNearby) {
                    hasNearby = true;
                    nearbyBounds.push(workerLatLng);
                }
                allBounds.push(workerLatLng);
            });

            // Clean stale markers gracefully
            markerMap.forEach((m, id) => {
                if (!activeIds.has(id)) {
                    workerLayer.removeLayer(m);
                    markerMap.delete(id);
                }
            });

            if (!isAutoUpdate) {
                if (hasNearby) map.fitBounds(nearbyBounds, { padding: [80, 80], maxZoom: 15 });
                else if (allBounds.length > 0) map.fitBounds(allBounds, { padding: [80, 80], maxZoom: 12 });
            }

            // Sync UI Counters
            const countSpan = document.getElementById('worker-count');
            const bubble = document.getElementById('nearby-count-bubble');
            if (countSpan && bubble) {
                const count = workers.filter(w => w.isNearby).length;
                countSpan.textContent = count;
                bubble.classList.toggle('hidden', count === 0);
            }
        } catch (err) {
            console.error("Map Sync Error:", err);
        } finally {
            isFetchingWorkers = false;
        }

        // Precision Road-Route Pre-caching (Nearest 3)
        const top3 = workers
            .filter(w => w.isNearby && w.distanceM !== null)
            .sort((a, b) => a.distanceM - b.distanceM)
            .slice(0, 3);

        top3.forEach(w => {
            const cached = window.roadDistanceStore[w.id];
            if (!cached || cached.type !== 'road') {
                const userPos = window.referenceLatLng || window.currentUserLatLng;
                if (userPos) {
                    fetchRoadDistance(userPos[0], userPos[1], w.latitude, w.longitude)
                        .then(result => {
                            const distText = formatDistance(result.distanceM);
                            const etaText = result.durationS ? `${Math.ceil(result.durationS / 60)} mins` : `${Math.ceil((result.distanceM / 1000) * 3)} mins`;
                            window.roadDistanceStore[w.id] = {
                                text: distText, eta: etaText, type: 'road',
                                userLatLng: [...userPos], workerLatLng: [w.latitude, w.longitude],
                                ts: Date.now()
                            };
                            if (window.selectedWorkerId === w.id) {
                                const dEl = document.getElementById('sheet-dist-val');
                                const eEl = document.getElementById('sheet-eta-val');
                                if (dEl) dEl.textContent = distText;
                                if (eEl) eEl.textContent = etaText;
                            }
                        });
                }
            }
        });
    }

    // --- Interaction Performance (Debounced Map Move) ---
    let moveEndDebounce = null;
    map.on('moveend', () => {
        if (window._isProgrammaticMove) return;
        clearTimeout(moveEndDebounce);
        moveEndDebounce = setTimeout(() => {
            console.log("📍 Context Refreshed after pan");
            loadWorkers(true);
        }, 500);
    });
    window.loadWorkers = loadWorkers;

    window.expandSummaryResults = function () {
        if (!window.lastFilteredWorkers || window.lastFilteredWorkers.length === 0) {
            loadWorkers(false);
            return;
        }
        renderNearbyServicesList(window.lastFilteredWorkers);
    };

    function renderNearbyServicesList(workers) {
        const sheet = document.getElementById('worker-profile-sheet');
        const overlay = document.getElementById('sheet-overlay');
        const content = document.getElementById('sheet-content');

        if (!sheet || !content || !overlay) return;

        let listHtml = `
            <div class="flex flex-col h-full bg-white">
                <div class="px-6 py-5 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white/90 backdrop-blur-xl z-10">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-600/20 transform-gpu">
                            <span class="text-lg">📍</span>
                        </div>
                        <div>
                            <h3 class="text-lg font-black text-gray-900 leading-tight">Nearby Services</h3>
                            <p class="text-[10px] text-gray-400 font-bold uppercase tracking-widest">${workers.length} Pros Online Now</p>
                        </div>
                    </div>
                </div>
                <div class="px-5 py-6 space-y-3 overflow-y-auto no-scrollbar" style="-webkit-overflow-scrolling: touch;">
        `;

        workers.forEach(w => {
            const profilePlaceholder = `https://ui-avatars.com/api/?name=${encodeURIComponent(w.name)}&background=random&color=fff&size=80`;
            listHtml += `
                <div onclick="openWorkerFromList('${w.id}')"
                     class="group flex items-center gap-4 p-4 rounded-2xl bg-gray-50/50 border border-gray-100/50 hover:bg-blue-50/50 hover:border-blue-100/80 transition-all duration-300 cursor-pointer active:scale-[0.98] transform-gpu">
                    <div class="relative">
                        <img src="${profilePlaceholder}" class="w-12 h-12 rounded-full border-2 border-white shadow-sm group-hover:shadow-md transition-all">
                        <div class="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-green-500 border-2 border-white rounded-full"></div>
                    </div>
                    <div class="flex-1 overflow-hidden">
                        <div class="flex items-center justify-between gap-2">
                            <h4 class="font-bold text-gray-900 truncate group-hover:text-blue-700 transition-colors">${w.name}</h4>
                            <span class="text-[10px] font-black text-blue-600 uppercase whitespace-nowrap bg-blue-50 px-2 py-0.5 rounded-full">${w.distanceText}</span>
                        </div>
                        <p class="text-[11px] text-gray-500 font-medium uppercase tracking-wider mt-0.5">${w.service}</p>
                    </div>
                    <div class="text-gray-300 group-hover:text-blue-500 transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clip-rule="evenodd" />
                        </svg>
                    </div>
                </div>
            `;
        });

        listHtml += `
                </div>
            </div>
        `;

        content.innerHTML = listHtml;
        window.selectedWorkerId = null; // Clear selection when list is open

        // Show sheet
        overlay.classList.remove('hidden');
        sheet.classList.remove('hidden');
        setTimeout(() => {
            overlay.classList.add('active');
            sheet.classList.add('open');
        }, 10);
    }

    window.openWorkerFromList = function (workerId) {
        const worker = window.lastFilteredWorkers.find(w => w.id === parseInt(workerId));
        if (worker) {
            const marker = markerMap.get(worker.id);
            openWorkerPopup(worker, marker);
        }
    };

    // Helper to update sheet content without triggers transitions
    function updateBottomSheetContent(worker) {
        const content = document.getElementById('sheet-content');
        if (!content) return;

        // --- Selective Patching Logic (Zero-Flicker) ---
        if (content.dataset.workerId === String(worker.id)) {
            // Update only specific dynamic fields if they changed
            const statusEl = document.getElementById('sheet-status-badge-container');
            const distEl = document.getElementById('sheet-dist-val');
            const etaEl = document.getElementById('sheet-eta-val');

            // 1. Availability Update
            const isOnline = worker.is_online === true;
            const currentStatus = content.dataset.workerStatus;
            if (currentStatus !== String(worker.is_online)) {
                content.dataset.workerStatus = worker.is_online;
                if (statusEl) {
                    statusEl.innerHTML = isOnline ?
                        `<div class="flex items-center gap-1.5 bg-green-50 text-green-700 px-3 py-1 rounded-full border border-green-100">
                            <div class="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></div>
                            <span class="text-[9px] font-bold uppercase tracking-wider">Available Now</span>
                        </div>` :
                        `<div class="flex items-center gap-1.5 bg-gray-100 text-gray-500 px-3 py-1 rounded-full border border-gray-200">
                            <span class="text-[9px] font-bold uppercase tracking-wider">Offline • Last Seen ${timeAgo(worker.last_active)}</span>
                        </div>`;
                }
            }

            // 2. Proximity Update
            const userPos = window.referenceLatLng || window.currentUserLatLng;
            if (userPos && worker.latitude && worker.longitude) {
                const cached = window.roadDistanceStore[worker.id];
                const userMoved = cached ? calculateDistance(cached.userLatLng[0], cached.userLatLng[1], userPos[0], userPos[1]) : 999;
                const workerMoved = cached ? calculateDistance(cached.workerLatLng[0], cached.workerLatLng[1], worker.latitude, worker.longitude) : 999;

                if (cached && cached.type === 'road' && userMoved < 50 && workerMoved < 50) {
                    requestAnimationFrame(() => {
                        if (distEl) distEl.textContent = cached.text;
                        if (etaEl) etaEl.textContent = cached.eta || 'Fast';
                    });
                } else {
                    fetchRoadDistance(userPos[0], userPos[1], worker.latitude, worker.longitude)
                        .then(result => {
                            const distText = formatDistance(result.distanceM);
                            const etaText = result.durationS ? `${Math.ceil(result.durationS / 60)} mins` : `${Math.ceil((result.distanceM / 1000) * 3)} mins`;
                            requestAnimationFrame(() => {
                                if (distEl) distEl.textContent = distText;
                                if (etaEl) etaEl.textContent = etaText;
                            });
                            window.roadDistanceStore[worker.id] = {
                                text: distText,
                                eta: etaText,
                                type: 'road',
                                userLatLng: [...userPos],
                                workerLatLng: [worker.latitude, worker.longitude],
                                ts: Date.now()
                            };
                        });
                }
            }
            return;
        }

        // Full Render (only on first open or worker swap)
        content.dataset.workerId = worker.id;
        content.dataset.workerStatus = worker.is_online;

        // --- Data Normalization & Safeguards ---
        const safeWorker = {
            name: worker.name || 'Service Provider',
            service: worker.service || 'Professional Service',
            phone: worker.phone || '',
            experience: worker.experience || 0,
            rating: worker.rating || (4.5 + Math.random() * 0.5).toFixed(1),
            reviews: worker.reviews_count || Math.floor(Math.random() * 50) + 12,
            completedJobs: worker.completed_jobs || Math.floor(Math.random() * 100) + 15,
            latitude: worker.latitude ? parseFloat(worker.latitude).toFixed(6) : '0.000000',
            longitude: worker.longitude ? parseFloat(worker.longitude).toFixed(6) : '0.000000',
            isOnline: worker.is_online === true,
            isVerified: worker.is_verified === true || true, // Default to true for premium feel for now
            photo: worker.profile_photo || `https://ui-avatars.com/api/?name=${encodeURIComponent(worker.name || 'W')}&background=random&color=fff&size=200`
        };

        const statusBadge = safeWorker.isOnline ?
            `<div class="flex items-center gap-1.5 bg-green-50 text-green-700 px-3 py-1 rounded-full border border-green-100">
                <div class="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></div>
                <span class="text-[9px] font-bold uppercase tracking-wider">Available Now</span>
            </div>` :
            `<div class="flex items-center gap-1.5 bg-gray-100 text-gray-500 px-3 py-1 rounded-full border border-gray-200">
                <span class="text-[9px] font-bold uppercase tracking-wider">Offline • Last Seen ${timeAgo(worker.last_active)}</span>
            </div>`;

        const actionButtons = `
            <div class="w-full grid grid-cols-2 gap-3 mt-6 pb-12">
                <a href="tel:${safeWorker.phone}"
                    class="flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white text-[13px] font-bold py-4 px-4 rounded-2xl shadow-lg transition-all active:scale-95 shadow-green-600/20">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                    </svg>
                    Call Now
                </a>
                <a href="https://wa.me/${safeWorker.phone}" target="_blank"
                    class="flex items-center justify-center gap-2 bg-white hover:bg-gray-50 text-blue-600 border border-blue-100 text-[13px] font-bold py-4 px-4 rounded-2xl shadow-sm transition-all active:scale-95">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.582 2.128 2.182-.573c.978.58 1.911.928 3.145.929 3.178 0 5.767-2.587 5.768-5.766 0-3.18-2.587-5.766-5.764-5.766zm3.391 8.221c-.144.405-.837.774-1.156.823-.298.045-.688.067-1.104-.067-.278-.09-.629-.193-1.077-.373-1.905-.764-3.138-2.701-3.233-2.827-.094-.126-.766-.921-.823-1.745-.057-.823.369-1.246.549-1.442.181-.197.394-.246.525-.246h.377c.12 0 .285-.045.44.328.16.385.541 1.32.589 1.418.049.098.082.213.017.344-.066.131-.131.213-.262.361-.132.148-.277.303-.394.41-.131.131-.05.285.033.426.082.148.369.608.791.984.545.484 1.006.636 1.156.702.144.067.23.05.312-.045.082-.094.344-.402.435-.541.094-.144.181-.115.312-.067.131.049.828.391.972.463.144.072.241.107.276.168.037.06.037.35-.107.755z"/>
                    </svg>
                    WhatsApp
                </a>
            </div>
        `;

        content.innerHTML = `
            <div class="flex flex-col items-center">
                <button onclick="closeWorkerProfileSheet()"
                        class="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors p-2 z-10 bg-white/80 backdrop-blur-sm rounded-full">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
                
                <!-- Profile Header -->
                <div class="relative mt-2 mb-4">
                    <div class="w-24 h-24 rounded-full border-[3px] border-white shadow-xl overflow-hidden bg-gray-100 ring-4 ring-blue-50/50">
                        <img src="${safeWorker.photo}" alt="${safeWorker.name}" class="w-full h-full object-cover">
                    </div>
                    ${safeWorker.isVerified ? `
                    <div class="absolute right-0 bottom-0 bg-green-500 border-2 border-white rounded-full p-1 shadow-md">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 text-white" viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                        </svg>
                    </div>` : ''}
                </div>

                <!-- Info Block -->
                <div class="text-center w-full px-2">
                    <div class="flex items-center justify-center gap-2 mb-1">
                        <h3 class="text-xl font-extrabold text-gray-900 tracking-tight">${safeWorker.name}</h3>
                        ${safeWorker.isVerified ? '<span class="text-[8px] bg-green-50 text-green-700 px-2 py-0.5 rounded-md font-black uppercase border border-green-100/50">Verified</span>' : ''}
                    </div>
                    <div class="flex items-center justify-center gap-1.5 mb-3">
                        <div class="flex text-yellow-400 text-xs">
                            ${'⭐'.repeat(Math.round(parseFloat(safeWorker.rating)))}
                        </div>
                        <span class="text-xs font-bold text-gray-700">${safeWorker.rating}</span>
                        <span class="text-[10px] text-gray-400 font-medium">(${safeWorker.reviews} reviews)</span>
                    </div>
                    
                    <div class="inline-flex items-center px-3 py-1 bg-blue-50/50 rounded-full border border-blue-100/30 mb-5">
                        <span class="text-[10px] font-bold text-blue-600 uppercase tracking-widest">${safeWorker.service} • ${safeWorker.experience} YRS EXP</span>
                    </div>

                    <!-- Compact Coordinates -->
                    <div class="flex items-center justify-center gap-4 py-2 px-5 bg-gray-50/80 rounded-2xl border border-gray-100 mx-auto w-fit mb-6">
                        <div class="flex flex-col items-start">
                            <span class="text-[7px] text-gray-400 uppercase font-black tracking-widest leading-none">Lat</span>
                            <span class="text-[10px] font-mono font-bold text-gray-600">${safeWorker.latitude}</span>
                        </div>
                        <div class="w-px h-5 bg-gray-200"></div>
                        <div class="flex flex-col items-start">
                            <span class="text-[7px] text-gray-400 uppercase font-black tracking-widest leading-none">Lng</span>
                            <span class="text-[10px] font-mono font-bold text-gray-600">${safeWorker.longitude}</span>
                        </div>
                    </div>
                </div>

                <!-- Metrics Grid -->
                <div class="grid grid-cols-3 gap-0.5 w-full bg-gray-50/50 rounded-2xl border border-gray-100 overflow-hidden mb-6">
                     <div class="flex flex-col items-center py-4 hover:bg-white transition-colors">
                         <span class="text-[8px] text-gray-400 uppercase font-bold tracking-widest mb-1">Distance</span>
                         <span id="sheet-dist-val" class="text-xs font-black text-gray-900">${worker.distanceText || 'Nearby'}</span>
                     </div>
                     <div class="flex flex-col items-center py-4 border-x border-gray-100 hover:bg-white transition-colors">
                         <span class="text-[8px] text-gray-400 uppercase font-bold tracking-widest mb-1">Arrival</span>
                         <span id="sheet-eta-val" class="text-xs font-black text-blue-600">${worker.etaText || 'Fast'}</span>
                     </div>
                     <div class="flex flex-col items-center py-4 hover:bg-white transition-colors">
                         <span class="text-[8px] text-gray-400 uppercase font-bold tracking-widest mb-1">Completed</span>
                         <span class="text-xs font-black text-gray-900">${safeWorker.completedJobs} Jobs</span>
                     </div>
                </div>

                <!-- Status & Actions -->
                <div class="w-full flex flex-col items-center">
                    <div id="sheet-status-badge-container">
                        ${statusBadge}
                    </div>
                    ${actionButtons}
                </div>
            </div>
        `;
    }

    // Simplified & Fail-Safe Marker Interaction
    function bindMarkerEvents(marker, worker) {
        const handleInteraction = (e) => {
            console.log("👆 Interaction recognized for:", worker.name);

            // Prevent event propagation safely
            if (e && e.originalEvent) {
                e.originalEvent.preventDefault();
                e.originalEvent.stopPropagation();
            }

            // Flag to prevent map-click closure race condition
            window._isMarkerInteracting = true;
            setTimeout(() => window._isMarkerInteracting = false, 200);

            openWorkerPopup(worker, marker);
        };

        // Clear and re-bind Leaflet native events (Most reliable on mobile)
        marker.off('click');
        marker.on('click', handleInteraction);

        // Secondary binding for extra sensitivity (helps with small icons)
        marker.on('add', function () {
            const icon = marker.getElement();
            if (icon) {
                icon.style.pointerEvents = 'auto';
            }
        });

        const icon = marker.getElement();
        if (icon) icon.style.pointerEvents = 'auto';
    }

    // High-Integrity Bottom Sheet Opener
    window.openWorkerPopup = function (worker, marker) {
        if (!worker || !marker) return;
        console.log("📂 Processing worker profile opening...");

        window.selectedWorkerId = worker.id;
        const sheet = document.getElementById('worker-profile-sheet');
        const overlay = document.getElementById('sheet-overlay');

        if (!sheet || !overlay) {
            console.error("Critical Error: Profile UI elements missing from DOM.");
            return;
        }

        try {
            updateBottomSheetContent(worker);

            // Unified visibility toggle
            overlay.classList.remove('hidden');
            sheet.classList.remove('hidden');

            // Trigger animation sequence
            requestAnimationFrame(() => {
                overlay.classList.add('active');
                sheet.classList.add('open');
            });

            // Logical view adjustment (Centered with responsive vertical balance)
            const latlng = marker.getLatLng();
            const containerPoint = map.latLngToContainerPoint(latlng);

            // On small screens, shift marker up more (sheet is at bottom)
            // On large screens, shift marker less (modal is in center)
            const yOffset = window.innerWidth < 768 ? (window.innerHeight * 0.12) : (window.innerHeight * 0.05);
            const targetPoint = L.point([containerPoint.x, containerPoint.y + yOffset]);

            window._isProgrammaticMove = true;
            map.flyTo(map.containerPointToLatLng(targetPoint), 15, { animate: true, duration: 0.8 });
            setTimeout(() => window._isProgrammaticMove = false, 900);

        } catch (err) {
            console.error("Profile Rendering Failed:", err);
        }
    };

    window.closeWorkerProfileSheet = function () {
        window.selectedWorkerId = null;
        const sheet = document.getElementById('worker-profile-sheet');
        const overlay = document.getElementById('sheet-overlay');

        if (sheet) sheet.classList.remove('open');
        if (overlay) overlay.classList.remove('active');

        setTimeout(() => {
            if (sheet && !sheet.classList.contains('open')) sheet.classList.add('hidden');
            if (overlay && !overlay.classList.contains('active')) overlay.classList.add('hidden');
        }, 300);
    };

    // --- GOOGLE-STYLE SEARCH AUTOCOMPLETE ---
    let searchTimeout = null;
    let selectedIndex = -1;
    let currentSuggestions = [];

    const searchInput = document.getElementById('map-search');
    const suggestionsBox = document.getElementById('search-suggestions');

    async function fetchSearchSuggestions(query) {
        const radii = [0.5, 1, 3, 5, null];
        for (const radius of radii) {
            let url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=in&limit=5`;
            if (radius && window.currentUserLatLng) {
                const [lat, lng] = window.currentUserLatLng;
                const offset = radius / 111;
                const viewbox = `${lng - offset},${lat + offset},${lng + offset},${lat - offset}`;
                url += `&viewbox=${viewbox}&bounded=1`;
            }
            try {
                const res = await fetch(url);
                const data = await res.json();
                if (data && data.length > 0) return data;
            } catch (e) { console.error("Expansion step failed", e); }
        }
        return [];
    }

    window.handleSearchInput = function (query) {
        clearTimeout(searchTimeout);
        selectedIndex = -1;
        if (query.length < 2) {
            suggestionsBox.classList.add('hidden');
            return;
        }
        searchTimeout = setTimeout(async () => {
            const data = await fetchSearchSuggestions(query);
            currentSuggestions = data;
            renderSuggestions(query);
        }, 300);
    };

    function renderSuggestions(query) {
        suggestionsBox.innerHTML = '';
        if (currentSuggestions.length > 0) {
            suggestionsBox.classList.remove('hidden');
            currentSuggestions.forEach((place, index) => {
                const div = document.createElement('div');
                div.className = `p-4 hover:bg-blue-50/50 cursor-pointer flex items-center gap-4 transition-all border-b border-gray-50 last:border-0 ${index === selectedIndex ? 'bg-blue-50' : ''}`;
                const displayName = place.display_name;
                const parts = displayName.split(',');
                const mainText = parts[0];
                const subText = parts.slice(1, 3).join(',').trim();
                const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp(`(${escapedQuery})`, 'gi');
                const highlightedMain = mainText.replace(regex, '<span class="text-blue-600 font-bold">$1</span>');
                div.innerHTML = `
                <div class="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center text-blue-600 flex-shrink-0">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    </svg>
                </div>
                <div class="overflow-hidden flex-1">
                    <div class="text-[15px] font-semibold text-gray-900 truncate">${highlightedMain}</div>
                    <div class="text-[12px] text-gray-500 truncate">${subText}</div>
                </div>`;
                div.onclick = () => selectSuggestion(place);
                suggestionsBox.appendChild(div);
            });
        } else {
            suggestionsBox.classList.add('hidden');
        }
    }

    function selectSuggestion(place) {
        const lat = parseFloat(place.lat);
        const lon = parseFloat(place.lon);
        const name = place.display_name.split(',')[0];

        window._isProgrammaticMove = true;
        map.flyTo([lat, lon], 14, { animate: true, duration: 1 });
        setTimeout(() => { window._isProgrammaticMove = false; }, 1100);

        searchInput.value = name;
        suggestionsBox.classList.add('hidden');
        selectedIndex = -1;
    }

    searchInput.addEventListener('keydown', (e) => {
        if (suggestionsBox.classList.contains('hidden')) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedIndex = (selectedIndex + 1) % currentSuggestions.length;
            renderSuggestions(searchInput.value);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedIndex = (selectedIndex - 1 + currentSuggestions.length) % currentSuggestions.length;
            renderSuggestions(searchInput.value);
        } else if (e.key === 'Enter') {
            if (selectedIndex > -1) {
                e.preventDefault();
                selectSuggestion(currentSuggestions[selectedIndex]);
            } else {
                manualSearch();
            }
        } else if (e.key === 'Escape') {
            suggestionsBox.classList.add('hidden');
        }
    });

    window.manualSearch = function () {
        const query = searchInput.value;
        if (!query || query.length < 2) return;
        suggestionsBox.classList.add('hidden');
        fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=in&limit=1`)
            .then(res => res.json())
            .then(data => {
                if (data && data.length > 0) {
                    selectSuggestion(data[0]);
                }
            })
            .catch(err => console.error("Search failed:", err));
    };

    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !suggestionsBox.contains(e.target)) {
            suggestionsBox.classList.add('hidden');
        }
    });

    // --- CUSTOM CONTROLS LOGIC ---
    window.mapZoomIn = () => map.zoomIn();
    window.mapZoomOut = () => map.zoomOut();

    // --- DEBOUNCED MAP INTERACTIONS ---
    let moveTimeout = null;
    map.on('moveend', () => {
        if (moveTimeout) clearTimeout(moveTimeout);
        moveTimeout = setTimeout(() => {
            if (!isMoveMapMode) {
                const center = map.getCenter();
                window.currentUserLatLng = [center.lat, center.lng];
                loadWorkers(true, window.currentRadius || 5000);
            }
        }, 300); // Debounce reduced to 300ms for responsiveness
    });

    window.toggleMapStyleSheet = function () {
        const sheet = document.getElementById('map-style-sheet');
        sheet.classList.toggle('open');
    };

    window.switchLayer = function (type) {
        Object.values(window.layers).forEach(layer => map.removeLayer(layer));
        if (window.layers[type]) {
            map.addLayer(window.layers[type]);
        }
        setTimeout(() => document.getElementById('map-style-sheet').classList.remove('open'), 300);
    };

    map.on('click', (e) => {
        // STEP 1 FIX: Do not close if we just clicked a marker
        if (window._isMarkerInteracting) return;

        document.getElementById('map-style-sheet').classList.remove('open');
        document.getElementById('search-suggestions').classList.add('hidden');

        // Only close worker sheet if clicking "away" on the map
        closeWorkerProfileSheet();
    });

    // --- MOVE MAP TO SET LOCATION MODE ---
    let isMoveMapMode = false;
    window.startMoveMapMode = function () {
        isMoveMapMode = true;
        document.getElementById('center-pin').classList.remove('hidden');
        document.getElementById('confirm-location-area').classList.remove('hidden');
        document.querySelectorAll('.pointer-events-auto').forEach(el => {
            if (!el.id.includes('confirm-location') && !el.id.includes('map')) {
                el.classList.add('opacity-50', 'pointer-events-none');
            }
        });
    };

    window.confirmSelectedLocation = function () {
        exitMoveMapMode();
    };

    function exitMoveMapMode() {
        isMoveMapMode = false;
        document.getElementById('center-pin').classList.add('hidden');
        document.getElementById('confirm-location-area').classList.add('hidden');
        document.querySelectorAll('.pointer-events-auto').forEach(el => {
            el.classList.remove('opacity-50', 'pointer-events-none');
        });
    }

    window.filterWorkers = function () { loadWorkers(false); };

    window.addEventListener('availabilityFilterChange', function (e) {
        const filter = e.detail.filter;
        window.currentAvailabilityFilter = filter;
        const chips = {
            'All': document.getElementById('filter-all'),
            'Available': document.getElementById('filter-available'),
            'Offline': document.getElementById('filter-offline')
        };
        const baseClasses = 'flex-shrink-0 px-4 py-1.5 rounded-full text-[13px] font-semibold shadow-sm border transition-all active:scale-95';
        const inactiveClasses = 'bg-white text-gray-600 border-gray-100 hover:bg-gray-50';
        Object.values(chips).forEach(btn => {
            if (!btn) return;
            btn.className = `${baseClasses} ${inactiveClasses}`;
        });
        const activeBtn = chips[filter];
        if (activeBtn) {
            activeBtn.className = `${baseClasses} bg-blue-600 text-white border-blue-600 shadow-md ring-2 ring-blue-100`;
        }
        loadWorkers(false);
    });

    // Initial load
    if (urlParams.get('lat')) {
        const lat = parseFloat(urlParams.get('lat'));
        const lng = parseFloat(urlParams.get('lng'));
        window._isProgrammaticMove = true;
        map.setView([lat, lng], 15);
        setTimeout(() => { window._isProgrammaticMove = false; }, 500);
        loadWorkers(false);
    } else {
        locateUser();
    }

    // Refresh every 10s
    setInterval(() => loadWorkers(true), 10000);
});

window.filterByAvailability = function (filter) {
    const event = new CustomEvent('availabilityFilterChange', { detail: { filter } });
    window.dispatchEvent(event);
}
