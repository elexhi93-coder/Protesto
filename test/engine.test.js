const test = require('node:test');
const assert = require('node:assert');
const { calculateDistanceMeters, generalizeCoordinates } = require('../server/geoUtils');
const stateManager = require('../server/stateManager');

test('GeoUtils: calculateDistanceMeters accurately calculates Tirana landmarks', () => {
  // Sheshi Skënderbej (41.3275, 19.8187) te Kryeministria (41.3217, 19.8198) ~ 650m
  const dist = calculateDistanceMeters(41.3275, 19.8187, 41.3217, 19.8198);
  assert.ok(dist >= 600 && dist <= 700, `Distanca duhet të jetë rreth 650m, ishte ${dist}m`);
});

test('GeoUtils: generalizeCoordinates removes high-precision pinpointing', () => {
  const generalized = generalizeCoordinates(41.3275812, 19.8187421, 3);
  assert.strictEqual(generalized.lat, 41.328);
  assert.strictEqual(generalized.lon, 19.819);
});

test('StateManager: User registration, role assignment and location update', () => {
  const socketId = 'sock_test_1';
  const user = stateManager.registerUser(socketId, {
    role: 'medic',
    emergencyContact: { name: 'Babai', phone: '+355691122334' }
  });

  assert.strictEqual(user.role, 'medic');
  assert.strictEqual(user.emergencyContact.name, 'Babai');

  stateManager.updateLocation(socketId, { lat: 41.3275, lng: 19.8187 });
  const retrieved = stateManager.users.get(socketId);
  assert.strictEqual(retrieved.lat, 41.3275);
  assert.strictEqual(retrieved.lng, 19.8187);
});

test('StateManager: Buddy Group Creation and Membership', () => {
  const creatorSocket = 'sock_creator';
  const memberSocket = 'sock_member';

  stateManager.registerUser(creatorSocket, { role: 'legal' });
  stateManager.registerUser(memberSocket, { role: 'civilian' });

  const group = stateManager.createBuddyGroup(creatorSocket, 'Studentët e Drejtësisë', '9988');
  assert.strictEqual(group.name, 'Studentët e Drejtësisë');

  const joinRes = stateManager.joinBuddyGroup(memberSocket, group.id, '9988');
  assert.strictEqual(joinRes.success, true);

  stateManager.updateLocation(creatorSocket, { lat: 41.3275, lng: 19.8187 });
  stateManager.updateLocation(memberSocket, { lat: 41.3279, lng: 19.8189 });

  const members = stateManager.getBuddyGroupMembers(group.id);
  assert.strictEqual(members.length, 2);
});

test('StateManager: Incident Pin Verification Consensus (Anti-Fake)', () => {
  const socketA = 'user_a';
  const socketB = 'user_b';
  const socketC = 'user_c';

  const pin = stateManager.createPin(socketA, {
    type: 'police_cordon',
    lat: 41.3217,
    lng: 19.8198,
    description: 'Kordon i dendur policie te Piramida'
  });

  assert.strictEqual(pin.status, 'pending');
  assert.strictEqual(pin.confirmationsCount, 1);

  stateManager.confirmPin(socketB, pin.id, 'confirm');
  let current = stateManager.confirmPin(socketC, pin.id, 'confirm');

  // Me 3 konfirmime duhet të bëhet 'confirmed'
  assert.strictEqual(current.status, 'confirmed');
  assert.strictEqual(current.confirmationsCount, 3);
});

test('StateManager: Buddy Group displays member names/nicknames', () => {
  const socket1 = 'sock_buddy_1';
  const socket2 = 'sock_buddy_2';

  stateManager.registerUser(socket1, { nickname: 'Arbër', role: 'medic' });
  stateManager.registerUser(socket2, { nickname: 'Bora', role: 'legal' });

  const group = stateManager.createBuddyGroup(socket1, 'Qeliza Mjekë-Ligj', '1111');
  stateManager.joinBuddyGroup(socket2, group.id, '1111');

  stateManager.updateLocation(socket1, { lat: 41.3275, lng: 19.8187 });
  stateManager.updateLocation(socket2, { lat: 41.3280, lng: 19.8190 });

  const members = stateManager.getBuddyGroupMembers(group.id);
  assert.strictEqual(members.length, 2);
  assert.ok(members.some(m => m.nickname === 'Arbër'));
  assert.ok(members.some(m => m.nickname === 'Bora'));
});

test('StateManager: Organizer Directives broadcasting to crowd', () => {
  const orgSocket = 'sock_organizer';
  const civSocket = 'sock_civilian_listener';

  stateManager.registerUser(orgSocket, {
    nickname: 'Drejtuesi i Marshimit',
    role: 'organizer',
    organizerCode: 'LIRI2026'
  });
  stateManager.registerUser(civSocket, {
    nickname: 'Protestues',
    role: 'civilian'
  });

  // Movement command without photo MUST FAIL
  const failNoPhoto = stateManager.createTacticalDirective(orgSocket, {
    actionDirective: 'advance',
    title: 'Zhvendosje pa foto',
    message: 'Nuk lejohet marshim pa foto dëshmi.',
    photoData: null
  });
  assert.strictEqual(failNoPhoto.success, false);
  assert.ok(failNoPhoto.message.includes('KUSHT I DETYRUESHËM'));

  // Movement command WITH photo MUST SUCCEED
  const directiveResult = stateManager.createTacticalDirective(orgSocket, {
    actionDirective: 'advance',
    title: 'Zhvendosje drejt Kryeministrisë',
    message: 'Ecni ngadalë në mënyrë kompakte, shmangni rrugicat anësore.',
    priority: 'urgent',
    photoData: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  });

  assert.strictEqual(directiveResult.success, true);
  assert.strictEqual(directiveResult.directive.author, 'Drejtuesi i Marshimit');
  assert.strictEqual(directiveResult.directive.actionDirective, 'advance');
  assert.ok(directiveResult.directive.photoData !== null);

  const activeDirectives = stateManager.getActiveDirectives();
  assert.ok(activeDirectives.length >= 1);
  assert.ok(activeDirectives.some(d => d.title === 'Zhvendosje drejt Kryeministrisë'));

  // Verify non-organizer cannot broadcast directives
  const failResult = stateManager.createTacticalDirective(civSocket, {
    message: 'Thirrje e paautorizuar'
  });
  assert.strictEqual(failResult.success, false);
});

test('StateManager: Frontline Registration & Admin Oversight Control', () => {
  const adminSocket = 'sock_admin';
  const frontlineSocket = 'sock_frontline';
  const minorSocket = 'sock_minor_vanguard';

  // Frontline user registration
  const flUser = stateManager.registerUser(frontlineSocket, {
    nickname: 'Bledar (Mburojë)',
    role: 'frontline',
    isFrontline: true
  });
  assert.strictEqual(flUser.isFrontline, true);
  assert.strictEqual(flUser.role, 'frontline');

  // Minor youth registration in vanguard
  const minorUser = stateManager.registerUser(minorSocket, {
    nickname: 'Klodi (Gjimnazist)',
    role: 'vanguard',
    isFrontline: true,
    isMinor: true
  });
  assert.strictEqual(minorUser.isMinor, true);
  assert.strictEqual(minorUser.role, 'vanguard');

  // Admin authentication
  const authSuccess = stateManager.authenticateAdmin(adminSocket, 'ADMIN_SUPER_KEY_2026');
  assert.strictEqual(authSuccess, true);
  assert.strictEqual(stateManager.isAdmin(adminSocket), true);

  // Admin dashboard inspection
  const dash = stateManager.getAdminDashboardData(adminSocket);
  assert.strictEqual(dash.success, true);
  assert.ok(dash.stats.frontlineCount >= 1);
  assert.ok(dash.stats.minorsCount >= 1);

  // Create a pin and let admin remove it
  const testPin = stateManager.createPin(frontlineSocket, {
    type: 'teargas',
    lat: 41.32,
    lng: 19.81,
    description: 'Gaz lotsjellës provokues'
  });
  assert.ok(stateManager.pins.has(testPin.id));

  const deleted = stateManager.adminDeletePin(adminSocket, testPin.id);
  assert.strictEqual(deleted, true);
  assert.strictEqual(stateManager.pins.has(testPin.id), false);
});

test('GeoUtils: calculateSafeCorridor selects unblocked path to hospital', () => {
  const { calculateSafeCorridor } = require('../server/geoUtils');
  const userLat = 41.3230;
  const userLng = 19.8190;

  const threatPins = [
    { lat: 41.3217, lng: 19.8198, type: 'police_cordon' }
  ];

  const safeDestinations = [
    { name: 'QSUT', lat: 41.3365, lng: 19.8335 },
    { name: 'Pikë Ndihme Parku Rinia', lat: 41.3255, lng: 19.8180 }
  ];

  const corridor = calculateSafeCorridor(userLat, userLng, threatPins, safeDestinations);
  assert.ok(corridor !== null);
  assert.strictEqual(corridor.destination.name, 'Pikë Ndihme Parku Rinia');
});

test('StateManager: Field Scout Intel Dispatch Creation & Broadcast', () => {
  const scoutSocket = 'sock_scout_test';
  const civSocket = 'sock_civ_test';

  const scoutUser = stateManager.registerUser(scoutSocket, {
    nickname: 'Informatori-ZoguIZi',
    role: 'scout'
  });
  assert.strictEqual(scoutUser.role, 'scout');

  stateManager.registerUser(civSocket, {
    nickname: 'Civil-Thjesht',
    role: 'civilian'
  });

  // Scout creates valid movement intel
  const res = stateManager.createIntelDispatch(scoutSocket, {
    movementType: 'encirclement_warning',
    street: 'Rruga e Durrësit',
    text: 'Po na rrethojnë nga prapa! Lëvizni drejt sheshit!',
    urgency: 'critical',
    lat: 41.3290,
    lng: 19.8150
  });

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.dispatch.movementType, 'encirclement_warning');
  assert.strictEqual(res.dispatch.urgency, 'critical');

  const activeIntel = stateManager.getActiveIntel();
  assert.ok(activeIntel.some(i => i.id === res.dispatch.id));

  // Civilian cannot create scout movement intel
  const fail = stateManager.createIntelDispatch(civSocket, {
    text: 'Tentativë e paautorizuar'
  });
  assert.strictEqual(fail.success, false);
});



