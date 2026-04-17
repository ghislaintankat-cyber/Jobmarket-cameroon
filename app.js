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
let currentUser = null;

auth.onAuthStateChanged(user => {
    currentUser = user;
    if(user) document.getElementById('userDisplay').innerText = user.email;
});

// 🗺️ INITIALISATION CARTE GOOGLE HYBRIDE (SATELLITE + NOMS)
let map = L.map("map", { zoomControl: false }).setView([3.848, 11.502], 14);
L.tileLayer('https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
    maxZoom: 20,
    subdomains:['mt0','mt1','mt2','mt3']
}).addTo(map);

// GPS
let userMarker;
navigator.geolocation.watchPosition(pos => {
    let lat = pos.coords.latitude; let lng = pos.coords.longitude;
    if (userMarker) { userMarker.setLatLng([lat, lng]); } 
    else { userMarker = L.circleMarker([lat, lng], { radius: 10, color: "white", weight: 3, fillColor: "#3b82f6", fillOpacity: 1 }).addTo(map); }
}, null, { enableHighAccuracy: true });

// ➕ PUBLIER
window.toggleForm = () => { if(!currentUser) return alert("Connectez-vous d'abord !"); document.getElementById('formBox').classList.toggle("hidden"); };

window.addJob = () => {
    const catRaw = document.getElementById('category').value.split('|');
    const icon = catRaw; const color = catRaw;
    const title = document.getElementById('title').value;
    const desc = document.getElementById('desc').value;
    const price = document.getElementById('price').value;
    const phone = document.getElementById('phone').value;

    if(!title || !phone) return alert("Remplissez les champs obligatoires");

    navigator.geolocation.getCurrentPosition(pos => {
        let jobRef = db.ref("jobs").push();
        jobRef.set({
            id: jobRef.key, icon, color, title, desc, price, phone,
            lat: pos.coords.latitude, lng: pos.coords.longitude,
            user: currentUser.uid, time: Date.now()
        }).then(() => {
            alert("✅ Publié !");
            document.getElementById('formBox').classList.add("hidden");
        });
    });
};

// 📍 MARQUEURS CATÉGORIES
db.ref("jobs").on("value", snap => {
    map.eachLayer(layer => { if(layer instanceof L.Marker) map.removeLayer(layer); });
    snap.forEach(d => {
        let j = d.val();
        const customIcon = L.divIcon({
            html: `<div style="background:${j.color}; width:35px; height:35px; border-radius:12px; display:flex; align-items:center; justify-content:center; border:2.5px solid white; box-shadow:0 5px 15px rgba(0,0,0,0.3); font-size:20px;">${j.icon}</div>`,
            className: '', iconSize:, iconAnchor:
        });
        let marker = L.marker([j.lat, j.lng], {icon: customIcon}).addTo(map);
        marker.bindPopup(`<div style="color:#000; padding:5px;"><b>${j.title}</b><br>${j.price} FCFA<br><a href="https://wa.me/237${j.phone}" target="_blank" style="display:block; background:#25D366; color:white; text-align:center; padding:8px; border-radius:8px; text-decoration:none; margin-top:10px; font-weight:bold;">WhatsApp</a></div>`);
    });
});

// 🗑️ SUPPRESSION & LISTE
window.loadJobsList = () => {
    const list = document.getElementById('jobsList');
    list.innerHTML = "<h2>Missions disponibles</h2>";
    db.ref("jobs").orderByChild("time").limitToLast(50).once("value", snap => {
        snap.forEach(d => {
            let j = d.val(); let id = d.key;
            const canDelete = (currentUser && (currentUser.uid === j.user || currentUser.uid === ADMIN_UID));
            list.innerHTML += `<div style="background:#222; padding:20px; border-radius:20px; margin-bottom:15px; border:1px solid #333">
                <span style="font-size:24px">${j.icon}</span> <b style="color:var(--primary)">${j.title}</b><br>
                <p>${j.price} FCFA</p>
                <div style="display:flex; gap:10px; margin-top:10px">
                    <a href="https://wa.me/237${j.phone}" style="background:#25D366; color:white; padding:10px; border-radius:10px; flex:1; text-align:center; text-decoration:none;">WhatsApp</a>
                    ${canDelete ? `<button onclick="deleteJob('${id}')" style="background:#EF4444; color:white; border:none; border-radius:10px; padding:10px; cursor:pointer;">Supprimer</button>` : ""}
                </div>
            </div>`;
        });
    });
};

window.deleteJob = (id) => { if(confirm("Supprimer ?")) db.ref("jobs").child(id).remove().then(() => { alert("OK"); window.loadJobsList(); }); };

// 🧭 NAV
window.showMap = () => { hideAll(); document.getElementById('map').style.display="block"; };
window.showList = () => { hideAll(); document.getElementById('jobsList').classList.remove("hidden"); window.loadJobsList(); };
window.showChat = () => { hideAll(); document.getElementById('chatBox').classList.remove("hidden"); };
window.showAccount = () => { hideAll(); document.getElementById('accountBox').classList.remove("hidden"); };
function hideAll() { ["map","jobsList","chatBox","accountBox","formBox"].forEach(id => { let el = document.getElementById(id); if(el) id==="map" ? el.style.display="none" : el.classList.add("hidden"); }); }

// Auth Functions
window.register = () => { auth.createUserWithEmailAndPassword(email.value, password.value).catch(alert); };
window.login = () => { auth.signInWithEmailAndPassword(email.value, password.value).catch(alert); };
