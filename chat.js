function sendMessage() {
    db.ref('messages').push({
        sender: auth.currentUser.uid,
        text: chatInput.value,
        timestamp: Date.now()
    });
}
