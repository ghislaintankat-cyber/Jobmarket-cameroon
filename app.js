// CONFIGURATION FIREBASE
const firebaseConfig = {
    apiKey: "AIzaSyCR1Z6VlS5A7iPbUCoVm0AQcnkkUdsA0CE",
    authDomain: "jobmarketfuture.firebaseapp.com",
    databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com",
    projectId: "jobmarketfuture"
};
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// INITIALISATION CARTE
let map = L.map("map", { zoomControl: false }).setView([3.848, 11.502], 13);
L.tileLayer('https://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}',{ subdomains:['mt0','mt1','mt2','mt3'] }).addTo(map);

let jobsLayer = L.featureGroup().addTo(map);
let userCoords = null;

// CHARGEMENT INSTANTANÉ DES JOBS (Règle le problème de la carte vide)
function loadJobs() {
    db.ref("jobs").on("value", snap => {
        jobsLayer.clearLayers();
        snap.forEach(child => {
            const j = child.val();
            if (j.lat && j.lng) {
                const dist = userCoords ? `${getDistance(userCoords.lat, userCoords.lng, j.lat, j.lng).toFixed(1)} km` : "";
                
                const customIcon = L.divIcon({
                    html: `
                        <div class="job-marker-container">
                            <div class="marker-icon-circle" style="background:${j.color}">
                                ${j.icon}
                            </div>
                            <div class="marker-info">
                                <p class="marker-title">${j.title}</p>
                                <div class="marker-stats">
                                    <span style="color:#FFD700">★ 5.0</span> 
                                    <span style="color:#888; margin-left:5px">${dist}</span>
                                </div>
                            </div>
                        </div>`,
                    className: '', iconSize:, iconAnchor:
                });

                L.marker([j.lat, j.lng], { icon: customIcon })
                 .on('click', () => { alert("Job: " + j.title); })
                 .addTo(jobsLayer);
            }
        });
    });
}

// GPS ET DISTANCE
function locateMe() {
    navigator.geolocation.getCurrentPosition(pos => {
        userCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        L.circleMarker([userCoords.lat, userCoords.lng], { radius: 8, color: '#fff', fillColor: '#00f2fe', fillOpacity: 1 }).addTo(map);
        map.flyTo([userCoords.lat, userCoords.lng], 14);
        loadJobs(); // Recharge avec les distances calculées
    }, () => loadJobs());
}

function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2-lat1)*Math.PI/180;
    const dLon = (lon2-lon1)*Math.PI/180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

// PUBLIER
function addJob() {
    const cat = document.getElementById('category').value.split('|');
    navigator.geolocation.getCurrentPosition(pos => {
        db.ref("jobs").push({
            title: document.getElementById('title').value,
            price: document.getElementById('price').value,
            phone: document.getElementById('phone').value,
            desc: document.getElementById('desc').value,
            icon: cat, color: cat,
            lat: pos.coords.latitude, lng: pos.coords.longitude
        });
        toggleForm();
    });
}

// UI
window.showMap = () => { hideAll(); document.getElementById('map').style.display="block"; map.invalidateSize(); };
window.showList = () => { hideAll(); document.getElementById('jobsList').classList.remove("hidden"); };
window.toggleForm = () => document.getElementById('formBox').classList.toggle("hidden");
function hideAll() { ['jobsList','formBox'].forEach(id => document.getElementById(id).classList.add("hidden")); }

// LANCEMENT
locateMe();
loadJobs();
