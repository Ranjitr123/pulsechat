
require('dotenv').config(); // Load environment variables from .env file

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const nodemailer = require('nodemailer');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  maxHttpBufferSize: 1e7
});

// Nodemailer SMTP Transporter (Uses Gmail / Free SMTP)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER || '',
    pass: process.env.EMAIL_PASS || ''
  }
});

// In-Memory Data Store
const users = {}; 
const pendingOtps = {};
const roomHistory = {
  general: [],
  'tech-lounge': [],
  'design-hub': [],
  random: []
};
const directMessages = {};
const customRooms = new Set(['general', 'tech-lounge', 'design-hub', 'random']);

function getDmKey(email1, email2) {
  return [email1.toLowerCase(), email2.toLowerCase()].sort().join('::');
}

io.on('connection', (socket) => {
  console.log(`🔌 New client connected: ${socket.id}`);

  // 1. Send Email Verification OTP
  socket.on('send_email_otp', async ({ email }, callback) => {
    const cleanEmail = (email || '').toLowerCase().trim();
    if (!cleanEmail) return callback({ success: false, message: 'Invalid email' });

    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    pendingOtps[cleanEmail] = otp;

    let emailSent = false;

    // Send Real Email if EMAIL_USER and EMAIL_PASS environment variables are configured
    if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
      try {
        await transporter.sendMail({
          from: `"PulseChat Verification" <${process.env.EMAIL_USER}>`,
          to: cleanEmail,
          subject: `${otp} is your PulseChat Verification Code`,
          html: `
            <div style="font-family: Arial, sans-serif; padding: 24px; background-color: #0b0f19; color: #ffffff; border-radius: 12px; border: 1px solid #6366f1;">
              <h2 style="color: #6366f1; margin-top: 0;">⚡ PulseChat Email Verification</h2>
              <p>Your 4-digit verification code to join the PulseChat workspace is:</p>
              <h1 style="font-size: 36px; letter-spacing: 6px; color: #06b6d4; background: rgba(255,255,255,0.08); padding: 12px 24px; display: inline-block; border-radius: 8px;">${otp}</h1>
              <p style="color: #9ca3af; font-size: 13px; margin-top: 24px;">If you did not request this verification code, please ignore this message.</p>
            </div>
          `
        });
        emailSent = true;
        console.log(`📧 Real verification email successfully sent to: ${cleanEmail}`);
      } catch (err) {
        console.error('❌ Email sending error:', err.message);
      }
    } else {
      console.log(`ℹ️ EMAIL_USER not set. Displaying code [${otp}] in UI fallback.`);
    }

    callback({ success: true, otp, emailSent });
  });

  // 2. User Join App
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

  // 3. Switch Channel
  socket.on('switch_room', (newRoom) => {
    const user = users[socket.id];
    if (!user) return;

    const oldRoom = user.currentRoom;
    if (oldRoom && oldRoom !== newRoom) socket.leave(oldRoom);

    user.currentRoom = newRoom;
    user.activeDmRecipientEmail = null;
    socket.join(newRoom);

    if (!roomHistory[newRoom]) roomHistory[newRoom] = [];
    
    socket.emit('room_switched', {
      room: newRoom,
      history: roomHistory[newRoom]
    });
  });

  // 4. Open Private DM
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

  // 5. Send Message
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
      const dmKey = getDmKey(sender.email, messageData.recipientEmail);
      if (!directMessages[dmKey]) directMessages[dmKey] = [];
      directMessages[dmKey].push(messageData);

      const targetSockets = Object.values(users).filter(
        u => u.email === sender.email || u.email === messageData.recipientEmail.toLowerCase()
      );

      targetSockets.forEach(u => {
        io.to(u.id).emit('receive_direct_message', messageData);
      });
    } else {
      const room = payload.targetRoom || sender.currentRoom;
      if (!roomHistory[room]) roomHistory[room] = [];
      roomHistory[room].push(messageData);

      io.to(room).emit('receive_message', messageData);
    }
  });

  // 6. User Disconnect
  socket.on('disconnect', () => {
    const user = users[socket.id];
    if (user) {
      delete users[socket.id];
      io.emit('users_update', Object.values(users));
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 PulseChat Server running on http://localhost:${PORT}`);
});
