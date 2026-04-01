import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, onValue, push } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSy...",
  databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const map = L.map('map').setView([3.8, 11.5], 6);

/* SATELLITE */
L.tileLayer(
'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
).addTo(map);

L.tileLayer(
'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'
).addTo(map);

/* CLUSTER */
const markers = L.markerClusterGroup();
map.addLayer(markers);

let userLat, userLng;
let jobsData = {};
let currentFilter = "all";

/* USER LOCATION */
navigator.geolocation.getCurrentPosition(pos => {
  userLat = pos.coords.latitude;
  userLng = pos.coords.longitude;

  L.circleMarker([userLat, userLng]).addTo(map);
  map.setView([userLat, userLng], 12);
});

/* DISTANCE */
function distance(a, b, c, d) {
  const R = 6371;
  const dLat = (c-a) * Math.PI/180;
  const dLon = (d-b) * Math.PI/180;

  const x =
    Math.sin(dLat/2)**2 +
    Math.cos(a*Math.PI/180) *
    Math.cos(c*Math.PI/180) *
    Math.sin(dLon/2)**2;

  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
}

/* LOAD DATA */
onValue(ref(db,'jobs'), snap => {
  jobsData = snap.val() || {};
  applyFilters();
  document.getElementById("loader").style.display = "none";
});

/* FILTER */
window.filterJobs = (e,type) => {
  currentFilter = type;

  document.querySelectorAll(".filter").forEach(f=>f.classList.remove("active"));
  e.target.classList.add("active");

  applyFilters();
};

/* SEARCH */
document.getElementById("search").addEventListener("input", e=>{
  applyFilters(e.target.value.toLowerCase());
});

/* APPLY FILTER */
function applyFilters(search="") {

  let jobs = Object.values(jobsData);

  if(currentFilter !== "all"){
    jobs = jobs.filter(j => j.title.toLowerCase().includes(currentFilter));
  }

  if(search){
    jobs = jobs.filter(j => j.title.toLowerCase().includes(search));
  }

  if(userLat){
    jobs.sort((a,b)=>
      distance(userLat,userLng,a.lat,a.lng) -
      distance(userLat,userLng,b.lat,b.lng)
    );
  }

  displayJobs(jobs);
}

/* DISPLAY */
function displayJobs(jobs){

  markers.clearLayers();

  jobs.forEach(job=>{

    const dist = userLat
      ? distance(userLat,userLng,job.lat,job.lng).toFixed(1)
      : "?";

    const marker = L.marker([job.lat,job.lng]);

    marker.on("click", ()=> openModal(job, dist));

    markers.addLayer(marker);
  });
}

/* MODAL */
function openModal(job,dist){

  document.getElementById("jobTitle").innerText = job.title;
  document.getElementById("jobDesc").innerText = job.description;
  document.getElementById("jobDistance").innerText = dist + " km";

  document.getElementById("callBtn").href = "tel:"+job.phone;

  document.getElementById("waBtn").href =
    "https://wa.me/237"+job.phone;

  document.getElementById("jobPhoto").src =
    job.photo || "https://via.placeholder.com/300";

  document.getElementById("jobRating").innerText =
    "⭐ " + (job.rating || "4.5");

  document.getElementById("jobModal").style.display = "block";
}

/* CLOSE */
document.getElementById("closeModal").onclick = () => {
  document.getElementById("jobModal").style.display = "none";
};

/* CREATE */
window.createJob = () => {

  const title = prompt("Titre");
  const desc = prompt("Description");
  const phone = prompt("Téléphone");

  if(!title || !desc || !phone) return;

  navigator.geolocation.getCurrentPosition(pos=>{

    push(ref(db,'jobs'),{
      title,
      description: desc,
      phone,
      lat: pos.coords.latitude,
      lng: pos.coords.longitude
    });

  });

};

/* CENTER USER */
window.goToUser = () => {
  if(userLat) map.flyTo([userLat,userLng],15);
};
