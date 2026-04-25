const firebaseConfig = {
    apiKey: "AIzaSyCR1Z6VlS5A7iPbUCoVm0AQcnkkUdsA0CE",
    authDomain: "jobmarketfuture.firebaseapp.com",
    databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com",
    projectId: "jobmarketfuture"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const auth = firebase.auth();
const ADMIN_UID = "GrajEM98vOc1w3FUr9XeTN90rfl2";

// Initialisation Carte (Mode Satellite par défaut, design premium)
let map = L.map('map', { zoomControl: false }).setView([3.848, 11.502], 13);
L.tileLayer('https://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}',{ subdomains:['mt0','mt1','mt2','mt3'], attribution: '© Google Maps' }).addTo(map);

let jobsLayer = L.featureGroup().addTo(map);
let userCoords = null;
let allJobs = JSON.parse(localStorage.getItem('cached_jobs')) || []; // Cache local
let measureLine = null; // Pour l'outil de mesure

auth.signInAnonymously().catch(e => console.error("Auth Error"));

// 1. GÉOLOCALISATION
function locateMe() {
    navigator.geolocation.getCurrentPosition(pos => {
        userCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        L.circleMarker([userCoords.lat, userCoords.lng], { radius: 7, color: '#fff', fillColor: '#007AFF', fillOpacity: 1 }).addTo(map);
        map.flyTo([userCoords.lat, userCoords.lng], 14);
        syncJobs();
    }, () => syncJobs(), { timeout: 5000 });
}

// 2. SYNCHRONISATION DES DONNÉES ET AFFICHAGE
function syncJobs() {
    db.ref("jobs").on("value", snap => {
        allJobs = [];
        snap.forEach(child => {
            const j = child.val();
            const dist = userCoords ? calcDist(userCoords.lat, userCoords.lng, j.lat, j.lng) : 999;
            allJobs.push({ ...j, id: child.key, dist, ratingAvg: parseFloat(j.ratingAvg || 5.0) });
        });
        localStorage.setItem('cached_jobs', JSON.stringify(allJobs));
        render(allJobs);
    });
}

function render(data) {
    jobsLayer.clearLayers();
    // Conseil : Uniquement les marqueurs proches ou visibles pour la performance
    data.forEach(j => {
        const icon = L.divIcon({
            html: `<div class="m-pin" style="border-color:${j.color}">
                    <div class="m-icon-circle" style="background:${j.color}">${j.icon}</div>
                    <div class="m-info">
                        <p class="m-title">${j.title}</p>
                        <p class="m-subtitle">${j.desc.substring(0, 20)}...</p>
                        <div class="m-stats">
                            <span class="m-stars">⭐ ${j.ratingAvg.toFixed(1)}</span> 
                            <span class="m-dist">• ${j.dist.toFixed(1)} km</span>
                        </div>
                    </div>
                </div>`,
            className: '', iconSize:, iconAnchor:
        });
        L.marker([j.lat, j.lng], { icon }).addTo(jobsLayer).bindPopup(`
            <div class="job-popup-content">
                <div class="job-popup-header">
                    <b class="job-popup-title">${j.title}</b>
                    <span class="job-popup-price">${j.price}</span>
                </div>
                <p class="job-popup-landmark">📍 Repère: ${j.landmark || 'Près de votre position'}</p>
                <div class="job-popup-actions">
                    <a href="tel:${j.phone}" class="btn-direct call">📞 Appeler</a>
                    <a href="https://wa.me/${j.phone}" class="btn-direct wa">💬 WhatsApp</a>
                    
                    <div class="trust-engine-container">
                        <button class="btn-noter" onclick="showRatingMenu('${j.id}')">★ Noter le professionnel</button>
                        <div id="ratingStars_${j.id}" class="rating-stars hidden">
                            ${.map(s => `<span class="star" onclick="submitRating('${j.id}', ${s})">★</span>`).join('')}
                        </div>
                    </div>
                </div>
            </div>
        `).on('click', () => updateItineraryPanel(j));
    });
    updateJobsList(data);
}

// 3. TRUST ENGINE (Notation étoilée)
window.showRatingMenu = (jobId) => {
    document.getElementById(`ratingStars_${jobId}`).classList.toggle("hidden");
};

window.submitRating = (jobId, score) => {
    db.ref(`jobs/${jobId}`).once("value", snap => {
        const j = snap.val();
        const nT = (j.ratingTotal || 0) + score;
        const nC = (j.ratingCount || 0) + 1;
        db.ref(`jobs/${jobId}`).update({ ratingTotal: nT, ratingCount: nC, ratingAvg: (nT/nC).toFixed(1) }).then(() => {
            alert("✅ Confiance mise à jour !");
            document.getElementById(`ratingStars_${jobId}`).classList.add("hidden");
        });
    });
};

// 4. PUBLICATION & ANTI-SPAM (Conseil : Blocage local)
function addJob() {
    const lastPost = localStorage.getItem('lastPost');
    if (lastPost && (Date.now() - lastPost < 120000)) {
        return alert("⏳ Anti-Spam : Veuillez patienter 2 minutes.");
    }

    const catInfo = document.getElementById('category').value.split('|');
    const title = document.getElementById('title').value;
    const phone = document.getElementById('phone').value;
    const price = document.getElementById('price').value;

    if(!title || !phone || !price) return alert("Remplissez les champs obligatoires.");

    navigator.geolocation.getCurrentPosition(pos => {
        const ref = db.ref("jobs").push();
        ref.set({
            id: ref.key, title, price, phone,
            desc: document.getElementById('desc').value,
            landmark: document.getElementById('landmark').value,
            icon: catInfo, color: catInfo,
            lat: pos.coords.latitude, lng: pos.coords.longitude,
            user: auth.currentUser.uid, ratingAvg: 5.0, timestamp: Date.now()
        });
        localStorage.setItem('lastPost', Date.now()); // Enregistre l'heure du succès
        toggleForm();
    });
}

// 5. OUTILS DE CARTE (image_1.png style)
function updateItineraryPanel(j) {
    if(!userCoords) return;
    const dist = calcDist(userCoords.lat, userCoords.lng, j.lat, j.lng);
    document.getElementById("itineraryDistance").innerText = dist.toFixed(1) + " km";
    // Calcul de la direction simplifiée
    const dir = (j.lat > userCoords.lat) ? "Nord" : "Sud";
    document.getElementById("itineraryDirection").innerText = `Direction: ${dir}`;
    document.getElementById("itineraryPanel").classList.remove("hidden");
}

// Outil de mesure (règle)
document.getElementById('rulerBtn').addEventListener('click', function() {
    this.classList.toggle('active');
    if (this.classList.contains('active')) {
        map.on('click', onMapMeasurementClick);
        measureLine = L.polyline([], {color: '#ff0000', dashArray: '5, 10'}).addTo(map);
    } else {
        map.off('click', onMapMeasurementClick);
        if(measureLine) map.removeLayer(measureLine);
        measureLine = null;
    }
});

function onMapMeasurementClick(e) {
    measureLine.addLatLng(e.latlng);
    const points = measureLine.getLatLngs();
    if(points.length > 1) {
        let totalDist = 0;
        for(let i=1; i<points.length; i++) totalDist += calcDist(points[i-1].lat, points[i-1].lng, points[i].lat, points[i].lng);
        alert(`📏 Distance mesurée : ${totalDist.toFixed(2)} km`);
    }
}

// 6. FILTRES & UI
window.filterJobs = (cat) => {
    const filtered = (cat === 'all') ? allJobs : allJobs.filter(j => j.icon === cat);
    render(filtered);
    // Active chip style
    document.querySelectorAll('.cat-chip').forEach(b => b.classList.remove('active'));
    event.currentTarget.classList.add('active');
};

function updateJobsList(jobs) {
    const list = document.getElementById('listContent');
    jobs.sort((a, b) => a.dist - b.dist);
    list.innerHTML = jobs.map(j => `
        <div style="background:white; padding:15px; border-radius:15px; margin-bottom:10px; border-left:5px solid ${j.color}; background:#fff; color:#1a1a1a;">
            <div style="display:flex; justify-content:space-between"><b>${j.title}</b> <span>${j.dist.toFixed(1)}km</span></div>
            <p style="color:#34C759; font-weight:bold; margin:5px 0">${j.price}</p>
            <p style="font-size:12px; color:#888;">📍 ${j.landmark || 'Position'}</p>
            <div style="display:flex; gap:10px; margin-top:10px">
                <a href="https://wa.me/${j.phone}" style="flex:1; background:#34C759; color:white; padding:8px; border-radius:8px; text-align:center; text-decoration:none; font-weight:bold;">WhatsApp</a>
                <button onclick="focusJob(${j.lat},${j.lng})" style="flex:1; background:#f4f7f6; padding:8px; border-radius:8px; border:1px solid #eee; text-align:center;">Voir Carte</button>
            </div>
        </div>
    `).join('');
}

// Nav Utils Clarté
window.focusJob = (lat, lng) => { showMap(); map.flyTo([lat, lng], 16); };
window.showMap = () => { document.getElementById('jobsList').classList.add('hidden'); map.invalidateSize(); };
window.showList = () => { document.getElementById('jobsList').classList.remove('hidden'); updateJobsList(allJobs); };
window.toggleForm = () => { document.getElementById('formBox').classList.toggle('hidden'); };

function calcDist(la1, lo1, la2, lo2) {
    const R = 6371; const dLat = (la2-la1)*Math.PI/180; const dLon = (lo2-lo1)*Math.PI/180;
    const a = Math.sin(dLat/2)**2 + Math.cos(la1*Math.PI/180)*Math.cos(la2*Math.PI/180)*Math.sin(dLon/2)**2;
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

locateMe();
