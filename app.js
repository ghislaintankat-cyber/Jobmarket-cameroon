// --- 1. CONFIGURATIONS ---
const firebaseConfig = {
    apiKey: "AIzaSyCR1Z6VlS5A7iPbUCoVm0AQcnkkUdsA0CE",
    authDomain: "jobmarketfuture.firebaseapp.com",
    databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com",
    projectId: "jobmarketfuture"
};
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const auth = firebase.auth();

const CLOUD_NAME = "dvoab3mzb"; 
const UPLOAD_PRESET = "job_preset"; 

// --- 2. INITIALISATION CARTE (Satellite View EXACT) ---
let map = L.map('map', { zoomControl: false, attributionControl: false }).setView([3.848, 11.502], 13);
let satelliteLayer = L.tileLayer('https://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}', {
    subdomains: ['mt0','mt1','mt2','mt3'],
    maxZoom: 20
}).addTo(map);

let jobsLayer = L.featureGroup().addTo(map);
let routeLayer = L.layerGroup().addTo(map); // Pour le tracé rouge
let userCoords = null;
let routeControl = null; // Leaflet Routing Machine instance
let allJobs = [];
let voiceSfx; // Moteur vocal

// Moteur vocal de démarrage
if ('speechSynthesis' in window) {
    voiceSfx = window.speechSynthesis;
}

// Authentification Anonyme au lancement
auth.signInAnonymously().catch(e => console.error("Erreur Auth:", e));

// --- 3. LOGIQUE GÉOLOCALISATION & MISE EN CACHE (Améliorée) ---
function locateMe() {
    navigator.geolocation.getCurrentPosition(pos => {
        userCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        L.circleMarker([userCoords.lat, userCoords.lng], { radius: 10, color: '#fff', fillColor: '#007AFF', fillOpacity: 1 }).addTo(map);
        map.flyTo([userCoords.lat, userCoords.lng], 15);
        syncJobs();
    }, () => {
        // En cas d'échec GPS, utilise la cache ou Yaoundé
        const cache = localStorage.getItem('jobs_cache');
        if(cache) { 
            allJobs = JSON.parse(cache);
            renderApexMarkers(allJobs);
            document.getElementById('live-count').innerText = `${allJobs.length} Missions (Caché)`;
        } else {
            alert("Veuillez activer votre GPS.");
            syncJobs(); 
        }
    });
}

// --- 4. SYNCHRONISATION TEMPS RÉEL FIREBASE ---
function syncJobs() {
    db.ref('jobs').on('value', snap => {
        allJobs = [];
        snap.forEach(child => {
            let j = child.val();
            let dist = userCoords ? calcDist(userCoords.lat, userCoords.lng, j.lat, j.lng) : 999;
            allJobs.push({ ...j, id: child.key, dist });
        });
        allJobs.sort((a, b) => a.dist - b.dist);
        localStorage.setItem('jobs_cache', JSON.stringify(allJobs));
        renderApexMarkers(allJobs);
        hideLoader();
    });
}

// --- 5. RENDU ULTIME DES MARQUEURS PROS (image_1.png EXACT) ---
function renderApexMarkers(data) {
    jobsLayer.clearLayers();
    data.forEach(j => {
        const icon = L.divIcon({
            html: `<div class="custom-pin" style="background:${j.color}; width:15px; height:15px; border-radius:50%; border:3px solid white; box-shadow:0 0 15px ${j.color}66;"></div>`,
            className: '', iconSize:
        });

        const rating = j.ratingAvg || 5.0;
        const dist = j.dist.toFixed(1);

        L.marker([j.lat, j.lng], { icon }).addTo(jobsLayer).bindPopup(`
            <div class="apex-pin-popup">
                ${j.image ? `<img src="${j.image}" style="width:100%; height:100px; object-fit:cover; border-radius:10px; margin-bottom:8px;">` : ''}
                <div class="apex-pin-header">
                    <p class="apex-pin-cat"><span style="color:${j.color}">${j.icon}</span> ${j.title}</p>
                    <span class="apex-stars">★ ${rating.toFixed(1)}</span>
                </div>
                <span class="apex-pin-price">${j.price} FCFA</span>
                <p class="apex-pin-landmark">📍 Repère: ${j.landmark || 'Quartier'}</p>
                ${j.verified ? '<div class="verified-badge">✔ Vérifié</div>' : ''}
                <div style="display:flex; gap:5px; margin-top:8px;">
                    <a href="https://wa.me/${j.phone}?text=Bonjour, je vous contacte via JobMarket pour : ${j.title}" class="apex-action-btn wa">WhatsApp</a>
                    <a href="tel:${j.phone}" class="apex-action-btn call">Appeler</a>
                </div>
                <button onclick="drawDynamicRoute(${j.lat},${j.lng})" class="apex-action-btn nav">Suivre Itinéraire</button>
            </div>
        `);
    });
    updateJobsList(data);
}

// --- 6. LOGIQUE D'ITINÉRAIRE DYNAMIQUE, SUIVI RÉEL ET VOCAL (Restauré) ---
function drawDynamicRoute(lat, lng) {
    if(!userCoords) return alert("Activez d'abord votre GPS !");

    // Nettoie l'ancien itinéraire
    if(routeControl) map.removeControl(routeControl);
    routeLayer.clearLayers();

    routeControl = L.Routing.control({
        waypoints: [
            L.latLng(userCoords.lat, userCoords.lng),
            L.latLng(lat, lng)
        ],
        show: false, // Cache le panneau natif Leaflet
        createMarker: () => null, // Cache les marqueurs de routing machine
        lineOptions: { styles: [{ color: '#ff4d4d', weight: 6, opacity: 0.9, dashArray: '10, 10' }] }
    }).addTo(map);

    routeControl.on('routesfound', (e) => {
        const route = e.routes;
        const distKm = (route.summary.totalDistance / 1000).toFixed(1);
        updateItineraryPanel(distKm, "Suivez le tracé en temps réel");
    });

    document.getElementById('btnItinerary').classList.remove('hidden');

    // Suivi de position en temps réel (watchPosition) pour le guidage
    if ("geolocation" in navigator) {
        navigator.geolocation.watchPosition(pos => {
            const currentCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            // Met à jour la position utilisateur sur la carte
            updateUserMarker(currentCoords);

            // Recalcule l'itinéraire dynamiquement
            if(routeControl) {
                routeControl.spliceWaypoints(0, 1, L.latLng(currentCoords.lat, currentCoords.lng));
            }
        });
    }

    // Guidage Vocal (Speech API) au démarrage
    if (voiceSfx) {
        const utterance = new SpeechSynthesisUtterance("Guidage démarré. Suivez l'itinéraire rouge.");
        utterance.lang = 'fr-FR';
        utterance.pitch = 1.0;
        voiceSfx.speak(utterance);
    }
}

// --- 7. PUBLICATION APEX (image_0.png Style, Cloudinary) ---
function publishApexJob() {
    const title = document.getElementById('j-title').value;
    const phone = document.getElementById('j-phone').value;
    const price = document.getElementById('j-price').value;

    if(!title || !phone || !price) return alert("Titre, WhatsApp et Prix requis !");

    cloudinary.openUploadWidget({
        cloudName: CLOUD_NAME, uploadPreset: UPLOAD_PRESET,
        sources: ['local', 'camera'], multiple: false
    }, (error, result) => {
        if (!error && result && result.event === "success") {
            const imageUrl = result.info.secure_url;
            saveApexJobToFirebase(imageUrl);
        } else if (error) {
            alert("Erreur d'upload photo. Vérifiez votre connexion.");
        }
    });
}

function saveApexJobToFirebase(imageUrl) {
    const cat = document.getElementById('j-cat').value.split('|');
    const pos = userCoords || { lat: 3.848, lng: 11.502 }; // Fallback Yaoundé

    db.ref('jobs').push().set({
        title: document.getElementById('j-title').value,
        price: document.getElementById('j-price').value,
        phone: document.getElementById('j-phone').value,
        landmark: document.getElementById('j-landmark').value,
        desc: document.getElementById('j-desc').value,
        image: imageUrl, icon: cat, color: cat,
        lat: pos.lat, lng: pos.lng,
        verified: false, ratingAvg: 5.0, timestamp: Date.now()
    }).then(() => {
        alert("✅ Annonce propulsée avec succès !");
        toggleForm();
    });
}

// --- 8. UTILITAIRES & UI ---
function calcDist(la1, lo1, la2, lo2) {
    const R = 6371; const dLat = (la2-la1)*Math.PI/180; const dLon = (lo2-lo1)*Math.PI/180;
    const a = Math.sin(dLat/2)**2 + Math.cos(la1*Math.PI/180)*Math.cos(la2*Math.PI/180)*Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function updateItineraryPanel(dist, direction) {
    document.getElementById('itDist').innerText = dist + " km";
    document.getElementById('itDirection').innerText = direction;
    document.getElementById('itineraryBox').classList.remove('hidden');
}

function clearRoute() {
    if(routeControl) map.removeControl(routeControl);
    routeLayer.clearLayers();
    document.getElementById('itineraryBox').classList.add('hidden');
    document.getElementById('btnItinerary').classList.add('hidden');
}

function focusJob(lat, lng) { showMap(); map.flyTo([lat, lng], 17); }

// UI Helpers
function toggleForm() { document.getElementById('postDrawer').classList.toggle('hidden'); }
function showMap() { document.getElementById('jobsList').classList.add('hidden'); document.getElementById('accountPage').classList.add('hidden'); }
function showList() { document.getElementById('jobsList').classList.remove('hidden'); }
function openAccount() { document.getElementById('accountPage').classList.remove('hidden'); }
function hideLoader() { document.getElementById('loader').style.opacity = '0'; setTimeout(() => document.getElementById('loader').classList.add('hidden'), 500); }

locateMe();
