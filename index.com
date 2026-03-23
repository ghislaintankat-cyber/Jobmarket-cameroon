<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>JobMarket Cameroon 🛰️</title>
    
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.7.1/dist/leaflet.css" />
    <script src="https://unpkg.com/leaflet@1.7.1/dist/leaflet.js"></script>
    <link rel="stylesheet" href="https://unpkg.com/leaflet-control-geocoder/dist/Control.Geocoder.css" />
    <script src="https://unpkg.com/leaflet-control-geocoder/dist/Control.Geocoder.js"></script>

    <script src="https://www.gstatic.com/firebasejs/9.1.1/firebase-app-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/9.1.1/firebase-database-compat.js"></script>
    
    <style>
        :root { --gold: #f59e0b; --gold-light: #fcd34d; --dark: #0f172a; --dark-light: #1e293b; }
        body { margin: 0; padding: 0; height: 100vh; display: flex; flex-direction: column; background: var(--dark); font-family: sans-serif; overflow: hidden; color: white; }
        header { background: var(--dark-light); padding: 10px; text-align: center; border-bottom: 2px solid var(--gold); z-index: 2000; position: relative; }
        .btn-aide { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); background: #334155; color: white; border: 1px solid var(--gold); border-radius: 50%; width: 25px; height: 25px; font-weight: bold; cursor: pointer; }
        #map { flex-grow: 1; width: 100%; height: 100%; background: #000; }
        .btn-float { position: fixed; bottom: 20px; right: 20px; left: 20px; background: linear-gradient(45deg, var(--gold), var(--gold-light)); color: #0f172a; border: none; height: 50px; border-radius: 25px; font-weight: bold; z-index: 1000; box-shadow: 0 4px 15px rgba(0,0,0,0.5); cursor: pointer; }
        .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.9); z-index: 3000; justify-content: center; align-items: center; }
        .modal-content { background: var(--dark-light); padding: 20px; border-radius: 20px; width: 85%; max-width: 350px; border: 1px solid var(--gold); }
        input, textarea, select { width: 100%; margin-bottom: 10px; padding: 12px; border-radius: 10px; border: 1px solid #334155; background: var(--dark); color: white; font-size: 16px; box-sizing: border-box; }
        .btn-wa { background: #25D366; color: white; padding: 10px; display: block; text-align: center; text-decoration: none; border-radius: 10px; font-weight: bold; margin-top: 10px; }
        
        /* Styles recherche et badges */
        .leaflet-control-geocoder { background: white !important; color: black !important; border: 2px solid var(--gold) !important; margin-top: 10px !important; }
        .dist-badge { background: var(--gold); color: black; padding: 2px 5px; border-radius: 5px; font-size: 10px; font-weight: bold; margin-left: 5px; }
        .custom-icon { display: flex; justify-content: center; align-items: center; font-size: 20px; background: white; border-radius: 50%; border: 2px solid var(--gold); width: 32px; height: 32px; color: black; }
    </style>
</head>
<body>

    <header>
        <button class="btn-aide" onclick="openHelp()">?</button>
        <b>JOBMARKET CAMEROON 🛰️</b> 
    </header>

    <div id="map"></div>
    <button class="btn-float" onclick="useGPS()">📍 UTILISER MON GPS ACTUEL</button>

    <div id="pubModal" class="modal">
        <div class="modal-content">
            <h3 style="color:var(--gold)">Nouveau Job ✨</h3>
            <select id="mType">
                <option value="🏊 Nageur">🏊 Maître-Nageur</option>
                <option value="🛠️ Dépannage">🛠️ Dépannage</option>
                <option value="📦 Livraison">📦 Livraison</option>
                <option value="🧹 Ménage">🧹 Ménage</option>
            </select>
            <input type="text" id="userName" placeholder="Ton nom">
            <input type="number" id="userPhone" placeholder="WhatsApp">
            <textarea id="mDesc" rows="3" placeholder="Description..."></textarea>
            <button class="btn-float" style="position:static; width:100%" onclick="finaliserPublication()">VALIDER</button>
            <button onclick="closeModal('pubModal')" style="background:none; border:none; color:gray; width:100%; margin-top:10px;">Annuler</button>
        </div>
    </div>

    <script>
        const firebaseConfig = {
            apiKey: "AIzaSyCR1Z6VlS5A7iPbUCoVm0AQcnkkUdsA0CE",
            authDomain: "jobmarketfuture.firebaseapp.com",
            databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com",
            projectId: "jobmarketfuture",
            appId: "1:351669024349:web:d4d4d08727ccc6012b7fb4"
        };
        firebase.initializeApp(firebaseConfig);
        const db = firebase.database();

        // Couches de carte
        var plan = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png');
        var satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}');

        var map = L.map('map', { zoomControl: false, tap: false, layers: [satellite] }).setView([3.848, 11.502], 13);
        L.control.layers({"🛰️ Satellite": satellite, "🗺️ Plan": plan}, null, {position: 'topright'}).addTo(map);

        L.Control.geocoder({ defaultMarkGeocode: false, placeholder: "Chercher un quartier..." })
        .on('markgeocode', function(e) { map.fitBounds(e.geocode.bbox); }).addTo(map);

        let tempCoords = null;
        let userPos = null;

        window.openHelp = () => { alert("Cliquez sur la carte pour publier ou utilisez le GPS !"); };
        window.closeModal = (id) => { document.getElementById(id).style.display = 'none'; };
        
        window.useGPS = function() {
            navigator.geolocation.getCurrentPosition((pos) => {
                userPos = L.latLng(pos.coords.latitude, pos.coords.longitude);
                map.flyTo(userPos, 17);
                tempCoords = {lat: pos.coords.latitude, lng: pos.coords.longitude};
                setTimeout(() => { document.getElementById('pubModal').style.display = 'flex'; }, 1000);
            }, () => { alert("Active ton GPS !"); });
        };

        map.on('click', (e) => {
            tempCoords = e.latlng;
            document.getElementById('pubModal').style.display = 'flex';
        });

        window.finaliserPublication = () => {
            const data = {
                type: document.getElementById('mType').value,
                name: document.getElementById('userName').value || "Anonyme",
                phone: document.getElementById('userPhone').value,
                desc: document.getElementById('mDesc').value,
                lat: tempCoords.lat, lng: tempCoords.lng
            };
            if(!data.phone || !data.desc) return alert("Remplis tout !");
            db.ref('missions').push(data).then(() => { closeModal('pubModal'); });
        };

        function getEmoji(type) {
            if(type.includes("Nageur")) return "🏊";
            if(type.includes("Dépannage")) return "🛠️";
            if(type.includes("Livraison")) return "📦";
            if(type.includes("Ménage")) return "🧹";
            return "💼";
        }

        db.ref('missions').on('child_added', (snap) => {
            const m = snap.val();
            const icon = L.divIcon({ className: 'custom-icon', html: getEmoji(m.type), iconSize: });
            const marker = L.marker([m.lat, m.lng], {icon: icon}).addTo(map);
            
            marker.on('click', () => {
                let distHtml = "";
                if(userPos) {
                    const d = userPos.distanceTo(L.latLng(m.lat, m.lng));
                    const text = d < 1000 ? Math.round(d)+"m" : (d/1000).toFixed(1)+"km";
                    distHtml = `<span class="dist-badge">${text}</span>`;
                }
                marker.bindPopup(`<b>${m.type}</b>${distHtml}<br>👤 ${m.name}<hr>${m.desc}<br><a href="https://wa.me/237${m.phone}" class="btn-wa">WhatsApp</a>`).openPopup();
            });
        });

        setTimeout(() => { map.invalidateSize(); }, 800);
    </script>
</body>
</html>
