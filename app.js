const firebaseConfig = {
    apiKey: "AIzaSyCR1Z6VlS5A7iPbUCoVm0AQcnkkUdsA0CE",
    authDomain: "jobmarketfuture.firebaseapp.com",
    databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com",
    projectId: "jobmarketfuture"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const auth = firebase.auth();

// Initialisation Carte (Mode Clair par défaut)
let map = L.map('map', { zoomControl: false }).setView([3.848, 11.502], 13);
L.tileLayer('https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',{ subdomains:['mt0','mt1','mt2','mt3'] }).addTo(map);

let jobsLayer = L.featureGroup().addTo(map);
let userCoords = null;
// Conseil : Cache local pour le mode hors-ligne
let allJobs = JSON.parse(localStorage.getItem('cached_jobs')) || []; 

auth.signInAnonymously().catch(e => console.error("Auth Error"));

// 1. GÉOLOCALISATION
function locateMe() {
    navigator.geolocation.getCurrentPosition(pos => {
        userCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        L.circleMarker([userCoords.lat, userCoords.lng], { radius: 7, color: '#fff', fillColor: '#007AFF', fillOpacity: 1 }).addTo(map);
        map.flyTo([userCoords.lat, userCoords.lng], 14);
        syncData();
    }, () => syncData(), { timeout: 5000 });
}

// 2. SYNCHRONISATION DES DONNÉES
function syncData() {
    db.ref("jobs").on("value", snap => {
        allJobs = [];
        snap.forEach(child => {
            const j = child.val();
            const dist = userCoords ? calcDist(userCoords.lat, userCoords.lng, j.lat, j.lng) : 999;
            allJobs.push({ ...j, id: child.key, dist });
        });
        localStorage.setItem('cached_jobs', JSON.stringify(allJobs));
        render(allJobs);
    });
}

function render(data) {
    jobsLayer.clearLayers();
    data.forEach(j => {
        const icon = L.divIcon({
            html: `<div class="m-pin"><div class="m-dot" style="background:${j.color}"></div><span class="m-price">${j.price}</span></div>`,
            className: '', iconSize:
        });
        L.marker([j.lat, j.lng], { icon }).addTo(jobsLayer).bindPopup(`
            <div style="font-family:inherit; padding:5px; min-width:180px;">
                <b style="font-size:16px;">${j.title}</b><br>
                <span style="color:#34C759; font-weight:bold;">${j.price}</span><br>
                <small style="color:#666;">📍 Repère: ${j.landmark || 'Non précisé'}</small>
                <div style="display:flex; gap:8px; margin-top:12px;">
                    <a href="tel:${j.phone}" style="flex:1; background:#007AFF; color:white; padding:10px; border-radius:8px; text-align:center; text-decoration:none; font-weight:bold; font-size:12px;">Appeler</a>
                    <a href="https://wa.me/${j.phone}" style="flex:1; background:#34C759; color:white; padding:10px; border-radius:8px; text-align:center; text-decoration:none; font-weight:bold; font-size:12px;">WhatsApp</a>
                </div>
            </div>
        `);
    });
    updateListUI(data);
}

// 3. PUBLICATION & ANTI-SPAM
function addJob() {
    // Conseil : Limite de publication locale
    const lastPost = localStorage.getItem('last_p');
    if (lastPost && (Date.now() - lastPost < 120000)) {
        return alert("⏳ Sécurité : Attendez 2 minutes entre chaque annonce.");
    }

    const catInfo = document.getElementById('category').value.split('|');
    const title = document.getElementById('title').value;
    const phone = document.getElementById('phone').value;
    const price = document.getElementById('price').value;
    const landmark = document.getElementById('landmark').value;
    const desc = document.getElementById('desc').value;

    if(!title || !phone || !price) return alert("Veuillez remplir les champs obligatoires.");

    navigator.geolocation.getCurrentPosition(pos => {
        const ref = db.ref("jobs").push();
        ref.set({
            title, price, phone, landmark, desc,
            icon: catInfo, color: catInfo,
            lat: pos.coords.latitude, lng: pos.coords.longitude,
            timestamp: Date.now(),
            user: auth.currentUser.uid
        }).then(() => {
            localStorage.setItem('last_p', Date.now());
            toggleForm();
            alert("✅ Mission publiée gratuitement !");
        });
    }, () => alert("Le GPS est requis pour localiser la mission."));
}

// 4. UX & FILTRES
function filterBy(cat, btn) {
    document.querySelectorAll('.filter-chip').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const filtered = (cat === 'all') ? allJobs : allJobs.filter(j => j.icon === cat);
    render(filtered);
}

function updateListUI(data) {
    const list = document.getElementById('listContent');
    data.sort((a, b) => a.dist - b.dist);
    list.innerHTML = data.map(j => `
        <div style="background:white; padding:20px; border-radius:20px; margin-bottom:15px; box-shadow:0 4px 12px rgba(0,0,0,0.03); border-left:6px solid ${j.color}">
            <div style="display:flex; justify-content:space-between; align-items:start;">
                <h3 style="margin:0; font-size:16px; color:#111;">${j.icon} ${j.title}</h3>
                <span style="font-size:12px; font-weight:800; color:var(--blue)">${j.dist.toFixed(1)} km</span>
            </div>
            <p style="color:#34C759; font-weight:800; margin:8px 0; font-size:15px;">${j.price}</p>
            <p style="font-size:13px; color:#8E8E93; margin-bottom:15px;">📍 ${j.landmark || 'Près de votre position'}</p>
            <div style="display:flex; gap:10px;">
                <button onclick="focusJob(${j.lat},${j.lng})" style="flex:1; background:#F2F2F7; border:none; padding:12px; border-radius:12px; font-weight:bold; color:#333;">Voir Carte</button>
                <a href="https://wa.me/${j.phone}" style="flex:1; background:var(--green); color:white; padding:12px; border-radius:12px; text-align:center; text-decoration:none; font-weight:bold;">WhatsApp</a>
            </div>
        </div>
    `).join('');
}

// Navigation
function focusJob(lat, lng) { showMap(); map.flyTo([lat, lng], 17); }
function showMap() { 
    document.getElementById('jobsList').classList.add('hidden'); 
    document.getElementById('tabMap').classList.add('active');
    document.getElementById('tabList').classList.remove('active');
    map.invalidateSize();
}
function showList() { 
    document.getElementById('jobsList').classList.remove('hidden'); 
    document.getElementById('tabMap').classList.remove('active');
    document.getElementById('tabList').classList.add('active');
}
function toggleForm() { document.getElementById('formBox').classList.toggle('hidden'); }

// Calcul Distance (Haversine)
function calcDist(la1, lo1, la2, lo2) {
    const R = 6371; const dLat = (la2-la1)*Math.PI/180; const dLon = (lo2-lo1)*Math.PI/180;
    const a = Math.sin(dLat/2)**2 + Math.cos(la1*Math.PI/180)*Math.cos(la2*Math.PI/180)*Math.sin(dLon/2)**2;
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

// Lancement
locateMe();
if(allJobs.length > 0) render(allJobs);
