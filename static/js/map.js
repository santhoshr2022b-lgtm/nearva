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
    window.isInitialCenter = true; // Track if map has centered for the first time

    function showMapLoading(show, message = "Syncing...") {
        const badge = document.getElementById('map-status-badge');
        if (show && badge) {
            badge.innerHTML = `<span class="animate-pulse">🔄 ${message}</span>`;
            badge.classList.remove('hidden');
        } else if (badge) {
            badge.classList.add('hidden');
        }
    }

    function hideLoadingOverlay() {
        const overlay = document.getElementById('loading-overlay');
        if (overlay && !overlay.classList.contains('hidden')) {
            overlay.classList.add('hidden');
        }
    }

    // 1. Locate User (High-Accuracy continuous strategy)
    window.locateUser = function (isAuto = false) {
        if (!navigator.geolocation) return;

        const gpsBtn = document.getElementById('gps-button');

        // If clicking manually, re-enable "Follow Me" and RESET centering state
        if (!isAuto) {
            window.isFollowingUser = true;
            window.isInitialCenter = true; // FORCE map to fly to new location
            gpsLockStartTime = Date.now(); // Reset refinement timer
            hasHighAccuracyLock = false; // Reset lock state
            if (gpsBtn) gpsBtn.classList.add('gps-following');
        }

        if (gpsBtn) gpsBtn.classList.add('gps-glow', 'text-blue-600');
        showMapLoading(true, "Detecting location...");

        // Strategy: High-Accuracy Kickstart (Long Timeout for Prompt) + Continuous Watch (Sequential)
        const kickstartOptions = {
            enableHighAccuracy: true,
            timeout: isAuto ? 5000 : 15000, // Give native prompt 15s if manual
            maximumAge: 0
        };

        const watchOptions = {
            enableHighAccuracy: true,
            timeout: 5000,
            maximumAge: 0
        };

        // 1. KICKSTART: Clear any existing watch and get immediate position
        if (window.watchId) navigator.geolocation.clearWatch(window.watchId);

        const tryKickstart = (retryCount = 0) => {
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    if (gpsBtn) gpsBtn.classList.remove('gps-glow');
                    handleGPSFix(pos, true, gpsBtn);
                    startContinuousTracking();
                },
                (err) => {
                    console.warn(`GPS Kickstart Error (Try ${retryCount + 1}):`, err);

                    // AGGRESSIVE RETRY: If manual click and first try fails (common if GPS was just turned on), try once more
                    if (!isAuto && retryCount < 1) {
                        console.log("Retrying GPS kickstart to force native prompt...");
                        setTimeout(() => tryKickstart(retryCount + 1), 1000); // 1s delay
                        return;
                    }

                    showMapLoading(false);
                    hideLoadingOverlay();
                    // Still try to start watch in background in case user turns it on later or allows it
                    startContinuousTracking();
                },
                kickstartOptions
            );
        };

        tryKickstart();

        const startContinuousTracking = () => {
            if (window.watchId) return; // Already watching
            window.watchId = navigator.geolocation.watchPosition(
                (pos) => {
                    window._gpsErrorCount = 0;
                    if (gpsBtn) gpsBtn.classList.remove('gps-glow');
                    handleGPSFix(pos, false, gpsBtn);
                },
                (err) => {
                    showMapLoading(false);
                    hideLoadingOverlay();
                    if (gpsBtn) gpsBtn.classList.remove('gps-glow', 'gps-following');
                    window._gpsErrorCount = (window._gpsErrorCount || 0) + 1;
                    if (err.code !== 1 && window._gpsErrorCount <= 2) {
                        setTimeout(() => window.locateUser(true), 5000);
                    }
                },
                watchOptions
            );
        };

        // Safety timeout
        setTimeout(() => {
            hideLoadingOverlay();
            if (window.isInitialCenter) {
                window.isInitialCenter = false;
                loadWorkers(false);
            }
        }, isAuto ? 8000 : 16000);
    }



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

        // Faster centering: If accuracy is decent (< 200m) and it's the first fix, center instantly
        if (window.isInitialCenter && accuracy < 200) {
            window.isInitialCenter = false;
            hideLoadingOverlay();
            updateUserPosition(lat, lng, accuracy, true);
            return;
        }

        // Accuracy Threshold: 50m for Professional standards
        const isAccurate = accuracy < 50;
        const lockTimeout = (Date.now() - gpsLockStartTime) > 6000;
        const extremeTimeout = (Date.now() - gpsLockStartTime) > 12000;

        if (isAccurate || lockTimeout) {
            if (!hasHighAccuracyLock) {
                hasHighAccuracyLock = true;
                showMapLoading(false);
                hideLoadingOverlay();
                // If we didn't center yet, do it now
                if (window.isInitialCenter) {
                    window.isInitialCenter = false;
                    updateUserPosition(lat, lng, accuracy, true);
                    return;
                }
                if (isAccurate) showSmartNotification("High-Accuracy GPS Lock Acquired", 2000);
            }
        } else {
            // If still extremely inaccurate after 12s, kickstart again
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
        }

        // Focused fix: Always flyTo level 17 on manual triggers (isFirstFix)
        if (isFirstFix) {
            map.flyTo([lat, lng], 17, { animate: true, duration: 1.5 });
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

        // --- Context Load Trigger ---
        // If this is a very first fix or significant move, reload workers
        if (!window.lastUpdateLatLng) {
            window.lastUpdateLatLng = [lat, lng];
            loadWorkers(false);
        } else {
            const moveSinceLastLoad = calculateDistance(window.lastUpdateLatLng[0], window.lastUpdateLatLng[1], lat, lng);
            if (moveSinceLastLoad > 500) { // Reload every 500m of movement
                window.lastUpdateLatLng = [lat, lng];
                loadWorkers(true);
            }
        }
    }

    // Worker Markers Layer Group
    const workerLayer = L.layerGroup().addTo(map);
    const markerMap = new Map(); // Persistent map of worker markers: {workerId: marker}

    // Worker Icons
    const icons = {
        'Plumber': '🔧', 'Electrician': '⚡', 'Cook': '🍳', 'Driver': '🚗',
        'Carpenter': '🔨', 'AC Technician': '❄️', 'Mason': '🧱',
        'House Cleaning': '🧹', 'Two Wheeler Mechanic': '🏍️',
        'Mobile Repair': '📱',
        'Refrigerator Repair': '🧊', 'Washing Machine Repair': '🧺',
        'RO Water Purifier Service': '💧', 'Painter': '🖌️',
        'Pest Control': '🐜', 'Water Tank Cleaning': '🌊',
        'Car Mechanic': '🏎️', 'Puncture Repair': '🚲',
        'CCTV Installation': '📹', 'Laptop Repair': '💻',
        'Sofa Cleaning': '🛋️', 'Deep Cleaning': '🧹',
        'Real Estate Agent': '🏠',
        'Default': '👷'
    };

    window.toggleCategorySheet = function () {
        const sheet = document.getElementById('category-selection-sheet');
        const chevron = document.getElementById('cat-toggle-chevron');
        if (!sheet) return;

        const isMobile = window.innerWidth < 768;
        const isHidden = sheet.classList.contains('hidden');

        // Map controls to hide on mobile
        const controlsToHide = [
            document.querySelector('.absolute.bottom-\\[180px\\].right-4'), // Zoom/GPS container
            document.querySelector('.absolute.inset-x-0.top-0.z-\\[20\\]'), // Top Header/Search container
            document.getElementById('gps-status') // GPS status badge if present
        ];

        if (isHidden) {
            sheet.classList.remove('hidden');
            setTimeout(() => sheet.classList.add('open'), 10);
            if (chevron) chevron.classList.add('rotate-180');

            // Hide controls on mobile
            if (isMobile) {
                controlsToHide.forEach(el => {
                    if (el) {
                        el.classList.remove('map-controls-visible');
                        el.classList.add('map-controls-hidden');
                    }
                });
            }
        } else {
            sheet.classList.remove('open');
            if (chevron) chevron.classList.remove('rotate-180');

            // Show controls on mobile
            if (isMobile) {
                controlsToHide.forEach(el => {
                    if (el) {
                        el.classList.remove('map-controls-hidden');
                        el.classList.add('map-controls-visible');
                    }
                });
            }

            setTimeout(() => {
                sheet.classList.add('hidden');
            }, 400);
        }
    };

    window.setCategory = function (category) {
        // STEP 1: Update Global State
        window.currentCategoryFilter = category;
        window.currentAvailabilityFilter = 'All';

        // STEP 2: Update URL without reload
        const newUrl = new URL(window.location);
        if (category === 'All') {
            newUrl.searchParams.delete('category');
        } else {
            newUrl.searchParams.set('category', category);
        }
        window.history.pushState({}, '', newUrl);

        // STEP 3: Update UI
        refreshFilterUI();

        // Close the selection sheet with animation
        window.toggleCategorySheet();

        // STEP 4: Trigger Load
        loadWorkers(false);
    };

    window.filterByAvailability = function (filter) {
        window.currentAvailabilityFilter = filter;
        refreshFilterUI();
        loadWorkers(false);
    }

    function refreshFilterUI() {
        const category = window.currentCategoryFilter || 'All';
        const availability = window.currentAvailabilityFilter || 'All';

        const activePillClasses = ['active'];

        // 1. Update Category Toggle Button
        const toggleBtn = document.getElementById('cat-toggle-btn');
        const toggleText = document.getElementById('cat-toggle-text');

        if (toggleBtn && toggleText) {
            if (category !== 'All') {
                toggleBtn.classList.add('active');
                toggleText.textContent = category;
            } else {
                toggleBtn.classList.remove('active');
                toggleText.innerHTML = `<span data-en="Category" data-ta="வகை">${currentLang === 'ta' ? 'வகை' : 'Category'}</span>`;
            }
        }

        // 2. Update Availability Pills
        const statusPills = {
            'Available': document.getElementById('filter-available'),
            'Offline': document.getElementById('filter-offline')
        };

        Object.entries(statusPills).forEach(([key, btn]) => {
            if (!btn) return;
            if (key === availability) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        // 3. Update Dropdown/Sheet Options
        document.querySelectorAll('.cat-option').forEach(opt => {
            const isMatch = (opt.id === `opt-${category.toLowerCase().replace(/ /g, '-')}`);
            if (isMatch || (category === 'All' && opt.id === 'opt-all')) {
                opt.classList.add('active-card');
                opt.classList.remove('border-gray-100');
            } else {
                opt.classList.remove('active-card');
                opt.classList.add('border-gray-100');
            }
        });
    }

    function getWorkerIcon(worker, isNearby = false) {
        const emoji = icons[worker.service] || icons['Default'];
        let borderClass = 'border-white';
        let bgClass = worker.is_online ? 'bg-white' : 'bg-gray-100 grayscale opacity-60';
        let glowClass = '';

        if (worker.is_online && isNearby) {
            borderClass = 'border-green-500';
            bgClass = 'bg-white';
            glowClass = 'shadow-[0_8px_20px_rgba(34,197,94,0.4)]';
        } else if (!worker.is_online) {
            borderClass = 'border-gray-200';
        }

        // Privacy Mode: Always use emoji for map marker, never profile_photo
        const iconContent = `<span class="transform transition-transform active:scale-90">${emoji}</span>`;

        return L.divIcon({
            className: 'worker-marker-container',
            html: `<div class="marker-hit-area relative w-16 h-16 flex items-center justify-center cursor-pointer" style="pointer-events: auto;">
                    <div class="relative z-10 flex items-center justify-center w-12 h-12 ${bgClass} rounded-full shadow-lg border-2 ${borderClass} ${glowClass} text-2xl transition-all duration-300 transform-gpu hover:scale-110 active:scale-95" style="pointer-events: none;">
                        ${iconContent}
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

        const category = window.currentCategoryFilter || new URLSearchParams(window.location.search).get('category') || 'All';
        const availability = window.currentAvailabilityFilter || 'All';

        // Geospatial context: Load what the user IS LOOKING AT
        const center = map.getCenter();
        const lat = center.lat;
        const lng = center.lng;

        showMapLoading(!isAutoUpdate);

        try {
            const res = await fetch(`/api/workers?category=${category}&lat=${lat}&lng=${lng}&t=${Date.now()}`);
            const text = await res.text();

            // atomic diff check to avoid unnecessary calculations
            if (isAutoUpdate && text === lastWorkersResponseText) {
                isFetchingWorkers = false;
                return;
            }
            lastWorkersResponseText = text;
            let workers = JSON.parse(text);

            // Client-side availability filtering
            if (availability === 'Available') {
                workers = workers.filter(w => w.is_online === true);
            } else if (availability === 'Offline') {
                workers = workers.filter(w => w.is_online === false);
            }

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
                    if (m._lastIsNearby !== isNearby || m._lastIsOnline !== worker.is_online || m._lastService !== worker.service || m._lastPhoto !== worker.profile_photo) {
                        m.setIcon(getWorkerIcon(worker, isNearby));
                        m._lastIsNearby = isNearby;
                        m._lastIsOnline = worker.is_online;
                        m._lastService = worker.service;
                        m._lastPhoto = worker.profile_photo;
                        bindMarkerEvents(m, worker);
                    }

                    // Live Update Bottom Sheet if open
                    if (window.selectedWorkerId === worker.id) updateBottomSheetContent(worker);
                } else {
                    const m = L.marker(workerLatLng, {
                        icon: getWorkerIcon(worker, isNearby),
                        zIndexOffset: isNearby ? 1000 : 500
                    });
                    m._lastIsNearby = isNearby;
                    m._lastIsOnline = worker.is_online;
                    m._lastService = worker.service;
                    m._lastPhoto = worker.profile_photo;
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

            // Handle Empty State (REMOVED: The map should stay clean as requested)

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
            showSmartNotification("Connection issue. Unable to fetch nearby workers.", 4000);
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

    // Scroll Indicator Logic for Category Bar
    const filterContainer = document.getElementById('filter-container');
    const scrollIndicator = document.getElementById('scroll-indicator');
    if (filterContainer && scrollIndicator) {
        filterContainer.addEventListener('scroll', () => {
            const maxScroll = filterContainer.scrollWidth - filterContainer.clientWidth;
            const currentScroll = filterContainer.scrollLeft;
            // Hide indicator when near the end (10px buffer)
            scrollIndicator.style.opacity = (currentScroll >= maxScroll - 10) ? '0' : '1';
        });
    }

    // --- Interaction Performance (Debounced Map Move) ---
    let moveEndDebounce = null;
    map.on('moveend', () => {
        if (window._isProgrammaticMove || (typeof isMoveMapMode !== 'undefined' && isMoveMapMode)) return;
        clearTimeout(moveEndDebounce);
        moveEndDebounce = setTimeout(() => {
            console.log("📍 Context Refreshed after pan");
            loadWorkers(true);
        }, 800);
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
        // Use a high-quality UI Avatar fallback if profile_photo is not set
        const photoUrl = worker.profile_photo && worker.profile_photo.trim() !== ''
            ? worker.profile_photo
            : `https://ui-avatars.com/api/?name=${encodeURIComponent(worker.name || 'W')}&background=random&color=fff&size=200`;

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
            photo: photoUrl
        };

        const ambassadorName = worker.ambassadors ? worker.ambassadors.name : null;
        const ambassadorBadge = ambassadorName ? 
            `<div class="flex items-center gap-1.5 mt-2.5 mb-1 bg-[#f0f9ff] border border-blue-100 text-blue-700 font-bold px-3 py-1.5 rounded-xl text-[11px] inline-flex">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 text-blue-500" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
                </svg>
                Verified by Ambassador: ${ambassadorName}
            </div>` : '';

        // Structured Metrics Grid
        const statusBadge = safeWorker.isOnline ?
            `<div class="flex items-center gap-1.5 bg-green-50 text-green-700 px-3 py-1 rounded-full border border-green-100">
                <div class="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></div>
                <span class="text-[9px] font-bold uppercase tracking-wider">Available Now</span>
            </div>` :
            `<div class="flex items-center gap-1.5 bg-gray-100 text-gray-500 px-3 py-1 rounded-full border border-gray-200">
                <span class="text-[9px] font-bold uppercase tracking-wider">Offline • Last Seen ${timeAgo(worker.last_active)}</span>
            </div>`;

        // ... Action buttons ...
        const actionButtons = `
            <div class="w-full grid grid-cols-2 gap-3 mt-6 pb-12">
                <a href="tel:${safeWorker.phone}"
                    class="flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white text-[14px] font-bold py-3.5 px-4 rounded-xl shadow-[0_8px_16px_-4px_rgba(22,163,74,0.4)] transition-all active:scale-95">
                    <svg xmlns="http://www.w3.org/2000/svg" class="w-[22px] h-[22px] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                    </svg>
                    Call Now
                </a>
                <a href="https://wa.me/91${safeWorker.phone}" target="_blank"
                    class="flex items-center justify-center gap-2 bg-white hover:bg-gray-50 text-blue-600 border-2 border-blue-50 text-[14px] font-bold py-3.5 px-4 rounded-xl shadow-sm transition-all active:scale-95">
                    <svg xmlns="http://www.w3.org/2000/svg" class="w-[22px] h-[22px] shrink-0" fill="currentColor" viewBox="0 0 16 16">
                        <path d="M13.601 2.326A7.85 7.85 0 0 0 7.994 0C3.627 0 .068 3.558.064 7.926c0 1.399.366 2.76 1.057 3.965L0 16l4.204-1.102a7.9 7.9 0 0 0 3.79.965h.004c4.368 0 7.926-3.558 7.93-7.93A7.9 7.9 0 0 0 13.6 2.326zM7.994 14.521a6.6 6.6 0 0 1-3.356-.92l-.24-.144-2.494.654.666-2.433-.156-.251a6.56 6.56 0 0 1-1.007-3.505c0-3.626 2.957-6.584 6.591-6.584a6.56 6.56 0 0 1 4.66 1.931 6.56 6.56 0 0 1 1.928 4.66c-.004 3.639-2.961 6.592-6.592 6.592m3.615-4.934c-.197-.099-1.17-.578-1.353-.646-.182-.065-.315-.099-.445.099-.133.197-.513.646-.627.775-.114.133-.232.148-.43.05-.197-.1-.836-.308-1.592-.985-.59-.525-.985-1.175-1.103-1.372-.114-.198-.011-.304.088-.403.087-.088.197-.232.296-.346.1-.114.133-.198.198-.33.065-.134.034-.248-.015-.347-.05-.099-.445-1.076-.612-1.47-.16-.389-.323-.335-.445-.34-.114-.007-.247-.007-.38-.007a.73.73 0 0 0-.529.247c-.182.198-.691.677-.691 1.654s.71 1.916.81 2.049c.098.133 1.394 2.132 3.383 2.992.47.205.84.326 1.129.418.475.152.904.129 1.246.08.38-.058 1.171-.48 1.338-.943.164-.464.164-.86.114-.943-.049-.084-.182-.133-.38-.232"/>
                    </svg>
                    WhatsApp
                </a>
            </div>
        `;

        content.innerHTML = `
            <div class="flex flex-col items-center">
                <!-- Swipe Header -->
                <div class="w-12 h-1.5 bg-gray-200 rounded-full mt-3 mb-6 block md:hidden"></div>

                <button onclick="closeWorkerProfileSheet()"
                        class="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors p-2 z-10 bg-gray-50 rounded-full hidden md:block">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
                
                <!-- Premium Profile Section -->
                <div class="flex flex-col md:flex-row items-start md:items-center gap-5 w-full mb-6 relative">
                    <div class="relative flex-shrink-0">
                        <div class="w-20 h-20 rounded-2xl shadow-lg overflow-hidden bg-gray-100 ring-4 ring-blue-50/50">
                            <img src="${safeWorker.photo}" alt="${safeWorker.name}" loading="lazy" class="w-full h-full object-cover">
                        </div>
                        ${safeWorker.isVerified ? `
                        <div class="absolute -right-2 -bottom-2 bg-blue-600 border-2 border-white rounded-full p-1 shadow-md">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 text-white" viewBox="0 0 20 20" fill="currentColor">
                                <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                            </svg>
                        </div>` : ''}
                    </div>

                    <div class="flex-1 w-full text-left">
                        <div class="flex flex-wrap items-center gap-2 mb-1">
                            <h3 class="text-xl font-black text-gray-900 leading-tight">${safeWorker.name}</h3>
                            <span class="text-[10px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-bold uppercase border border-blue-100/50">Verified</span>
                        </div>
                        <div class="flex items-center gap-2 mb-2">
                             <div class="flex items-center gap-0.5 text-yellow-400">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
                                <span class="text-xs font-black text-gray-900">${safeWorker.rating}</span>
                             </div>
                             <span class="text-[11px] text-gray-400 font-medium">${safeWorker.reviews} reviews</span>
                        </div>
                        <div class="text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                            ${safeWorker.service} • ${safeWorker.experience} yrs exp
                        </div>
                        ${ambassadorBadge}
                    </div>
                </div>

                <!-- Structured Metrics Grid -->
                <div class="grid grid-cols-3 gap-3 w-full mb-6">
                     <div class="flex flex-col items-center justify-center p-3 bg-white border border-gray-100 rounded-2xl shadow-sm">
                         <span class="text-[9px] text-gray-400 uppercase font-black tracking-widest mb-1">Distance</span>
                         <span id="sheet-dist-val" class="text-sm font-black text-gray-900">${worker.distanceText || 'Nearby'}</span>
                     </div>
                     <div class="flex flex-col items-center justify-center p-3 bg-white border border-gray-100 rounded-2xl shadow-sm">
                         <span class="text-[9px] text-gray-400 uppercase font-black tracking-widest mb-1">Arrival</span>
                         <span id="sheet-eta-val" class="text-sm font-black text-blue-600">${worker.etaText || 'Fast'}</span>
                     </div>
                     <div class="flex flex-col items-center justify-center p-3 bg-white border border-gray-100 rounded-2xl shadow-sm">
                         <span class="text-[9px] text-gray-400 uppercase font-black tracking-widest mb-1">Jobs</span>
                         <span class="text-sm font-black text-gray-900">${safeWorker.completedJobs}</span>
                     </div>
                </div>

                <!-- Modern Actions -->
                <div class="w-full flex flex-col gap-4">
                    <div id="sheet-status-badge-container" class="flex justify-center">
                        ${statusBadge}
                    </div>
                    
                    <div class="grid grid-cols-2 gap-3 w-full pb-8">
                        <a href="tel:${safeWorker.phone}"
                            class="flex items-center justify-center gap-2 bg-blue-600 text-white text-[15px] font-bold py-4 px-4 rounded-2xl shadow-lg shadow-blue-500/20 active:scale-95 transition-all">
                            <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                            </svg>
                            Call Now
                        </a>
                        <a href="https://wa.me/${safeWorker.phone}" target="_blank"
                            class="flex items-center justify-center gap-2 bg-white text-gray-900 border-2 border-gray-100 text-[15px] font-bold py-4 px-4 rounded-2xl shadow-sm active:scale-95 transition-all">
                            <img src="https://nearva.in/static/images/whatsapp.png" class="w-5 h-5 grayscale opacity-80" onerror="this.style.display='none'">
                            Message
                        </a>
                    </div>
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

            // Hide map controls for a clean profile view
            const mapControls = document.getElementById('map-controls-group');
            const gpsBadge = document.getElementById('gps-status');

            if (mapControls) {
                mapControls.classList.add('map-controls-hidden');
                mapControls.classList.remove('map-controls-visible');
            }
            if (gpsBadge) {
                gpsBadge.classList.add('map-controls-hidden');
                gpsBadge.classList.remove('map-controls-visible');
            }

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
        const catSheet = document.getElementById('category-selection-sheet');
        const overlay = document.getElementById('sheet-overlay');

        if (sheet) {
            sheet.classList.remove('open');
        }

        if (catSheet) {
            catSheet.classList.remove('open');
            const chevron = document.getElementById('cat-toggle-chevron');
            if (chevron) chevron.classList.remove('rotate-180');
        }

        if (overlay) overlay.classList.remove('active');

        // Show map controls again
        const mapControls = document.getElementById('map-controls-group');
        const gpsBadge = document.getElementById('gps-status');

        if (mapControls) {
            mapControls.classList.remove('map-controls-hidden');
            mapControls.classList.add('map-controls-visible');
        }
        if (gpsBadge) {
            gpsBadge.classList.remove('map-controls-hidden');
            gpsBadge.classList.add('map-controls-visible');
        }

        setTimeout(() => {
            if (sheet && !sheet.classList.contains('open')) sheet.classList.add('hidden');
            if (catSheet && !catSheet.classList.contains('open')) catSheet.classList.add('hidden');
            if (overlay && !overlay.classList.contains('active')) overlay.classList.add('hidden');
        }, 400);
    };

    // Swipe-to-close logic for Bottom Sheet
    const sheet = document.getElementById('worker-profile-sheet');
    let touchStartY = 0;
    let currentY = 0;
    let isDragging = false;

    if (sheet) {
        sheet.addEventListener('touchstart', (e) => {
            // Only trigger swipe if the sheet content is scrolled to top
            const contentArea = document.getElementById('sheet-content');
            if (contentArea && contentArea.scrollTop > 0) return;

            touchStartY = e.touches[0].clientY;
            isDragging = true;
            sheet.style.transition = 'none'; // Fast tracking for drag
        }, { passive: true });

        sheet.addEventListener('touchmove', (e) => {
            if (!isDragging) return;
            currentY = e.touches[0].clientY;
            let diffY = currentY - touchStartY;

            if (diffY > 0 && window.innerWidth < 768) { // Drag down on mobile only
                sheet.style.transform = `translateY(${diffY}px)`;
            }
        }, { passive: true });

        sheet.addEventListener('touchend', () => {
            if (!isDragging) return;
            isDragging = false;
            sheet.style.transition = ''; // Restore CSS transition

            let diffY = currentY - touchStartY;
            if (diffY > 100 && window.innerWidth < 768) { // 100px threshold to close
                window.closeWorkerProfileSheet();
            } else if (window.innerWidth < 768) {
                sheet.style.transform = ''; // Snap back if uncompleted
            }
        });
    }

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
    // (Merged into the existing moveend listener)

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

    // Initial load
    window.currentCategoryFilter = initialCategory;
    window.currentAvailabilityFilter = 'All';
    refreshFilterUI();

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

    // Refresh every 15s (increased from 10s for performance)
    setInterval(() => {
        // Only auto-update if map is visible and not being interacted with
        if (document.visibilityState === 'visible' && !window._isProgrammaticMove) {
            loadWorkers(true);
        }
    }, 15000);
});
