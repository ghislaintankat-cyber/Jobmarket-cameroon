const firebaseConfig = {
  apiKey: "AIzaSyCR1Z6VlS5A7iPbUCoVm0AQcnkkUdsA0CE",
  authDomain: "jobmarketfuture.firebaseapp.com",
  databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com",
  projectId: "jobmarketfuture",
  storageBucket: "jobmarketfuture.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:jobmarketcameroon"
};

firebase.initializeApp(firebaseConfig);
firebase.analytics();

const db = firebase.database();
const auth = firebase.auth();
const messaging = firebase.messaging();

const CLOUDINARY_CLOUD_NAME = "dvoab3mzb";
const CLOUDINARY_UPLOAD_PRESET = "job_preset";
const ADMIN_UID = "GrajEM98vOc1w3FUr9XeTN90rfl2";

let currentUser = null;
let userCoords = null;
let allJobs = [];
let userMarker = null;
let accuracyCircle = null;
let routeControl = null;

const map = L.map('map', {
  zoomControl: false,
  maxZoom: 20
}).setView([3.848, 11.502], 13);

L.control.zoom({ position: 'bottomright' }).addTo(map);

L.tileLayer('https://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}', {
  subdomains:['mt0','mt1','mt2','mt3'],
  maxZoom:20
}).addTo(map);

const jobsLayer = L.featureGroup().addTo(map);

auth.onAuthStateChanged(user => {
  currentUser = user;
  if (user) updateAccountUI(user);
});

auth.signInAnonymously().catch(console.error);

function signupEmail() {
  auth.createUserWithEmailAndPassword(email.value, password.value)
    .then(res => {
      res.user.sendEmailVerification();
      alert(`Bienvenue ${res.user.email}. Vérifiez votre email.`);
    })
    .catch(err => alert(err.message));
}

function loginEmail() {
  auth.signInWithEmailAndPassword(email.value, password.value)
    .then(res => alert(`Bon retour ${res.user.email}`))
    .catch(err => alert(err.message));
}

function loginGoogle() {
  const provider = new firebase.auth.GoogleAuthProvider();
  auth.signInWithPopup(provider)
    .then(res => alert(`Bienvenue ${res.user.displayName}`))
    .catch(err => alert(err.message));
}

function logout() {
  auth.signOut();
}

function updateAccountUI(user) {
  const avatar = document.getElementById('userAvatar');
  if (!avatar) return;
  const name = user.displayName || user.email || 'JM';
  avatar.innerText = name.split(' ').map(v => v[0]).join('').substring(0,2).toUpperCase();
}

function locateMe() {
  navigator.geolocation.getCurrentPosition(pos => {
    updateUserLocation(pos);
    navigator.geolocation.watchPosition(updateUserLocation, console.error, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 15000
    });
    syncJobs();
  }, () => syncJobs(), {
    enableHighAccuracy: true,
    timeout: 20000,
    maximumAge: 0
  });
}

function updateUserLocation(position) {
  userCoords = {
    lat: position.coords.latitude,
    lng: position.coords.longitude
  };

  if (userMarker) map.removeLayer(userMarker);
  if (accuracyCircle) map.removeLayer(accuracyCircle);

  accuracyCircle = L.circle([userCoords.lat, userCoords.lng], {
    radius: position.coords.accuracy,
    color: '#007AFF',
    fillColor: '#007AFF',
    fillOpacity: 0.12
  }).addTo(map);

  userMarker = L.circleMarker([userCoords.lat, userCoords.lng], {
    radius: 10,
    color: '#fff',
    weight: 3,
    fillColor: '#007AFF',
    fillOpacity: 1
  }).addTo(map);

  map.setView([userCoords.lat, userCoords.lng], map.getZoom());
}

async function addJob() {
  if (!currentUser || currentUser.isAnonymous) {
    alert("Connectez-vous pour publier un job");
    return;
  }

  if (!currentUser.emailVerified && currentUser.email) {
    alert("Veuillez vérifier votre email.");
    return;
  }

  const publishBtn = document.getElementById("publishBtn");
  if (publishBtn) publishBtn.innerText = "Publication...";

  navigator.geolocation.getCurrentPosition(async pos => {
    try {
      const uploadedImages = [];
      const files = document.getElementById("jobImages")?.files || document.getElementById("jobImage")?.files || [];

      for (const file of files) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

        const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, {
          method: "POST",
          body: formData
        });

        const data = await res.json();
        if (data.secure_url) uploadedImages.push(data.secure_url);
      }

      const cat = document.getElementById("category").value.split('|');

      const jobData = {
        title: document.getElementById("title").value,
        price: document.getElementById("price").value,
        phone: document.getElementById("phone").value,
        landmark: document.getElementById("landmark").value,
        desc: document.getElementById("desc").value,
        icon: cat[0],
        color: cat[1],
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        images: uploadedImages,
        image: uploadedImages[0] || "",
        user: currentUser.uid,
        userName: currentUser.displayName || currentUser.email,
        verified: true,
        ratingAvg: 5,
        timestamp: Date.now(),
        country: "Cameroon",
        currency: "XAF"
      };

      await db.ref("jobs").push(jobData);
      alert("Job publié avec succès");
      resetJobForm();
      toggleForm();
      syncJobs();
    } catch (error) {
      console.error(error);
      alert("Erreur lors de la publication");
    }

    if (publishBtn) publishBtn.innerText = "Publier maintenant";
  }, () => {
    alert("GPS requis pour publier");
    if (publishBtn) publishBtn.innerText = "Publier maintenant";
  }, {
    enableHighAccuracy: true,
    timeout: 20000,
    maximumAge: 0
  });
}

function syncJobs() {
  db.ref("jobs").on("value", snap => {
    allJobs = [];
    jobsLayer.clearLayers();

    snap.forEach(child => {
      const job = child.val();
      const jobId = child.key;
      const dist = userCoords ? calcDist(userCoords.lat, userCoords.lng, job.lat, job.lng) : 999;
      allJobs.push({ ...job, id: jobId, dist });

      L.marker([job.lat, job.lng]).addTo(jobsLayer)
        .bindPopup(`
          <div style="min-width:230px">
            <b>${job.title}</b><br>
            <span style="color:green;font-weight:bold">${job.price}</span><br>
            <small>${job.landmark || ''}</small><br>
            ${job.images?.length ? job.images.map(img => `<img src="${img}" style="width:100%;margin-top:6px;border-radius:8px;">`).join('') : ''}
            <a href="https://wa.me/${job.phone}" target="_blank" style="display:block;background:#25D366;color:white;padding:10px;text-align:center;border-radius:10px;margin-top:8px;text-decoration:none;">WhatsApp</a>
            <button onclick="drawRoute(${job.lat},${job.lng})" style="width:100%;background:red;color:white;padding:10px;border:none;border-radius:10px;margin-top:8px;">Itinéraire</button>
          </div>
        `);
    });

    allJobs.sort((a,b) => a.dist - b.dist);
    updateJobsList(allJobs);
  });
}

function drawRoute(lat, lng) {
  if (!userCoords) return;

  if (routeControl) map.removeControl(routeControl);

  routeControl = L.Routing.control({
    waypoints: [
      L.latLng(userCoords.lat, userCoords.lng),
      L.latLng(lat, lng)
    ],
    routeWhileDragging: false,
    addWaypoints: false,
    createMarker: () => null,
    lineOptions: {
      styles: [{ color: 'red', weight: 6 }]
    }
  }).addTo(map);
}

function updateJobsList(jobs) {
  const list = document.getElementById("listContent");
  if (!list) return;

  list.innerHTML = jobs.map(job => `
    <div style="background:white;padding:15px;border-radius:16px;margin-bottom:12px;">
      <b>${job.title}</b><br>
      <small>${job.dist.toFixed(2)} km</small><br>
      <span style="color:green;font-weight:bold">${job.price}</span>
    </div>
  `).join('');
}

function resetJobForm() {
  ["title","price","phone","landmark","desc","jobImage","jobImages"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
}

function toggleForm(){ formBox.classList.toggle('hidden'); }
function showList(){ jobsList.classList.remove('hidden'); }
function showMap(){ jobsList.classList.add('hidden'); accountPage.classList.add('hidden'); }
function openAccount(){ accountPage.classList.remove('hidden'); }
function filterJobs(cat){ if(cat==='all') return updateJobsList(allJobs); updateJobsList(allJobs.filter(j=>j.icon===cat)); }

function calcDist(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2-lat1) * Math.PI/180;
  const dLon = (lon2-lon1) * Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

messaging.requestPermission()
.then(() => messaging.getToken())
.then(token => {
  if(currentUser) db.ref('notificationTokens/' + currentUser.uid).set(token);
})
.catch(console.error);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
}

locateMe();
syncJobs();
