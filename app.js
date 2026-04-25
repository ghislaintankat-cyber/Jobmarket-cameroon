// FIREBASE
const firebaseConfig = {
 apiKey: "AIzaSyCR1Z6VlS5A7iPbUCoVm0AQcnkkUdsA0CE",
 authDomain: "jobmarketfuture.firebaseapp.com",
 databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com",
 projectId: "jobmarketfuture"
};

firebase.initializeApp(firebaseConfig);

const db = firebase.database();
const auth = firebase.auth();

const ADMIN_UID = "GrajEM98vOc1w3FUr9XeTN90rfl2";

let currentUser=null;
let userCoords=null;
let routeControl=null;

auth.onAuthStateChanged(u=>currentUser=u);

// MAP
let map=L.map("map").setView([3.848,11.502],13);

L.tileLayer('https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',{
 subdomains:['mt0','mt1','mt2','mt3']
}).addTo(map);

// GPS
navigator.geolocation.watchPosition(pos=>{
 userCoords={lat:pos.coords.latitude,lng:pos.coords.longitude};
});

// MARKER STYLE
function createMarker(lat,lng){
 return L.marker([lat,lng],{
  icon:L.divIcon({
   html:`<div style="
   width:25px;height:25px;
   border-radius:50%;
   background:linear-gradient(45deg,gold,orange,red);
   border:2px solid white;"></div>`,
   className:""
  })
 });
}

// LOAD JOBS
db.ref("jobs").on("value",snap=>{

 map.eachLayer(l=>{
  if(l instanceof L.Marker) map.removeLayer(l);
 });

 snap.forEach(d=>{
  let j=d.val(); j.id=d.key;

  let marker=createMarker(j.lat,j.lng).addTo(map);

  marker.bindPopup(`
  <b>${j.title}</b><br>
  👍 ${j.likes||0}<br>

  <a href="https://wa.me/${j.phone}" style="color:green">WhatsApp</a><br>
  <a href="tel:${j.phone}" style="color:blue">Appel</a><br>

  <button onclick="drawRoute(${j.lat},${j.lng})">Itinéraire</button>

  <button onclick="likeJob('${j.id}')">👍 Like</button>

  ${(currentUser && (currentUser.uid===j.user || currentUser.uid===ADMIN_UID)) 
  ? `<button onclick="deleteJob('${j.id}')">Supprimer</button>` : ""}
  `);

 });

});

// LIKE
function likeJob(id){
 db.ref("jobs/"+id+"/likes").transaction(v=>(v||0)+1);
}

// ADD JOB
function addJob(){

 if(!currentUser) return alert("Connecte-toi");

 navigator.geolocation.getCurrentPosition(pos=>{
  db.ref("jobs").push({
   title:title.value,
   price:price.value,
   phone:phone.value,
   lat:pos.coords.latitude,
   lng:pos.coords.longitude,
   user:currentUser.uid,
   createdAt:Date.now(),
   likes:0
  });
 });

 toggleForm();
}

// ROUTE
function drawRoute(lat,lng){

 if(!userCoords) return alert("Active GPS");

 if(routeControl) map.removeControl(routeControl);

 routeControl=L.Routing.control({
  waypoints:[
   L.latLng(userCoords.lat,userCoords.lng),
   L.latLng(lat,lng)
  ],
  createMarker:()=>null
 }).addTo(map);
}

// DELETE
function deleteJob(id){
 db.ref("jobs/"+id).remove();
}

// LISTE
function showList(){

 hideAll();
 let box=document.getElementById("list");
 box.classList.remove("hidden");

 box.innerHTML="<h2>Jobs proches</h2>";

 navigator.geolocation.getCurrentPosition(pos=>{

  let lat=pos.coords.latitude;
  let lng=pos.coords.longitude;

  db.ref("jobs").once("value",snap=>{

   let jobs=[];

   snap.forEach(d=>{
    let j=d.val();
    j.distance=getDistance(lat,lng,j.lat,j.lng);
    jobs.push(j);
   });

   jobs.sort((a,b)=>a.distance-b.distance);

   jobs.forEach(j=>{
    box.innerHTML+=`
    <div style="background:#111;padding:15px;margin:10px;border-radius:10px">
    <b>${j.title}</b><br>
    ${j.distance.toFixed(1)} km<br>

    <a href="https://wa.me/${j.phone}" style="color:green">WhatsApp</a>
    <a href="tel:${j.phone}" style="color:blue">Appel</a>
    </div>`;
   });

  });

 });
}

// DISTANCE
function getDistance(lat1,lon1,lat2,lon2){
 const R=6371;
 const dLat=(lat2-lat1)*Math.PI/180;
 const dLon=(lon2-lon1)*Math.PI/180;
 const a=Math.sin(dLat/2)**2+
 Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*
 Math.sin(dLon/2)**2;
 return R*(2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a)));
}

// AUTH
function register(){
 auth.createUserWithEmailAndPassword(email.value,password.value);
}

function login(){
 auth.signInWithEmailAndPassword(email.value,password.value);
}

function googleLogin(){
 let provider=new firebase.auth.GoogleAuthProvider();
 auth.signInWithPopup(provider);
}

// UI
function toggleForm(){
 document.getElementById("formBox").classList.toggle("hidden");
}

function showMap(){hideAll();document.getElementById("map").style.display="block";}
function showAccount(){hideAll();document.getElementById("account").classList.remove("hidden");}

function hideAll(){
 document.getElementById("map").style.display="none";
 document.getElementById("list").classList.add("hidden");
 document.getElementById("account").classList.add("hidden");
                             }
