// =============================
// FIREBASE CONFIG
// =============================
const firebaseConfig = {
    apiKey: "AIzaSyCR1Z6VlS5A7iPbUCoVm0AQcnkkUdsA0CE",
    authDomain: "jobmarketfuture.firebaseapp.com",
    databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com",
    projectId: "jobmarketfuture",
    storageBucket: "jobmarketfuture.appspot.com",
    messagingSenderId: "123456789",
    appId: "1:123456789:web:jobmarketpro"
};

firebase.initializeApp(firebaseConfig);

const db = firebase.database();
const auth = firebase.auth();
const ADMIN_UID = "GrajEM98vOc1w3FUr9XeTN90rfl2";

// =============================
// CLOUDINARY CONFIG
// =============================
const CLOUDINARY_CLOUD_NAME = "dvoab3mzb";
const CLOUDINARY_UPLOAD_PRESET = "job_preset";

// =============================
// GLOBAL STATE
// =============================
let userCoords = null;
let routeControl = null;
let allJobs = [];
let userMarker = null;
let gpsWatch = null;
let voiceEnabled = true;

// =============================
// MAP INIT
// =============================
const map = L.map('map', {
    zoomControl: false,
    minZoom: 5
}).setView([3.848, 11.502], 13);

L.tileLayer('https://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}', {
    maxZoom: 20,
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
}).addTo(map);

L.control.zoom({ position: 'bottomright' }).addTo(map);

const jobsLayer = L.featureGroup().addTo(map);

// =============================
// AUTH INIT
// =============================
auth.signInAnonymously().catch(console.error);

auth.onAuthStateChanged(user => {
    if (user) {
        updateUserAvatar(user);
    }
});

// =============================
// GPS LIVE LOCATION
// =============================
function locateMe() {
    if (!navigator.geolocation) {
        alert("GPS non supporté");
        return;
    }

    if (gpsWatch) navigator.geolocation.clearWatch(gpsWatch);

    gpsWatch = navigator.geolocation.watchPosition(position => {
        userCoords = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
        };

        if (userMarker) map.removeLayer(userMarker);

        userMarker = L.circleMarker([userCoords.lat, userCoords.lng], {
            radius: 10,
            color: '#ffffff',
            weight: 3,
            fillColor: '#007AFF',
            fillOpacity: 1
        }).addTo(map);

        map.setView([userCoords.lat, userCoords.lng], map.getZoom(), {
            animate: true
        });

        syncJobs();
    }, error => {
        console.error(error);
        syncJobs();
    }, {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 10000
    });
}

// =============================
// JOB SYNC
// =============================
function syncJobs() {
    db.ref('jobs').on('value', snapshot => {
        allJobs = [];

        snapshot.forEach(child => {
            const job = child.val();
            const dist = userCoords
                ? calcDist(userCoords.lat, userCoords.lng, job.lat, job.lng)
                : 999;

            allJobs.push({
                ...job,
                id: child.key,
                dist
            });
        });

        allJobs.sort((a, b) => a.dist - b.dist);
        renderJobs(allJobs);
    });
}

// =============================
// PREMIUM MARKERS
// =============================
function createPremiumMarker(job) {
    return L.divIcon({
        className: '',
        html: `
        <div style="
            width:28px;
            height:28px;
            border-radius:50% 50% 50% 0;
            transform:rotate(-45deg);
            background:linear-gradient(135deg,#FFD700,#FFA500,#FF5E00);
            border:3px solid white;
            box-shadow:0 4px 15px rgba(0,0,0,0.45);
            display:flex;
            align-items:center;
            justify-content:center;
        ">
            <span style="
                transform:rotate(45deg);
                font-size:12px;
                color:white;
                font-weight:bold;
            ">${job.icon || '💼'}</span>
        </div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 28]
    });
}

// =============================
// RENDER JOBS
// =============================
function renderJobs(jobs) {
    jobsLayer.clearLayers();

    jobs.forEach(job => {
        const marker = L.marker([job.lat, job.lng], {
            icon: createPremiumMarker(job)
        }).addTo(jobsLayer);

        marker.bindPopup(`
            <div style="min-width:220px">
                <b>${job.title}</b><br>
                <small>${job.landmark || ''}</small><br>
                <span style="color:green;font-weight:bold">${job.price}</span><br>
                <small>${job.dist.toFixed(1)} km</small>
                <div style="margin-top:8px;color:gold;text-align:center;">
                    ${'★'.repeat(Math.round(job.ratingAvg || 5))}
                </div>
                <a href="https://wa.me/${job.phone}?text=${encodeURIComponent('J’ai vu votre offre sur JobMarket et je suis intéressé.')}" target="_blank"
                   style="display:block;background:#25D366;color:white;padding:10px;border-radius:10px;text-align:center;margin-top:8px;text-decoration:none;">
                   WhatsApp
                </a>
                <a href="tel:${job.phone}"
                   style="display:block;background:#007AFF;color:white;padding:10px;border-radius:10px;text-align:center;margin-top:6px;text-decoration:none;">
                   Appeler
                </a>
                <button onclick="drawRoute(${job.lat},${job.lng})"
                   style="width:100%;background:red;color:white;padding:10px;border:none;border-radius:10px;margin-top:6px;">
                   Itinéraire Vocal
                </button>
                ${(auth.currentUser && (auth.currentUser.uid === job.user || auth.currentUser.uid === ADMIN_UID))
                    ? `<button onclick="deleteJob('${job.id}')"
                       style="width:100%;background:#111;color:white;padding:10px;border:none;border-radius:10px;margin-top:6px;">
                       Supprimer
                       </button>`
                    : ''}
            </div>
        `);
    });

    updateJobsList(jobs);
}

// =============================
// ADD JOB
// =============================
async function addJob() {
    if (!auth.currentUser || auth.currentUser.isAnonymous) {
        alert("Connectez-vous pour publier.");
        return;
    }

    const title = document.getElementById('title').value.trim();
    const price = document.getElementById('price').value.trim();
    const phone = document.getElementById('phone').value.trim();
    const landmark = document.getElementById('landmark').value.trim();
    const desc = document.getElementById('desc').value.trim();
    const category = document.getElementById('category').value.split('|');

    if (!title || !price || !phone) {
        alert("Remplissez les champs obligatoires.");
        return;
    }

    navigator.geolocation.getCurrentPosition(async pos => {
        const jobData = {
            title,
            price,
            phone,
            landmark,
            desc,
            icon: category[0],
            color: category[1],
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            user: auth.currentUser.uid,
            userName: auth.currentUser.displayName || auth.currentUser.email,
            verified: !!auth.currentUser.emailVerified,
            ratingAvg: 5,
            timestamp: Date.now()
        };

        await db.ref('jobs').push(jobData);

        alert("Job bien publié. Félicitations !");
        toggleForm();
        clearForm();
    });
}

function clearForm() {
    ['title', 'price', 'phone', 'landmark', 'desc'].forEach(id => {
        document.getElementById(id).value = '';
    });
}

// =============================
// DELETE JOB
// =============================
function deleteJob(jobId) {
    if (confirm("Supprimer ce job ?")) {
        db.ref('jobs/' + jobId).remove();
    }
}

// =============================
// ROUTING + VOICE
// =============================
function drawRoute(lat, lng) {
    if (!userCoords) {
        alert("Activez votre GPS");
        return;
    }

    if (routeControl) map.removeControl(routeControl);

    routeControl = L.Routing.control({
        waypoints: [
            L.latLng(userCoords.lat, userCoords.lng),
            L.latLng(lat, lng)
        ],
        routeWhileDragging: false,
        addWaypoints: false,
        draggableWaypoints: false,
        fitSelectedRoutes: true,
        createMarker: () => null,
        lineOptions: {
            styles: [{ color: 'red', weight: 6 }]
        }
    }).addTo(map);

    routeControl.on('routesfound', e => {
        const route = e.routes[0];
        speakDirections(route.instructions);
    });
}

function speakDirections(instructions) {
    if (!voiceEnabled || !('speechSynthesis' in window)) return;

    instructions.forEach((step, index) => {
        setTimeout(() => {
            const utterance = new SpeechSynthesisUtterance(step.text);
            utterance.lang = 'fr-FR';
            speechSynthesis.speak(utterance);
        }, index * 4000);
    });
}

// =============================
// JOB LIST
// =============================
function updateJobsList(jobs) {
    const list = document.getElementById('listContent');

    list.innerHTML = jobs.map(job => `
        <div style="background:white;padding:15px;border-radius:16px;margin-bottom:12px;box-shadow:0 4px 12px rgba(0,0,0,0.08)">
            <b>${job.title}</b><br>
            <small>${job.landmark || ''}</small><br>
            <small>${job.dist.toFixed(1)} km</small><br>
            <span style="color:green;font-weight:bold">${job.price}</span>
            <a href="https://wa.me/${job.phone}?text=${encodeURIComponent('J’ai vu votre offre sur JobMarket et je suis intéressé.')}"
               style="display:block;background:#25D366;color:white;padding:8px;border-radius:10px;text-align:center;margin-top:8px;text-decoration:none;">
               WhatsApp
            </a>
        </div>
    `).join('');
}

// =============================
// AUTH FUNCTIONS
// =============================
function loginEmail() {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    auth.signInWithEmailAndPassword(email, password)
        .then(res => {
            alert(`Bienvenue sur JobMarket, ${res.user.email}`);
        })
        .catch(err => {
            if (err.code === 'auth/user-not-found') {
                auth.createUserWithEmailAndPassword(email, password)
                    .then(res => {
                        alert(`Compte créé avec succès : ${res.user.email}`);
                    });
            } else {
                alert(err.message);
            }
        });
}

function loginGoogle() {
    const provider = new firebase.auth.GoogleAuthProvider();

    auth.signInWithPopup(provider)
        .then(res => {
            alert(`Bienvenue sur JobMarket, ${res.user.displayName}`);
        })
        .catch(err => alert(err.message));
}

function updateUserAvatar(user) {
    const avatar = document.getElementById('userAvatar');
    if (!avatar) return;

    const initials = (user.displayName || user.email || 'U')
        .split(' ')
        .map(x => x[0])
        .join('')
        .substring(0, 2)
        .toUpperCase();

    avatar.innerHTML = initials;
}

// =============================
// UI CONTROLS
// =============================
function toggleForm() {
    document.getElementById('formBox').classList.toggle('hidden');
}

function showList() {
    document.getElementById('jobsList').classList.remove('hidden');
}

function showMap() {
    document.getElementById('jobsList').classList.add('hidden');
    document.getElementById('accountPage').classList.add('hidden');
}

function openAccount() {
    document.getElementById('accountPage').classList.remove('hidden');
}

function filterJobs(category) {
    if (category === 'all') return renderJobs(allJobs);
    renderJobs(allJobs.filter(job => job.icon === category));
}

// =============================
// DISTANCE CALC
// =============================
function calcDist(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;

    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) *
        Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) ** 2;

    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

// =============================
// START APP
// =============================
locateMe();
syncJobs();
