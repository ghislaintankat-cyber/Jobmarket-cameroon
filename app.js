// 🔥 FIREBASE CONFIG (remplace si besoin)
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "jobmarketfuture.firebaseapp.com",
  databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com",
};

firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.database();

// 🗺️ MAP
let map = L.map('map').setView([3.8,11.5],6);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

let userMarker;

navigator.geolocation.watchPosition(pos=>{
  let lat = pos.coords.latitude;
  let lng = pos.coords.longitude;

  if(userMarker) map.removeLayer(userMarker);

  userMarker = L.circle([lat,lng],{radius:20,color:'blue'}).addTo(map);
});

// 🔥 LOAD JOBS
db.ref("jobs").on("value",snap=>{

  let data = snap.val();
  if(!data) return;

  document.getElementById("jobsScreen").innerHTML="";

  Object.entries(data).forEach(([id,job])=>{

    let marker = L.marker([job.lat,job.lng]).addTo(map);

    marker.bindPopup(`
    <b>${job.title}</b><br>
    ⭐ ${job.rating || 0}<br>
    <img src="${job.image || ''}" width="100"><br>

    <button onclick="route(${job.lat},${job.lng})">Itinéraire</button>

    <br>
    <a href="https://wa.me/${job.phone}">WhatsApp</a>
    <a href="tel:${job.phone}">Appeler</a>

    <br>
    <button onclick="deleteJob('${id}')">Supprimer</button>
    `);

    // LIST
    document.getElementById("jobsScreen").innerHTML += `
      <div class="job-card">
      <b>${job.title}</b><br>
      ⭐ ${job.rating || 0}
      </div>
    `;
  });

});

// ➕ ADD JOB
function addJob(){

let title = prompt("Service ?");
let phone = prompt("Téléphone ?");
let image = prompt("Image URL ?");

navigator.geolocation.getCurrentPosition(pos=>{

db.ref("jobs").push({
title,
phone,
image,
lat:pos.coords.latitude,
lng:pos.coords.longitude,
rating:0,
created:Date.now()
});

});

}

// 📍 ROUTE
function route(lat,lng){

navigator.geolocation.getCurrentPosition(pos=>{

let d = distance(
pos.coords.latitude,
pos.coords.longitude,
lat,lng
);

document.getElementById("distance").innerText = d.toFixed(2);

});

}

// 📏 DISTANCE
function distance(lat1,lon1,lat2,lon2){

let R=6371;
let dLat=(lat2-lat1)*Math.PI/180;
let dLon=(lon2-lon1)*Math.PI/180;

let a=Math.sin(dLat/2)*Math.sin(dLat/2)+
Math.cos(lat1*Math.PI/180)*
Math.cos(lat2*Math.PI/180)*
Math.sin(dLon/2)*Math.sin(dLon/2);

return R*(2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a)));
}

// 🔐 AUTH
function register(){
auth.createUserWithEmailAndPassword(
email.value,
password.value
);
}

function login(){
auth.signInWithEmailAndPassword(
email.value,
password.value
);
}

function googleLogin(){
let provider = new firebase.auth.GoogleAuthProvider();
auth.signInWithPopup(provider);
}

auth.onAuthStateChanged(user=>{
if(user){
userBox.innerText = user.email;
}
});

// 👮 ADMIN
let isAdmin=false;

function adminMode(){
if(adminCode.value === "237BO"){
isAdmin=true;
alert("Admin activé");
}
}

function deleteJob(id){
if(!isAdmin) return alert("Non autorisé");
db.ref("jobs/"+id).remove();
}

// NAV
function showScreen(s){

map.style.display="none";
jobsScreen.classList.add("hidden");
accountScreen.classList.add("hidden");

if(s==="map") map.style.display="block";
if(s==="jobs") jobsScreen.classList.remove("hidden");
if(s==="account") accountScreen.classList.remove("hidden");

    }
