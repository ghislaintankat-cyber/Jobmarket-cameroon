import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, onValue, push } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { getAuth, signInWithPopup, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

/* FIREBASE */
const firebaseConfig = {
  apiKey: "AIzaSyCR1Z6VlS5A7iPbUCoVm0AQcnkkUdsA0CE",
  authDomain: "jobmarketfuture.firebaseapp.com",
  databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com",
  projectId: "jobmarketfuture"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

let currentUser = null;

/* LOGIN */
window.login = async ()=>{
  const provider = new GoogleAuthProvider();
  const res = await signInWithPopup(auth, provider);
  currentUser = res.user;

  document.getElementById("userInfo").innerHTML = currentUser.email;
};

/* MAP */
const map = L.map('map').setView([3.8, 11.5], 6);

L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}').addTo(map);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{opacity:0.4}).addTo(map);

/* JOBS */
let jobs = [];

onValue(ref(db,'jobs'), snap=>{
  const data = snap.val();
  if(!data) return;

  jobs = Object.values(data);

  displayJobs();
  displayMap();
});

/* DISPLAY JOBS */
function displayJobs(){
  const div = document.getElementById("jobsScreen");

  div.innerHTML = jobs.map(job=>`
    <div class="job-card">
      <b>${job.title}</b><br>
      ⭐ ${job.rating || 4.5}<br>
      <button onclick="call('${job.phone}')">📞</button>
      <button onclick="whatsapp('${job.phone}')">💬</button>
    </div>
  `).join('');
}

/* DISPLAY MAP */
function displayMap(){
  jobs.forEach(job=>{
    L.marker([job.lat, job.lng])
    .addTo(map)
    .bindPopup(job.title);
  });
}

/* NAVIGATION */
window.showTab = (tab)=>{

  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));

  if(tab === 'jobs'){
    document.getElementById("jobsScreen").classList.add("active");
  }

  if(tab === 'account'){
    document.getElementById("accountScreen").classList.add("active");
    loadAccount();
  }
};

/* ACCOUNT */
function loadAccount(){
  const div = document.getElementById("accountScreen");

  div.innerHTML = `
    <h2>Compte</h2>

    <button onclick="login()">Connexion Google</button>

    <p>Que veux-tu faire ?</p>

    <button>🔎 Chercher du travail</button>
    <button>📢 Poster un travail</button>
  `;
}

/* CREATE JOB */
window.createJob = ()=>{
  const title = prompt("Titre du job");

  navigator.geolocation.getCurrentPosition(pos=>{
    push(ref(db,'jobs'), {
      title,
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      phone:"690000000"
    });
  });
};

/* CONTACT */
window.call = (p)=> location.href="tel:"+p;
window.whatsapp = (p)=> window.open("https://wa.me/237"+p);
