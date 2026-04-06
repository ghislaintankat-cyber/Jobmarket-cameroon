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

// INITIALISATION DE LA CARTE (Mode Satellite + Labels)
let map = L.map('map', { zoomControl: false }).setView([3.8, 11.5], 6);

L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Esri World Imagery'
}).addTo(map);

L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png', {
    subdomains: 'abcd'
}).addTo(map);

// GESTION GPS & ZOOM MAISON
let userLat, userLng;
navigator.geolocation.watchPosition(pos => {
    userLat = pos.coords.latitude;
    userLng = pos.coords.longitude;
    // Zoom auto au démarrage sur la position
    if(!map.hasZoomed) {
        map.setView([userLat, userLng], 18); // Zoom max pour voir les arbres/maisons
        map.hasZoomed = true;
    }
}, err => console.log(err), { enableHighAccuracy: true });

// NAVIGATION ENTRE ÉCRANS
function showScreen(name) {
    document.querySelectorAll('.screen-panel').forEach(p => p.classList.add('hidden'));
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    
    if(name !== 'map') {
        document.getElementById(name + 'Screen').classList.remove('hidden');
    }
    event.currentTarget.classList.add('active');
    setTimeout(() => map.invalidateSize(), 200);
}

// CHARGEMENT DES JOBS SUR CARTE ET LISTE
db.ref("jobs").on("value", snap => {
    let data = snap.val();
    const list = document.getElementById("jobsScreen");
    list.innerHTML = "<h2>Services disponibles</h2>";
    
    // Nettoyer marqueurs
    map.eachLayer(layer => { if(layer instanceof L.Marker) map.removeLayer(layer); });

    if(!data) return;

    Object.entries(data).forEach(([id, job]) => {
        // Liste
        list.innerHTML += `
            <div class="job-card">
                <b>${job.title}</b><br>
                <small>${job.desc}</small><br>
                <strong style="color:#FFD700">${job.price} FCFA</strong><br>
                <button onclick="window.open('https://wa.me/${job.phone}')" style="margin-top:10px; padding:5px 10px;">Contacter</button>
                <button onclick="deleteJob('${id}')" style="background:none; border:none; color:red; float:right;">❌</button>
            </div>
        `;

        // Carte (Étiquette Premium)
        let icon = L.divIcon({
            className: 'custom-div-icon',
            html: `<div class="custom-label"><b>${job.title}</b></div>`,
            iconSize:,
            iconAnchor:
        });

        L.marker([job.lat, job.lng], {icon: icon}).addTo(map)
            .bindPopup(`<b>${job.title}</b><br>${job.price} FCFA<br><button onclick="window.open('https://wa.me/${job.phone}')">WhatsApp</button>`);
    });
});

// PUBLIER
function addJob() {
    if(!userLat) return alert("Attendez le GPS...");
    if(!auth.currentUser) return alert("Connectez-vous d'abord");

    db.ref("jobs").push({
        title: document.getElementById("title").value,
        desc: document.getElementById("desc").value,
        price: document.getElementById("price").value,
        phone: document.getElementById("phone").value,
        lat: userLat, lng: userLng
    }).then(() => {
        toggleForm();
        alert("Annonce publiée !");
    });
}

function toggleForm() { document.getElementById("jobForm").classList.toggle("hidden"); }

// ADMIN DELETE
function deleteJob(id) {
    let code = prompt("Code secret administrateur ?");
    if(code === "237BO") {
        db.ref("jobs/" + id).remove();
    } else {
        alert("Code incorrect");
    }
}

// AUTHENTIFICATION
function login() { auth.signInWithEmailAndPassword(email.value, password.value).catch(e => alert(e.message)); }
function register() { auth.createUserWithEmailAndPassword(email.value, password.value).catch(e => alert(e.message)); }
function googleLogin() { auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()); }

function saveProfile() {
    let u = auth.currentUser;
    if(u) db.ref("users/" + u.uid).set({ cv: cv.value, role: role.value });
                                    }
