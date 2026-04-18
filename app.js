const firebaseConfig = {
  apiKey: "AIzaSyCR1Z6VlS5A7iPbUCoVm0AQcnkkUdsA0CE",
  authDomain: "jobmarketfuture.firebaseapp.com",
  databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com",
  projectId: "jobmarketfuture"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const auth = firebase.auth();

const ADMIN_UID = "TON_UID";
let currentUser;

auth.onAuthStateChanged(u=>currentUser=u);

// MAP
let map = L.map("map").setView([3.848,11.502],14);

L.tileLayer('https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',{
subdomains:['mt0','mt1','mt2','mt3']
}).addTo(map);

// GPS
let userMarker;
navigator.geolocation.watchPosition(pos=>{
let lat=pos.coords.latitude;
let lng=pos.coords.longitude;

if(userMarker){userMarker.setLatLng([lat,lng]);}
else{
userMarker=L.circleMarker([lat,lng],{radius:8,color:"blue"}).addTo(map);
userMarker._isUser=true;
}
});

// DISTANCE
function getDistance(a,b,c,d){
let R=6371;
let dLat=(c-a)*Math.PI/180;
let dLon=(d-b)*Math.PI/180;
let x=Math.sin(dLat/2)**2+
Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(dLon/2)**2;
return R*(2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x)));
}

// ADD JOB
function addJob(){

if(!currentUser)return alert("Login");

let [icon,color]=category.value.split("|");

navigator.geolocation.getCurrentPosition(pos=>{
let ref=db.ref("jobs").push();

ref.set({
id:ref.key,
icon,color,
title:title.value,
desc:desc.value,
price:price.value,
phone:phone.value,
lat:pos.coords.latitude,
lng:pos.coords.longitude,
user:currentUser.uid
});

});
}

// LOAD LIST
function showList(){

hideAll();
jobsList.classList.remove("hidden");

navigator.geolocation.getCurrentPosition(pos=>{

let uLat=pos.coords.latitude;
let uLng=pos.coords.longitude;

db.ref("jobs").once("value",snap=>{

let arr=[];

snap.forEach(d=>{
let j=d.val();
j.distance=getDistance(uLat,uLng,j.lat,j.lng);
arr.push(j);
});

arr.sort((a,b)=>a.distance-b.distance);

jobsList.innerHTML="";

arr.forEach(j=>{

let phone=j.phone.startsWith("237")?j.phone:"237"+j.phone;

jobsList.innerHTML+=`
<div style="background:#222;padding:15px;margin:10px;border-radius:10px">
<b>${j.icon} ${j.title}</b><br>
${j.distance.toFixed(1)} km<br>

<a href="https://wa.me/${phone}" style="color:#25D366">WhatsApp</a><br>
<a href="tel:${phone}" style="color:#1E90FF">Appeler</a><br>

${currentUser && (currentUser.uid==j.user || currentUser.uid==ADMIN_UID)?
`<button onclick="deleteJob('${j.id}')">Supprimer</button>`:""}
</div>
`;

});

});

});
}

// DELETE
function deleteJob(id){
db.ref("jobs/"+id).remove();
}

// ROUTE
let route;
function drawRoute(lat,lng){

navigator.geolocation.getCurrentPosition(pos=>{

if(route) map.removeLayer(route);

route=L.polyline([
[pos.coords.latitude,pos.coords.longitude],
[lat,lng]
],{color:"gold"}).addTo(map);

speechSynthesis.speak(new SpeechSynthesisUtterance("Navigation lancée"));

});
}

// MARKERS
db.ref("jobs").on("value",snap=>{

map.eachLayer(l=>{
if(l instanceof L.Marker && !l._isUser) map.removeLayer(l);
});

snap.forEach(d=>{
let j=d.val();

let icon=L.divIcon({
html:`<div style="background:${j.color};width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center">${j.icon}</div>`
});

let m=L.marker([j.lat,j.lng],{icon}).addTo(map);

m.bindPopup(`
<b>${j.title}</b><br>
<button onclick="drawRoute(${j.lat},${j.lng})">Itinéraire</button>
`);
});

});

// NAV
function hideAll(){
map.getContainer().style.display="none";
jobsList.classList.add("hidden");
chatBox.classList.add("hidden");
accountBox.classList.add("hidden");
}

function showMap(){
hideAll();
map.getContainer().style.display="block";
setTimeout(()=>map.invalidateSize(),200);
}

function showChat(){hideAll();chatBox.classList.remove("hidden");}
function showAccount(){hideAll();accountBox.classList.remove("hidden");}

// GPS BTN
function goToMyPosition(){
navigator.geolocation.getCurrentPosition(p=>{
map.setView([p.coords.latitude,p.coords.longitude],17);
});
}

// AUTH
function register(){auth.createUserWithEmailAndPassword(email.value,password.value);}
function login(){auth.signInWithEmailAndPassword(email.value,password.value);}
function googleLogin(){
let provider=new firebase.auth.GoogleAuthProvider();
auth.signInWithPopup(provider);
    }
