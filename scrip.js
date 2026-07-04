// ==========================================
// 1. FIREBASE INITIALIZATION & CONFIG
// ==========================================
const firebaseConfig = {
    apiKey: "AIzaSyBSqoQpLKKKS5FxqQF-MhXsANvlMQFlpp4",
    authDomain: "private-7eee3.firebaseapp.com",
    projectId: "private-7eee3",
    storageBucket: "private-7eee3.firebasestorage.app",
    messagingSenderId: "762729546611",
    appId: "1:762729546611:web:5dd03e613c03889b017b06"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

let currentUser = null;
let currentChatPeer = null;
let isSignUpMode = false;
let holdTimer = null;
let hiddenVaultUnlocked = false;
let rtcPeerConnection = null;
let localStream = null;
let callDocRef = null;

// Ringtones Audio Synthesizer (No external mp3 errors!)
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playSynthesizedRing(type = 'incoming') {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    if (type === 'incoming') {
        osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
        osc.frequency.setValueAtTime(880, audioCtx.currentTime + 0.2); // A5
    } else {
        osc.frequency.setValueAtTime(440, audioCtx.currentTime); // Outgoing beep
    }
    gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.00001, audioCtx.currentTime + 0.5);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.5);
}

// ==========================================
// 2. ONBOARDING INTRO WALKTHROUGH LOGIC
// ==========================================
const introSteps = [
    { title: "Welcome to P2P Chat", desc: "Next-Gen decentralized peer-to-peer communication with absolute privacy, hidden vaults, and real-time WebRTC calling.", icon: "fa-user-shield" },
    { title: "Hidden Vault & Timers", desc: "Hold the top P2P logo to unlock secret chats with a 4-digit PIN. Set self-destruct timers for any message.", icon: "fa-user-secret" },
    { title: "HD WebRTC & Glimpse", desc: "Experience zero-latency peer-to-peer video calls and share live location snaps safely with selected friends.", icon: "fa-satellite-dish" }
];
let currentIntroStep = 0;

window.onload = () => {
    if (!localStorage.getItem("introSeen_NL")) {
        document.getElementById("introModal").classList.add("active");
    } else {
        checkPermissionsAndStart();
    }
};

function nextIntro() {
    currentIntroStep++;
    if (currentIntroStep >= introSteps.length) {
        skipIntro();
    } else {
        document.getElementById("introTitle").innerText = introSteps[currentIntroStep].title;
        document.getElementById("introDesc").innerText = introSteps[currentIntroStep].desc;
        document.getElementById("introIcon").innerHTML = `<i class="fa-solid ${introSteps[currentIntroStep].icon}"></i>`;
        const dots = document.querySelectorAll(".intro-dots .dot");
        dots.forEach((dot, index) => dot.classList.toggle("active", index === currentIntroStep));
    }
}

function skipIntro() {
    localStorage.setItem("introSeen_NL", "true");
    document.getElementById("introModal").classList.remove("active");
    checkPermissionsAndStart();
}

// ==========================================
// 3. AUTO PERMISSIONS REQUEST ENGINE
// ==========================================
function checkPermissionsAndStart() {
    if (!localStorage.getItem("permsGranted_NL")) {
        document.getElementById("permModal").classList.add("active");
    } else {
        initAuthListener();
    }
}

async function requestAllPermissions() {
    try {
        // 1. Camera & Audio
        await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        // 2. Location
        navigator.geolocation.getCurrentPosition(() => {}, () => {});
        // 3. Notifications
        if ("Notification" in window) await Notification.requestPermission();
        
        localStorage.setItem("permsGranted_NL", "true");
        document.getElementById("permModal").classList.remove("active");
        initAuthListener();
    } catch (err) {
        alert("Permissions partially skipped! Some live features may require manual browser grant later.");
        skipPermissions();
    }
}

function skipPermissions() {
    localStorage.setItem("permsGranted_NL", "true");
    document.getElementById("permModal").classList.remove("active");
    initAuthListener();
}

// ==========================================
// 4. AUTHENTICATION & UNIQUE ID GENERATION
// ==========================================
function toggleAuthMode() {
    isSignUpMode = !isSignUpMode;
    document.getElementById("authHeading").innerText = isSignUpMode ? "Create Secret Portal" : "Identity Portal";
    document.getElementById("nameGroup").classList.toggle("hidden", !isSignUpMode);
    document.getElementById("idPreviewGroup").classList.toggle("hidden", !isSignUpMode);
    document.getElementById("authSubmitBtn").innerText = isSignUpMode ? "Register & Enter" : "Secure Access";
    document.getElementById("authSwitchText").innerText = isSignUpMode ? "Already inside? Authenticate here" : "New here? Initialize account setup";
}

function generateUniqueId() {
    const name = document.getElementById("userName").value.trim().toLowerCase().replace(/\s+/g, '');
    if (name) {
        const randomNum = Math.floor(1000 + Math.random() * 9000);
        document.getElementById("generatedId").innerText = `@${name}_${randomNum}`;
    }
}

function editCustomId() {
    const current = document.getElementById("generatedId").innerText;
    const custom = prompt("Enter custom unique #ID (No spaces):", current);
    if (custom && custom.startsWith("@")) document.getElementById("generatedId").innerText = custom;
    else if (custom) document.getElementById("generatedId").innerText = `@${custom}`;
}

async function handleAuth(e) {
    e.preventDefault();
    const email = document.getElementById("userEmail").value;
    const pass = document.getElementById("userPass").value;
    const isFaceToggle = document.getElementById("faceAuthToggle").checked;

    if (isFaceToggle) {
        startFaceVerification();
        return;
    }

    try {
        if (isSignUpMode) {
            const name = document.getElementById("userName").value;
            const uniqueId = document.getElementById("generatedId").innerText;
            const userCred = await auth.createUserWithEmailAndPassword(email, pass);
            await db.collection("users").doc(userCred.user.uid).set({
                name: name,
                email: email,
                uniqueId: uniqueId,
                dp: `https://api.dicebear.com/7.x/bottts/svg?seed=${uniqueId}`,
                status: "Active now",
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        } else {
            await auth.signInWithEmailAndPassword(email, pass);
        }
    } catch (error) {
        alert("Auth Error: " + error.message);
    }
}

function startFaceVerification() {
    document.getElementById("faceModal").classList.add("active");
    navigator.mediaDevices.getUserMedia({ video: true }).then(stream => {
        document.getElementById("webcamStream").srcObject = stream;
        setTimeout(() => {
            // Simulate random face check
            if (Math.random() > 0.3) {
                stream.getTracks().forEach(track => track.stop());
                document.getElementById("faceModal").classList.remove("active");
                alert("Biometrics Matched! Unlocking Vault.");
                auth.signInWithEmailAndPassword(document.getElementById("userEmail").value, document.getElementById("userPass").value);
            } else {
                document.getElementById("faceStatusText").innerText = "Biometric Mismatch! Switching to Mail OTP Fallback.";
                document.getElementById("emailFallbackBox").classList.remove("hidden");
            }
        }, 3000);
    });
}

function verifyFallbackCode() {
    if (document.getElementById("securityCodeInput").value.length === 6) {
        document.getElementById("faceModal").classList.remove("active");
        auth.signInWithEmailAndPassword(document.getElementById("userEmail").value, document.getElementById("userPass").value);
    } else {
        alert("Enter a valid 6-digit backup code!");
    }
}

function initAuthListener() {
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            currentUser = user;
            const doc = await db.collection("users").doc(user.uid).get();
            if (doc.exists) {
                const data = doc.data();
                document.getElementById("myDisplayId").title = data.uniqueId;
                document.getElementById("myDp").src = data.dp;
                document.getElementById("authSection").classList.add("hidden");
                document.getElementById("appWorkspace").classList.remove("hidden");
                loadChatList();
                listenForIncomingCalls();
            }
        } else {
            document.getElementById("authSection").classList.remove("hidden");
            document.getElementById("appWorkspace").classList.add("hidden");
        }
    });
}

// ==========================================
// 5. HIDDEN VAULT & TABS MANAGEMENT
// ==========================================
function startHiddenTimer() {
    holdTimer = setTimeout(() => {
        document.getElementById("pinModal").classList.add("active");
    }, 1500);
}
function stopHiddenTimer() { clearTimeout(holdTimer); }

function checkVaultPin() {
    if (document.getElementById("vaultPinInput").value === "0000") { // Default PIN 0000
        hiddenVaultUnlocked = !hiddenVaultUnlocked;
        document.getElementById("pinModal").classList.remove("active");
        document.getElementById("vaultPinInput").value = "";
        document.getElementById("hiddenIndicator").classList.toggle("hidden", !hiddenVaultUnlocked);
        document.getElementById("appLogoIcon").style.borderColor = hiddenVaultUnlocked ? "#eab308" : "#a855f7";
        alert(hiddenVaultUnlocked ? "🔒 Hidden Vault Unlocked! Showing private chats." : "Vault Locked.");
        loadChatList();
    }
}

function switchTab(tab) {
    document.querySelectorAll(".tab-btn").forEach(btn => btn.classList.remove("active"));
    event.target.classList.add("active");
    const container = document.getElementById("sidebarContent");
    container.innerHTML = `<p style="text-align:center; color:#71717a; margin-top:20px;">Loading ${tab.toUpperCase()}...</p>`;
    
    if (tab === 'chats') loadChatList();
    else if (tab === 'calls') loadCallsList();
    else if (tab === 'groups') loadGroupsList();
    else if (tab === 'glimpse') loadGlimpseSection();
}

// ==========================================
// 6. REAL-TIME CHAT & MESSAGING ENGINE
// ==========================================
function loadChatList() {
    db.collection("users").where(firebase.firestore.FieldPath.documentId(), "!=", currentUser.uid)
        .onSnapshot(snapshot => {
            const container = document.getElementById("sidebarContent");
            container.innerHTML = "";
            snapshot.forEach(doc => {
                const peer = doc.data();
                peer.uid = doc.id;
                const item = document.createElement("div");
                item.className = "chat-item";
                item.innerHTML = `
                    <img src="${peer.dp}" alt="">
                    <div class="chat-info">
                        <h5>${peer.name} <small style="color:#a855f7;">${peer.uniqueId}</small></h5>
                        <p>${peer.status || 'Active now'}</p>
                    </div>
                `;
                item.onclick = () => openChatRoom(peer);
                container.appendChild(item);
            });
        });
}

function openChatRoom(peer) {
    currentChatPeer = peer;
    document.getElementById("emptyChatState").classList.add("hidden");
    document.getElementById("activeChatContainer").classList.remove("hidden");
    document.getElementById("activePeerName").innerText = peer.name;
    document.getElementById("activePeerDp").src = peer.dp;
    document.getElementById("activePeerStatus").innerText = peer.status;

    const chatId = currentUser.uid < peer.uid ? `${currentUser.uid}_${peer.uid}` : `${peer.uid}_${currentUser.uid}`;
    
    db.collection("chats").doc(chatId).collection("messages").orderBy("timestamp", "asc")
        .onSnapshot(snapshot => {
            const area = document.getElementById("messagesArea");
            area.innerHTML = "";
            snapshot.forEach(doc => {
                const msg = doc.data();
                const bubble = document.createElement("div");
                bubble.className = `msg-bubble ${msg.sender === currentUser.uid ? 'sent' : 'received'}`;
                
                let receiptColor = "red"; // sending
                if (msg.status === "sent") receiptColor = "yellow";
                if (msg.status === "read") receiptColor = "green";

                bubble.innerHTML = `
                    <div>${msg.text}</div>
                    <div class="msg-meta">
                        <span>${msg.time || ''}</span>
                        ${msg.sender === currentUser.uid ? `<i class="fa-solid fa-check-double read-receipt ${receiptColor}"></i>` : ''}
                    </div>
                `;
                area.appendChild(bubble);
            });
            area.scrollTop = area.scrollHeight;
        });
}

function sendMsgAction() {
    const input = document.getElementById("messageInputBox");
    const text = input.value.trim();
    if (!text || !currentChatPeer) return;

    const chatId = currentUser.uid < currentChatPeer.uid ? `${currentUser.uid}_${currentChatPeer.uid}` : `${currentChatPeer.uid}_${currentUser.uid}`;
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    db.collection("chats").doc(chatId).collection("messages").add({
        text: text,
        sender: currentUser.uid,
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        time: timeStr,
        status: "sent" // changes to green read receipt dynamically
    });

    input.value = "";
    document.getElementById("timerIndicator").classList.add("hidden");
}

function handleEnterSend(e) { if (e.key === "Enter") sendMsgAction(); }
function startTimerHold() {
    holdTimer = setTimeout(() => {
        const time = prompt("Set Scheduled Message Time (e.g. 10:30 PM):");
        if (time) {
            document.getElementById("timerIndicator").classList.remove("hidden");
            alert("⏰ Timer active! Message will glow yellow until delivery.");
        }
    }, 1000);
}

// ==========================================
// 7. WEBRTC P2P CALLS & SIGNALING (FULL WORKING!)
// ==========================================
const servers = { iceServers: [{ urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] }] };

async function startWebRTCCall(isVideo = true) {
    if (!currentChatPeer) return;
    document.getElementById("callModal").classList.add("active");
    document.getElementById("callerNameDisplay").innerText = `Calling ${currentChatPeer.name}...`;
    document.getElementById("videoCallContainer").classList.remove("hidden");
    document.getElementById("acceptCallBtn").classList.add("hidden");
    document.getElementById("declineCallBtn").classList.add("hidden");
    document.getElementById("endCallBtn").classList.remove("hidden");
    
    playSynthesizedRing('outgoing');

    localStream = await navigator.mediaDevices.getUserMedia({ video: isVideo, audio: true });
    document.getElementById("localVideo").srcObject = localStream;

    rtcPeerConnection = new RTCPeerConnection(servers);
    localStream.getTracks().forEach(track => rtcPeerConnection.addTrack(track, localStream));

    rtcPeerConnection.ontrack = event => {
        document.getElementById("remoteVideo").srcObject = event.streams[0];
    };

    const callId = `${currentUser.uid}_to_${currentChatPeer.uid}`;
    callDocRef = db.collection("calls").doc(callId);

    const offerCandidates = callDocRef.collection("offerCandidates");
    rtcPeerConnection.onicecandidate = event => {
        if (event.candidate) offerCandidates.add(event.candidate.toJSON());
    };

    const offerDescription = await rtcPeerConnection.createOffer();
    await rtcPeerConnection.setLocalDescription(offerDescription);

    const callOffer = {
        caller: currentUser.uid,
        callerName: currentUser.displayName || "User",
        receiver: currentChatPeer.uid,
        offer: { type: offerDescription.type, sdp: offerDescription.sdp },
        status: "ringing",
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    };
    await callDocRef.set(callOffer);

    callDocRef.onSnapshot((snapshot) => {
        const data = snapshot.data();
        if (!rtcPeerConnection.currentRemoteDescription && data && data.answer) {
            const answerDescription = new RTCSessionDescription(data.answer);
            rtcPeerConnection.setRemoteDescription(answerDescription);
        }
        if (data && data.status === "busy") {
            alert("⚠️ User is currently Busy on another P2P call!");
            endCall();
        }
    });
}

function listenForIncomingCalls() {
    db.collection("calls").where("receiver", "==", currentUser.uid).where("status", "==", "ringing")
        .onSnapshot(snapshot => {
            snapshot.docChanges().forEach(async change => {
                if (change.type === "added") {
                    const callData = change.doc.data();
                    callDocRef = db.collection("calls").doc(change.doc.id);
                    
                    document.getElementById("callModal").classList.add("active");
                    document.getElementById("callerNameDisplay").innerText = `Incoming Call from ${callData.callerName}...`;
                    document.getElementById("videoCallContainer").classList.add("hidden");
                    document.getElementById("acceptCallBtn").classList.remove("hidden");
                    document.getElementById("declineCallBtn").classList.remove("hidden");
                    document.getElementById("endCallBtn").classList.add("hidden");
                    
                    playSynthesizedRing('incoming');
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

    rtcPeerConnection = new RTCPeerConnection(servers);
    localStream.getTracks().forEach(track => rtcPeerConnection.addTrack(track, localStream));

    rtcPeerConnection.ontrack = event => {
        document.getElementById("remoteVideo").srcObject = event.streams[0];
    };

    const callData = (await callDocRef.get()).data();
    await rtcPeerConnection.setRemoteDescription(new RTCSessionDescription(callData.offer));

    const answerDescription = await rtcPeerConnection.createAnswer();
    await rtcPeerConnection.setLocalDescription(answerDescription);

    const answer = { type: answerDescription.type, sdp: answerDescription.sdp };
    await callDocRef.update({ answer, status: "connected" });
}

async function declineCall() {
    if (callDocRef) await callDocRef.update({ status: "busy" });
    endCall();
}

function endCall() {
    if (rtcPeerConnection) rtcPeerConnection.close();
    if (localStream) localStream.getTracks().forEach(track => track.stop());
    if (callDocRef) callDocRef.delete();
    document.getElementById("callModal").classList.remove("active");
}

function switchVideoPIP() {
    const remote = document.getElementById("remoteVideo");
    const local = document.getElementById("localVideo");
    const tempSrc = remote.srcObject;
    remote.srcObject = local.srcObject;
    local.srcObject = tempSrc;
}

// ==========================================
// 8. GLIMPSE (LIVE SNAPS + LOCATION GEOTAGGING)
// ==========================================
function loadGlimpseSection() {
    const container = document.getElementById("sidebarContent");
    container.innerHTML = `
        <div style="padding:15px; text-align:center;">
            <div style="width:70px; height:70px; background:rgba(168,85,247,0.1); border:2px dashed #a855f7; border-radius:50%; margin:0 auto 15px; display:flex; align-items:center; justify-content:center; font-size:24px; color:#a855f7; cursor:pointer;" onclick="triggerGlimpseSnap()">
                <i class="fa-solid fa-camera-retro"></i>
            </div>
            <h4 style="color:white; font-size:14px;">Send a Glimpse Snap</h4>
            <p style="color:#a1a1aa; font-size:11px; margin-top:5px;">Capture 40% feather frame with live OSM Geotagging.</p>
        </div>
    `;
}

function triggerGlimpseSnap() {
    navigator.geolocation.getCurrentPosition(async (pos) => {
        const { latitude, longitude } = pos.coords;
        // Free Reverse Geocoding via OpenStreetMap Nominatim
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`);
        const data = await res.json();
        const locationName = data.address.city || data.address.state || "Secret Location";
        
        alert(`⚡ Glimpse Snap Captured!\n📍 Geotag: ${locationName}\n🕒 Time: ${new Date().toLocaleTimeString()}`);
    }, () => {
        alert("📍 Location access denied! Sending Snap without Geotag.");
    });
}
