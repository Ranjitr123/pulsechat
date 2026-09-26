document.addEventListener('DOMContentLoaded', () => {
  const socket = io();

  // OTP State
  let generatedOtp = null;

  // Application State
  const state = {
    user: null,
    currentRoom: 'general',
    activeDmEmail: null,
    soundEnabled: true,
    typingTimer: null,
    pendingAttachment: null
  };

  // Web Audio Synthesizer Sound FX
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
  const loginStep1 = document.getElementById('login-step-1');
  const loginStep2 = document.getElementById('login-step-2');
  const usernameInput = document.getElementById('username-input');
  const emailInput = document.getElementById('email-input');
  const avatarPicker = document.getElementById('avatar-picker');
  const statusSelect = document.getElementById('status-select');
  const verifyEmailDisplay = document.getElementById('verify-email-display');
  const demoCodeVal = document.getElementById('demo-code-val');
  const otpInput = document.getElementById('otp-input');
  const otpError = document.getElementById('otp-error');
  const backToStep1 = document.getElementById('back-to-step1');

  const mainLayout = document.getElementById('main-layout');
  const sidebar = document.getElementById('sidebar');
  const sidebarOverlay = document.getElementById('sidebar-overlay');
  const sidebarToggle = document.getElementById('sidebar-toggle');
  const closeSidebarBtn = document.getElementById('close-sidebar-btn');

  const currentUserAvatar = document.getElementById('current-user-avatar');
  const currentUserName = document.getElementById('current-user-name');
  const currentUserEmail = document.getElementById('current-user-email');
  const currentUserStatus = document.getElementById('current-user-status');
  
  const roomsList = document.getElementById('rooms-list');
  const usersList = document.getElementById('users-list');
  const userCount = document.getElementById('user-count');
  const addRoomBtn = document.getElementById('add-room-btn');
  const currentRoomTitle = document.getElementById('current-room-title');
  const roomSubtitle = document.getElementById('room-subtitle');
  const headerIcon = document.getElementById('header-icon');
  const chatTypeBadge = document.getElementById('chat-type-badge');
  
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

  // Mobile Drawer Toggle Listeners
  function openSidebar() {
    sidebar.classList.add('open');
    sidebarOverlay.classList.add('active');
  }

  function closeSidebar() {
    sidebar.classList.remove('open');
    sidebarOverlay.classList.remove('active');
  }

  if (sidebarToggle) sidebarToggle.addEventListener('click', openSidebar);
  if (closeSidebarBtn) closeSidebarBtn.addEventListener('click', closeSidebar);
  if (sidebarOverlay) sidebarOverlay.addEventListener('click', closeSidebar);

  // Avatar Selection Listener
  avatarPicker.addEventListener('click', (e) => {
    const opt = e.target.closest('.avatar-opt');
    if (!opt) return;
    document.querySelectorAll('.avatar-opt').forEach(el => el.classList.remove('selected'));
    opt.classList.add('selected');
  });

  // Step 1 Submit: Send Verification Code to Email
  loginStep1.addEventListener('submit', (e) => {
    e.preventDefault();
    const username = usernameInput.value.trim();
    const email = emailInput.value.trim().toLowerCase();

    if (!username || !email) return;

    const submitBtn = loginStep1.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>Sending Email...</span> ⏳';

    socket.emit('send_email_otp', { email }, (res) => {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span>Send Verification Code</span> ➔';

      if (res && res.success) {
        generatedOtp = res.otp;
        verifyEmailDisplay.textContent = email;

        const demoBanner = document.querySelector('.demo-code-banner');
        if (res.emailSent) {
          demoBanner.innerHTML = `<span>📥 <strong>Verification email sent to ${email}!</strong> Check your inbox.</span>`;
        } else {
          demoBanner.innerHTML = `<span>🔑 Code: <strong id="demo-code-val">${res.otp}</strong></span>`;
        }

        loginStep1.classList.add('hidden');
        loginStep2.classList.remove('hidden');
        otpInput.focus();
      }
    });
  });

  backToStep1.addEventListener('click', () => {
    loginStep2.classList.add('hidden');
    loginStep1.classList.remove('hidden');
  });

  // Step 2 Submit: Verify Code & Enter Workspace
  loginStep2.addEventListener('submit', (e) => {
    e.preventDefault();
    const enteredCode = otpInput.value.trim();

    if (enteredCode !== generatedOtp) {
      otpError.classList.remove('hidden');
      return;
    }

    otpError.classList.add('hidden');

    const username = usernameInput.value.trim();
    const email = emailInput.value.trim().toLowerCase();
    const avatar = document.querySelector('.avatar-opt.selected')?.dataset.avatar || '⚡';
    const status = statusSelect.value;

    state.user = { username, email, avatar, status };

    // Update UI Profile Card
    currentUserAvatar.textContent = avatar;
    currentUserName.textContent = username;
    currentUserEmail.textContent = email;
    currentUserStatus.className = `status-dot ${status}`;

    loginModal.classList.remove('active');
    loginModal.classList.add('hidden');
    mainLayout.classList.remove('hidden');

    // Socket Join with Email & Verified Status
    socket.emit('user_join', { username, email, avatar, status });
  });

  // Socket Init Data Handler
  socket.on('init_data', ({ user, rooms, history, usersList: allUsers }) => {
    state.user.id = user.id;
    renderRooms(rooms);
    renderUsers(allUsers);
    renderHistory(history);
  });

  // Render Public Channels List
  function renderRooms(rooms) {
    roomsList.innerHTML = '';
    rooms.forEach((room) => {
      const li = document.createElement('li');
      li.className = `nav-item ${room === state.currentRoom && !state.activeDmEmail ? 'active' : ''}`;
      li.innerHTML = `<span>#</span> <span>${room}</span>`;
      li.addEventListener('click', () => {
        switchRoom(room);
        closeSidebar();
      });
      roomsList.appendChild(li);
    });
  }

  // Render Online Verified Users for DM
  function renderUsers(users) {
    usersList.innerHTML = '';
    const otherUsers = users.filter(u => u.email !== state.user?.email);
    userCount.textContent = otherUsers.length;

    if (otherUsers.length === 0) {
      const emptyLi = document.createElement('li');
      emptyLi.className = 'nav-item';
      emptyLi.style.fontSize = '11px';
      emptyLi.style.opacity = '0.6';
      emptyLi.textContent = 'No other users online';
      usersList.appendChild(emptyLi);
      return;
    }

    otherUsers.forEach((u) => {
      const li = document.createElement('li');
      li.className = `nav-item ${state.activeDmEmail === u.email ? 'active' : ''}`;
      li.innerHTML = `
        <span>${u.avatar}</span>
        <div style="flex:1; overflow:hidden;">
          <div style="font-size:13px; font-weight:600; text-overflow:ellipsis; overflow:hidden;">${escapeHtml(u.username)}</div>
          <span class="dm-email-tag">${escapeHtml(u.email)}</span>
        </div>
        <span class="status-dot ${u.status}"></span>
      `;
      li.addEventListener('click', () => {
        startDM(u);
        closeSidebar();
      });
      usersList.appendChild(li);
    });
  }

  // Switch to Public Channel
  function switchRoom(room) {
    state.currentRoom = room;
    state.activeDmEmail = null;

    headerIcon.textContent = '#';
    currentRoomTitle.textContent = room;
    roomSubtitle.textContent = 'Public group channel';
    chatTypeBadge.className = 'chat-type-badge public-badge';
    chatTypeBadge.textContent = '📢 Public Group';
    messageInput.placeholder = `Message #${room}...`;

    socket.emit('switch_room', room);
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    renderRooms(Array.from(document.querySelectorAll('#rooms-list li span:nth-child(2)')).map(el => el.textContent));
    if (state.user) socket.emit('users_update');
  }

  // Switch to Private Direct Message Session
  function startDM(targetUser) {
    state.activeDmEmail = targetUser.email;
    
    headerIcon.textContent = '🔒';
    currentRoomTitle.textContent = `@${targetUser.username}`;
    roomSubtitle.textContent = `Private 1-on-1 session (${targetUser.email})`;
    chatTypeBadge.className = 'chat-type-badge dm-badge';
    chatTypeBadge.textContent = '🔒 Private 1-on-1';
    messageInput.placeholder = `Private message to @${targetUser.username}...`;

    document.querySelectorAll('#users-list .nav-item').forEach(el => el.classList.remove('active'));

    socket.emit('open_dm', { targetEmail: targetUser.email });
  }

  socket.on('dm_opened', ({ recipientUser, history }) => {
    renderHistory(history);
  });

  // Create Channel Button Listener
  addRoomBtn.addEventListener('click', () => {
    const name = prompt('Enter new public channel name:');
    if (name) {
      socket.emit('create_room', name);
    }
  });

  socket.on('room_created', ({ rooms }) => {
    renderRooms(rooms);
  });

  socket.on('room_switched', ({ history }) => {
    renderHistory(history);
  });

  // Render Chat Message History
  function renderHistory(history) {
    messagesFeed.innerHTML = '';
    if (history.length === 0) {
      const sys = document.createElement('div');
      sys.className = 'sys-msg';
      sys.textContent = state.activeDmEmail 
        ? `🔒 Private chat session started. Messages are end-to-end isolated.`
        : `📢 Joined #${state.currentRoom}. Send a message to get started!`;
      messagesFeed.appendChild(sys);
    } else {
      history.forEach(appendMessage);
    }
    scrollToBottom();
  }

  // Handle Incoming Messages
  socket.on('receive_message', (msg) => {
    if (!state.activeDmEmail && msg.targetRoom === state.currentRoom) {
      appendMessage(msg);
      scrollToBottom();
      if (msg.senderEmail !== state.user?.email) soundFX.playReceive();
    }
  });

  socket.on('receive_direct_message', (msg) => {
    if (state.activeDmEmail && (msg.senderEmail === state.activeDmEmail || msg.recipientEmail === state.activeDmEmail)) {
      appendMessage(msg);
      scrollToBottom();
      if (msg.senderEmail !== state.user?.email) soundFX.playReceive();
    }
  });

  socket.on('system_message', (msg) => {
    if (!state.activeDmEmail) {
      const div = document.createElement('div');
      div.className = 'sys-msg';
      div.textContent = `[${msg.timestamp}] ${msg.text}`;
      messagesFeed.appendChild(div);
      scrollToBottom();
    }
  });

  // Append Single Message to Feed
  function appendMessage(msg) {
    const isMe = msg.senderEmail === state.user?.email;
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
          <span class="msg-sender">${escapeHtml(msg.sender)}</span>
          <span class="msg-time">${msg.timestamp}</span>
        </div>
        <div class="msg-bubble">${contentHtml}</div>
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
      isDirect: !!state.activeDmEmail,
      recipientEmail: state.activeDmEmail,
      targetRoom: state.currentRoom
    };

    socket.emit('send_message', payload);
    soundFX.playSend();

    messageInput.value = '';
    clearAttachment();
    socket.emit('typing_stop', { isDirect: !!state.activeDmEmail, recipientEmail: state.activeDmEmail, room: state.currentRoom });
  });

  // Image Attachment Upload
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

  // Voice Note Recording
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
      } catch (err) {
        alert('Microphone access denied or not supported.');
      }
    } else {
      mediaRecorder.stop();
      isRecording = false;
      voiceRecordBtn.style.color = '';
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
    socket.emit('typing_start', { isDirect: !!state.activeDmEmail, recipientEmail: state.activeDmEmail, room: state.currentRoom });
    clearTimeout(state.typingTimer);
    state.typingTimer = setTimeout(() => {
      socket.emit('typing_stop', { isDirect: !!state.activeDmEmail, recipientEmail: state.activeDmEmail, room: state.currentRoom });
    }, 1500);
  });

  socket.on('typing_update', ({ typer, isDirect, email }) => {
    if (isDirect && email === state.activeDmEmail) {
      typingBar.textContent = `⚡ ${typer} is typing...`;
    } else if (!isDirect && !state.activeDmEmail) {
      typingBar.textContent = `⚡ ${typer} is typing...`;
    }
  });

  socket.on('typing_stop_update', () => {
    typingBar.textContent = '';
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
    return str ? str.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m])) : '';
  }
});
