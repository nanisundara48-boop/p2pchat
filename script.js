// --- 1. STATE MANAGEMENT (LocalStorage Integration) ---
let tabHistory = ['chat-view'];
let currentChatId = 'public'; // 'public' or user ID like 'alex_01'
let currentChatName = 'Public Room';
let isPrivateMode = false;

// Initialize Storage if empty
let chatsData = JSON.parse(localStorage.getItem('nex_chats')) || {
    'public': [
        { sender: 'System', text: 'Welcome to NexChat Public Room! Everyone can see these messages.', time: 'Just now', type: 'incoming' }
    ]
};
let blockedUsers = JSON.parse(localStorage.getItem('nex_blocked')) || [];
let callLogs = JSON.parse(localStorage.getItem('nex_calls')) || [];
let sharedMedia = JSON.parse(localStorage.getItem('nex_media')) || [];

// --- 2. INITIALIZATION ON LOAD ---
document.addEventListener("DOMContentLoaded", () => {
    renderMessages();
    renderMediaVault();
    renderCallLogs();
    updateBlockUI();
    
    // Load saved theme
    const savedTheme = localStorage.getItem('nex_theme') || 'theme-neon';
    document.body.className = savedTheme;
    document.getElementById('theme-selector').value = savedTheme;
});

// --- 3. NAVIGATION & BACK BUTTON LOGIC ---
function switchTab(tabId, title) {
    if (tabHistory[tabHistory.length - 1] !== tabId) {
        tabHistory.push(tabId);
    }
    
    // Switch Panels
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.menu-item').forEach(b => b.classList.remove('active'));
    
    document.getElementById(tabId).classList.add('active');
    
    // Update Header Title
    document.getElementById('current-panel-title').innerText = title;
    
    // Hide chat-specific buttons if not in chat view
    const isChat = (tabId === 'chat-view');
    document.getElementById('mode-switch-btn').style.display = isChat ? 'flex' : 'none';
    document.getElementById('block-btn').style.display = (isChat && isPrivateMode) ? 'flex' : 'none';
}

function goBack() {
    if (tabHistory.length > 1) {
        tabHistory.pop(); // Remove current view
        const prevTab = tabHistory[tabHistory.length - 1];
        
        const titles = {
            'chat-view': currentChatName,
            'contacts-view': 'Private Contacts',
            'shared-view': 'Media Vault',
            'calls-view': 'Call History',
            'settings-view': 'Settings & Themes'
        };
        
        switchTab(prevTab, titles[prevTab] || 'Chat Hub');
    } else {
        alert("You are already at the main home screen!");
    }
}

// --- 4. PUBLIC TO PRIVATE SWITCHING & CHAT ROUTING ---
function toggleChatMode() {
    if (!isPrivateMode) {
        // Switch to Private -> Take user to contacts list to choose whom to chat with
        switchTab('contacts-view', 'Private Contacts');
    } else {
        // Switch back to Public Room
        openPublicRoom();
    }
}

function openPublicRoom() {
    currentChatId = 'public';
    currentChatName = 'Public Room';
    isPrivateMode = false;
    
    document.getElementById('chat-mode-badge').innerText = 'Public Room';
    document.getElementById('chat-mode-badge').className = 'badge public-badge';
    document.getElementById('mode-switch-btn').innerHTML = '<i class="fa-solid fa-shield-halved"></i> <span>Switch to Private</span>';
    document.getElementById('block-btn').style.display = 'none';
    
    document.getElementById('chat-status-banner').innerHTML = '<i class="fa-solid fa-globe"></i> You are currently chatting in the <b>Public Room</b>. Everyone can see these messages.';
    document.getElementById('chat-status-banner').style.borderColor = 'var(--accent-primary)';
    
    switchTab('chat-view', 'Public Room');
    renderMessages();
    updateBlockUI();
}

function openPrivateChat(name, userId) {
    currentChatId = userId;
    currentChatName = name + ' (Private)';
    isPrivateMode = true;
    
    if (!chatsData[userId]) {
        chatsData[userId] = [
            { sender: name, text: `Hello Nani! This is an end-to-end encrypted private glimpse chat with ${name}.`, time: 'Just now', type: 'incoming' }
        ];
        saveChats();
    }
    
    document.getElementById('chat-mode-badge').innerText = 'Private Encrypted';
    document.getElementById('chat-mode-badge').className = 'badge private-badge';
    document.getElementById('mode-switch-btn').innerHTML = '<i class="fa-solid fa-globe"></i> <span>Switch to Public</span>';
    document.getElementById('block-btn').style.display = 'flex';
    
    document.getElementById('chat-status-banner').innerHTML = `<i class="fa-solid fa-lock"></i> End-to-end encrypted private chat with <b>${name}</b>.`;
    document.getElementById('chat-status-banner').style.borderColor = '#ff007f';
    
    switchTab('chat-view', currentChatName);
    renderMessages();
    updateBlockUI();
}

// --- 5. BLOCK / UNBLOCK USER FEATURE ---
function toggleBlockUser() {
    if (!isPrivateMode || currentChatId === 'public') return;
    
    const index = blockedUsers.indexOf(currentChatId);
    if (index === -1) {
        blockedUsers.push(currentChatId);
        alert(`You have blocked ${currentChatName}. They cannot send you messages or photos now.`);
    } else {
        blockedUsers.splice(index, 1);
        alert(`You have unblocked ${currentChatName}.`);
    }
    
    localStorage.setItem('nex_blocked', JSON.stringify(blockedUsers));
    updateBlockUI();
}

function updateBlockUI() {
    const isBlocked = blockedUsers.includes(currentChatId);
    const blockBtn = document.getElementById('block-btn');
    const inputBar = document.getElementById('input-bar-container');
    const blockedNotice = document.getElementById('blocked-notice');
    
    if (isPrivateMode) {
        blockBtn.innerHTML = isBlocked ? '<i class="fa-solid fa-unlock"></i> <span>Unblock</span>' : '<i class="fa-solid fa-ban"></i> <span>Block</span>';
        blockBtn.className = isBlocked ? 'action-btn colorful-btn' : 'action-btn danger-btn';
    }
    
    if (isBlocked) {
        inputBar.style.display = 'none';
        blockedNotice.style.display = 'block';
    } else {
        inputBar.style.display = 'flex';
        blockedNotice.style.display = 'none';
    }
    
    // Update contact status in contacts tab
    if (document.getElementById(`status-${currentChatId}`)) {
        document.getElementById(`status-${currentChatId}`).innerText = isBlocked ? 'BLOCKED USER' : 'Available for Glimpse chat';
        document.getElementById(`status-${currentChatId}`).style.color = isBlocked ? 'var(--danger-color)' : 'var(--text-muted)';
    }
}

// --- 6. MESSaging & REAL PHOTO SENDING (Base64) ---
function sendMessage() {
    if (blockedUsers.includes(currentChatId)) return;
    
    const inputField = document.getElementById('msg-input');
    const text = inputField.value.trim();
    if (!text) return;
    
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    // Append Outgoing Message
    addMessageToChat(currentChatId, { sender: 'You', text: text, time: timeStr, type: 'outgoing' });
    inputField.value = '';
    
    // Simulate AI / Friend Reply after 1.5 seconds
    setTimeout(() => {
        if (!blockedUsers.includes(currentChatId)) {
            const replyText = isPrivateMode ? 
                `[Encrypted Glimpse] Received your message: "${text}" safely!` : 
                `[Public Broadcast] Someone liked your message in the public room!`;
            addMessageToChat(currentChatId, { sender: isPrivateMode ? currentChatName : 'Group Member', text: replyText, time: 'Just now', type: 'incoming' });
        }
    }, 1500);
}

function handleKeyPress(event) {
    if (event.key === 'Enter') sendMessage();
}

function sendPhoto(event) {
    if (blockedUsers.includes(currentChatId)) return;
    
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
        const base64Image = e.target.result;
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        // 1. Add image message to chat
        addMessageToChat(currentChatId, { sender: 'You', image: base64Image, time: timeStr, type: 'outgoing' });
        
        // 2. Save image to Shared Media Vault
        sharedMedia.unshift(base64Image);
        localStorage.setItem('nex_media', JSON.stringify(sharedMedia));
        renderMediaVault();
    };
    reader.readAsDataURL(file);
}

function addMessageToChat(chatId, msgObj) {
    if (!chatsData[chatId]) chatsData[chatId] = [];
    chatsData[chatId].push(msgObj);
    saveChats();
    
    if (currentChatId === chatId) {
        renderMessages();
    }
}

function saveChats() {
    localStorage.setItem('nex_chats', JSON.stringify(chatsData));
}

function renderMessages() {
    const chatBox = document.getElementById('chat-box');
    chatBox.innerHTML = '';
    
    const currentMessages = chatsData[currentChatId] || [];
    currentMessages.forEach(msg => {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${msg.type}`;
        
        let contentHtml = `<div>${msg.text || ''}</div>`;
        if (msg.image) {
            contentHtml = `<img src="${msg.image}" alt="Sent Photo">`;
        }
        
        msgDiv.innerHTML = `
            ${contentHtml}
            <div class="msg-meta">${msg.sender} • ${msg.time}</div>
        `;
        chatBox.appendChild(msgDiv);
    });
    
    chatBox.scrollTop = chatBox.scrollHeight;
}

// --- 7. SHARED MEDIA VAULT & CALL LOGS ---
function renderMediaVault() {
    const grid = document.getElementById('media-vault-grid');
    grid.innerHTML = '';
    
    if (sharedMedia.length === 0) {
        grid.innerHTML = `<p style="color:var(--text-muted); grid-column: 1/-1;">No photos shared yet. Use the camera icon in chat to send photos!</p>`;
        return;
    }
    
    sharedMedia.forEach(imgSrc => {
        const img = document.createElement('img');
        img.src = imgSrc;
        grid.appendChild(img);
    });
}

function logCall(callType) {
    const timeStr = new Date().toLocaleString();
    const targetName = isPrivateMode ? currentChatName : 'Public Voice Room';
    
    callLogs.unshift({ type: callType, target: targetName, time: timeStr });
    localStorage.setItem('nex_calls', JSON.stringify(callLogs));
    renderCallLogs();
    
    alert(`Initiating Encrypted ${callType} with ${targetName}... Added to Call History!`);
}

function renderCallLogs() {
    const container = document.getElementById('call-logs-container');
    container.innerHTML = '';
    
    if (callLogs.length === 0) {
        container.innerHTML = `<p style="color:var(--text-muted); text-align:center;">No call records found.</p>`;
        return;
    }
    
    callLogs.forEach(call => {
        const row = document.createElement('div');
        row.className = 'call-log-row';
        row.innerHTML = `
            <div>
                <strong><i class="fa-solid fa-phone-arrow-up-right"></i> ${call.type} - ${call.target}</strong>
                <div style="font-size:12px; color:var(--text-muted); margin-top:4px;">${call.time}</div>
            </div>
            <span style="color:var(--success-color); font-weight:bold; font-size:13px;">Secured</span>
        `;
        container.appendChild(row);
    });
}

// --- 8. COLORFUL THEMES & SETTINGS ---
function applyTheme() {
    const selectedTheme = document.getElementById('theme-selector').value;
    document.body.className = selectedTheme;
    localStorage.setItem('nex_theme', selectedTheme);
}

function clearAllData() {
    if (confirm("Are you sure? This will delete all messages, sent photos, block lists, and call logs!")) {
        localStorage.clear();
        location.reload();
    }
}

function triggerLogout() {
    alert("Logging out from NexChat Pro... Clearing current active session safely.");
    location.reload();
}
