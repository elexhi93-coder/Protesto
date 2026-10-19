/**
 * In-Memory State Manager (Redis/Fast Memory emulation)
 * Designed for low latency, zero persistent personal footprint, and auto-TTL expiration.
 */
const { calculateDistanceMeters, generalizeCoordinates } = require('./geoUtils');

class StateManager {
  constructor() {
    this.users = new Map(); // socketId -> { id, nickname, role, buddyGroupId, lat, lng, lastSeen, emergencyContact, isFrontline }
    this.buddyGroups = new Map(); // groupId -> { id, name, passCode, members: Set<socketId> }
    this.pins = new Map(); // pinId -> { id, type, lat, lng, description, reportedBy, status, confirmations: Set<socketId>, disputes: Set<socketId>, createdAt, expiresAt }
    this.sosAlerts = new Map(); // alertId -> { id, socketId, userId, nickname, buddyGroupId, role, lat, lng, alertType, note, status, timestamp, responders: Set<socketId> }
    this.broadcastGuides = new Map(); // guideId -> { id, title, message, targetArea, actionDirective, priority, photoUrl, createdAt, expiresAt }
    this.intelDispatches = new Map(); // dispatchId -> { id, authorId, authorNickname, text, movementType, street, lat, lng, urgency, createdAt, expiresAt }
    this.chatRooms = new Map(); // chatId -> { id, name, passCode, organizerSocketId, members: Set<socketId>, messages: [{id, authorId, authorNickname, authorRole, text, timestamp}] }
    const isProd = process.env.NODE_ENV === 'production';
    this.inviteTokens = new Set(
      (process.env.INVITE_TOKENS || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
    );
    this.organizerPasscodes = new Set(
      (process.env.ORGANIZER_PASSCODES || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
    );
    this.adminKey = process.env.ADMIN_KEY || '';
    // Demo/dev fallbacks ONLY when not in production (secrets never hardcoded in prod)
    if (!isProd) {
      if (this.inviteTokens.size === 0) {
        ['PROTEST2026', 'TIRANA_LIRI', 'STUDENTI_BASHKUAR'].forEach(t => this.inviteTokens.add(t));
      }
      if (this.organizerPasscodes.size === 0) {
        ['LIRI2026', 'ORGANIZATORI_TR', 'BASHKIMI'].forEach(p => this.organizerPasscodes.add(p));
      }
      if (!this.adminKey) {
        this.adminKey = 'ADMIN_SUPER_KEY_2026';
      }
    }
    this.admins = new Set(); // socketId-të e administratorëve

    // Inicializo të dhëna demo vetëm në zhvillim (jo në prod)
    if (!isProd) {
      this.seedDemoData();
    }
  }

  seedDemoData() {
    // 1. Grupi i Shokëve Demo (Qeliza "Studentët e Mjekësisë & Drejtësisë")
    const demoGroupId = 'bg_demo_tirana';
    this.buddyGroups.set(demoGroupId, {
      id: demoGroupId,
      name: 'Qeliza "Studentët e Bashkuar"',
      passCode: '1234',
      members: new Set(['demo_sock_1', 'demo_sock_2', 'demo_sock_3', 'demo_sock_4'])
    });

    // 2. Shokët brenda qelizës (me pozicione rreth Bulevardit Dëshmorët e Kombit)
    const demoBuddies = [
      { socketId: 'demo_sock_1', id: 'usr_arbi', nickname: 'Arbër M.', role: 'frontline', isFrontline: true, lat: 41.3262, lng: 19.8190 },
      { socketId: 'demo_sock_2', id: 'usr_bora', nickname: 'Dr. Bora', role: 'medic', isFrontline: false, lat: 41.3255, lng: 19.8188 },
      { socketId: 'demo_sock_3', id: 'usr_ilir', nickname: 'Av. Iliri', role: 'legal', isFrontline: false, lat: 41.3248, lng: 19.8194 },
      { socketId: 'demo_sock_4', id: 'usr_era', nickname: 'Era (Ujë/Ndihmë)', role: 'logistics', isFrontline: false, lat: 41.3258, lng: 19.8182 }
    ];

    demoBuddies.forEach(b => {
      this.users.set(b.socketId, {
        id: b.id,
        nickname: b.nickname,
        role: b.role,
        isFrontline: b.isFrontline,
        buddyGroupId: demoGroupId,
        socketId: b.socketId,
        lat: b.lat,
        lng: b.lng,
        lastSeen: Date.now()
      });
    });

    // 3. Qindra protestues të simuluar (Clusters / Crowd Heatmap përgjatë aksit Skënderbej -> Kryeministri -> Piramida)
    const crowdFocalPoints = [
      { lat: 41.3275, lng: 19.8187, count: 120 }, // Sheshi Skënderbej
      { lat: 41.3250, lng: 19.8189, count: 240 }, // Parku Rinia / Ministritë
      { lat: 41.3235, lng: 19.8195, count: 310 }, // Te Piramida
      { lat: 41.3217, lng: 19.8198, count: 450 }, // Para Kryeministrisë
      { lat: 41.3200, lng: 19.8202, count: 180 }, // Te Presidenca / Sheshi Nënë Tereza
      { lat: 41.3240, lng: 19.8160, count: 90 }   // Rruga e Myslym Shyrit (Korridor evakuimi)
    ];

    let simIndex = 1;
    crowdFocalPoints.forEach(fp => {
      for (let i = 0; i < 15; i++) {
        const offsetLat = (Math.random() - 0.5) * 0.0018;
        const offsetLng = (Math.random() - 0.5) * 0.0018;
        const simId = `sim_user_${simIndex++}`;
        this.users.set(simId, {
          id: simId,
          nickname: `Protestues #${simIndex}`,
          role: i % 5 === 0 ? 'frontline' : 'civilian',
          isFrontline: i % 5 === 0,
          buddyGroupId: null,
          socketId: simId,
          lat: fp.lat + offsetLat,
          lng: fp.lng + offsetLng,
          lastSeen: Date.now()
        });
      }
    });

    // 4. Incident Pins Demo (Pikat e policisë, gazit dhe kordonëve)
    const demoPins = [
      {
        id: 'pin_demo_police_1',
        type: 'police_cordon',
        lat: 41.3212,
        lng: 19.8200,
        description: 'Kordon i dyfishtë FNSH / Polici me skafandra para Kryeministrisë.',
        status: 'confirmed',
        confirmations: new Set(['user1', 'user2', 'user3', 'user4']),
        disputes: new Set(),
        createdAt: Date.now() - (10 * 60 * 1000),
        expiresAt: Date.now() + (60 * 60 * 1000)
      },
      {
        id: 'pin_demo_plainclothes',
        type: 'plainclothes_police',
        lat: 41.3242,
        lng: 19.8175,
        description: 'Polici me rroba civile të maskuar te hyrja e rrugicës anësore të Tajvanit.',
        status: 'confirmed',
        confirmations: new Set(['user5', 'user6', 'user7']),
        disputes: new Set(),
        createdAt: Date.now() - (5 * 60 * 1000),
        expiresAt: Date.now() + (60 * 60 * 1000)
      },
      {
        id: 'pin_demo_teargas',
        type: 'teargas',
        lat: 41.3228,
        lng: 19.8192,
        description: 'Përdorim spray dhe tymuese lotsjellëse pranë urës së Lanës.',
        status: 'confirmed',
        confirmations: new Set(['user8', 'user9', 'user10']),
        disputes: new Set(),
        createdAt: Date.now() - (3 * 60 * 1000),
        expiresAt: Date.now() + (60 * 60 * 1000)
      },
      {
        id: 'pin_demo_medic',
        type: 'medic_needed',
        lat: 41.3238,
        lng: 19.8190,
        description: 'Një student ka nevojë për ujë me bikarbonat (kontakt me gaz në sy).',
        status: 'pending',
        confirmations: new Set(['user11']),
        disputes: new Set(),
        createdAt: Date.now() - (2 * 60 * 1000),
        expiresAt: Date.now() + (60 * 60 * 1000)
      }
    ];

    demoPins.forEach(p => this.pins.set(p.id, p));

    // 5. SOS Alert Demo (Arrest Alert në proces)
    const demoSosId = 'sos_demo_live';
    this.sosAlerts.set(demoSosId, {
      id: demoSosId,
      socketId: 'demo_sock_victim',
      userId: 'usr_besi',
      nickname: 'Besnik K. (Student)',
      buddyGroupId: demoGroupId,
      role: 'frontline',
      emergencyContact: { name: 'Familja', phone: '+355692030400' },
      lat: 41.3221,
      lng: 19.8196,
      alertType: 'arrest_in_progress',
      note: 'Tentativë shoqërimi me forcë nga civilët te Piramida! Kemi nevojë për avokat!',
      status: 'active',
      timestamp: Date.now() - (60 * 1000),
      responders: new Set(['demo_sock_3'])
    });

    // 6. Udhëzim Taktik nga Organizatorët (me provë foto)
    const demoDirectiveId = 'dir_demo_1';
    this.broadcastGuides.set(demoDirectiveId, {
      id: demoDirectiveId,
      author: 'Këshilli Koordinues i Studentëve',
      title: 'ZHVENDOSJE E QETË DREJT BULEVARDIT',
      message: 'Mos u ndani në grupe të vogla. Mbani distancë 15 metra nga kordoni i policisë dhe ruani krahët e hapur!',
      actionDirective: 'hold',
      priority: 'urgent',
      targetArea: 'all',
      photoData: null,
      createdAt: Date.now() - (4 * 60 * 1000),
      expiresAt: Date.now() + (45 * 60 * 1000)
    });

    // 7. Biseda e Grupit Demo (Chat i Organizatorëve për Koordinim)
    const demoChatId = 'chat_demo_org';
    this.chatRooms.set(demoChatId, {
      id: demoChatId,
      name: 'Këshilli Koordinues - Salla Kryesore',
      passCode: 'KORDI2026',
      organizerSocketId: 'demo_sock_org',
      members: new Set(['demo_sock_1', 'demo_sock_2', 'demo_sock_3', 'demo_sock_org']),
      messages: [
        { id: 'msg_demo_1', authorId: 'usr_org', authorNickname: 'Koordinatori Qendror', authorRole: 'organizer', text: 'Mirë se erdhët në sallën e koordinimit! Këtu japim udhëzime të shpejta pa u ekspozuar në transmetim të gjerë.', timestamp: Date.now() - (30 * 60 * 1000) },
        { id: 'msg_demo_2', authorId: 'usr_arbi', authorNickname: 'Arbër M.', authorRole: 'frontline', text: 'Kordoni te Piramida po dendësohet. Kemi nevojë për mjekë në krahun e djathtë.', timestamp: Date.now() - (12 * 60 * 1000) },
        { id: 'msg_demo_3', authorId: 'usr_bora', authorNickname: 'Dr. Bora', authorRole: 'medic', text: 'Po shkoj me 2 vullnetarë, kemi ujë me bikarbonat.', timestamp: Date.now() - (8 * 60 * 1000) }
      ]
    });

    // 8. Buletinet Demo të Informatorëve (Field Scout Intel)
    const demoIntel1 = 'intel_demo_1';
    this.intelDispatches.set(demoIntel1, {
      id: demoIntel1,
      authorId: 'usr_scout_1',
      authorNickname: 'Scout-MyslymShyri',
      authorRole: 'scout',
      movementType: 'police_incoming',
      street: 'Rruga Ibrahim Rugova (drejt Tajvanit)',
      text: 'Po vijnë 3 furgonë të policisë nga drejtimi i urës së Bllokut drejt Tajvanit! Kujdes krahu i majtë!',
      lat: 41.3241,
      lng: 19.8173,
      urgency: 'high',
      createdAt: Date.now() - (3 * 60 * 1000),
      expiresAt: Date.now() + (20 * 60 * 1000)
    });

    const demoIntel2 = 'intel_demo_2';
    this.intelDispatches.set(demoIntel2, {
      id: demoIntel2,
      authorId: 'usr_scout_2',
      authorNickname: 'Scout-Rinia',
      authorRole: 'scout',
      movementType: 'encirclement_warning',
      street: 'Kryqëzimi te Pallati i Kongreseve',
      text: 'FNSH po formon gjysmërreth nga prapa! Mos lejoni të pritet rruga drejt Parkut Rinia, tërhiquni ngadalë në qendër!',
      lat: 41.3204,
      lng: 19.8210,
      urgency: 'critical',
      createdAt: Date.now() - (1 * 60 * 1000),
      expiresAt: Date.now() + (20 * 60 * 1000)
    });

    // Informator demo (për autorësinë e buletinit)
    this.users.set('demo_sock_scout', {
      id: 'usr_scout_1',
      nickname: 'Scout-MyslymShyri',
      role: 'scout',
      isFrontline: false,
      buddyGroupId: null,
      socketId: 'demo_sock_scout',
      lat: 41.3241,
      lng: 19.8173,
      lastSeen: Date.now()
    });

    // Organizatori demo (për autorësinë e mesazheve në bisedë)
    this.users.set('demo_sock_org', {
      id: 'usr_org',
      nickname: 'Koordinatori Qendror',
      role: 'organizer',
      isFrontline: false,
      buddyGroupId: null,
      socketId: 'demo_sock_org',
      lat: 41.3268,
      lng: 19.8191,
      lastSeen: Date.now()
    });
  }

  // Token Validation
  validateInviteToken(token) {
    if (!token) return false;
    return this.inviteTokens.has(token.trim().toUpperCase());
  }

  // Organizer Validation
  validateOrganizerPasscode(code) {
    if (!code) return false;
    return this.organizerPasscodes.has(code.trim().toUpperCase());
  }

  // Admin Validation
  validateAdmin(key) {
    if (!key || !this.adminKey) return false;
    return key.trim() === this.adminKey;
  }

  authenticateAdmin(socketId, key) {
    if (this.validateAdmin(key)) {
      this.admins.add(socketId);
      const user = this.users.get(socketId);
      if (user) {
        user.role = 'admin';
      }
      return true;
    }
    return false;
  }

  isAdmin(socketId) {
    return this.admins.has(socketId);
  }

  // User Management
  registerUser(socketId, { userId, nickname = '', role = 'civilian', buddyGroupId = null, emergencyContact = null, organizerCode = '', adminKey = '', isFrontline = false, isMinor = false } = {}) {
    const validRoles = ['civilian', 'scout', 'frontline', 'vanguard', 'medic', 'legal', 'logistics', 'organizer', 'admin'];
    let userRole = validRoles.includes(role) ? role : 'civilian';

    // Verify admin
    if (userRole === 'admin') {
      if (this.validateAdmin(adminKey)) {
        this.admins.add(socketId);
      } else {
        userRole = 'civilian';
      }
    }

    // Verify organizer code if selecting organizer role
    if (userRole === 'organizer' && !this.validateOrganizerPasscode(organizerCode)) {
      userRole = 'civilian';
    }

    const defaultNick = userRole === 'organizer' ? 'Koordinatori' : (userRole === 'scout' ? 'Vëzhguesi (Scout)' : 'Shoku');
    const userData = {
      id: userId || `anon_${Math.random().toString(36).substring(2, 9)}`,
      nickname: (nickname || '').trim().substring(0, 30) || defaultNick,
      socketId,
      role: userRole,
      isFrontline: Boolean(isFrontline) || userRole === 'frontline' || userRole === 'vanguard',
      isMinor: Boolean(isMinor),
      buddyGroupId,
      emergencyContact: emergencyContact || null,
      lat: null,
      lng: null,
      lastSeen: Date.now()
    };

    // Hiq nga grupi i mëparshëm përpara se të shtohet në një të ri (shmang anëtarësinë fantazmë)
    const prev = this.users.get(socketId);
    if (prev && prev.buddyGroupId && prev.buddyGroupId !== buddyGroupId && this.buddyGroups.has(prev.buddyGroupId)) {
      this.buddyGroups.get(prev.buddyGroupId).members.delete(socketId);
    }

    this.users.set(socketId, userData);

    if (buddyGroupId && this.buddyGroups.has(buddyGroupId)) {
      this.buddyGroups.get(buddyGroupId).members.add(socketId);
    }

    return userData;
  }

  updateLocation(socketId, { lat, lng } = {}) {
    const user = this.users.get(socketId);
    if (!user) return null;

    const numLat = parseFloat(lat);
    const numLng = parseFloat(lng);
    if (!Number.isFinite(numLat) || !Number.isFinite(numLng) ||
        numLat < -90 || numLat > 90 || numLng < -180 || numLng > 180) {
      return null; // injoro koordinata të pavlefshme
    }

    user.lat = numLat;
    user.lng = numLng;
    user.lastSeen = Date.now();
    return user;
  }

  removeUser(socketId) {
    const user = this.users.get(socketId);
    if (user && user.buddyGroupId && this.buddyGroups.has(user.buddyGroupId)) {
      this.buddyGroups.get(user.buddyGroupId).members.delete(socketId);
    }
    this.users.delete(socketId);

    // Hiq përdoruesin nga çdo bisedë grupi dhe fshi bisedat e boshatisura
    for (const [chatId, chat] of this.chatRooms) {
      chat.members.delete(socketId);
      if (chat.members.size === 0) {
        this.chatRooms.delete(chatId);
      }
    }
  }

  // Buddy Groups
  createBuddyGroup(socketId, name, passCode) {
    const user = this.users.get(socketId);
    if (user && user.buddyGroupId && this.buddyGroups.has(user.buddyGroupId)) {
      this.buddyGroups.get(user.buddyGroupId).members.delete(socketId);
    }

    const groupId = `bg_${Math.random().toString(36).substring(2, 8)}`;
    const group = {
      id: groupId,
      name: name || 'Qeliza Jonë',
      passCode: passCode || '1234',
      members: new Set([socketId])
    };
    this.buddyGroups.set(groupId, group);

    if (user) {
      user.buddyGroupId = groupId;
    }
    return group;
  }

  joinBuddyGroup(socketId, groupId, passCode) {
    const group = this.buddyGroups.get(groupId);
    if (!group) return { success: false, message: 'Grupi nuk u gjet.' };
    if (group.passCode !== passCode) return { success: false, message: 'Kodi i grupit është i pasaktë.' };
    if (group.members.size >= 5 && !group.members.has(socketId)) {
      return { success: false, message: 'Grupi ka arritur limitin prej 5 anëtarësh.' };
    }

    const user = this.users.get(socketId);
    if (user && user.buddyGroupId && user.buddyGroupId !== groupId && this.buddyGroups.has(user.buddyGroupId)) {
      this.buddyGroups.get(user.buddyGroupId).members.delete(socketId);
    }

    group.members.add(socketId);
    if (user) {
      user.buddyGroupId = groupId;
    }
    return { success: true, group };
  }

  getBuddyGroupMembers(groupId) {
    const group = this.buddyGroups.get(groupId);
    if (!group) return [];
    const members = [];
    for (const memberSocketId of group.members) {
      const u = this.users.get(memberSocketId);
      if (u && Number.isFinite(u.lat) && Number.isFinite(u.lng)) {
        members.push({
          id: u.id,
          nickname: u.nickname || 'Shoku',
          role: u.role,
          isFrontline: u.isFrontline,
          isMinor: u.isMinor,
          lat: u.lat,
          lng: u.lng,
          lastSeen: u.lastSeen
        });
      }
    }
    return members;
  }

  // ---- Bisedat e Grupeve (Group Chats) ----
  isOrganizerOrAdmin(socketId) {
    const user = this.users.get(socketId);
    if (!user) return false;
    return user.role === 'organizer' || this.isAdmin(socketId);
  }

  getChatMemberNicknames(chat) {
    const members = [];
    for (const memberSocketId of chat.members) {
      const u = this.users.get(memberSocketId);
      if (u) {
        members.push({ id: u.id, nickname: u.nickname || 'Shoku', role: u.role, isOrganizer: u.role === 'organizer' || this.admins.has(memberSocketId) });
      }
    }
    return members;
  }

  serializeChat(chat, includeMessages = true) {
    return {
      id: chat.id,
      name: chat.name,
      hasPassCode: Boolean(chat.passCode),
      organizerSocketId: chat.organizerSocketId,
      membersCount: chat.members.size,
      members: this.getChatMemberNicknames(chat),
      messages: includeMessages ? chat.messages.slice(-100) : []
    };
  }

  createChatRoom(socketId, { name, passCode = '' } = {}) {
    if (!this.isOrganizerOrAdmin(socketId)) {
      return { success: false, message: 'Vetëm organizatorët e autorizuar mund të krijojnë biseda grupi.' };
    }

    const chatId = `chat_${Math.random().toString(36).substring(2, 8)}`;
    const chat = {
      id: chatId,
      name: (name || 'Biseda e Grupit').trim().substring(0, 60),
      passCode: (passCode || '').trim(),
      organizerSocketId: socketId,
      members: new Set([socketId]),
      messages: []
    };
    this.chatRooms.set(chatId, chat);
    return { success: true, chat: this.serializeChat(chat) };
  }

  joinChatRoom(socketId, { chatId, passCode = '' } = {}) {
    const chat = this.chatRooms.get(chatId);
    if (!chat) return { success: false, message: 'Biseda nuk u gjet.' };
    if (chat.passCode && chat.passCode !== (passCode || '').trim()) {
      return { success: false, message: 'Kodi i bisedës është i pasaktë.' };
    }
    chat.members.add(socketId);
    return { success: true, chat: this.serializeChat(chat) };
  }

  leaveChatRoom(socketId, chatId) {
    const chat = this.chatRooms.get(chatId);
    if (!chat) return { success: false, message: 'Biseda nuk u gjet.' };
    chat.members.delete(socketId);
    // Nëse mbetet bosh, fshije (zero gjurmë)
    if (chat.members.size === 0) {
      this.chatRooms.delete(chatId);
    }
    return { success: true };
  }

  sendChatMessage(socketId, { chatId, text } = {}) {
    const chat = this.chatRooms.get(chatId);
    const user = this.users.get(socketId);
    if (!chat || !user || !chat.members.has(socketId)) return null;

    const cleanText = (text || '').trim().substring(0, 500);
    if (!cleanText) return null;

    const message = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      authorId: user.id,
      authorNickname: user.nickname || 'Shoku',
      authorRole: user.role,
      text: cleanText,
      timestamp: Date.now()
    };
    chat.messages.push(message);
    // Ruaj vetëm 200 mesazhet e fundit (latencë & memorie minimale)
    if (chat.messages.length > 200) {
      chat.messages.splice(0, chat.messages.length - 200);
    }
    return message;
  }

  getUserChatRooms(socketId) {
    const rooms = [];
    for (const chat of this.chatRooms.values()) {
      if (chat.members.has(socketId)) {
        rooms.push(this.serializeChat(chat));
      }
    }
    return rooms;
  }

  // General Crowdsource & Density Heatmap
  getCrowdDensity() {
    const clusters = new Map();
    for (const [, user] of this.users) {
      if (!Number.isFinite(user.lat) || !Number.isFinite(user.lng)) continue;
      // Generalize to 100-200m grid for privacy
      const fuzzy = generalizeCoordinates(user.lat, user.lng, 3);
      const key = `${fuzzy.lat}_${fuzzy.lon}`;
      if (!clusters.has(key)) {
        clusters.set(key, { lat: fuzzy.lat, lng: fuzzy.lon, count: 0 });
      }
      clusters.get(key).count += 1;
    }
    return Array.from(clusters.values());
  }

  // Specialists, Scouts & Frontline Beacons
  getSpecialists() {
    const specialists = [];
    for (const [, user] of this.users) {
      if ((user.role === 'medic' || user.role === 'legal' || user.role === 'logistics' || user.role === 'scout' || user.role === 'frontline' || user.isFrontline) && Number.isFinite(user.lat) && Number.isFinite(user.lng)) {
        specialists.push({
          id: user.id,
          nickname: user.nickname,
          role: user.role,
          isFrontline: user.isFrontline,
          lat: user.lat,
          lng: user.lng
        });
      }
    }
    return specialists;
  }

  // Threat & Police Incident Pins
  createPin(socketId, { type, lat, lng, description = '' } = {}) {
    const validTypes = ['police_cordon', 'plainclothes_police', 'teargas', 'water_cannon', 'blocked_street', 'medic_needed', 'lawyer_needed'];
    const numLat = parseFloat(lat);
    const numLng = parseFloat(lng);
    if (!validTypes.includes(type) ||
        !Number.isFinite(numLat) || !Number.isFinite(numLng) ||
        numLat < -90 || numLat > 90 || numLng < -180 || numLng > 180) {
      return null;
    }
    const pinId = `pin_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const pin = {
      id: pinId,
      type, // 'police_cordon', 'plainclothes_police', 'teargas', 'water_cannon', 'blocked_street', 'medic_needed', 'lawyer_needed'
      lat: numLat,
      lng: numLng,
      description: (description || '').substring(0, 160),
      reportedBy: socketId,
      status: 'pending',
      confirmations: new Set([socketId]),
      disputes: new Set(),
      createdAt: Date.now(),
      expiresAt: Date.now() + (45 * 60 * 1000) // Skadon pas 45 minutash
    };
    this.pins.set(pinId, pin);
    return this.serializePin(pin);
  }

  confirmPin(socketId, pinId, vote = 'confirm') {
    const pin = this.pins.get(pinId);
    if (!pin) return null;

    // Anti-Fake: vota vlen vetëm nëse dëshmitari është brenda ~500m nga pika e raportuar
    const voter = this.users.get(socketId);
    if (voter && Number.isFinite(voter.lat) && Number.isFinite(voter.lng) &&
        Number.isFinite(pin.lat) && Number.isFinite(pin.lng)) {
      const dist = calculateDistanceMeters(voter.lat, voter.lng, pin.lat, pin.lng);
      if (dist > 500) return this.serializePin(pin); // injoro votat e largëta
    }

    if (vote === 'confirm') {
      pin.disputes.delete(socketId);
      pin.confirmations.add(socketId);
      if (pin.confirmations.size >= 3) {
        pin.status = 'confirmed';
      }
    } else {
      pin.confirmations.delete(socketId);
      pin.disputes.add(socketId);
      if (pin.disputes.size >= 3) {
        pin.status = 'dismissed';
      }
    }
    return this.serializePin(pin);
  }

  serializePin(pin) {
    return {
      id: pin.id,
      type: pin.type,
      lat: pin.lat,
      lng: pin.lng,
      description: pin.description,
      status: pin.status,
      confirmationsCount: pin.confirmations.size,
      disputesCount: pin.disputes.size,
      createdAt: pin.createdAt,
      expiresAt: pin.expiresAt
    };
  }

  getActivePins() {
    const now = Date.now();
    const active = [];
    for (const [id, pin] of this.pins) {
      if (pin.expiresAt <= now || pin.status === 'dismissed') {
        this.pins.delete(id);
      } else {
        active.push(this.serializePin(pin));
      }
    }
    return active;
  }

  // SOS & Arrest Alert
  triggerSOS(socketId, { lat, lng, alertType = 'arrest_in_progress', note = '' } = {}) {
    const user = this.users.get(socketId);
    const parsedLat = parseFloat(lat);
    const parsedLng = parseFloat(lng);
    const numLat = Number.isFinite(parsedLat) ? parsedLat : (user && Number.isFinite(user.lat) ? user.lat : 41.3275);
    const numLng = Number.isFinite(parsedLng) ? parsedLng : (user && Number.isFinite(user.lng) ? user.lng : 19.8187);
    const alertId = `sos_${Date.now()}`;
    const alert = {
      id: alertId,
      socketId,
      userId: user ? user.id : 'anon',
      nickname: user ? (user.nickname || 'Shoku') : 'Shoku',
      buddyGroupId: user ? user.buddyGroupId : null,
      role: user ? user.role : 'civilian',
      isFrontline: user ? user.isFrontline : false,
      isMinor: user ? user.isMinor : false,
      emergencyContact: user ? user.emergencyContact : null,
      lat: numLat,
      lng: numLng,
      alertType, // 'arrest_in_progress', 'medical_emergency', 'cornered'
      note: (note || '').substring(0, 140),
      status: 'active',
      timestamp: Date.now(),
      expiresAt: Date.now() + (45 * 60 * 1000), // Skadon pas 45 minutash
      responders: new Set()
    };
    this.sosAlerts.set(alertId, alert);
    return alert;
  }

  respondToSOS(socketId, alertId) {
    const alert = this.sosAlerts.get(alertId);
    if (!alert) return null;
    alert.responders.add(socketId);
    return {
      alertId,
      respondersCount: alert.responders.size
    };
  }

  getActiveSOS() {
    const now = Date.now();
    const active = [];
    for (const [id, a] of this.sosAlerts) {
      if (a.expiresAt && a.expiresAt <= now) {
        this.sosAlerts.delete(id);
        continue;
      }
      if (a.status !== 'active') continue;
      active.push({
        id: a.id,
        userId: a.userId,
        nickname: a.nickname,
        buddyGroupId: a.buddyGroupId,
        role: a.role,
        isFrontline: a.isFrontline,
        isMinor: a.isMinor,
        lat: a.lat,
        lng: a.lng,
        alertType: a.alertType,
        note: a.note,
        timestamp: a.timestamp,
        respondersCount: a.responders.size
      });
    }
    return active;
  }

  // Tactical Guidance for Organizers (Must include Photo evidence for Movement Directives)
  createTacticalDirective(socketId, { title, message, actionDirective, priority = 'normal', targetArea = 'all', photoData = null } = {}) {
    const user = this.users.get(socketId);
    const isAdmin = this.isAdmin(socketId);

    if (!user || (user.role !== 'organizer' && !isAdmin)) {
      return { success: false, message: 'Vetëm organizatorët e autorizuar mund të transmetojnë udhëzime.' };
    }

    const validActions = ['advance', 'hold', 'fallback', 'medical_corridor', 'peaceful_sit_in'];
    const validPriorities = ['normal', 'urgent', 'critical'];
    const action = validActions.includes(actionDirective) ? actionDirective : 'hold';
    const prio = validPriorities.includes(priority) ? priority : 'normal';

    // MANDATORY PHOTO REQUIREMENT FOR ADVANCE OR FALLBACK (Marsh para / Tërheqje prapa)
    // Sanitizo photoData: prano vetëm data-URL të vlefshme base64 imazhi (parandalon injektim HTML/XSS)
    const safePhotoData = (typeof photoData === 'string' && /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(photoData)) ? photoData : null;
    const movementDirectives = ['advance', 'fallback'];
    if (movementDirectives.includes(action) && !safePhotoData) {
      return {
        success: false,
        message: 'KUSHT I DETYRUESHËM SIGURIE: Për të dhënë komandë lëvizjeje ("Marsh Para" ose "Tërheqje Prapa"), duhet të ngarkoni foto nga terreni si provë vizuale!'
      };
    }

    const directiveId = `dir_${Date.now()}`;
    const directive = {
      id: directiveId,
      author: user.nickname || 'Këshilli Koordinues',
      title: title ? title.substring(0, 80) : 'Udhëzim Taktik nga Organizatorët',
      message: (message || '').substring(0, 300),
      actionDirective: action, // 'advance', 'hold', 'fallback', 'medical_corridor', 'peaceful_sit_in'
      priority: prio, // 'normal', 'urgent', 'critical'
      targetArea,
      photoData: safePhotoData,
      createdAt: Date.now(),
      expiresAt: Date.now() + (30 * 60 * 1000) // 30 minuta
    };

    this.broadcastGuides.set(directiveId, directive);
    return { success: true, directive };
  }

  getActiveDirectives() {
    const now = Date.now();
    const active = [];
    for (const [id, dir] of this.broadcastGuides) {
      if (dir.expiresAt <= now) {
        this.broadcastGuides.delete(id);
      } else {
        active.push(dir);
      }
    }
    return active;
  }

  // Admin Oversight Actions
  getAdminDashboardData(socketId) {
    if (!this.isAdmin(socketId)) {
      return { success: false, message: 'I paautorizuar.' };
    }

    const allUsers = Array.from(this.users.values()).map(u => ({
      id: u.id,
      socketId: u.socketId,
      nickname: u.nickname,
      role: u.role,
      isFrontline: u.isFrontline,
      isMinor: u.isMinor,
      buddyGroupId: u.buddyGroupId,
      lat: u.lat,
      lng: u.lng,
      lastSeen: u.lastSeen
    }));

    return {
      success: true,
      stats: {
        totalUsers: this.users.size,
        frontlineCount: allUsers.filter(u => u.isFrontline || u.role === 'frontline' || u.role === 'vanguard').length,
        minorsCount: allUsers.filter(u => u.isMinor).length,
        scoutsCount: allUsers.filter(u => u.role === 'scout').length,
        medicCount: allUsers.filter(u => u.role === 'medic').length,
        legalCount: allUsers.filter(u => u.role === 'legal').length,
        organizerCount: allUsers.filter(u => u.role === 'organizer').length,
        activePins: this.getActivePins().length,
        activeSOS: this.getActiveSOS().length,
        activeDirectives: this.getActiveDirectives().length,
        activeIntel: this.getActiveIntel().length
      },
      users: allUsers,
      pins: this.getActivePins(),
      sosAlerts: this.getActiveSOS(),
      directives: this.getActiveDirectives(),
      intelDispatches: this.getActiveIntel()
    };
  }

  // ---- Informatorët / Vëzhguesit e Terrenit (Field Scout Intel) ----
  createIntelDispatch(socketId, { text, movementType = 'police_incoming', street = '', lat = null, lng = null, urgency = 'high' } = {}) {
    const user = this.users.get(socketId);
    if (!user) {
      return { success: false, message: 'Përdoruesi nuk ekziston.' };
    }
    // Informatorët, organizatorët dhe adminët kanë të drejtë të njoftojnë lëvizje policie
    const allowedRoles = ['scout', 'organizer', 'frontline', 'admin'];
    const canDispatch = allowedRoles.includes(user.role) || this.isAdmin(socketId);
    if (!canDispatch) {
      return { success: false, message: 'Vetëm Vëzhguesit (Informatorët), Organizatorët ose Fronti mund të lëshojnë buletine lëvizjeje.' };
    }

    const cleanText = (text || '').trim().substring(0, 240);
    if (!cleanText) {
      return { success: false, message: 'Mesazhi i njoftimit nuk mund të jetë bosh.' };
    }

    const validMovements = ['police_incoming', 'encirclement_warning', 'water_cannon_moving', 'van_reinforcements', 'exit_blocked', 'corridor_clear'];
    const move = validMovements.includes(movementType) ? movementType : 'police_incoming';

    const validUrgency = ['normal', 'high', 'critical'];
    const urg = validUrgency.includes(urgency) ? urgency : 'high';

    const dispatchId = `intel_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const dispatchLat = Number.isFinite(parseFloat(lat)) ? parseFloat(lat) : (Number.isFinite(user.lat) ? user.lat : null);
    const dispatchLng = Number.isFinite(parseFloat(lng)) ? parseFloat(lng) : (Number.isFinite(user.lng) ? user.lng : null);

    const dispatch = {
      id: dispatchId,
      authorId: user.id,
      authorNickname: user.nickname || 'Informator Terreni',
      authorRole: user.role,
      movementType: move,
      street: (street || '').trim().substring(0, 80),
      text: cleanText,
      lat: dispatchLat,
      lng: dispatchLng,
      urgency: urg,
      createdAt: Date.now(),
      expiresAt: Date.now() + (20 * 60 * 1000) // Buletinet e vëzhgimit skadojnë pas 20 min sepse dinamika ndryshon shpejt
    };

    this.intelDispatches.set(dispatchId, dispatch);
    return { success: true, dispatch };
  }

  getActiveIntel() {
    const now = Date.now();
    const active = [];
    for (const [id, item] of this.intelDispatches) {
      if (item.expiresAt <= now) {
        this.intelDispatches.delete(id);
      } else {
        active.push(item);
      }
    }
    // Më të fundit të parat
    return active.sort((a, b) => b.createdAt - a.createdAt);
  }

  adminDeleteIntel(socketId, dispatchId) {
    if (!this.isAdmin(socketId)) return false;
    return this.intelDispatches.delete(dispatchId);
  }

  adminDeletePin(socketId, pinId) {
    if (!this.isAdmin(socketId)) return false;
    return this.pins.delete(pinId);
  }

  adminDeleteDirective(socketId, directiveId) {
    if (!this.isAdmin(socketId)) return false;
    return this.broadcastGuides.delete(directiveId);
  }

  adminResolveSOS(socketId, alertId) {
    if (!this.isAdmin(socketId)) return false;
    const alert = this.sosAlerts.get(alertId);
    if (alert) {
      alert.status = 'resolved';
      return true;
    }
    return false;
  }
}

module.exports = new StateManager();
