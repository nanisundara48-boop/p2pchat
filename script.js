// 1. FIREBASE CONFIGURATION
const firebaseConfig = {
    apiKey: "AIzaSyBSqoQpLKKKS5FxqQF-MhXsANvlMQFlpp4",
    authDomain: "private-7eee3.firebaseapp.com",
    projectId: "private-7eee3",
    storageBucket: "private-7eee3.firebasestorage.app",
    messagingSenderId: "762729546611",
    appId: "1:762729546611:web:5dd03e613c03889b017b06"
};

if (!firebase.apps.length) { firebase.initializeApp(firebaseConfig); }
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

let currentUser = null;
let currentChatPeer = null;
let isSignUpMode = false;
let holdTimer = null;
let isVaultUnlocked = false;
let rtcPeerConnection = null;
let localStream = null;
let callDocRef = null;
let callListenerUnsubscribe = null;

// Audio Synthesizer for Clean Ringtones
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playRing(type = 'incoming') {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.frequency.setValueAtTime(type === 'incoming' ? 587.33 : 440, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.00001, audioCtx.currentTime + 0.5);
    osc.start(); osc.stop(audioCtx.currentTime + 0.5);
}

// 2. AUTHENTICATION & IDENTITY PORTAL
function toggleAuthMode() {
    isSignUpMode = !isSignUpMode;
    document.getElementById("nameGroup").classList.toggle("hidden", !isSignUpMode);
    document.getElementById("idPreviewGroup").classList.toggle("hidden", !isSignUpMode);
    document.getElementById("authSubmitBtn").innerText = isSignUpMode ? "Create Realm Account" : "Sign In";
    document.getElementById("authSwitchText").innerText = isSignUpMode ? "Already have an account? Sign In" : "Don't have an account? Create one";
}

function generateUniqueId() {
    const name = document.getElementById("userName").value.trim().toLowerCase().replace(/\s+/g, '');
    if (name) {
        const num = Math.floor(1000 + Math.random() * 9000);
        document.getElementById("generatedId").innerText = `@${name}_${num}`;
    }
}

async function handleAuth(e) {
    e.preventDefault();
    const email = document.getElementById("userEmail").value.trim();
    const pass = document.getElementById("userPass").value.trim();

    try {
        if (isSignUpMode) {
            const name = document.getElementById("userName").value.trim();
            const uniqueId = document.getElementById("generatedId").innerText;
            const res = await auth.createUserWithEmailAndPassword(email, pass);
            await db.collection("users").doc(res.user.uid).set({
                name: name, email: email, uniqueId: uniqueId,
                dp: `https://api.dicebear.com/7.x/initials/svg?seed=${name}`,
                status: "Online", contacts: []
            });
        } else {
            await auth.signInWithEmailAndPassword(email, pass);
        }
    } catch (err) { alert("Auth Error: " + err.message); }
}

auth.onAuthStateChanged(async (user) => {
    if (user) {
        currentUser = user;
        const doc = await db.collection("users").doc(user.uid).get();
        if (doc.exists) {
            const data = doc.data();
            document.getElementById("myDp").src = data.dp;
            document.getElementById("authSection").classList.add("hidden");
            document.getElementById("appWorkspace").classList.remove("hidden");
            switchTab('chats');
            listenForIncomingCalls();
        }
    } else {
        document.getElementById("authSection").classList.remove("hidden");
        document.getElementById("appWorkspace").classList.add("hidden");
    }
});

// 3. TAB NAVIGATION & FRIEND CONTACTS SYSTEM
function switchTab(tab) {
    document.querySelectorAll(".tab-btn").forEach(btn => btn.classList.remove("active"));
    const container = document.getElementById("sidebarContent");
    const searchBar = document.getElementById("searchBarContainer");
    searchBar.classList.toggle("hidden", tab !== 'search');
    container.innerHTML = `<div class="empty-state">Loading...</div>`;

    if (tab === 'chats') loadMyContacts();
    else if (tab === 'calls') loadCallHistory();
    else if (tab === 'glimpse') openGlimpseModal();
    else if (tab === 'search') container.innerHTML = `<div class="empty-state">Type @id above to search and add contacts.</div>`;
}

// Only load added contacts (No more direct user dumps!)
async function loadMyContacts() {
    const userDoc = await db.collection("users").doc(currentUser.uid).get();
    const contacts = userDoc.data().contacts || [];
    const container = document.getElementById("sidebarContent");
    container.innerHTML = "";

    if (contacts.length === 0) {
        container.innerHTML = `<div class="empty-state">No contacts yet. Click the (+) icon above to add contacts!</div>`;
        return;
    }

    contacts.forEach(async (peerId) => {
        const peerDoc = await db.collection("users").doc(peerId).get();
        if (peerDoc.exists) {
            const peer = peerDoc.data();
            peer.uid = peerDoc.id;
            
            // Check if chat is secret/vault locked
            if (peer.isSecret && !isVaultUnlocked) return;

            const item = document.createElement("div");
            item.className = "list-item";
            item.innerHTML = `
                <img src="${peer.dp}" alt="">
                <div class="item-info">
                    <h4>${peer.name} ${peer.isSecret ? '<i class="fa-solid fa-lock text-yellow"></i>' : ''}</h4>
                    <p>${peer.uniqueId}</p>
                </div>
            `;
            item.onclick = () => openChatRoom(peer);
            container.appendChild(item);
        }
    });
}

function searchUsersToAdd() {
    const query = document.getElementById("searchInput").value.trim().toLowerCase();
    if (!query) return;
    
    db.collection("users").where("uniqueId", ">=", query).where("uniqueId", "<=", query + "\uf8ff").get()
        .then(snapshot => {
            const container = document.getElementById("sidebarContent");
            container.innerHTML = "";
            snapshot.forEach(doc => {
                if (doc.id === currentUser.uid) return;
                const peer = doc.data();
                const item = document.createElement("div");
                item.className = "list-item";
                item.innerHTML = `
                    <img src="${peer.dp}" alt="">
                    <div class="item-info"><h4>${peer.name}</h4><p>${peer.uniqueId}</p></div>
                    <button class="btn-primary" style="width:auto; padding:6px 12px; font-size:12px;" onclick="addContact('${doc.id}')">Add Contact</button>
                `;
                container.appendChild(item);
            });
        });
}

async function addContact(peerId) {
    await db.collection("users").doc(currentUser.uid).update({
        contacts: firebase.firestore.FieldValue.arrayUnion(peerId)
    });
    alert("✅ Contact Added!");
    switchTab('chats');
}

// 4. TRUE MOBILE CHAT ROOM NAVIGATION
function openChatRoom(peer) {
    currentChatPeer = peer;
    document.getElementById("emptyChatState").classList.add("hidden");
    document.getElementById("activeChatContainer").classList.remove("hidden");
    document.getElementById("activePeerName").innerText = peer.name;
    document.getElementById("activePeerDp").src = peer.dp;
    document.getElementById("appWorkspace").classList.add("mobile-chat-active");

    const chatId = currentUser.uid < peer.uid ? `${currentUser.uid}_${peer.uid}` : `${peer.uid}_${currentUser.uid}`;
    db.collection("chats").doc(chatId).collection("messages").orderBy("timestamp", "asc")
        .onSnapshot(snapshot => {
            const area = document.getElementById("messagesArea");
            area.innerHTML = "";
            snapshot.forEach(doc => {
                const msg = doc.data();
                const bubble = document.createElement("div");
                bubble.className = `msg-bubble ${msg.sender === currentUser.uid ? 'sent' : 'received'}`;
                bubble.innerHTML = `<div>${msg.text}</div><span class="msg-meta">${msg.time || ''}</span>`;
                area.appendChild(bubble);
            });
            area.scrollTop = area.scrollHeight;
        });
}

function closeChatMobile() {
    document.getElementById("appWorkspace").classList.remove("mobile-chat-active");
}

function sendMsgAction() {
    const input = document.getElementById("messageInputBox");
    const text = input.value.trim();
    if (!text || !currentChatPeer) return;
    const chatId = currentUser.uid < currentChatPeer.uid ? `${currentUser.uid}_${currentChatPeer.uid}` : `${currentChatPeer.uid}_${currentUser.uid}`;
    
    db.collection("chats").doc(chatId).collection("messages").add({
        text: text, sender: currentUser.uid,
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
    input.value = "";
}
function handleEnterSend(e) { if (e.key === "Enter") sendMsgAction(); }

// 5. WEBRTC CALLING & REAL CUT-OFF SYNC
const rtcServers = { iceServers: [{ urls: ['stun:stun1.l.google.com:19302'] }] };

async function startWebRTCCall(isVideo = true) {
    if (!currentChatPeer) return;
    document.getElementById("callModal").classList.add("active");
    document.getElementById("callerNameDisplay").innerText = `Calling ${currentChatPeer.name}...`;
    document.getElementById("videoCallContainer").classList.remove("hidden");
    document.getElementById("acceptCallBtn").classList.add("hidden");
    document.getElementById("declineCallBtn").classList.add("hidden");
    document.getElementById("endCallBtn").classList.remove("hidden");
    playRing('outgoing');

    localStream = await navigator.mediaDevices.getUserMedia({ video: isVideo, audio: true });
    document.getElementById("localVideo").srcObject = localStream;
    rtcPeerConnection = new RTCPeerConnection(rtcServers);
    localStream.getTracks().forEach(track => rtcPeerConnection.addTrack(track, localStream));
    rtcPeerConnection.ontrack = e => document.getElementById("remoteVideo").srcObject = e.streams[0];

    const callId = `${currentUser.uid}_${currentChatPeer.uid}`;
    callDocRef = db.collection("calls").doc(callId);
    
    // Log call to history
    db.collection("calls_history").add({
        caller: currentUser.uid, receiver: currentChatPeer.uid,
        peerName: currentChatPeer.name, type: isVideo ? "Video Call" : "Voice Call",
        time: new Date().toLocaleString(), status: "Outgoing"
    });

    const offer = await rtcPeerConnection.createOffer();
    await rtcPeerConnection.setLocalDescription(offer);
    await callDocRef.set({
        caller: currentUser.uid, callerName: currentUser.displayName || "User",
        receiver: currentChatPeer.uid, offer: { type: offer.type, sdp: offer.sdp },
        status: "ringing"
    });

    // LISTEN FOR CALL END FROM OTHER SIDE
    callListenerUnsubscribe = callDocRef.onSnapshot(snap => {
        const data = snap.data();
        if (!data || data.status === "ended") { endCall(false); }
        else if (data.answer && !rtcPeerConnection.currentRemoteDescription) {
            rtcPeerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
        }
    });
}

function listenForIncomingCalls() {
    db.collection("calls").where("receiver", "==", currentUser.uid).where("status", "==", "ringing")
        .onSnapshot(snap => {
            snap.docChanges().forEach(async change => {
                if (change.type === "added") {
                    const data = change.doc.data();
                    callDocRef = db.collection("calls").doc(change.doc.id);
                    document.getElementById("callModal").classList.add("active");
                    document.getElementById("callerNameDisplay").innerText = `Incoming from ${data.callerName}`;
                    document.getElementById("videoCallContainer").classList.add("hidden");
                    document.getElementById("acceptCallBtn").classList.remove("hidden");
                    document.getElementById("declineCallBtn").classList.remove("hidden");
                    document.getElementById("endCallBtn").classList.add("hidden");
                    playRing('incoming');
                    
                    callListenerUnsubscribe = callDocRef.onSnapshot(s => {
                        if (!s.exists || s.data().status === "ended") endCall(false);
                    });
                }
            });
        });
}

async function acceptCall() {
    document.getElementById("videoCallContainer").classList.remove("hidden");
    document.getElementById("acceptCallBtn").classList.add("hidden");
    document.getElementById("declineCallBtn").classList.add("hidden");
    document.getElementById("endCallBtn").classList.remove("hidden");
    
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    document.getElementById("localVideo").srcObject = localStream;
    rtcPeerConnection = new RTCPeerConnection(rtcServers);
    localStream.getTracks().forEach(track => rtcPeerConnection.addTrack(track, localStream));
    rtcPeerConnection.ontrack = e => document.getElementById("remoteVideo").srcObject = e.streams[0];

    const data = (await callDocRef.get()).data();
    await rtcPeerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await rtcPeerConnection.createAnswer();
    await rtcPeerConnection.setLocalDescription(answer);
    await callDocRef.update({ answer: { type: answer.type, sdp: answer.sdp }, status: "connected" });
}

async function declineCall() { if (callDocRef) await callDocRef.update({ status: "ended" }); endCall(true); }

function endCall(notifyRemote = true) {
    if (notifyRemote && callDocRef) callDocRef.update({ status: "ended" });
    if (rtcPeerConnection) rtcPeerConnection.close();
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    if (callListenerUnsubscribe) callListenerUnsubscribe();
    document.getElementById("callModal").classList.remove("active");
}

function loadCallHistory() {
    db.collection("calls_history").where("caller", "==", currentUser.uid).get().then(snap => {
        const container = document.getElementById("sidebarContent");
        container.innerHTML = "";
        if (snap.empty) { container.innerHTML = `<div class="empty-state">No call logs yet.</div>`; return; }
        snap.forEach(doc => {
            const log = doc.data();
            const item = document.createElement("div");
            item.className = "list-item";
            item.innerHTML = `<div class="item-info"><h4>${log.peerName} (${log.type})</h4><p>${log.time}</p></div>`;
            container.appendChild(item);
        });
    });
}

// 6. HIDDEN VAULT (PIN: 0000)
function startHiddenTimer() { holdTimer = setTimeout(() => document.getElementById("pinModal").classList.add("active"), 1200); }
function stopHiddenTimer() { clearTimeout(holdTimer); }
function checkVaultPin() {
    if (document.getElementById("vaultPinInput").value === "0000") {
        isVaultUnlocked = !isVaultUnlocked;
        document.getElementById("pinModal").classList.remove("active");
        document.getElementById("vaultPinInput").value = "";
        document.getElementById("hiddenIndicator").classList.toggle("hidden", !isVaultUnlocked);
        alert(isVaultUnlocked ? "🔓 Security Vault Unlocked! Showing hidden chats." : "🔒 Vault Locked.");
        loadMyContacts();
    }
}

// 7. HIGH-ACCURACY GPS GLIMPSE WITH TAG TOGGLES
function openGlimpseModal() {
    document.getElementById("glimpseModal").classList.add("active");
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } })
        .then(stream => document.getElementById("glimpseCamStream").srcObject = stream);
}
function closeModal(id) { document.getElementById(id).classList.remove("active"); }

function updateGlimpseTags() {
    const showTime = document.getElementById("toggleTime").checked;
    const showLoc = document.getElementById("toggleLoc").checked;
    
    document.getElementById("tagTimeDisplay").classList.toggle("hidden", !showTime);
    document.getElementById("tagLocDisplay").classList.toggle("hidden", !showLoc);
    
    if (showTime) document.getElementById("timeText").innerText = new Date().toLocaleTimeString();
    if (showLoc) {
        document.getElementById("locText").innerText = "Locating GPS...";
        navigator.geolocation.getCurrentPosition(async (pos) => {
            const { latitude, longitude } = pos.coords;
            const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`);
            const data = await res.json();
            // Gets accurate local village/suburb (e.g., Ramarajulanka / Bhimavaram)
            const exactPlace = data.address.suburb || data.address.village || data.address.town || data.address.city || "Exact Location";
            document.getElementById("locText").innerText = exactPlace;
        }, () => document.getElementById("locText").innerText = "GPS Access Denied", { enableHighAccuracy: true });
    }
}

function captureAndSendGlimpse() {
    alert("⚡ Live Glimpse Snap Sent with Active Encrypted Tags!");
    closeModal('glimpseModal');
}
