document.addEventListener('DOMContentLoaded', () => {
  const socket = io();

  // Application State
  const state = {
    user: null,
    currentRoom: 'general',
    activeDM: null, // socketId if in DM mode
    soundEnabled: true,
    typingTimer: null,
    pendingAttachment: null // { type: 'image'|'audio', dataUrl }
  };

  // Web Audio Synthesizer (Instant Sound FX without audio asset files)
  const soundFX = {
    playSend() {
      if (!state.soundEnabled) return;
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.1);
      } catch (e) {}
    },
    playReceive() {
      if (!state.soundEnabled) return;
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(587.33, ctx.currentTime);
        osc.frequency.setValueAtTime(880, ctx.currentTime + 0.08);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.2);
      } catch (e) {}
    }
  };

  // DOM Elements
  const loginModal = document.getElementById('login-modal');
  const loginForm = document.getElementById('login-form');
  const mainLayout = document.getElementById('main-layout');
  const usernameInput = document.getElementById('username-input');
  const avatarPicker = document.getElementById('avatar-picker');
  const statusSelect = document.getElementById('status-select');

  const currentUserAvatar = document.getElementById('current-user-avatar');
  const currentUserName = document.getElementById('current-user-name');
  const currentUserStatus = document.getElementById('current-user-status');
  
  const roomsList = document.getElementById('rooms-list');
  const usersList = document.getElementById('users-list');
  const userCount = document.getElementById('user-count');
  const addRoomBtn = document.getElementById('add-room-btn');
  const currentRoomTitle = document.getElementById('current-room-title');
  
  const messagesFeed = document.getElementById('messages-feed');
  const messagesContainer = document.getElementById('messages-container');
  const chatForm = document.getElementById('chat-form');
  const messageInput = document.getElementById('message-input');
  const typingBar = document.getElementById('typing-bar');

  const emojiPickerBtn = document.getElementById('emoji-picker-btn');
  const emojiPopover = document.getElementById('emoji-popover');
  const imageInput = document.getElementById('image-input');
  const voiceRecordBtn = document.getElementById('voice-record-btn');
  const attachmentPreview = document.getElementById('attachment-preview');
  const previewText = document.getElementById('preview-text');
  const removeAttachment = document.getElementById('remove-attachment');
  const soundToggle = document.getElementById('sound-toggle');

  // Avatar Selection Listener
  avatarPicker.addEventListener('click', (e) => {
    const opt = e.target.closest('.avatar-opt');
    if (!opt) return;
    document.querySelectorAll('.avatar-opt').forEach(el => el.classList.remove('selected'));
    opt.classList.add('selected');
  });

  // Handle Login Form Submit
  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const username = usernameInput.value.trim();
    const avatar = document.querySelector('.avatar-opt.selected')?.dataset.avatar || '⚡';
    const status = statusSelect.value;

    if (!username) return;

    state.user = { username, avatar, status };
    
    // UI Update
    currentUserAvatar.textContent = avatar;
    currentUserName.textContent = username;
    currentUserStatus.className = `status-dot ${status}`;

    loginModal.classList.remove('active');
    loginModal.classList.add('hidden');
    mainLayout.classList.remove('hidden');

    // Emit socket login event
    socket.emit('user_join', { username, avatar, status });
  });

  // Socket Init Data Handler
  socket.on('init_data', ({ user, rooms, history, usersList: allUsers }) => {
    state.user.id = user.id;
    renderRooms(rooms);
    renderUsers(allUsers);
    renderHistory(history);
  });

  // Render Rooms
  function renderRooms(rooms) {
    roomsList.innerHTML = '';
    rooms.forEach((room) => {
      const li = document.createElement('li');
      li.className = `nav-item ${room === state.currentRoom && !state.activeDM ? 'active' : ''}`;
      li.innerHTML = `<span>#</span> <span>${room}</span>`;
      li.addEventListener('click', () => switchRoom(room));
      roomsList.appendChild(li);
    });
  }

  // Render Online Users
  function renderUsers(users) {
    usersList.innerHTML = '';
    const otherUsers = users.filter(u => u.id !== socket.id);
    userCount.textContent = otherUsers.length;

    otherUsers.forEach((u) => {
      const li = document.createElement('li');
      li.className = `nav-item ${state.activeDM === u.id ? 'active' : ''}`;
      li.innerHTML = `
        <span>${u.avatar}</span>
        <span style="flex:1">${u.username}</span>
        <span class="status-dot ${u.status}"></span>
      `;
      li.addEventListener('click', () => startDM(u));
      usersList.appendChild(li);
    });
  }

  // Switch Public Channel
  function switchRoom(room) {
    state.currentRoom = room;
    state.activeDM = null;
    currentRoomTitle.textContent = room;
    socket.emit('switch_room', room);

    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    renderRooms(Array.from(document.querySelectorAll('#rooms-list li span:nth-child(2)')).map(el => el.textContent));
  }

  // Start Direct Message
  function startDM(targetUser) {
    state.activeDM = targetUser.id;
    currentRoomTitle.textContent = `@${targetUser.username}`;
    messagesFeed.innerHTML = `<div class="sys-msg">Direct message session started with @${targetUser.username}</div>`;
  }

  // Create New Channel Button
  addRoomBtn.addEventListener('click', () => {
    const name = prompt('Enter new channel name:');
    if (name) {
      socket.emit('create_room', name);
    }
  });

  socket.on('room_created', ({ rooms }) => {
    renderRooms(rooms);
  });

  socket.on('room_switched', ({ room, history }) => {
    renderHistory(history);
  });

  // Render Message History
  function renderHistory(history) {
    messagesFeed.innerHTML = '';
    history.forEach(appendMessage);
    scrollToBottom();
  }

  // Handle Incoming Messages
  socket.on('receive_message', (msg) => {
    appendMessage(msg);
    scrollToBottom();
    if (msg.senderId !== socket.id) soundFX.playReceive();
  });

  socket.on('receive_direct_message', (msg) => {
    appendMessage(msg);
    scrollToBottom();
    if (msg.senderId !== socket.id) soundFX.playReceive();
  });

  socket.on('system_message', (msg) => {
    const div = document.createElement('div');
    div.className = 'sys-msg';
    div.textContent = `[${msg.timestamp}] ${msg.text}`;
    messagesFeed.appendChild(div);
    scrollToBottom();
  });

  // Append Single Message to Feed
  function appendMessage(msg) {
    const isMe = msg.senderId === socket.id;
    const row = document.createElement('div');
    row.className = `msg-row ${isMe ? 'me' : ''}`;
    row.id = msg.id;

    let contentHtml = '';
    if (msg.text) contentHtml += `<div>${escapeHtml(msg.text)}</div>`;
    if (msg.type === 'image' && msg.attachmentUrl) {
      contentHtml += `<img src="${msg.attachmentUrl}" class="msg-img" alt="shared image">`;
    }
    if (msg.type === 'audio' && msg.attachmentUrl) {
      contentHtml += `<audio controls src="${msg.attachmentUrl}" class="audio-player"></audio>`;
    }

    row.innerHTML = `
      <span class="msg-avatar">${msg.avatar}</span>
      <div class="msg-body">
        <div class="msg-header">
          <span class="msg-sender">${msg.sender}</span>
          <span class="msg-time">${msg.timestamp}</span>
        </div>
        <div class="msg-bubble">${contentHtml}</div>
        <div class="reactions-list" id="reactions-${msg.id}"></div>
      </div>
    `;

    messagesFeed.appendChild(row);
  }

  // Handle Send Message Form Submit
  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = messageInput.value.trim();
    if (!text && !state.pendingAttachment) return;

    const payload = {
      text,
      type: state.pendingAttachment ? state.pendingAttachment.type : 'text',
      attachmentUrl: state.pendingAttachment ? state.pendingAttachment.dataUrl : null,
      isDirect: !!state.activeDM,
      recipientId: state.activeDM,
      targetRoom: state.currentRoom
    };

    socket.emit('send_message', payload);
    soundFX.playSend();

    // Reset Input & Attachments
    messageInput.value = '';
    clearAttachment();
    socket.emit('typing_stop');
  });

  // Image Attachment Upload Listener
  imageInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      state.pendingAttachment = { type: 'image', dataUrl: evt.target.result };
      previewText.textContent = `📷 Image: ${file.name}`;
      attachmentPreview.classList.remove('hidden');
    };
    reader.readAsDataURL(file);
  });

  // Voice Recording Logic (MediaRecorder API)
  let mediaRecorder = null;
  let audioChunks = [];
  let isRecording = false;

  voiceRecordBtn.addEventListener('click', async () => {
    if (!isRecording) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];

        mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data);
        mediaRecorder.onstop = () => {
          const blob = new Blob(audioChunks, { type: 'audio/webm' });
          const reader = new FileReader();
          reader.onload = (evt) => {
            state.pendingAttachment = { type: 'audio', dataUrl: evt.target.result };
            previewText.textContent = '🎙️ Voice Note Ready';
            attachmentPreview.classList.remove('hidden');
          };
          reader.readAsDataURL(blob);
          stream.getTracks().forEach(track => track.stop());
        };

        mediaRecorder.start();
        isRecording = true;
        voiceRecordBtn.style.color = '#ef4444';
        voiceRecordBtn.title = 'Click again to Stop Recording';
      } catch (err) {
        alert('Microphone access denied or not supported.');
      }
    } else {
      mediaRecorder.stop();
      isRecording = false;
      voiceRecordBtn.style.color = '';
      voiceRecordBtn.title = 'Hold/Click to Record Voice Note';
    }
  });

  function clearAttachment() {
    state.pendingAttachment = null;
    attachmentPreview.classList.add('hidden');
    imageInput.value = '';
  }

  removeAttachment.addEventListener('click', clearAttachment);

  // Live Typing Indicators
  messageInput.addEventListener('input', () => {
    socket.emit('typing_start');
    clearTimeout(state.typingTimer);
    state.typingTimer = setTimeout(() => {
      socket.emit('typing_stop');
    }, 1500);
  });

  socket.on('typing_update', (typers) => {
    const filtered = typers.filter(t => t !== state.user?.username);
    if (filtered.length > 0) {
      typingBar.textContent = `⚡ ${filtered.join(', ')} ${filtered.length === 1 ? 'is' : 'are'} typing...`;
    } else {
      typingBar.textContent = '';
    }
  });

  socket.on('users_update', (users) => renderUsers(users));

  // Emoji Popover
  emojiPickerBtn.addEventListener('click', () => {
    emojiPopover.classList.toggle('hidden');
  });

  emojiPopover.addEventListener('click', (e) => {
    if (e.target.classList.contains('emoji-opt')) {
      messageInput.value += e.target.textContent;
      emojiPopover.classList.add('hidden');
      messageInput.focus();
    }
  });

  soundToggle.addEventListener('click', () => {
    state.soundEnabled = !state.soundEnabled;
    soundToggle.textContent = state.soundEnabled ? '🔔' : '🔕';
  });

  function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]));
  }
});
