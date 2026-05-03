// USER VERIFICATION
if (currentUser && !currentUser.emailVerified) {
    alert("Veuillez vérifier votre email pour publier.");
}

// MULTI-IMAGE SUPPORT
const imageFiles = document.getElementById("jobImages").files;
const uploadedImages = [];

for (const file of imageFiles) {
   // Cloudinary upload loop
}

jobData.images = uploadedImages;

// PUSH NOTIFICATIONS
const messaging = firebase.messaging();
messaging.requestPermission()
.then(() => messaging.getToken())
.then(token => {
    db.ref('notificationTokens/' + currentUser.uid).set(token);
});

// ANALYTICS
firebase.analytics();

// LANGUAGE SYSTEM
const supportedLanguages = ['fr', 'en'];

// INTERNATIONAL EXPANSION READY
jobData.country = selectedCountry;
jobData.currency = selectedCurrency;
