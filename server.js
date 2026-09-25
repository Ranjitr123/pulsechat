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
const users = {}; // socketId -> { id, username, avatar, status, currentRoom }
const roomHistory = {
  general: [],
  'tech-lounge': [],
  'design-hub': [],
  random: []
};
const customRooms = new Set(['general', 'tech-lounge', 'design-hub', 'random']);
const typingUsers = {}; // room -> Set of usernames

io.on('connection', (socket) => {
  console.log(`🔌 New client connected: ${socket.id}`);

  // 1. User Login / Join App
  socket.on('user_join', ({ username, avatar, status }) => {
    users[socket.id] = {
      id: socket.id,
      username: username || `User_${socket.id.substring(0, 4)}`,
      avatar: avatar || '⚡',
      status: status || 'online',
      currentRoom: 'general'
    };

    // Join default room
    socket.join('general');

    // Send room history & active room list
    socket.emit('init_data', {
      user: users[socket.id],
      rooms: Array.from(customRooms),
      history: roomHistory['general'] || [],
      usersList: Object.values(users)
    });

    // Notify others in general channel
    socket.to('general').emit('system_message', {
      text: `${users[socket.id].username} joined the chat. 👋`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });

    // Broadcast updated online users list
    io.emit('users_update', Object.values(users));
  });

  // 2. Switch Room / Channel
  socket.on('switch_room', (newRoom) => {
    const user = users[socket.id];
    if (!user) return;

    const oldRoom = user.currentRoom;
    socket.leave(oldRoom);
    socket.join(newRoom);
    user.currentRoom = newRoom;

    // Send updated room history
    if (!roomHistory[newRoom]) roomHistory[newRoom] = [];
    socket.emit('room_switched', {
      room: newRoom,
      history: roomHistory[newRoom]
    });

    // Notify previous and new room
    socket.to(oldRoom).emit('system_message', {
      text: `${user.username} left the room.`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
    socket.to(newRoom).emit('system_message', {
      text: `${user.username} joined #${newRoom}.`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
  });

  // 3. Create Custom Room
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

  // 4. Send Message (Public Room or Direct Message)
  socket.on('send_message', (payload) => {
    const user = users[socket.id];
    if (!user) return;

    const messageData = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      sender: user.username,
      avatar: user.avatar,
      senderId: socket.id,
      text: payload.text || '',
      type: payload.type || 'text', // 'text', 'image', 'audio'
      attachmentUrl: payload.attachmentUrl || null,
      reactions: {},
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      targetRoom: payload.targetRoom || user.currentRoom,
      isDirect: payload.isDirect || false,
      recipientId: payload.recipientId || null
    };

    if (messageData.isDirect && messageData.recipientId) {
      // Direct message to recipient + echo to sender
      socket.to(messageData.recipientId).emit('receive_direct_message', messageData);
      socket.emit('receive_direct_message', messageData);
    } else {
      // Store in room history (keep max 50)
      const room = messageData.targetRoom;
      if (!roomHistory[room]) roomHistory[room] = [];
      roomHistory[room].push(messageData);
      if (roomHistory[room].length > 50) roomHistory[room].shift();

      // Broadcast message to room
      io.to(room).emit('receive_message', messageData);
    }
  });

  // 5. Typing Indicators
  socket.on('typing_start', () => {
    const user = users[socket.id];
    if (!user) return;
    const room = user.currentRoom;

    if (!typingUsers[room]) typingUsers[room] = new Set();
    typingUsers[room].add(user.username);

    socket.to(room).emit('typing_update', Array.from(typingUsers[room]));
  });

  socket.on('typing_stop', () => {
    const user = users[socket.id];
    if (!user) return;
    const room = user.currentRoom;

    if (typingUsers[room]) {
      typingUsers[room].delete(user.username);
      socket.to(room).emit('typing_update', Array.from(typingUsers[room]));
    }
  });

  // 6. Message Emoji Reactions
  socket.on('toggle_reaction', ({ messageId, emoji, room }) => {
    const user = users[socket.id];
    if (!user) return;

    const history = roomHistory[room];
    if (!history) return;

    const msg = history.find((m) => m.id === messageId);
    if (msg) {
      if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
      const userIdx = msg.reactions[emoji].indexOf(user.username);
      if (userIdx > -1) {
        msg.reactions[emoji].splice(userIdx, 1);
        if (msg.reactions[emoji].length === 0) delete msg.reactions[emoji];
      } else {
        msg.reactions[emoji].push(user.username);
      }
      io.to(room).emit('reaction_updated', { messageId, reactions: msg.reactions, room });
    }
  });

  // 7. Update User Status
  socket.on('update_status', (newStatus) => {
    if (users[socket.id]) {
      users[socket.id].status = newStatus;
      io.emit('users_update', Object.values(users));
    }
  });

  // 8. User Disconnect
  socket.on('disconnect', () => {
    const user = users[socket.id];
    if (user) {
      const room = user.currentRoom;
      socket.to(room).emit('system_message', {
        text: `${user.username} disconnected.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });
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
