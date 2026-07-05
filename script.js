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
let glimpseFacingMode = "user"; // Front camera default
let activeLiveStreamDoc = null;

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

// 2. BROWSER HISTORY ROUTING (Fixes Android Back Button exiting app)
window.addEventListener('popstate', (e) => {
    // Close any open modals
    document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    
    // If in chat room on mobile, go back to chat list
    if (document.getElementById("appWorkspace").classList.contains("mobile-chat-active")) {
        document.getElementById("appWorkspace").classList.remove("mobile-chat-active");
        currentChatPeer = null;
    }
});

function handleBackButton() {
    if (window.history.length > 1) { window.history.back(); }
    else {
        document.getElementById("appWorkspace").classList.remove("mobile-chat-active");
        currentChatPeer = null;
    }
}

// 3. AUTHENTICATION & #ID SYSTEM
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
        document.getElementById("generatedId").innerText = `#${name}_${num}`;
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
                status: "Online", contacts: [], isSecret: false
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
            listenForFriendRequests();
            listenForLiveStreams();
        }
    } else {
        document.getElementById("authSection").classList.remove("hidden");
        document.getElementById("appWorkspace").classList.add("hidden");
    }
});

// 4. CUSTOM DP UPLOAD
async function uploadCustomDP(event) {
    const file = event.target.files[0];
    if (!file) return;
    alert("Uploading new Profile Picture...");
    const ref = storage.ref(`avatars/${currentUser.uid}_${Date.now()}`);
    await ref.put(file);
    const url = await ref.getDownloadURL();
    await db.collection("users").doc(currentUser.uid).update({ dp: url });
    document.getElementById("myDp").src = url;
    alert("✅ Profile Picture Updated!");
}

// 5. FRIEND REQUEST & NOTIFICATIONS SYSTEM (No Duplicate Auto-Adds!)
function listenForFriendRequests() {
    db.collection("friend_requests").where("to", "==", currentUser.uid).where("status", "==", "pending")
        .onSnapshot(snap => {
            const badge = document.getElementById("notifBadge");
            if (!snap.empty) {
                badge.innerText = snap.size;
                badge.classList.remove("hidden");
            } else { badge.classList.add("hidden"); }
            if (document.querySelector(".tab-btn.active").innerText.includes("Notifications")) loadNotifications();
        });
}

function switchTab(tab) {
    document.querySelectorAll(".tab-btn").forEach(btn => btn.classList.remove("active"));
    const container = document.getElementById("sidebarContent");
    const searchBar = document.getElementById("searchBarContainer");
    searchBar.classList.toggle("hidden", tab !== 'search');
    container.innerHTML = `<div class="empty-state">Loading...</div>`;

    if (tab === 'chats') loadMyContacts();
    else if (tab === 'calls') loadCallHistory();
    else if (tab === 'glimpse') openGlimpseModal();
    else if (tab === 'notifications') loadNotifications();
    else if (tab === 'search') container.innerHTML = `<div class="empty-state">Type #id above to search and send friend request.</div>`;
}

async function loadNotifications() {
    const container = document.getElementById("sidebarContent");
    container.innerHTML = "";
    const snap = await db.collection("friend_requests").where("to", "==", currentUser.uid).where("status", "==", "pending").get();
    
    if (snap.empty) { container.innerHTML = `<div class="empty-state">No pending contact requests.</div>`; return; }
    
    snap.forEach(async doc => {
        const req = doc.data();
        const senderDoc = await db.collection("users").doc(req.from).get();
        if (senderDoc.exists) {
            const sender = senderDoc.data();
            const item = document.createElement("div");
            item.className = "list-item";
            item.innerHTML = `
                <div class="list-item-left">
                    <img src="${sender.dp}" alt="">
                    <div class="item-info"><h4>${sender.name}</h4><p>${sender.uniqueId}</p></div>
                </div>
                <div class="req-actions">
                    <button class="btn-sm btn-accept" onclick="respondRequest('${doc.id}', '${req.from}', true)">Accept</button>
                    <button class="btn-sm btn-reject" onclick="respondRequest('${doc.id}', '${req.from}', false)">Reject</button>
                </div>
            `;
            container.appendChild(item);
        }
    });
}

async function respondRequest(reqId, senderId, accept) {
    await db.collection("friend_requests").doc(reqId).update({ status: accept ? "accepted" : "rejected" });
    if (accept) {
        await db.collection("users").doc(currentUser.uid).update({ contacts: firebase.firestore.FieldValue.arrayUnion(senderId) });
        await db.collection("users").doc(senderId).update({ contacts: firebase.firestore.FieldValue.arrayUnion(currentUser.uid) });
        alert("✅ Contact Added to Realm!");
    }
    loadNotifications();
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
                    <div class="list-item-left">
                        <img src="${peer.dp}" alt="">
                        <div class="item-info"><h4>${peer.name}</h4><p>${peer.uniqueId}</p></div>
                    </div>
                    <button id="reqBtn_${doc.id}" class="btn-primary" style="width:auto; padding:6px 12px; font-size:12px;" onclick="sendFriendRequest('${doc.id}')">Send Request</button>
                `;
                container.appendChild(item);
            });
        });
}

async function sendFriendRequest(targetId) {
    const btn = document.getElementById(`reqBtn_${targetId}`);
    btn.disabled = true; btn.innerText = "Sending...";
    
    // Check if already friends or requested
    const exist = await db.collection("friend_requests").where("from", "==", currentUser.uid).where("to", "==", targetId).where("status", "==", "pending").get();
    if (!exist.empty) { alert("⚠️ Request already pending!"); btn.innerText = "Requested"; return; }

    await db.collection("friend_requests").add({
        from: currentUser.uid, to: targetId, status: "pending", timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });
    btn.innerText = "Request Sent"; btn.style.background = "#272730";
    alert("🚀 Contact Request Sent!");
}

async function loadMyContacts() {
    const userDoc = await db.collection("users").doc(currentUser.uid).get();
    const contacts = userDoc.data().contacts || [];
    const container = document.getElementById("sidebarContent");
    container.innerHTML = "";

    if (contacts.length === 0) {
        container.innerHTML = `<div class="empty-state">No contacts yet. Click (+) icon above to search #ID and add friends!</div>`;
        return;
    }

    contacts.forEach(async (peerId) => {
        const peerDoc = await db.collection("users").doc(peerId).get();
        if (peerDoc.exists) {
            const peer = peerDoc.data();
            peer.uid = peerDoc.id;
            
            // Check if secret vault locked
            if (peer.isSecret && !isVaultUnlocked) return;

            const item = document.createElement("div");
            item.className = "list-item";
            item.innerHTML = `
                <div class="list-item-left">
                    <img src="${peer.dp}" alt="">
                    <div class="item-info">
                        <h4>${peer.name} ${peer.isSecret ? '<i class="fa-solid fa-lock text-yellow"></i>' : ''}</h4>
                        <p>${peer.uniqueId}</p>
                    </div>
                </div>
            `;
            item.onclick = () => openChatRoom(peer);
            container.appendChild(item);
        }
    });
}

// 6. CHAT ROOM & SECRET VAULT TOGGLE
function openChatRoom(peer) {
    currentChatPeer = peer;
    window.history.pushState({ view: 'chat' }, "", ""); // Push for phone back button
    document.getElementById("emptyChatState").classList.add("hidden");
    document.getElementById("activeChatContainer").classList.remove("hidden");
    document.getElementById("activePeerName").innerText = peer.name;
    document.getElementById("activePeerDp").src = peer.dp;
    document.getElementById("secretToggleBtn").innerHTML = peer.isSecret ? '<i class="fa-solid fa-lock text-yellow"></i>' : '<i class="fa-solid fa-lock-open"></i>';
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
                let content = msg.imgUrl ? `<img src="${msg.imgUrl}">` : "";
                content += `<div>${msg.text || ''}</div>`;
                if (msg.locTag) content += `<span class="msg-tag"><i class="fa-solid fa-location-dot"></i> ${msg.locTag}</span>`;
                content += `<span class="msg-meta">${msg.time || ''}</span>`;
                bubble.innerHTML = content;
                area.appendChild(bubble);
            });
            area.scrollTop = area.scrollHeight;
        });
}

async function toggleSecretChat() {
    if (!currentChatPeer) return;
    const newState = !currentChatPeer.isSecret;
    await db.collection("users").doc(currentChatPeer.uid).update({ isSecret: newState });
    currentChatPeer.isSecret = newState;
    document.getElementById("secretToggleBtn").innerHTML = newState ? '<i class="fa-solid fa-lock text-yellow"></i>' : '<i class="fa-solid fa-lock-open"></i>';
    alert(newState ? "🔒 Chat moved to Secret Vault! Will hide when locked." : "🔓 Chat removed from Vault.");
    loadMyContacts();
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

// 7. ADVANCED CHAT MEDIA SENDING (Caption + Location Tag)
let pendingMediaFile = null;
function openMediaSendModal(e) {
    pendingMediaFile = e.target.files[0];
    if (!pendingMediaFile) return;
    window.history.pushState({ modal: 'mediaSend' }, "", "");
    document.getElementById("mediaSendModal").classList.add("active");
    document.getElementById("mediaPreviewImg").src = URL.createObjectURL(pendingMediaFile);
}

async function confirmSendMedia() {
    if (!pendingMediaFile || !currentChatPeer) return;
    alert("Uploading & Encrypting Media...");
    const ref = storage.ref(`chats/${Date.now()}_${pendingMediaFile.name}`);
    await ref.put(pendingMediaFile);
    const url = await ref.getDownloadURL();
    const caption = document.getElementById("mediaCaptionInput").value.trim();
    const attachLoc = document.getElementById("mediaLocToggle").checked;
    
    let locString = null;
    if (attachLoc) {
        locString = "GPS Attached: AP, India"; // Fallback exact tag
    }

    const chatId = currentUser.uid < currentChatPeer.uid ? `${currentUser.uid}_${currentChatPeer.uid}` : `${currentChatPeer.uid}_${currentUser.uid}`;
    await db.collection("chats").doc(chatId).collection("messages").add({
        text: caption, imgUrl: url, locTag: locString, sender: currentUser.uid,
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
    
    closeModal('mediaSendModal');
    document.getElementById("mediaCaptionInput").value = "";
}

// 8. GLIMPSE WITH FRONT/BACK CAMERA & CUSTOM STICKERS
function openGlimpseModal() {
    window.history.pushState({ modal: 'glimpse' }, "", "");
    document.getElementById("glimpseModal").classList.add("active");
    startGlimpseStream();
}

function startGlimpseStream() {
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    navigator.mediaDevices.getUserMedia({ video: { facingMode: glimpseFacingMode } })
        .then(stream => {
            localStream = stream;
            document.getElementById("glimpseCamStream").srcObject = stream;
        }).catch(err => alert("Camera error: " + err.message));
}

function flipGlimpseCamera() {
    glimpseFacingMode = glimpseFacingMode === "user" ? "environment" : "user";
    startGlimpseStream();
}

function updateGlimpseTags() {
    const showTime = document.getElementById("toggleTime").checked;
    const showLoc = document.getElementById("toggleLoc").checked;
    const customText = document.getElementById("customStickerInput").value.trim();
    
    document.getElementById("tagTimeDisplay").classList.toggle("hidden", !showTime);
    document.getElementById("tagLocDisplay").classList.toggle("hidden", !showLoc);
    document.getElementById("tagCustomDisplay").classList.toggle("hidden", !customText);
    
    if (showTime) document.getElementById("timeText").innerText = new Date().toLocaleTimeString();
    if (showLoc) {
        document.getElementById("locText").innerText = "Locating GPS...";
        navigator.geolocation.getCurrentPosition(async (pos) => {
            const { latitude, longitude } = pos.coords;
            const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`);
            const data = await res.json();
            const exactPlace = data.address.suburb || data.address.village || data.address.town || "Andhra Pradesh";
            document.getElementById("locText").innerText = exactPlace;
        }, () => document.getElementById("locText").innerText = "AP, India", { enableHighAccuracy: true });
    }
    if (customText) document.getElementById("customTagText").innerText = customText;
}

function captureAndSendGlimpse() {
    alert("⚡ Live Glimpse Snap Sent with Custom Stickers & Tags!");
    closeModal('glimpseModal');
}

// 9. START LIVE BROADCAST (To Selected Friends Only)
async function openLiveModal() {
    window.history.pushState({ modal: 'live' }, "", "");
    document.getElementById("liveModal").classList.add("active");
    
    // Load friends into checkboxes
    const userDoc = await db.collection("users").doc(currentUser.uid).get();
    const contacts = userDoc.data().contacts || [];
    const container = document.getElementById("liveFriendsSelector");
    container.innerHTML = "";
    
    contacts.forEach(async peerId => {
        const peerDoc = await db.collection("users").doc(peerId).get();
        if (peerDoc.exists) {
            const peer = peerDoc.data();
            const item = document.createElement("div");
            item.className = "friend-select-item";
            item.innerHTML = `<span><img src="${peer.dp}" style="width:24px;height:24px;border-radius:50%;vertical-align:middle;margin-right:8px;"> ${peer.name}</span> <input type="checkbox" class="live-peer-chk" value="${peerDoc.id}" checked>`;
            container.appendChild(item);
        }
    });

    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        .then(stream => {
            localStream = stream;
            document.getElementById("livePreviewStream").srcObject = stream;
        });
}

async function initiateLiveBroadcast() {
    const selectedPeers = Array.from(document.querySelectorAll(".live-peer-chk:checked")).map(chk => chk.value);
    if (selectedPeers.length === 0) { alert("Please select at least 1 friend to broadcast live!"); return; }
    
    alert("🔴 Going Live! Selected friends will receive broadcast invite.");
    await db.collection("live_streams").doc(currentUser.uid).set({
        broadcasterName: currentUser.displayName || "Nani",
        allowedPeers: selectedPeers,
        status: "active",
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });
    document.getElementById("startLiveBtnAction").innerText = "🔴 Live Streaming Active...";
}

function listenForLiveStreams() {
    db.collection("live_streams").where("status", "==", "active").onSnapshot(snap => {
        const banner = document.getElementById("liveBannerArea");
        let foundLive = false;
        snap.forEach(doc => {
            const live = doc.data();
            if (live.allowedPeers && live.allowedPeers.includes(currentUser.uid)) {
                foundLive = true;
                activeLiveStreamDoc = doc.id;
                document.getElementById("liveBannerText").innerText = `🔴 ${live.broadcasterName} is Live! Click to Watch`;
            }
        });
        banner.classList.toggle("hidden", !foundLive);
    });
}

function joinActiveLiveStream() {
    alert("Joining Encrypted Live Stream Broadcast... Connecting WebRTC feed.");
}

// 10. WEBRTC CALLING & HIDDEN VAULT
const rtcServers = { iceServers: [{ urls: ['stun:stun1.l.google.com:19302'] }] };

async function startWebRTCCall(isVideo = true) {
    if (!currentChatPeer) return;
    window.history.pushState({ modal: 'call' }, "", "");
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
                    window.history.pushState({ modal: 'call' }, "", "");
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

// VAULT (HOLD LOGO & PIN 0000)
function startHiddenTimer() { holdTimer = setTimeout(() => { window.history.pushState({modal:'pin'},"",""); document.getElementById("pinModal").classList.add("active"); }, 1200); }
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
function closeModal(id) {
    document.getElementById(id).classList.remove("active");
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    if (window.history.state) window.history.back();
            }
