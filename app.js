// 🔥 FIREBASE CONFIG (CORRIGÉ)
const firebaseConfig = {
  apiKey: "AIzaSyCR1Z6VlS5A7iPbUCoVm0AQcnkkUdsA0CE",
  authDomain: "jobmarketfuture.firebaseapp.com",
  databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com",
  projectId: "jobmarketfuture",
  storageBucket: "jobmarketfuture.appspot.com",
  messagingSenderId: "351669024349",
  appId: "1:351669024349:web:d4d4d08727ccc6012b7fb4"
};

firebase.initializeApp(firebaseConfig);

const db = firebase.database();
const storage = firebase.storage();
const auth = firebase.auth();

let currentUser;

// 🔐 AUTH
function register(){
  auth.createUserWithEmailAndPassword(email.value,password.value)
  .then(()=>alert("Compte créé"))
  .catch(e=>alert(e.message));
}

function login(){
  auth.signInWithEmailAndPassword(email.value,password.value)
  .then(()=>alert("Connecté"))
  .catch(e=>alert(e.message));
}

// 🗺️ MAP
let map = L.map("map").setView([3.848,11.502],15);

L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  { maxZoom: 19 }
).addTo(map);

let userMarker;
let markers = [];

// 📍 GPS (OPTIMISÉ)
navigator.geolocation.watchPosition(
  pos => {
    let lat = pos.coords.latitude;
    let lng = pos.coords.longitude;

    if (userMarker) {
      userMarker.setLatLng([lat, lng]);
    } else {
      userMarker = L.circleMarker([lat, lng], {
        radius: 8,
        color: "blue"
      }).addTo(map);
    }
  },
  err => console.log(err),
  { enableHighAccuracy: true, maximumAge: 5000 }
);

// 📏 DISTANCE
function getDistance(a,b,c,d){
  let R=6371;
  let dLat=(c-a)*Math.PI/180;
  let dLon=(d-b)*Math.PI/180;

  let x=Math.sin(dLat/2)**2+
  Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*
  Math.sin(dLon/2)**2;

  return (R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x))).toFixed(2);
}

// ➕ FORM
function openForm(){
  document.getElementById("formBox").classList.toggle("hidden");
}

// 💾 ADD JOB (IMAGE FIXED)
function addJob(){

  if(!title.value || !phone.value){
    alert("Remplis les champs");
    return;
  }

  navigator.geolocation.getCurrentPosition(pos=>{

    let file = image.files[0];

    if(file){

      let ref = storage.ref("jobs/" + Date.now() + ".jpg");

      ref.put(file)
      .then(()=> ref.getDownloadURL())
      .then(url => saveJob(url,pos))
      .catch(err=>{
        alert("Erreur upload image");
        console.log(err);
      });

    }else{
      saveJob("",pos);
    }

  });
}

// 💾 SAVE JOB
function saveJob(img,pos){

  let job={
    title:title.value,
    desc:desc.value,
    price:price.value,
    phone:phone.value,
    img:img,
    boost:boost.checked,
    lat:pos.coords.latitude,
    lng:pos.coords.longitude,
    time:Date.now()
  };

  db.ref("jobs").push(job);

  alert("✅ Job ajouté");

  document.getElementById("formBox").classList.add("hidden");
}

// 📄 LISTE JOBS
function loadJobsList(){

  let box = document.getElementById("jobsList");
  box.innerHTML = "Chargement...";

  db.ref("jobs").once("value",snap=>{

    box.innerHTML = "";

    let jobs = [];

    snap.forEach(d=>{
      let j = d.val();
      jobs.push(j);
    });

    // tri par distance si GPS dispo
    if(userMarker){
      let user = userMarker.getLatLng();
      jobs.forEach(j=>{
        j.distance = getDistance(user.lat,user.lng,j.lat,j.lng);
      });
      jobs.sort((a,b)=>a.distance - b.distance);
    }

    jobs.slice(0,50).forEach(j=>{

      box.innerHTML += `
      <div style="background:#222;margin:10px;padding:10px;border-radius:10px">
        <b>${j.title}</b><br>

        ${j.img ? `<img src="${j.img}" width="100%" style="border-radius:10px">` : ""}<br>

        💰 ${j.price || ""}<br>
        📏 ${j.distance || ""} km<br><br>

        <a href="https://wa.me/${j.phone}" style="color:#25D366">WhatsApp</a><br>
        <a href="tel:${j.phone}" style="color:#1E90FF">Appeler</a>
      </div>
      `;
    });

  });
}

// 🧭 NAVIGATION
function showMap(){
  document.getElementById("map").style.display="block";
  document.getElementById("jobsList").classList.add("hidden");
  document.getElementById("accountBox").classList.add("hidden");
}

function showList(){
  document.getElementById("map").style.display="none";
  document.getElementById("jobsList").classList.remove("hidden");
  document.getElementById("accountBox").classList.add("hidden");

  loadJobsList();
}

function showAccount(){
  document.getElementById("map").style.display="none";
  document.getElementById("jobsList").classList.add("hidden");
  document.getElementById("accountBox").classList.remove("hidden");
                }
