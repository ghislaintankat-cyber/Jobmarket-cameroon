exports.newJobNotification = functions.database.ref('/jobs/{jobId}')
.onCreate((snapshot, context) => {
   // Notify nearby users
});

exports.cleanExpiredJobs = functions.pubsub.schedule('every 24 hours')
.onRun(() => {
   // Remove expired jobs
});
