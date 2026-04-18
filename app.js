// 🔥 FIREBASE CONFIG
const firebaseConfig = {
    apiKey: "AIzaSyCR1Z6VlS5A7iPbUCoVm0AQcnkkUdsA0CE",
    authDomain: "jobmarketfuture.firebaseapp.com",
    databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com",
    projectId: "jobmarketfuture"
};

if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const auth = firebase.auth();

const ADMIN_UID = "GrajEM98vOc1w3FUr9XeTN90rfl2";
let currentUser = null;
let currentDistFilter = 0; 
let routingControl = null;

auth.onAuthStateChanged(user => { currentUser = user; });

// 🗺️ CARTE HYBRIDE (SATELLITE + NOMS)
let map = L.map("map", { zoomControl: false, tap: false }).setView([3.848, 11.502], 13);
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }).addTo(map);
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png', { pane: 'shadowPane', subdomains: 'abcd' }).addTo(map);

// 🎯 GPS & RADAR
let userMarker;
navigator.geolocation.watchPosition(pos => {
    let lat = pos.coords.latitude, lng = pos.coords.longitude;
    if (userMarker) { userMarker.setLatLng([lat, lng]); } 
    else {
        userMarker = L.circleMarker([lat, lng], { radius: 8, color: "white", weight: 3, fillColor: "#3b82f6", fillOpacity: 1 }).addTo(map);
        userMarker._isUser = true;
    }
    db.ref("jobs").once("value", snap => updateMarkers(snap));
}, null, { enableHighAccuracy: true });

// 📏 CALCUL DISTANCE (Haversine)
function getDist(lat1, lon1, lat2, lon2) {
    const R = 6371; 
    const dLat = (lat2-lat1)*Math.PI/180;
    const dLon = (lon2-lon1)*Math.PI/180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

// 📍 MISE À JOUR MARQUEURS & FILTRES
window.filterByDist = (d, btn) => {
    currentDistFilter = d;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    db.ref("jobs").once("value", snap => updateMarkers(snap));
};

function updateMarkers(snap) {
    if (!userMarker) return;
    const u = userMarker.getLatLng();
    map.eachLayer(l => { if (l instanceof L.Marker && !l._isUser) map.removeLayer(l); });

    snap.forEach(d => {
        let j = d.val();
        let dist = getDist(u.lat, u.lng, j.lat, j.lng);
        if (currentDistFilter > 0 && dist > currentDistFilter) return;

        const icon = L.divIcon({
            html: `<div style="background:${j.color}; width:35px; height:35px; border-radius:12px; display:flex; align-items:center; justify-content:center; border:2px solid white; box-shadow:0 5px 15px rgba(0,0,0,0.3); font-size:18px;">${j.icon}</div>`,
            className: '', iconSize:, iconAnchor:
        });

        let m = L.marker([j.lat, j.lng], { icon: icon }).addTo(map);
        m.bindPopup(`
            <div style="color:black; min-width:150px">
                <b>${j.title}</b><br>📍 ${dist.toFixed(1)} km<br>💰 ${j.price} FCFA
                <button onclick="startNav(${j.lat}, ${j.lng}, '${j.title.replace(/'/g," ")}')" style="width:100%; background:#3b82f6; color:white; border:none; padding:8px; border-radius:5px; margin-top:8px; font-weight:bold;">🛣️ Itinéraire</button>
                <a href="https://wa.me/${j.phone}" target="_blank" style="display:block; background:#25D366; color:white; text-align:center; padding:8px; border-radius:5px; text-decoration:none; margin-top:5px; font-weight:bold;">💬 WhatsApp</a>
            </div>
        `);
    });
}

// 🗣️ ITINÉRAIRE & GUIDAGE VOCAL
window.startNav = (lat, lng, title) => {
    if (routingControl) map.removeControl(routingControl);
    const u = userMarker.getLatLng();

    routingControl = L.Routing.control({
        waypoints: [ L.latLng(u.lat, u.lng), L.latLng(lat, lng) ],
        lineOptions: { styles: [{ color: '#3b82f6', weight: 6, opacity: 0.8 }] },
        createMarker: () => null, show: false, addWaypoints: false
    }).addTo(map);

    routingControl.on('routesfound', e => {
        const d = (e.routes.summary.totalDistance / 1000).toFixed(1);
        const t = Math.round(e.routes.summary.totalTime / 60);
        
        // Voix
        const speech = new SpeechSynthesisUtterance(`Itinéraire vers ${title} calculé. Distance ${d} kilomètres. Temps ${t} minutes.`);
        speech.lang = 'fr-FR'; window.speechSynthesis.speak(speech);
        
        document.getElementById('userStatus').innerText = `Arrivée dans ${t} min (${d} km)`;
        showMap(); map.closePopup();
    });
};

// ➕ GESTION DES MISSIONS
window.addJob = () => {
    if (!currentUser) return alert("Connectez-vous d'abord !");
    const cat = document.getElementById('category').value.split('|');
    const title = document.getElementById('title').value;
    const price = document.getElementById('price').value;
    let phone = document.getElementById('phone').value.replace(/\s/g, '');

    if (!title || phone.length < 8) return alert("Données invalides");
    const finalPhone = phone.startsWith("237") ? phone : "237" + phone;

    navigator.geolocation.getCurrentPosition(pos => {
        let ref = db.ref("jobs").push();
        ref.set({
            id: ref.key, icon: cat, color: cat, title, desc: document.getElementById('desc').value,
            price, phone: finalPhone, lat: pos.coords.latitude, lng: pos.coords.longitude,
            user: currentUser.uid, time: Date.now()
        }).then(() => {
            alert("Publié !");
            toggleForm();
            ['title','desc','price','phone'].forEach(id => document.getElementById(id).value = "");
        });
    });
};

// 🗑️ LISTE & ADMIN
window.loadJobsList = () => {
    const list = document.getElementById('jobsList');
    list.innerHTML = "<h2>Missions Radar</h2>";
    db.ref("jobs").orderByChild("time").limitToLast(50).once("value", snap => {
        snap.forEach(d => {
            let j = d.val();
            const canDel = (currentUser && (currentUser.uid === j.user || currentUser.uid === ADMIN_UID));
            list.innerHTML += `
                <div style="background:#1a1a1a; padding:15px; border-radius:15px; margin-bottom:10px; border:1px solid #333">
                    <b>${j.icon} ${j.title}</b><br><small>${j.price} FCFA</small><br>
                    <div style="display:flex; gap:10px; margin-top:10px">
                        <a href="https://wa.me/${j.phone}" style="flex:1; background:#25D366; color:white; padding:8px; border-radius:8px; text-align:center; text-decoration:none;">WhatsApp</a>
                        ${canDel ? `<button onclick="deleteJob('${d.key}')" style="background:#EF4444; color:white; border:none; border-radius:8px; padding:8px;">Supprimer</button>` : ""}
                    </div>
                </div>`;
        });
    });
};

window.deleteJob = id => { if(confirm("Supprimer ?")) db.ref("jobs").child(id).remove().then(()=>loadJobsList()); };

// 🧭 UI NAVIGATION
window.setActive = btn => { document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); };
window.showMap = () => { hideAll(); document.getElementById('map').style.display="block"; };
window.showList = () => { hideAll(); document.getElementById('jobsList').classList.remove("hidden"); loadJobsList(); };
window.showAccount = () => { hideAll(); document.getElementById('accountBox').classList.remove("hidden"); };
window.toggleForm = () => { document.getElementById('formBox').classList.toggle("hidden"); };

function hideAll() { 
    ['map','jobsList','accountBox','formBox'].forEach(id => {
        let el = document.getElementById(id);
        id === 'map' ? el.style.display="none" : el.classList.add("hidden");
    });
}

// Auth Simple
window.register = () => auth.createUserWithEmailAndPassword(email.value, password.value).catch(e => alert(e.message));
window.login = () => auth.signInWithEmailAndPassword(email.value, password.value).catch(e => alert(e.message));

db.ref("jobs").on("value", snap => updateMarkers(snap));
