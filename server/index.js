const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const stateManager = require('./stateManager');
const { calculateDistanceMeters, generalizeCoordinates } = require('./geoUtils');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

// Shërbe skedarët statikë të klientit (Frontend)
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/vendor/leaflet', express.static(path.join(__dirname, '..', 'node_modules', 'leaflet', 'dist')));
app.use(express.json({ limit: '10mb' })); // Për ngarkimin e fotove në base64

// API për verifikimin e ftesës
app.post('/api/auth/token', (req, res) => {
  const { token } = req.body;
  if (stateManager.validateInviteToken(token)) {
    return res.json({ success: true, message: 'Ftesa u pranua me sukses.' });
  }
  return res.status(403).json({ success: false, message: 'Kodi i ftesës është i pavlefshëm.' });
});

// Statusi i sistemit
app.get('/api/status', (req, res) => {
  res.json({
    onlineUsers: stateManager.users.size,
    activePins: stateManager.getActivePins().length,
    activeSOS: stateManager.getActiveSOS().length,
    timestamp: Date.now()
  });
});

// API për Administratorin
app.post('/api/admin/login', (req, res) => {
  const { adminKey } = req.body;
  if (stateManager.validateAdmin(adminKey)) {
    return res.json({ success: true, message: 'Autentikimi i administratorit u krye me sukses.' });
  }
  return res.status(401).json({ success: false, message: 'Çelësi i administratorit është i pasaktë.' });
});

// Ndihmës: transmeton gjendjen e plotë të një bisede te të gjithë anëtarët e saj
function broadcastChatRoom(chatId) {
  const chat = stateManager.chatRooms.get(chatId);
  if (!chat) return;
  const payload = stateManager.serializeChat(chat);
  for (const memberSocketId of chat.members) {
    io.to(memberSocketId).emit('chat:updated', payload);
  }
}

// Socket.io Real-Time Event Engine
io.on('connection', (socket) => {
  console.log(`[CONNECT] Socket u lidh: ${socket.id}`);

  // Regjistrim me Rol dhe Grup
  socket.on('user:join', (data) => {
    const user = stateManager.registerUser(socket.id, data || {});
    socket.emit('user:registered', {
      user,
      activePins: stateManager.getActivePins(),
      activeSOS: stateManager.getActiveSOS(),
      activeDirectives: stateManager.getActiveDirectives(),
      activeIntel: stateManager.getActiveIntel(),
      specialists: stateManager.getSpecialists(),
      chatRooms: stateManager.getUserChatRooms(socket.id)
    });

    // Nëse përdoruesi hyn në një grup ekzistues (si grupi demo), dërgoji shokët e grupit
    if (user.buddyGroupId) {
      const groupMembers = stateManager.getBuddyGroupMembers(user.buddyGroupId);
      socket.emit('buddy:update', groupMembers);
    }

    // Përditëso densitetin për të gjithë
    io.emit('crowd:density', stateManager.getCrowdDensity());
  });

  // Përditësimi i Pozicionit Live
  socket.on('location:update', (coords) => {
    const user = stateManager.updateLocation(socket.id, coords);
    if (!user) return;

    // Nëse përdoruesi ka një Buddy Group, njofto anëtarët e grupit
    if (user.buddyGroupId) {
      const groupMembers = stateManager.getBuddyGroupMembers(user.buddyGroupId);
      const group = stateManager.buddyGroups.get(user.buddyGroupId);
      if (group) {
        for (const memberSocketId of group.members) {
          io.to(memberSocketId).emit('buddy:update', groupMembers);
        }
      }
    }

    // Proximity Alert Check: Shiko nëse përdoruesi është pranë një pin-i rreziku (50-70m)
    const activePins = stateManager.getActivePins();
    for (const pin of activePins) {
      if (pin.status === 'confirmed') {
        const dist = calculateDistanceMeters(user.lat, user.lng, pin.lat, pin.lng);
        if (dist <= 75) {
          socket.emit('alert:proximity', {
            pinId: pin.id,
            type: pin.type,
            distanceMeters: dist,
            message: `Kujdes! Rrezik i konfirmuar (${pin.type}) vetëm ${dist}m larg teje!`
          });
        }
      }
    }
  });

  // Krijim i Buddy Group
  socket.on('buddy:create', ({ name, passCode } = {}) => {
    const group = stateManager.createBuddyGroup(socket.id, name, passCode);
    socket.emit('buddy:created', {
      groupId: group.id,
      name: group.name,
      passCode: group.passCode
    });
  });

  // Bashkim në Buddy Group
  socket.on('buddy:join', ({ groupId, passCode } = {}) => {
    const res = stateManager.joinBuddyGroup(socket.id, groupId, passCode);
    if (res.success) {
      socket.emit('buddy:joined', {
        groupId: res.group.id,
        name: res.group.name
      });
      // Dërgo anëtarët menjëherë
      const members = stateManager.getBuddyGroupMembers(res.group.id);
      for (const memberSocketId of res.group.members) {
        io.to(memberSocketId).emit('buddy:update', members);
      }
    } else {
      socket.emit('buddy:error', res.message);
    }
  });

  // Raportim i një Incidenti / Pin-i Policie
  socket.on('pin:create', (pinData) => {
    const pin = stateManager.createPin(socket.id, pinData);
    if (!pin) {
      socket.emit('pin:error', 'Raportim i pavlefshëm. Kontrollo llojin dhe koordinatat.');
      return;
    }
    io.emit('pin:broadcast', pin);
  });

  // Konfirmim ose Kundërshtim i një Pin-i
  socket.on('pin:confirm', ({ pinId, vote } = {}) => {
    const updatedPin = stateManager.confirmPin(socket.id, pinId, vote);
    if (updatedPin) {
      io.emit('pin:updated', updatedPin);
    }
  });

  // Butoni SOS / Njoftimi i Ndalimit Me Forcë (Arrest Alert)
  socket.on('sos:trigger', (sosData = {}) => {
    const alert = stateManager.triggerSOS(socket.id, sosData);
    if (!alert) return;

    // Privatësi/siguri operative: koordinatat E SAKTA shkojnë vetëm te qeliza e shokëve;
    // kanali i përgjithshëm merr vetëm pozicion të përgjithësuar (~100m).
    const fuzzy = generalizeCoordinates(alert.lat, alert.lng, 3);
    const publicAlert = {
      id: alert.id,
      userId: alert.userId,
      nickname: alert.nickname,
      buddyGroupId: alert.buddyGroupId,
      role: alert.role,
      lat: fuzzy.lat,
      lng: fuzzy.lon,
      alertType: alert.alertType,
      note: alert.note,
      timestamp: alert.timestamp,
      fuzzy: true
    };
    const privateAlert = {
      id: alert.id,
      userId: alert.userId,
      nickname: alert.nickname,
      buddyGroupId: alert.buddyGroupId,
      role: alert.role,
      lat: alert.lat,
      lng: alert.lng,
      alertType: alert.alertType,
      note: alert.note,
      timestamp: alert.timestamp,
      fuzzy: false
    };

    // Përcakto se kush merr vendndodhjen e saktë (dërguesi + qeliza e shokëve)
    const exactRecipients = new Set();
    exactRecipients.add(socket.id);
    if (alert.buddyGroupId) {
      const group = stateManager.buddyGroups.get(alert.buddyGroupId);
      if (group) {
        for (const memberSocketId of group.members) {
          exactRecipients.add(memberSocketId);
        }
      }
    }

    // 1) Dërguesi + qeliza e shokëve marrin vendndodhjen e saktë
    for (const sid of exactRecipients) {
      io.to(sid).emit('sos:broadcast', privateAlert);
    }

    // 2) Të gjithë të tjerët marrin vetëm pozicion të përgjithësuar (~100m)
    for (const [sid, clientSocket] of io.sockets.sockets) {
      if (!exactRecipients.has(sid)) {
        clientSocket.emit('sos:broadcast', publicAlert);
      }
    }

    // Emergency Vault: njoftim SINQERT se dërgimi automatik real nuk është i lidhur ende
    if (alert.emergencyContact) {
      const latStr = (Number.isFinite(alert.lat) ? alert.lat : 0).toFixed(4);
      const lngStr = (Number.isFinite(alert.lng) ? alert.lng : 0).toFixed(4);
      socket.emit('sos:vault_dispatched', {
        contact: alert.emergencyContact.phone || alert.emergencyContact.name,
        message: '⚠️ Dërgimi automatik SMS/telefonatë NUK është i lidhur në këtë version. Kontakti juaj NUK u njoftua realisht — telefonojeni menjëherë! Koordinatat: [' + latStr + ', ' + lngStr + ']'
      });
    }
  });

  // Udhëzime Taktike nga Organizatorët (Organizer Broadcast)
  socket.on('directive:create', (directiveData) => {
    const res = stateManager.createTacticalDirective(socket.id, directiveData);
    if (res.success) {
      io.emit('directive:broadcast', res.directive);
    } else {
      socket.emit('directive:error', res.message);
    }
  });

  // Reagim ndaj SOS (Vullnetar/Jurist po vjen në ndihmë)
  socket.on('sos:respond', ({ alertId } = {}) => {
    const res = stateManager.respondToSOS(socket.id, alertId);
    if (res) {
      io.emit('sos:responder_added', res);
    }
  });

  // ---- Bisedat e Grupeve (Group Chats) ----
  socket.on('chat:list', () => {
    socket.emit('chat:list', stateManager.getUserChatRooms(socket.id));
  });

  socket.on('chat:create', (data) => {
    const res = stateManager.createChatRoom(socket.id, data || {});
    if (res.success) {
      socket.emit('chat:created', res.chat);
      broadcastChatRoom(res.chat.id);
    } else {
      socket.emit('chat:error', res.message);
    }
  });

  socket.on('chat:join', (data) => {
    const res = stateManager.joinChatRoom(socket.id, data || {});
    if (res.success) {
      socket.emit('chat:joined', res.chat);
      broadcastChatRoom(res.chat.id);
    } else {
      socket.emit('chat:error', res.message);
    }
  });

  socket.on('chat:leave', ({ chatId } = {}) => {
    const res = stateManager.leaveChatRoom(socket.id, chatId);
    if (res.success) {
      socket.emit('chat:left', { chatId });
      broadcastChatRoom(chatId);
    }
  });

  socket.on('chat:message', (data) => {
    const chatId = data && data.chatId;
    const message = stateManager.sendChatMessage(socket.id, data || {});
    if (message && chatId) {
      const chat = stateManager.chatRooms.get(chatId);
      if (chat) {
        for (const memberSocketId of chat.members) {
          io.to(memberSocketId).emit('chat:message', { chatId, message });
        }
      }
    }
  });

  // ---- Informatorët / Vëzhguesit e Terrenit (Field Scout Intel) ----
  socket.on('intel:create', (intelData) => {
    const res = stateManager.createIntelDispatch(socket.id, intelData || {});
    if (res.success) {
      io.emit('intel:broadcast', res.dispatch);
    } else {
      socket.emit('intel:error', res.message);
    }
  });

  socket.on('admin:delete_intel', ({ dispatchId } = {}) => {
    if (stateManager.adminDeleteIntel(socket.id, dispatchId)) {
      io.emit('intel:deleted', { dispatchId });
      socket.emit('admin:data', stateManager.getAdminDashboardData(socket.id));
    }
  });

  // Admin Kontrolli & Mbikëqyrja
  socket.on('admin:auth', ({ adminKey } = {}) => {
    const success = stateManager.authenticateAdmin(socket.id, adminKey);
    if (success) {
      socket.emit('admin:auth_success', stateManager.getAdminDashboardData(socket.id));
    } else {
      socket.emit('admin:auth_error', 'Çelësi i gabuar i administratorit.');
    }
  });

  socket.on('admin:refresh_data', () => {
    if (stateManager.isAdmin(socket.id)) {
      socket.emit('admin:data', stateManager.getAdminDashboardData(socket.id));
    }
  });

  socket.on('admin:delete_pin', ({ pinId } = {}) => {
    if (stateManager.adminDeletePin(socket.id, pinId)) {
      io.emit('pin:deleted', { pinId });
      socket.emit('admin:data', stateManager.getAdminDashboardData(socket.id));
    }
  });

  socket.on('admin:delete_directive', ({ directiveId } = {}) => {
    if (stateManager.adminDeleteDirective(socket.id, directiveId)) {
      io.emit('directive:deleted', { directiveId });
      socket.emit('admin:data', stateManager.getAdminDashboardData(socket.id));
    }
  });

  socket.on('admin:resolve_sos', ({ alertId } = {}) => {
    if (stateManager.adminResolveSOS(socket.id, alertId)) {
      io.emit('sos:resolved', { alertId });
      socket.emit('admin:data', stateManager.getAdminDashboardData(socket.id));
    }
  });

  // Shkëputja (Disconnect)
  socket.on('disconnect', () => {
    const user = stateManager.users.get(socket.id);
    if (user && user.buddyGroupId) {
      const groupId = user.buddyGroupId;
      stateManager.removeUser(socket.id);
      const remainingMembers = stateManager.getBuddyGroupMembers(groupId);
      const group = stateManager.buddyGroups.get(groupId);
      if (group) {
        for (const memberSocketId of group.members) {
          io.to(memberSocketId).emit('buddy:update', remainingMembers);
        }
      }
    } else {
      stateManager.removeUser(socket.id);
    }
    io.emit('crowd:density', stateManager.getCrowdDensity());
    console.log(`[DISCONNECT] Socket u shkëput: ${socket.id}`);
  });
});

// Periodik broadcast i densitetit të turmës dhe specialistëve (çdo 15 sekonda)
setInterval(() => {
  io.emit('crowd:density', stateManager.getCrowdDensity());
  io.emit('specialists:update', stateManager.getSpecialists());
}, 15000);

server.listen(PORT, () => {
  console.log(`🛡️ ProtestGuard Serveri po operon në http://localhost:${PORT}`);
});
