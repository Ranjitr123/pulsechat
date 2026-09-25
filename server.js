const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  maxHttpBufferSize: 1e7 // 10MB payload support for base64 images & audio notes
});

// In-Memory Data Store
const users = {}; // socketId -> { id, username, email, verified, avatar, status, currentRoom }
const roomHistory = {
  general: [],
  'tech-lounge': [],
  'design-hub': [],
  random: []
};
const directMessages = {}; // DM key "email1::email2" -> array of messages
const customRooms = new Set(['general', 'tech-lounge', 'design-hub', 'random']);

function getDmKey(email1, email2) {
  return [email1.toLowerCase(), email2.toLowerCase()].sort().join('::');
}

io.on('connection', (socket) => {
  console.log(`🔌 New client connected: ${socket.id}`);

  // 1. User Join App with Email Verification
  socket.on('user_join', ({ username, email, avatar, status }) => {
    const cleanEmail = (email || '').toLowerCase().trim();
    
    users[socket.id] = {
      id: socket.id,
      username: username || `User_${socket.id.substring(0, 4)}`,
      email: cleanEmail,
      verified: true,
      avatar: avatar || '⚡',
      status: status || 'online',
      currentRoom: 'general',
      activeDmRecipientEmail: null
    };

    socket.join('general');

    socket.emit('init_data', {
      user: users[socket.id],
      rooms: Array.from(customRooms),
      history: roomHistory['general'] || [],
      usersList: Object.values(users)
    });

    socket.to('general').emit('system_message', {
      text: `${users[socket.id].username} (${cleanEmail}) joined the workspace. 👋`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });

    io.emit('users_update', Object.values(users));
  });

  // 2. Switch Public Channel
  socket.on('switch_room', (newRoom) => {
    const user = users[socket.id];
    if (!user) return;

    const oldRoom = user.currentRoom;
    if (oldRoom && oldRoom !== newRoom) {
      socket.leave(oldRoom);
    }

    user.currentRoom = newRoom;
    user.activeDmRecipientEmail = null;
    socket.join(newRoom);

    if (!roomHistory[newRoom]) roomHistory[newRoom] = [];
    
    socket.emit('room_switched', {
      room: newRoom,
      history: roomHistory[newRoom]
    });
  });

  // 3. Open Private Direct Message Session
  socket.on('open_dm', ({ targetEmail }) => {
    const user = users[socket.id];
    if (!user || !targetEmail) return;

    const cleanTargetEmail = targetEmail.toLowerCase().trim();
    user.activeDmRecipientEmail = cleanTargetEmail;

    const dmKey = getDmKey(user.email, cleanTargetEmail);
    if (!directMessages[dmKey]) directMessages[dmKey] = [];

    const recipientUser = Object.values(users).find(u => u.email === cleanTargetEmail);

    socket.emit('dm_opened', {
      targetEmail: cleanTargetEmail,
      recipientUser: recipientUser || { username: cleanTargetEmail.split('@')[0], email: cleanTargetEmail, avatar: '👤', status: 'offline' },
      history: directMessages[dmKey]
    });
  });

  // 4. Create Custom Channel
  socket.on('create_room', (roomName) => {
    const formatted = roomName.toLowerCase().trim().replace(/\s+/g, '-');
    if (!formatted || customRooms.has(formatted)) return;

    customRooms.add(formatted);
    roomHistory[formatted] = [];

    io.emit('room_created', {
      roomName: formatted,
      rooms: Array.from(customRooms)
    });
  });

  // 5. Send Message (Public Room or Private 1-on-1 DM)
  socket.on('send_message', (payload) => {
    const sender = users[socket.id];
    if (!sender) return;

    const messageData = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      sender: sender.username,
      senderEmail: sender.email,
      avatar: sender.avatar,
      senderId: socket.id,
      text: payload.text || '',
      type: payload.type || 'text',
      attachmentUrl: payload.attachmentUrl || null,
      reactions: {},
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isDirect: payload.isDirect || false,
      recipientEmail: payload.recipientEmail || null,
      targetRoom: payload.targetRoom || sender.currentRoom
    };

    if (messageData.isDirect && messageData.recipientEmail) {
      // Direct Private 1-on-1 Message
      const dmKey = getDmKey(sender.email, messageData.recipientEmail);
      if (!directMessages[dmKey]) directMessages[dmKey] = [];
      directMessages[dmKey].push(messageData);
      if (directMessages[dmKey].length > 100) directMessages[dmKey].shift();

      const targetSockets = Object.values(users).filter(
        u => u.email === sender.email || u.email === messageData.recipientEmail.toLowerCase()
      );

      targetSockets.forEach(u => {
        io.to(u.id).emit('receive_direct_message', {
          ...messageData,
          dmKey
        });
      });
    } else {
      // Public Group Message
      const room = payload.targetRoom || sender.currentRoom;
      if (!roomHistory[room]) roomHistory[room] = [];
      roomHistory[room].push(messageData);
      if (roomHistory[room].length > 50) roomHistory[room].shift();

      io.to(room).emit('receive_message', messageData);
    }
  });

  // 6. Typing Indicators
  socket.on('typing_start', ({ isDirect, recipientEmail, room }) => {
    const user = users[socket.id];
    if (!user) return;

    if (isDirect && recipientEmail) {
      const targetSockets = Object.values(users).filter(u => u.email === recipientEmail.toLowerCase());
      targetSockets.forEach(u => {
        io.to(u.id).emit('typing_update', { typer: user.username, email: user.email, isDirect: true });
      });
    } else {
      const activeRoom = room || user.currentRoom;
      socket.to(activeRoom).emit('typing_update', { typer: user.username, isDirect: false });
    }
  });

  socket.on('typing_stop', ({ isDirect, recipientEmail, room }) => {
    const user = users[socket.id];
    if (!user) return;

    if (isDirect && recipientEmail) {
      const targetSockets = Object.values(users).filter(u => u.email === recipientEmail.toLowerCase());
      targetSockets.forEach(u => {
        io.to(u.id).emit('typing_stop_update', { typer: user.username, email: user.email, isDirect: true });
      });
    } else {
      const activeRoom = room || user.currentRoom;
      socket.to(activeRoom).emit('typing_stop_update', { typer: user.username, isDirect: false });
    }
  });

  // 7. User Disconnect
  socket.on('disconnect', () => {
    const user = users[socket.id];
    if (user) {
      delete users[socket.id];
      io.emit('users_update', Object.values(users));
    }
    console.log(`❌ Client disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 PulseChat Server running on http://localhost:${PORT}`);
});
