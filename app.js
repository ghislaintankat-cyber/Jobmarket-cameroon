// CONFIGURATION FIREBASE
const firebaseConfig = {
    apiKey: "AIzaSyCR1Z6VlS5A7iPbUCoVm0AQcnkkUdsA0CE",
    authDomain: "jobmarketfuture.firebaseapp.com",
    databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com",
    projectId: "jobmarketfuture"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const auth = firebase.auth();

let currentUser;
const ADMIN_UID = "GrajEM98vOc1w3FUr9XeTN90rfl2";

// AUTHENTICATION
auth.onAuthStateChanged(user => {
    currentUser = user;
    if(user) document.getElementById('userDisplay').innerText = user.email;
});

function register() { auth.createUserWithEmailAndPassword(email.value, password.value).catch(alert); }
function login() { auth.signInWithEmailAndPassword(email.value, password.value).catch(alert); }

// CARTE SATELLITE HD
let map = L.map("map", { zoomControl: false }).setView([3.848, 11.502], 14);

L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Esri, DigitalGlobe, GeoEye, Earthstar Geographics'
}).addTo(map);

// GPS TEMPS RÉEL
let userMarker;
navigator.geolocation.watchPosition(pos => {
    let lat = pos.coords.latitude;
    let lng = pos.coords.longitude;
    if (userMarker) {
        userMarker.setLatLng([lat, lng]);
    } else {
        userMarker = L.circleMarker([lat, lng], { radius: 10, color: "white", weight: 3, fillColor: "#3b82f6", fillOpacity: 1 }).addTo(map);
    }
}, null, { enableHighAccuracy: true });

// GESTION FORMULAIRE
function toggleForm() { 
    if(!currentUser) return alert("Veuillez vous connecter pour publier.");
    document.getElementById('formBox').classList.toggle("hidden"); 
}

// AJOUTER UN JOB
function addJob() {
    navigator.geolocation.getCurrentPosition(pos => {
        let jobRef = db.ref("jobs").push();
        jobRef.set({
            id: jobRef.key,
            title: document.getElementById('title').value,
            desc: document.getElementById('desc').value,
            price: document.getElementById('price').value,
            phone: document.getElementById('phone').value,
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            user: currentUser.uid,
            time: Date.now()
        });
        alert("✅ Annonce publiée !");
        toggleForm();
    });
}

// CHARGEMENT DES MARQUEURS SUR LA CARTE
db.ref("jobs").on("value", snap => {
    map.eachLayer(layer => { if(layer instanceof L.Marker) map.removeLayer(layer); });
    snap.forEach(d => {
        let j = d.val();
        let marker = L.marker([j.lat, j.lng]).addTo(map);
        marker.bindPopup(`
            <div class="job-card-map">
                <b>${j.title}</b><br>
                <small>${j.price} FCFA</small><br>
                <p>${j.desc}</p>
                <a href="https://wa.me/${j.phone}" class="btn-wa">WhatsApp</a>
            </div>
        `);
    });
});

// NAVIGATION
function showMap() {
    hideAll();
    document.getElementById('map').style.display = "block";
}

function showList() {
    hideAll();
    let list = document.getElementById('jobsList');
    list.classList.remove("hidden");
    list.innerHTML = "<h2>Dernières Offres</h2>";
    db.ref("jobs").once("value", snap => {
        snap.forEach(d => {
            let j = d.val();
            list.innerHTML += `
                <div style="background:#222; padding:15px; border-radius:15px; margin-bottom:10px;">
                    <h3>${j.title}</h3>
                    <p>${j.price} FCFA</p>
                    <a href="tel:${j.phone}" style="color:var(--primary)">Appeler</a>
                </div>`;
        });
    });
}

function showChat() { hideAll(); document.getElementById('chatBox').classList.remove("hidden"); }
function showAccount() { hideAll(); document.getElementById('accountBox').classList.remove("hidden"); }

function hideAll() {
    document.getElementById('jobsList').classList.add("hidden");
    document.getElementById('chatBox').classList.add("hidden");
    document.getElementById('accountBox').classList.add("hidden");
    document.getElementById('formBox').classList.add("hidden");
                              }
