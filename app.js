// 🔥 CONFIGURATION FIREBASE
const firebaseConfig = {
    apiKey: "AIzaSyCR1Z6VlS5A7iPbUCoVm0AQcnkkUdsA0CE",
    authDomain: "jobmarketfuture.firebaseapp.com",
    databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com",
    projectId: "jobmarketfuture"
};
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const db = firebase.database(), auth = firebase.auth();
const ADMIN_UID = "GrajEM98vOc1w3FUr9XeTN90rfl2";

// 🗺️ CONFIGURATION CARTE MONDIALE HD
let map = L.map("map", { zoomControl: false, tap: false }).setView([3.848, 11.502], 13);
L.tileLayer('https://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}',{ subdomains:['mt0','mt1','mt2','mt3'] }).addTo(map);

let userMarker, userCoords = null, routingControl = null;

// 🎯 LOCALISATION & TRI AUTOMATIQUE
function locateMe() {
    navigator.geolocation.getCurrentPosition(pos => {
        userCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        if (userMarker) map.removeLayer(userMarker);
        userMarker = L.circleMarker([userCoords.lat, userCoords.lng], { radius: 10, color: '#fff', weight: 3, fillColor: '#00f2fe', fillOpacity: 1 }).addTo(map);
        map.flyTo([userCoords.lat, userCoords.lng], 16);
        updateJobsList(); 
    }, () => alert("Activez le GPS"), { enableHighAccuracy: true });
}
locateMe();

// 📐 ALGORITHME DE DISTANCE (Haversine)
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; 
    const dLat = (lat2-lat1)*Math.PI/180, dLon = (lon2-lon1)*Math.PI/180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

// 📋 MISE À JOUR & TRI PAR PROXIMITÉ
function updateJobsList() {
    const list = document.getElementById('listContent');
    list.innerHTML = "";
    db.ref("jobs").once("value", snap => {
        let jobsArray = [];
        snap.forEach(d => {
            let j = d.val();
            let dist = userCoords ? getDistance(userCoords.lat, userCoords.lng, j.lat, j.lng) : 999;
            jobsArray.push({ ...j, dist, id: d.key });
        });

        // TRI : Les plus proches en premier
        jobsArray.sort((a, b) => a.dist - b.dist);

        jobsArray.forEach(j => {
            const isOwner = auth.currentUser && (auth.currentUser.uid === j.user || auth.currentUser.uid === ADMIN_UID);
            let stars = j.ratingAvg ? `⭐ ${j.ratingAvg} (${j.ratingCount} avis)` : "⭐ Nouveau";
            let vBadge = (j.ratingAvg >= 4.5) ? `<span class="verified-badge">✓</span>` : "";

            list.innerHTML += `
                <div class="job-card" style="border-left: 10px solid ${j.color}; background:#111; padding:20px; border-radius:20px; margin-bottom:15px;">
                    <div style="display:flex; justify-content:space-between">
                        <span style="font-size:30px">${j.icon}</span>
                        <span style="color:var(--primary); font-weight:800">${j.dist.toFixed(1)} km</span>
                    </div>
                    <h3 style="margin:10px 0;">${j.title} ${vBadge}</h3>
                    <div class="stars-display">${stars}</div>
                    <p style="color:#888; font-size:14px">${j.desc}</p>
                    <b style="color:${j.color}; font-size:18px">${j.price} FCFA</b>
                    <div style="display:flex; gap:10px; margin:15px 0">
                        <a href="https://wa.me/${j.phone}" class="btn-wa">WhatsApp</a>
                        <a href="tel:${j.phone}" class="btn-call">Appel</a>
                    </div>
                    <button class="btn-primary" style="margin-bottom:10px" onclick="startNav(${j.lat}, ${j.lng}, '${j.title}')">🛣️ Itinéraire Vocal</button>
                    <button class="btn-outline" onclick="openRating('${j.id}', '${j.title}')">⭐ Terminer & Noter</button>
                    ${isOwner ? `<button class="btn-outline" style="border-color:#ff4b2b; color:#ff4b2b" onclick="deleteJob('${j.id}')">Supprimer</button>` : ""}
                </div>`;
        });
    });
}

// 🗣️ NAVIGATION & GUIDAGE VOCAL
function startNav(lat, lng, title) {
    if (routingControl) map.removeControl(routingControl);
    routingControl = L.Routing.control({
        waypoints: [L.latLng(userCoords.lat, userCoords.lng), L.latLng(lat, lng)],
        createMarker: () => null
    }).addTo(map);
    const speech = new SpeechSynthesisUtterance(`Itinéraire vers ${title} lancé. Suivez la ligne bleue.`);
    speech.lang = 'fr-FR'; window.speechSynthesis.speak(speech);
    showMap();
}

// ⭐ TRUST ENGINE (Notation)
function openRating(id, title) {
    document.getElementById('currentJobId').value = id;
    document.getElementById('ratingJobTitle').innerText = title;
    document.getElementById('ratingBox').classList.remove('hidden');
    setScore(5);
}
function setScore(s) {
    document.getElementById('currentScore').value = s;
    document.querySelectorAll('.star').forEach((el, i) => el.classList.toggle('active', 5 - i <= s));
}
function submitRating() {
    const id = document.getElementById('currentJobId').value;
    const score = parseInt(document.getElementById('currentScore').value);
    let ref = db.ref("jobs/" + id);
    ref.once("value", snap => {
        let j = snap.val();
        let nC = (j.ratingCount || 0) + 1, nT = (j.ratingTotal || 0) + score;
        ref.update({ ratingCount: nC, ratingTotal: nT, ratingAvg: (nT/nC).toFixed(1) });
        closeRating(); alert("Avis enregistré !"); updateJobsList();
    });
}

// 🔐 AUTH GOOGLE & UI
window.loginGoogle = () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider).then(() => { alert("Connecté !"); showMap(); });
};
window.addJob = () => {
    if(!auth.currentUser) return alert("Connectez-vous !");
    const cat = document.getElementById('category').value.split('|');
    db.ref("jobs").push({
        title: document.getElementById('title').value, desc: document.getElementById('desc').value,
        price: document.getElementById('price').value, phone: document.getElementById('phone').value,
        icon: cat, color: cat, lat: userCoords.lat, lng: userCoords.lng,
        user: auth.currentUser.uid, time: Date.now()
    }).then(() => { toggleForm(); updateJobsList(); });
};

// Fonctions Utilitaires UI
window.showMap = () => { hideAll(); document.getElementById('map').style.display="block"; };
window.showList = () => { hideAll(); document.getElementById('jobsList').classList.remove("hidden"); updateJobsList(); };
window.showAccount = () => { hideAll(); document.getElementById('accountBox').classList.remove("hidden"); };
window.toggleForm = () => document.getElementById('formBox').classList.toggle("hidden");
window.closeRating = () => document.getElementById('ratingBox').classList.add('hidden');
function hideAll() { ['jobsList','accountBox','formBox'].forEach(id => document.getElementById(id).classList.add("hidden")); }
