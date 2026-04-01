import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, onValue, push } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSy...",
  databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

/* LOGIN */
signInAnonymously(auth);

/* MAP */
const map = L.map('map').setView([3.8, 11.5], 6);

L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}').addTo(map);

const markers = L.markerClusterGroup();
map.addLayer(markers);

/* POSITION */
let userLat, userLng;

navigator.geolocation.getCurrentPosition(pos => {
  userLat = pos.coords.latitude;
  userLng = pos.coords.longitude;

  map.setView([userLat, userLng], 12);
});

/* LOAD JOBS */
onValue(ref(db,'jobs'), snap=>{
  displayJobs(snap.val() || {});
  document.getElementById("loader").style.display = "none";
});

/* DISTANCE */
function distance(a,b,c,d){
  const R = 6371;
  const dLat = (c-a)*Math.PI/180;
  const dLon = (d-b)*Math.PI/180;

  const x =
    Math.sin(dLat/2)**2 +
    Math.cos(a*Math.PI/180) *
    Math.cos(c*Math.PI/180) *
    Math.sin(dLon/2)**2;

  return R * 2 * Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
}

/* DISPLAY */
function displayJobs(jobs){

  markers.clearLayers();

  Object.values(jobs).forEach(job=>{

    const marker = L.marker([job.lat, job.lng]);

    marker.on("click", ()=>openModal(job));

    markers.addLayer(marker);
  });

}

/* MODAL */
function openModal(job){

  document.getElementById("jobTitle").innerText = job.title;
  document.getElementById("jobDesc").innerText = job.description;

  document.getElementById("jobModal").style.display = "block";

}

/* CLOSE */
document.getElementById("closeModal").onclick = ()=>{
  document.getElementById("jobModal").style.display = "none";
};

/* CREATE JOB (PROXY BACKEND) */
window.createJob = async ()=>{

  const title = prompt("Titre");
  const desc = prompt("Description");
  const phone = prompt("Téléphone");

  navigator.geolocation.getCurrentPosition(async pos=>{

    await fetch("https://TON-SERVER/create-job", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({
        title,
        description: desc,
        phone,
        lat: pos.coords.latitude,
        lng: pos.coords.longitude
      })
    });

  });

};

/* GO TO USER */
window.goToUser = ()=>{
  if(userLat) map.flyTo([userLat,userLng],15);
};
