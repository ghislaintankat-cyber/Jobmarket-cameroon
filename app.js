const firebaseConfig = {
    apiKey: "AIzaSyCR1Z6VlS5A7iPbUCoVm0AQcnkkUdsA0CE",
    authDomain: "jobmarketfuture.firebaseapp.com",
    databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com",
    projectId: "jobmarketfuture",
    storageBucket: "jobmarketfuture.appspot.com",
    messagingSenderId: "YOUR_MESSAGING_ID",
    appId: "1:351669024349:web:d4d4d08727ccc6012b7fb4"
};

firebase.initializeApp(firebaseConfig);

const db = firebase.database();
const auth = firebase.auth();

// ADMIN UID (replace with your exact Firebase user UID after first secure login)
const ADMIN_UID = "GrajEM98vOc1w3FUr9XeTN90rfl2";

// CLOUDINARY CONFIG
const CLOUDINARY_CLOUD_NAME = "dvoab3mzb";
const CLOUDINARY_UPLOAD_PRESET = "job_preset";

// MAP INITIALIZATION
let map = L.map('map', {
    zoomControl: false
}).setView([3.848, 11.502], 13);

// GOOGLE SATELLITE HYBRID
L.tileLayer('https://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}', {
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
    maxZoom: 20
}).addTo(map);

let jobsLayer = L.featureGroup().addTo(map);
let userCoords = null;
let routeControl = null;
let allJobs = [];
let userMarker = null;
let watchId = null;

auth.signInAnonymously();

// ===============================
// VOICE NAVIGATION
// ===============================
function speak(text) {
    const msg = new SpeechSynthesisUtterance(text);
    msg.lang = 'fr-FR';
    msg.rate = 1;
    speechSynthesis.cancel();
    speechSynthesis.speak(msg);
}

// ===============================
// LIVE GPS
// ===============================
function locateMe() {
    if (watchId) navigator.geolocation.clearWatch(watchId);

    watchId = navigator.geolocation.watchPosition(pos => {
        userCoords = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude
        };

        if (userMarker) {
            map.removeLayer(userMarker);
        }

        userMarker = L.circleMarker([userCoords.lat, userCoords.lng], {
            radius: 10,
            color: '#fff',
            weight: 3,
            fillColor: '#007AFF',
            fillOpacity: 1
        }).addTo(map);

        map.flyTo([userCoords.lat, userCoords.lng], 15);

        syncJobs();

    }, err => {
        console.log(err);
        syncJobs();
    }, {
        enableHighAccuracy: true,
        maximumAge: 0
    });
}

// ===============================
// DISTANCE
// ===============================
function calcDist(la1, lo1, la2, lo2) {
    const R = 6371;
    const dLat = (la2 - la1) * Math.PI / 180;
    const dLon = (lo2 - lo1) * Math.PI / 180;

    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(la1 * Math.PI / 180) *
        Math.cos(la2 * Math.PI / 180) *
        Math.sin(dLon / 2) ** 2;

    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

// ===============================
// JOBS SYNC
// ===============================
function syncJobs() {
    db.ref('jobs').on('value', snap => {
        allJobs = [];

        snap.forEach(child => {
            let j = child.val();

            let dist = userCoords
                ? calcDist(userCoords.lat, userCoords.lng, j.lat, j.lng)
                : 999;

            allJobs.push({
                ...j,
                id: child.key,
                dist
            });
        });

        allJobs.sort((a, b) => a.dist - b.dist);

        render(allJobs);
    });
}

// ===============================
// GOLDEN MARKERS
// ===============================
function render(jobs) {
    jobsLayer.clearLayers();

    jobs.forEach(j => {

        const icon = L.divIcon({
            html: `
                <div style="
                    width:28px;
                    height:28px;
                    background:linear-gradient(135deg,#FFD700,#FFA500,#FF4500);
                    border-radius:50% 50% 50% 0;
                    transform:rotate(-45deg);
                    border:3px solid white;
                    box-shadow:0 0 20px gold;
                "></div>
            `,
            className: '',
            iconSize: [28, 28],
            iconAnchor: [14, 28]
        });

        L.marker([j.lat, j.lng], {
            icon
        }).addTo(jobsLayer)
        .bindPopup(`
            <div>
                <b>${j.title}</b><br>
                <small>Par ${j.posterName || 'Utilisateur'}</small><br>
                <span style="color:green;font-weight:700">${j.price}</span><br>
                <small>${j.landmark || ''}</small><br>

                ${j.imageUrl ? `<img src="${j.imageUrl}" style="width:100%;border-radius:10px;margin-top:8px;">` : ''}

                <a href="https://wa.me/${j.phone}?text=${encodeURIComponent("Bonjour, j’ai vu votre offre sur JobMarket et je suis intéressé.")}"
                   target="_blank"
                   style="display:block;background:#25D366;color:white;padding:10px;text-align:center;border-radius:8px;margin-top:8px;font-weight:700;">
                   WhatsApp
                </a>

                <a href="tel:${j.phone}"
                   style="display:block;background:#007AFF;color:white;padding:10px;text-align:center;border-radius:8px;margin-top:5px;font-weight:700;">
                   Appeler
                </a>

                <div style="text-align:center;color:gold;margin-top:8px;font-size:18px;">
                    ${'★'.repeat(Math.round(j.ratingAvg || 5))}
                </div>

                <button onclick="drawRoute(${j.lat},${j.lng})"
                    style="width:100%;background:red;color:white;padding:10px;border:none;border-radius:8px;margin-top:8px;font-weight:700;">
                    Itinéraire Vocal
                </button>

                ${(auth.currentUser && (auth.currentUser.uid === j.user || auth.currentUser.uid === ADMIN_UID)) ? `
                    <button onclick="deleteJob('${j.id}')"
                        style="width:100%;background:black;color:white;padding:10px;border:none;border-radius:8px;margin-top:5px;">
                        Supprimer
                    </button>
                ` : ''}
            </div>
        `);
    });

    updateJobsList(jobs);
}

// ===============================
// CLOUDINARY IMAGE UPLOAD
// ===============================
async function uploadImageToCloudinary(file) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

    const response = await fetch(
        `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
        {
            method: "POST",
            body: formData
        }
    );

    const data = await response.json();
    return data.secure_url;
}

// ===============================
// ADD JOB
// ===============================
async function addJob() {
    if (!auth.currentUser) {
        alert("Veuillez vous connecter.");
        return;
    }

    const cat = document.getElementById('category').value.split('|');

    navigator.geolocation.getCurrentPosition(async pos => {

        let imageUrl = "";

        const imageInput = document.getElementById("jobImage");
        if (imageInput && imageInput.files.length > 0) {
            imageUrl = await uploadImageToCloudinary(imageInput.files[0]);
        }

        db.ref('jobs').push().set({
            posterName: posterName.value,
            title: title.value,
            price: price.value,
            phone: phone.value,
            landmark: landmark.value,
            desc: desc.value,
            icon: cat[0],
            color: cat[1],
            imageUrl,
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            user: auth.currentUser.uid,
            verified: false,
            ratingAvg: 5,
            timestamp: Date.now()
        });

        alert("Job bien publié. Félicitations.");
        toggleForm();
    });
}

// ===============================
// DELETE JOB
// ===============================
function deleteJob(id) {
    if (confirm("Supprimer ce job ?")) {
        db.ref('jobs/' + id).remove();
    }
}

// ===============================
// ADMIN DASHBOARD
// ===============================
function openAdminDashboard() {
    if (!auth.currentUser || auth.currentUser.uid !== ADMIN_UID) {
        alert("Accès administrateur refusé.");
        return;
    }

    db.ref('jobs').once('value').then(snapshot => {
        let totalJobs = snapshot.numChildren();

        alert(`
Admin Dashboard:
Jobs totaux : ${totalJobs}
Utilisateurs vérifiés : système évolutif
Sécurité : Active
        `);
    });
}

// VERIFY USER
function verifyUser(userId) {
    if (auth.currentUser.uid !== ADMIN_UID) return;

    db.ref('users/' + userId + '/verified').set(true);
}

// ===============================
// ROUTE + VOICE
// ===============================
function drawRoute(lat, lng) {
    if (!userCoords) {
        alert("Activez votre GPS.");
        return;
    }

    if (routeControl) {
        map.removeControl(routeControl);
    }

    routeControl = L.Routing.control({
        waypoints: [
            L.latLng(userCoords.lat, userCoords.lng),
            L.latLng(lat, lng)
        ],
        routeWhileDragging: false,
        addWaypoints: false,
        createMarker: () => null,
        lineOptions: {
            styles: [{
                color: 'red',
                weight: 6
            }]
        }
    }).on('routesfound', e => {

        const route = e.routes[0];

        document.getElementById('itineraryPanel').classList.remove('hidden');
        document.getElementById('itineraryDistance').innerText =
            (route.summary.totalDistance / 1000).toFixed(1) + ' km';

        if (route.instructions.length) {
            let next = route.instructions[0].text;
            document.getElementById('itineraryDirection').innerText = next;
            speak(next);
        }

    }).addTo(map);
}

// ===============================
// JOB LIST
// ===============================
function updateJobsList(jobs) {
    const list = document.getElementById('listContent');

    list.innerHTML = jobs.map(j => `
        <div style="background:white;padding:15px;border-radius:15px;margin-bottom:12px;">
            <b>${j.title}</b><br>
            <small>${j.posterName || ''}</small><br>
            <small>${j.dist.toFixed(1)} km</small><br>
            <b style="color:green">${j.price}</b>
        </div>
    `).join('');
}

// ===============================
// AUTH
// ===============================
function signupEmail() {
    auth.createUserWithEmailAndPassword(email.value, password.value)
        .then(res => welcomeUser(res.user, true))
        .catch(e => alert(e.message));
}

function loginEmail() {
    auth.signInWithEmailAndPassword(email.value, password.value)
        .then(res => welcomeUser(res.user, false))
        .catch(e => alert(e.message));
}

function loginGoogle() {
    const provider = new firebase.auth.GoogleAuthProvider();

    auth.signInWithPopup(provider)
        .then(res => welcomeUser(res.user, false))
        .catch(e => alert(e.message));
}

// ===============================
// USER WELCOME
// ===============================
function welcomeUser(user, isNew) {
    const name = user.displayName || user.email;

    alert(
        isNew
            ? `Bienvenue dans JobMarket, ${name}. Vos espérances deviennent réalité.`
            : `Bon retour sur JobMarket, ${name}.`
    );

    const avatar = document.getElementById('userAvatar');

    if (avatar) {
        avatar.innerText = name.substring(0, 2).toUpperCase();
        avatar.classList.remove('hidden');
    }
}

// ===============================
// UI CONTROLS
// ===============================
function toggleForm() {
    formBox.classList.toggle('hidden');
}

function showList() {
    jobsList.classList.remove('hidden');
    accountPage.classList.add('hidden');
}

function showMap() {
    jobsList.classList.add('hidden');
    accountPage.classList.add('hidden');
    formBox.classList.add('hidden');
}

function openAccount() {
    accountPage.classList.remove('hidden');
    jobsList.classList.add('hidden');
}

// ===============================
// FILTERS
// ===============================
function filterJobs(cat) {
    if (cat === 'all') {
        render(allJobs);
    } else {
        render(allJobs.filter(j => j.icon === cat));
    }
}

// ===============================
// INIT
// ===============================
locateMe();
syncJobs();
