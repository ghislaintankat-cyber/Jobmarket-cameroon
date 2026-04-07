let map, userMarker;

const SERVER = "https://jobmarket-backend-6gqm.onrender.com";

/* MAP */
function initMap(){

  const sat = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
  );

  const labels = L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png"
  );

  map = L.map("map",{center:[3.848,11.502],zoom:17,layers:[sat,labels]});

  navigator.geolocation.watchPosition(pos=>{
    let lat=pos.coords.latitude;
    let lng=pos.coords.longitude;

    if(userMarker){
      userMarker.setLatLng([lat,lng]);
    }else{
      userMarker=L.circleMarker([lat,lng],{radius:12,color:"blue"}).addTo(map);
    }
  });
}

/* FORM */
function openForm(){
  formBox.classList.toggle("hidden");
}

/* IA */
async function autoAI(){

  let t = title.value;

  let res = await fetch(SERVER+"/ai-complete",{
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body:JSON.stringify({title:t})
  });

  let data = await res.json();

  desc.value = data.reply;
}

/* BOOST */
function payBoost(){

  FlutterwaveCheckout({
    public_key: "TON_FLW_KEY",
    tx_ref: Date.now(),
    amount: 500,
    currency: "XAF",
    customer:{
      email:"user@gmail.com"
    },
    callback:function(){
      alert("Boost activé 🚀");
    }
  });
    }
