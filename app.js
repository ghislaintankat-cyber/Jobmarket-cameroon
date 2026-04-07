let map, userMarker;

/* NAVIGATION */
function showPage(page){

  document.querySelectorAll(".page").forEach(p=>{
    p.classList.remove("active");
  });

  document.getElementById(page).classList.add("active");

  if(page==="mapPage"){
    setTimeout(()=>{
      map.invalidateSize(); // 🔥 FIX CARTE
    },300);
  }
}

/* MAP */
function initMap(){

  const satellite = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
  );

  const labels = L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png"
  );

  map = L.map("map",{
    center:[3.848,11.502],
    zoom:17,
    layers:[satellite, labels]
  });

  setTimeout(()=>map.invalidateSize(),500);

  navigator.geolocation.watchPosition(pos=>{
    let lat = pos.coords.latitude;
    let lng = pos.coords.longitude;

    if(userMarker){
      userMarker.setLatLng([lat,lng]);
    }else{
      userMarker = L.circleMarker([lat,lng],{
        radius:10,
        color:"blue"
      }).addTo(map);
    }
  });
}

/* FORM */
function openForm(){
  formBox.classList.toggle("hidden");
}

/* JOB */
function addJob(){
  alert("Job prêt (connecte Firebase ici)");
}

/* IA */
async function askAI(){
  aiResponse.innerText = "IA connectée (backend)";
}

/* PAIEMENT */
function payBoost(){
  FlutterwaveCheckout({
    public_key:"FLWPUBK_TEST-a33eb7e6188f8560b4fbda00d8c07304-X",
    tx_ref:Date.now(),
    amount:500,
    currency:"XAF",
    customer:{email:"user@gmail.com"},
    callback:()=>alert("Boost activé 🚀")
  });
    }
