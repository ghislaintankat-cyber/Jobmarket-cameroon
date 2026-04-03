import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, onValue, push, update, remove } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { getAuth, signInWithPopup, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// CONFIG FIREBASE
const firebaseConfig = {
  apiKey: "AIza...",
  databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// AUTH
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

let currentUser = null;
let isAdmin = false;

// LOGIN
window.login = async ()=>{
  const result = await signInWithPopup(auth, provider);
  currentUser = result.user;
  alert("Connecté : " + currentUser.email);
};

// ADMIN
window.adminAccess = ()=>{
  const code = prompt("Code admin");
  if(code === "237BO"){
    isAdmin = true;
    alert("Admin activé");
  }
};

// MAP
const map = L.map('map').setView([3.8, 11.5], 6);

// SATELLITE + LABELS
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}').addTo(map);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{opacity:0.4}).addTo(map);

// CLUSTER
const markers = L.markerClusterGroup();
map.addLayer(markers);

let jobsArray = [];
let currentFilter = "all";
let userLat=null,userLng=null;

// GPS
navigator.geolocation.watchPosition(pos=>{
  userLat = pos.coords.latitude;
  userLng = pos.coords.longitude;
});

// LOAD JOBS
onValue(ref(db,'jobs'), snap=>{
  const data = snap.val();
  if(!data) return;

  jobsArray = Object.entries(data).map(([id,val])=>({id,...val}));

  displayJobs();
});

// DISPLAY
function displayJobs(){

  markers.clearLayers();
  const panel = document.getElementById("jobsPanel");
  panel.innerHTML = "";

  jobsArray.sort((a,b)=> b.boosted - a.boosted);

  jobsArray.forEach(job=>{

    if(currentFilter !== "all" && !job.title.toLowerCase().includes(currentFilter)) return;

    const marker = L.marker([job.lat, job.lng]);

    marker.bindPopup(`
      <b>${job.title}</b><br>
      ⭐ ${job.rating || 4.5}<br>
      <button onclick="call('${job.phone}')">📞</button>
      <button onclick="whatsapp('${job.phone}')">💬</button>
      <button onclick="boost('${job.id}')">Booster</button>
      ${isAdmin ? `<button onclick="deleteJob('${job.id}')">❌</button>` : ''}
    `);

    markers.addLayer(marker);

    panel.innerHTML += `
    <div class="job-card">
      <b>${job.title}</b><br>
      ⭐ ${job.rating || 4.5}
    </div>`;
  });
}

// FILTER
window.filterJobs = (f)=>{
  currentFilter = f;
  displayJobs();
};

// PANEL
window.showJobs = ()=> document.getElementById("jobsPanel").classList.add("show");
window.showMap = ()=> document.getElementById("jobsPanel").classList.remove("show");

// CREATE JOB
window.createJob = ()=>{
  const title = prompt("Titre");

  navigator.geolocation.getCurrentPosition(pos=>{
    push(ref(db,'jobs'), {
      title,
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      boosted:false,
      user: currentUser?.uid || "anon",
      phone:"690000000"
    });
  });
};

// DELETE
window.deleteJob = (id)=>{
  remove(ref(db,'jobs/'+id));
};

// CONTACT
window.call = (p)=> window.location.href="tel:"+p;
window.whatsapp = (p)=> window.open("https://wa.me/237"+p);

// BOOST
window.boost = async (id)=>{
  const res = await fetch("https://TON_BACKEND/pay",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({jobId:id,amount:500,email:"test@mail.com"})
  });

  const data = await res.json();
  window.location.href = data.link;
};
