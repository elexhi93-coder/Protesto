// ProtestGuard Albania - Tactical Client Engine
(function () {
  'use strict';

  // Initialize Socket.io connection
  const socket = io();

  // Local State
  let userProfile = {
    userId: localStorage.getItem('pg_user_id') || `anon_${Math.random().toString(36).substring(2, 9)}`,
    nickname: localStorage.getItem('pg_nickname') || 'Protestues (Ti)',
    role: localStorage.getItem('pg_role') || 'frontline',
    isFrontline: localStorage.getItem('pg_frontline') ? (localStorage.getItem('pg_frontline') === 'true') : true,
    isMinor: localStorage.getItem('pg_is_minor') === 'true',
    buddyGroupId: localStorage.getItem('pg_buddy_group') || null,
    emergencyContact: JSON.parse(localStorage.getItem('pg_vault_contact') || '{"name":"Babai / Avokati","phone":"+355691122334"}'),
    organizerCode: localStorage.getItem('pg_organizer_code') || '',
    adminKey: localStorage.getItem('pg_admin_key') || ''
  };
  localStorage.setItem('pg_user_id', userProfile.userId);

  // Map Instance (Center of Tirana: Bulevardi Dëshmorët e Kombit / Sheshi Skënderbej)
  const TIRANA_CENTER = [41.3275, 19.8187];
  const map = L.map('map', {
    zoomControl: false,
    attributionControl: false
  }).setView(TIRANA_CENTER, 15);

  // Standard 100% Free OpenStreetMap with zero API Key needed, styled with tactical dark CSS
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    className: 'tactical-dark-tiles'
  }).addTo(map);

  L.control.zoom({ position: 'topright' }).addTo(map);

  // Dedicated Tactical Layers (Institutions, Police stations, Hospitals, Frontline Vanguard)
  const layerPoliceGroup = L.layerGroup().addTo(map);
  const layerInstitutionsGroup = L.layerGroup().addTo(map);
  const layerHospitalsGroup = L.layerGroup().addTo(map);
  const layerVanguardGroup = L.layerGroup().addTo(map);

  // Dynamic Content Layers for User Control (Buddies, Crowd Heatmap, Threat Pins, Scout Intel)
  const layerBuddiesGroup = L.layerGroup().addTo(map);
  const layerPinsGroup = L.layerGroup().addTo(map);
  const layerIntelGroup = L.layerGroup().addTo(map);
  const crowdHeatLayers = L.layerGroup().addTo(map);

  // Markers and Layers References
  let userMarker = null;
  const buddyMarkers = new Map();
  const pinMarkers = new Map();
  const intelMarkers = new Map();

  // Current Coordinates
  let currentCoords = {
    lat: TIRANA_CENTER[0],
    lng: TIRANA_CENTER[1]
  };

  // Auto-Focus & Dynamic Viewport Engine
  let isAutoFocusEnabled = true;
  let lastAutoFitTime = 0;
  let latestCrowdClusters = [];
  const btnToggleAutofocus = document.getElementById('btn-toggle-autofocus');

  btnToggleAutofocus.addEventListener('click', () => {
    isAutoFocusEnabled = !isAutoFocusEnabled;
    if (isAutoFocusEnabled) {
      btnToggleAutofocus.classList.add('active');
      btnToggleAutofocus.innerHTML = '🎯 Auto-Fokus: ON';
      adjustMapViewportAutomatically(true);
    } else {
      btnToggleAutofocus.classList.remove('active');
      btnToggleAutofocus.innerHTML = '🎯 Auto-Fokus: OFF';
    }
  });

  // Kur përdoruesi tërheq hartën me dorë (pan/zoom manual), fik përkohësisht auto-fokusin që të mos e ndërpresë
  map.on('dragstart', () => {
    if (isAutoFocusEnabled) {
      isAutoFocusEnabled = false;
      btnToggleAutofocus.classList.remove('active');
      btnToggleAutofocus.innerHTML = '🎯 Auto-Fokus: OFF';
    }
  });

  /**
   * Përshtat automatikisht kufijtë e hartës (bounds)
   * duke marrë parasysh pozicionin tënd dhe qendrën më të afërt/kryesore të turmës
   */
  function adjustMapViewportAutomatically(force = false) {
    if (!isAutoFocusEnabled && !force) return;
    const now = Date.now();
    // Throttle animacionet e pan/zoom që të mos dridhet ekrani çdo sekondë (çdo 4 sekonda)
    if (!force && now - lastAutoFitTime < 4000) return;
    lastAutoFitTime = now;

    const points = [[currentCoords.lat, currentCoords.lng]];

    // Shto grupin e shokëve nëse ka
    buddyMarkers.forEach(marker => {
      const pos = marker.getLatLng();
      points.push([pos.lat, pos.lng]);
    });

    // Shto pikat më të rëndësishme të turmës brenda rrezes operative (deri në 1.5km)
    if (latestCrowdClusters && latestCrowdClusters.length > 0) {
      latestCrowdClusters.forEach(cluster => {
        points.push([cluster.lat, cluster.lng]);
      });
    }

    if (points.length === 1) {
      // Vetëm përdoruesi
      map.flyTo(points[0], 16, { animate: true, duration: 1 });
    } else {
      // Përfshi përdoruesin dhe turmën/shokët me padding të përshtatshëm
      const bounds = L.latLngBounds(points);
      map.fitBounds(bounds, {
        paddingTopLeft: [40, 160], // Hapësirë për butonat e menusë lart
        paddingBottomRight: [40, 100], // Hapësirë për butonin SOS poshtë
        maxZoom: 17,
        animate: true,
        duration: 1.2
      });
    }
  }

  // UI Elements
  const hudRole = document.getElementById('hud-role');
  const hudBuddy = document.getElementById('hud-buddy');

  let currentActiveSosId = null;

  // ---- Notification Inbox / Message Center (Kutia e Njoftimeve) ----
  const modalInbox = document.getElementById('modal-inbox');
  const inboxListEl = document.getElementById('inbox-list');
  const inboxBadgeEl = document.getElementById('inbox-badge');
  const btnOpenInbox = document.getElementById('btn-open-inbox');
  const btnClearInbox = document.getElementById('btn-clear-inbox');

  let notificationsHistory = JSON.parse(localStorage.getItem('pg_notifications_history') || '[]');
  let unreadNotificationsCount = 0;

  function updateInboxBadge() {
    if (!inboxBadgeEl) return;
    if (unreadNotificationsCount > 0) {
      inboxBadgeEl.style.display = 'inline-block';
      inboxBadgeEl.textContent = unreadNotificationsCount > 99 ? '99+' : unreadNotificationsCount;
    } else {
      inboxBadgeEl.style.display = 'none';
      inboxBadgeEl.textContent = '0';
    }
  }

  function addNotificationToInbox(item) {
    const entry = {
      id: item.id || `notif_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      type: item.type || 'info', // 'scout', 'directive', 'proximity', 'sos'
      title: item.title,
      text: item.text,
      street: item.street || '',
      author: item.author || '',
      timestamp: item.timestamp || Date.now(),
      photoData: item.photoData || null
    };

    notificationsHistory.unshift(entry);
    if (notificationsHistory.length > 50) notificationsHistory.pop();
    try {
      localStorage.setItem('pg_notifications_history', JSON.stringify(notificationsHistory));
    } catch (_) {}

    unreadNotificationsCount++;
    updateInboxBadge();
    renderInboxList();
  }

  function renderInboxList() {
    if (!inboxListEl) return;
    if (!notificationsHistory || notificationsHistory.length === 0) {
      inboxListEl.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;text-align:center;padding:24px;">Nuk ka njoftime të reja për momentin.</div>';
      return;
    }

    inboxListEl.innerHTML = notificationsHistory.map(item => {
      let badgeCls = 'inbox-badge--directive';
      let itemCls = 'inbox-item--directive';
      let typeLabel = 'UDHËZIM';

      if (item.type === 'scout') {
        badgeCls = 'inbox-badge--scout';
        itemCls = 'inbox-item--scout';
        typeLabel = 'VËZHGUES';
      } else if (item.type === 'sos') {
        badgeCls = 'inbox-badge--sos';
        itemCls = 'inbox-item--sos';
        typeLabel = 'SOS ALARM';
      } else if (item.type === 'proximity') {
        badgeCls = 'inbox-badge--proximity';
        itemCls = 'inbox-item--proximity';
        typeLabel = 'RREZIK AFËR';
      }

      const timeStr = new Date(item.timestamp).toLocaleTimeString('sq-AL', { hour: '2-digit', minute: '2-digit' });
      const photoHtml = item.photoData ? `<div style="margin-top:6px;"><img src="${item.photoData}" style="width:100%;max-height:120px;object-fit:cover;border-radius:6px;border:1px solid #444;"></div>` : '';

      return `
        <div class="inbox-item ${itemCls}">
          <div class="inbox-item-header">
            <span class="inbox-badge ${badgeCls}">${typeLabel}</span>
            <span style="font-size:0.72rem;color:var(--text-muted);">${timeStr}</span>
          </div>
          <div style="font-weight:700;font-size:0.9rem;margin-bottom:3px;color:#fff;">${escapeHtml(item.title)}</div>
          ${item.street ? `<div style="font-size:0.78rem;font-weight:700;color:#ffb703;margin-bottom:4px;">📍 ${escapeHtml(item.street)}</div>` : ''}
          <div style="font-size:0.84rem;color:#f1f5f9;line-height:1.35;">${escapeHtml(item.text)}</div>
          ${photoHtml}
          ${item.author ? `<div style="font-size:0.72rem;color:var(--text-muted);margin-top:4px;">Burimi: ${escapeHtml(item.author)}</div>` : ''}
        </div>
      `;
    }).join('');
  }

  if (btnOpenInbox) {
    btnOpenInbox.addEventListener('click', () => {
      unreadNotificationsCount = 0;
      updateInboxBadge();
      renderInboxList();
      if (modalInbox) modalInbox.classList.add('active');
    });
  }

  if (btnClearInbox) {
    btnClearInbox.addEventListener('click', () => {
      notificationsHistory = [];
      unreadNotificationsCount = 0;
      localStorage.removeItem('pg_notifications_history');
      updateInboxBadge();
      renderInboxList();
      showToast('Historiku i njoftimeve u pastrua.', 'info');
    });
  }

  renderInboxList();

  // ---- In-app UI helpers (replace native alert/confirm/prompt dialogs) ----
  const toastEl = document.getElementById('app-toast');
  let toastTimer = null;
  function showToast(message, type = 'info', duration = 3200) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.className = 'app-toast app-toast--' + type + ' show';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), duration);
  }

  function openSosModal() {
    const modal = document.getElementById('modal-sos');
    if (modal) modal.classList.add('active');
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Custom Icons
  const userIcon = L.divIcon({
    className: 'custom-user-marker',
    html: '<div style="background:#3a86ff;width:18px;height:18px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 10px #3a86ff;"></div>',
    iconSize: [18, 18],
    iconAnchor: [9, 9]
  });

  const buddyIcon = L.divIcon({
    className: 'custom-buddy-marker',
    html: '<div style="background:#06d6a0;width:16px;height:16px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 8px #06d6a0;"></div>',
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  });

  function getPinEmoji(type) {
    switch (type) {
      case 'police_cordon': return '👮';
      case 'plainclothes_police': return '🕵️';
      case 'teargas': return '💨';
      case 'water_cannon': return '🚛';
      case 'blocked_street': return '🚧';
      case 'medic_needed': return '🩺';
      case 'lawyer_needed': return '⚖️';
      default: return '⚠️';
    }
  }

  function updateHUD() {
    const roleLabels = {
      civilian: 'Civil',
      scout: 'Informator',
      frontline: 'Fronti',
      vanguard: 'Ballor',
      medic: 'Mjek',
      legal: 'Jurist',
      logistics: 'Logjistikë',
      organizer: 'Organizator',
      admin: 'Admin'
    };
    const frontlineTag = userProfile.isFrontline ? ' 🛡️' : '';
    const minorTag = userProfile.isMinor ? ' ⚠️' : '';
    hudRole.innerHTML = `🏷️ ${escapeHtml(userProfile.nickname || 'Shoku')}: <strong>${roleLabels[userProfile.role] || 'Civil'}${frontlineTag}${minorTag}</strong>`;
    hudBuddy.innerHTML = `👥 <strong>${userProfile.buddyGroupId ? 'Në Qelizë' : 'Pa Grup'}</strong>`;
  }
  updateHUD();

  // Static Tactical Landmarks for Orientation (Institutions, Police HQs, Hospitals)
  const TACTICAL_LANDMARKS = {
    institutions: [
      { name: 'Kryeministria', lat: 41.3217, lng: 19.8198, type: 'institution', icon: '🏛️', note: 'Pika qendrore e tubimit / Gardhi metalik' },
      { name: 'Parlamenti i Shqipërisë', lat: 41.3268, lng: 19.8236, type: 'institution', icon: '🏛️', note: 'Zonë me kordon të lartë sigurie' },
      { name: 'Bashkia Tiranë', lat: 41.3275, lng: 19.8179, type: 'institution', icon: '🏛️', note: 'Sheshi Skënderbej' },
      { name: 'Ministria e Brendshme', lat: 41.3262, lng: 19.8188, type: 'institution', icon: '🏛️', note: 'Prani e lartë e forcave të rendit' },
      { name: 'Presidenca e Republikës', lat: 41.3194, lng: 19.8208, type: 'institution', icon: '🏛️', note: 'Bulevardi Dëshmorët e Kombit' }
    ],
    police: [
      { name: 'Drejtoria Vendore e Policisë Tiranë', lat: 41.3312, lng: 19.8145, type: 'police_hq', icon: '🚨', note: 'Rruga Sami Frashëri / Qendra e shoqërimit' },
      { name: 'Komisariati Nr. 1', lat: 41.3292, lng: 19.8290, type: 'police_hq', icon: '🚨', note: 'Rruga Ali Demi' },
      { name: 'Komisariati Nr. 2', lat: 41.3230, lng: 19.8115, type: 'police_hq', icon: '🚨', note: 'Rruga Muhamet Gjollesha' },
      { name: 'Postbllok Policie te Tajvani', lat: 41.3245, lng: 19.8185, type: 'police_cordon', icon: '👮', note: 'Kordon operativ' }
    ],
    hospitals: [
      { name: 'QSUT - Spitali i Urgjencës', lat: 41.3365, lng: 19.8335, type: 'hospital', icon: '🏥', note: 'Qendra më e madhe spitalore / Traumat' },
      { name: 'Spitali Ushtarak (Trauma)', lat: 41.3435, lng: 19.7890, type: 'hospital', icon: '🏥', note: 'Spitali Qendror i Traumës' },
      { name: 'Poliklinika Qendrore Nr. 9', lat: 41.3282, lng: 19.8242, type: 'hospital', icon: '🏥', note: 'Ndihmë e shpejtë ambulatore' },
      { name: 'Pikë Ndihme Mjekësore Terreni (Parku Rinia)', lat: 41.3255, lng: 19.8180, type: 'medic_outpost', icon: '🩺', note: 'Tenda vullnetare: Ujë, sodë bikarbonati për sy' }
    ],
    vanguard: [
      { name: 'Grupi Ballor Rinor (Vanguard #1)', lat: 41.3224, lng: 19.8195, role: 'vanguard', icon: '⚡', note: 'Fronti i parë përballë kordonit - Të rinj/studentë. Vëzhgim intensiv kundër dhunës!' },
      { name: 'Grupi Ballor Rinor (Vanguard #2)', lat: 41.3228, lng: 19.8198, role: 'vanguard', icon: '⚡', note: 'Fronti anësor tek Ura e Lanës. Monitorim nga avokatët!' }
    ]
  };

  function renderTacticalLandmarks() {
    // Institutions
    TACTICAL_LANDMARKS.institutions.forEach(item => {
      const icon = L.divIcon({
        className: 'landmark-icon',
        html: `<div style="background:#2b2d42;color:#fff;border-radius:6px;padding:3px 6px;font-size:11px;font-weight:700;border:1px solid #8d99ae;box-shadow:0 2px 6px rgba(0,0,0,0.6);">${item.icon} ${item.name}</div>`,
        iconSize: [110, 24],
        iconAnchor: [55, 12]
      });
      L.marker([item.lat, item.lng], { icon })
        .bindPopup(`<strong>${item.icon} ${item.name}</strong><br><span style="color:#adb5bd;font-size:12px;">${item.note}</span>`)
        .addTo(layerInstitutionsGroup);
    });

    // Police Stations & Checkpoints
    TACTICAL_LANDMARKS.police.forEach(item => {
      const icon = L.divIcon({
        className: 'landmark-police-icon',
        html: `<div style="background:#780000;color:#fff;border-radius:6px;padding:3px 6px;font-size:11px;font-weight:700;border:1px solid #c1121f;box-shadow:0 2px 6px rgba(0,0,0,0.6);">${item.icon} ${item.name}</div>`,
        iconSize: [120, 24],
        iconAnchor: [60, 12]
      });
      L.marker([item.lat, item.lng], { icon })
        .bindPopup(`<strong>${item.icon} ${item.name}</strong><br><span style="color:#adb5bd;font-size:12px;">${item.note}</span>`)
        .addTo(layerPoliceGroup);
    });

    // Hospitals & Medical Outposts
    TACTICAL_LANDMARKS.hospitals.forEach(item => {
      const icon = L.divIcon({
        className: 'landmark-hospital-icon',
        html: `<div style="background:#005f73;color:#94d2bd;border-radius:6px;padding:3px 6px;font-size:11px;font-weight:700;border:1px solid #0a9396;box-shadow:0 2px 6px rgba(0,0,0,0.6);">${item.icon} ${item.name}</div>`,
        iconSize: [120, 24],
        iconAnchor: [60, 12]
      });
      L.marker([item.lat, item.lng], { icon })
        .bindPopup(`<strong>${item.icon} ${item.name}</strong><br><span style="color:#adb5bd;font-size:12px;">${item.note}</span>`)
        .addTo(layerHospitalsGroup);
    });

    // Frontline Vanguard (Fronti i Sulmit / Të Rinjtë në Vijën e Parë)
    TACTICAL_LANDMARKS.vanguard.forEach(item => {
      const icon = L.divIcon({
        className: 'landmark-vanguard-icon pulse-vanguard',
        html: `
          <div style="background:#e63946;color:#fff;border-radius:50%;width:34px;height:34px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 0 14px #e63946;font-size:18px;">
            ${item.icon}
          </div>
        `,
        iconSize: [34, 34],
        iconAnchor: [17, 17]
      });
      L.marker([item.lat, item.lng], { icon })
        .bindPopup(`
          <div style="font-size:0.9rem;">
            <strong style="color:#e63946;">⚡ FRONTI I PARË BALLOR (TË RINJTË)</strong><br>
            <span style="font-size:0.8rem;color:#f8f9fa;">${item.note}</span><br>
            <div style="background:rgba(230,57,70,0.2);padding:6px;border-radius:6px;margin-top:6px;font-size:0.75rem;border:1px solid #e63946;">
              ⚠️ <strong>KUJDES I VEÇANTË:</strong> Këtu gjenden të rinjtë dhe studentët që përballen me rrezikun më të lartë të dhunës. Juristët dhe mjekët duhet të mbajnë këtë zonë nën mbikëqyrje konstante!
            </div>
          </div>
        `)
        .addTo(layerVanguardGroup);
    });
  }
  renderTacticalLandmarks();

  // Helper to sync chip state visually
  function setChipState(id, isActive, activeClass = 'active') {
    const el = document.getElementById(id);
    if (!el) return;
    if (isActive) {
      el.classList.add(activeClass);
    } else {
      el.classList.remove('active', 'active-danger', 'active-green', 'active-purple', 'active-blue');
    }
  }

  function setLayerVisibility(group, shouldShow, chipId, activeClass = 'active') {
    if (!group) return;
    if (shouldShow) {
      if (!map.hasLayer(group)) map.addLayer(group);
      setChipState(chipId, true, activeClass);
    } else {
      if (map.hasLayer(group)) map.removeLayer(group);
      setChipState(chipId, false);
    }
  }

  // Switch view mode helper (activates a mode programmatically or on click)
  function applyViewMode(mode) {
    document.querySelectorAll('.main-nav-tab').forEach(t => {
      t.classList.remove('active-tab', 'active-all-tab', 'active-protesters-tab', 'active-police-tab');
    });

    const activeTab = document.querySelector(`.main-nav-tab[data-mode="${mode}"]`);

    if (mode === 'all') {
      if (activeTab) activeTab.classList.add('active-all-tab');
      setLayerVisibility(layerBuddiesGroup, true, 'layer-buddies', 'active-blue');
      setLayerVisibility(crowdHeatLayers, true, 'layer-crowd', 'active-purple');
      setLayerVisibility(layerPoliceGroup, true, 'layer-police', 'active-danger');
      setLayerVisibility(layerPinsGroup, true, 'layer-pins', 'active-danger');
      setLayerVisibility(layerIntelGroup, true, 'layer-intel', 'active-danger');
      setLayerVisibility(layerInstitutionsGroup, true, 'layer-institutions', 'active');
      setLayerVisibility(layerHospitalsGroup, true, 'layer-hospitals', 'active-green');
      setLayerVisibility(layerVanguardGroup, true, 'layer-vanguard', 'active-danger');
    } else if (mode === 'protesters') {
      if (activeTab) activeTab.classList.add('active-protesters-tab');
      // SHFAQ EKSKLUZIVISHT VETËM PROTESTUESIT (Fsheh çdo gjë policore/institucionale)
      setLayerVisibility(layerBuddiesGroup, true, 'layer-buddies', 'active-blue');
      setLayerVisibility(crowdHeatLayers, true, 'layer-crowd', 'active-purple');
      setLayerVisibility(layerVanguardGroup, true, 'layer-vanguard', 'active-danger');
      setLayerVisibility(layerPoliceGroup, false, 'layer-police');
      setLayerVisibility(layerPinsGroup, false, 'layer-pins');
      setLayerVisibility(layerIntelGroup, false, 'layer-intel');
      setLayerVisibility(layerInstitutionsGroup, false, 'layer-institutions');
      setLayerVisibility(layerHospitalsGroup, false, 'layer-hospitals');
    } else if (mode === 'police') {
      if (activeTab) activeTab.classList.add('active-police-tab');
      // SHFAQ EKSKLUZIVISHT VETËM POLICINË DHE RREZIQET (Përfshirë lëvizjet e informatorëve)
      setLayerVisibility(layerPoliceGroup, true, 'layer-police', 'active-danger');
      setLayerVisibility(layerPinsGroup, true, 'layer-pins', 'active-danger');
      setLayerVisibility(layerIntelGroup, true, 'layer-intel', 'active-danger');
      setLayerVisibility(layerInstitutionsGroup, true, 'layer-institutions', 'active');
      setLayerVisibility(layerBuddiesGroup, false, 'layer-buddies');
      setLayerVisibility(crowdHeatLayers, false, 'layer-crowd');
      setLayerVisibility(layerHospitalsGroup, false, 'layer-hospitals');
      setLayerVisibility(layerVanguardGroup, false, 'layer-vanguard');
    } else if (mode === 'buddies') {
      if (activeTab) activeTab.classList.add('active-all-tab');
      // SHFAQ VETËM SHOKËT
      setLayerVisibility(layerBuddiesGroup, true, 'layer-buddies', 'active-blue');
      setLayerVisibility(crowdHeatLayers, false, 'layer-crowd');
      setLayerVisibility(layerPoliceGroup, false, 'layer-police');
      setLayerVisibility(layerPinsGroup, false, 'layer-pins');
      setLayerVisibility(layerIntelGroup, false, 'layer-intel');
      setLayerVisibility(layerInstitutionsGroup, false, 'layer-institutions');
      setLayerVisibility(layerHospitalsGroup, false, 'layer-hospitals');
      setLayerVisibility(layerVanguardGroup, false, 'layer-vanguard');
    }

    // Ruaj zgjedhjen e përdoruesit lokalisht
    localStorage.setItem('pg_active_view_mode', mode);
  }

  // Main Navigation Tabs Switching Logic (KRYE-TABET LART: TË GJITHA | VETËM PROTESTUESIT | VETËM POLICIA | VETËM SHOKËT)
  document.querySelectorAll('.main-nav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const mode = tab.getAttribute('data-mode');
      applyViewMode(mode);
    });
  });

  // Apliko automatikisht tabin e ruajtur ose zgjidh 'protesters'
  const savedViewMode = localStorage.getItem('pg_active_view_mode') || 'all';
  applyViewMode(savedViewMode);

  // Individual Layer Filter Toggle Buttons Logic (Çelësat e çdo shtrese)
  document.querySelectorAll('.layer-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const layerType = chip.getAttribute('data-layer');
      let targetGroup = null;

      if (layerType === 'buddies') targetGroup = layerBuddiesGroup;
      if (layerType === 'crowd') targetGroup = crowdHeatLayers;
      if (layerType === 'police') targetGroup = layerPoliceGroup;
      if (layerType === 'pins') targetGroup = layerPinsGroup;
      if (layerType === 'intel') targetGroup = layerIntelGroup;
      if (layerType === 'institutions') targetGroup = layerInstitutionsGroup;
      if (layerType === 'hospitals') targetGroup = layerHospitalsGroup;
      if (layerType === 'vanguard') targetGroup = layerVanguardGroup;

      if (targetGroup) {
        const isVisible = map.hasLayer(targetGroup);
        if (isVisible) {
          map.removeLayer(targetGroup);
          chip.classList.remove('active', 'active-danger', 'active-green', 'active-purple', 'active-blue');
        } else {
          map.addLayer(targetGroup);
          if (layerType === 'buddies') chip.classList.add('active-blue');
          else if (layerType === 'crowd') chip.classList.add('active-purple');
          else if (layerType === 'hospitals') chip.classList.add('active-green');
          else if (layerType === 'police' || layerType === 'pins' || layerType === 'vanguard' || layerType === 'intel') chip.classList.add('active-danger');
          else chip.classList.add('active');
        }
      }

      // Pastro butonin aktiv te presets kur ndryshohet individualisht
      document.querySelectorAll('.view-mode-btn').forEach(b => b.classList.remove('active'));
    });
  });

  // Socket Connection Lifecycle
  socket.on('connect', () => {
    console.log('Lidhur me rrjetin e sigurisë.');
    socket.emit('user:join', userProfile);
  });

  socket.on('user:registered', (data) => {
    // Shfaq pin-et ekzistuese
    if (data.activePins) {
      data.activePins.forEach(renderPin);
    }
    // Shfaq SOS aktiv nëse ka
    if (data.activeSOS && data.activeSOS.length > 0) {
      showSosBanner(data.activeSOS[0]);
    }
    // Shfaq udhëzimet aktive të organizatorëve
    if (data.activeDirectives && data.activeDirectives.length > 0) {
      showDirectiveBanner(data.activeDirectives[0]);
    }

    // Shfaq buletinet aktive të informatorëve
    if (data.activeIntel && data.activeIntel.length > 0) {
      data.activeIntel.forEach(intel => {
        renderIntelMarker(intel);
        addNotificationToInbox({
          id: intel.id,
          type: 'scout',
          title: `🔭 ${getMovementLabel(intel.movementType)}`,
          street: intel.street,
          text: intel.text,
          author: `${intel.authorNickname || 'Informator'} (${intel.authorRole})`,
          timestamp: intel.timestamp
        });
      });
      // Shfaq si njoftim diskret në toast në vend që të bllokojë ekranin
      const latest = data.activeIntel[0];
      showToast(`🔭 [INFORMATORI]: ${latest.text}`, 'info', 4000);
    }

    // Ngarko bisedat e grupit të përdoruesit
    if (data.chatRooms) {
      renderMyChatList(data.chatRooms);
    }

    // Ri-zbato filtrimin e pamjes (në rast se është zgjedhur 'protesters' apo 'police')
    const currentMode = localStorage.getItem('pg_active_view_mode') || 'all';
    applyViewMode(currentMode);
  });

  // GPS Location Watcher
  if ('geolocation' in navigator) {
    navigator.geolocation.watchPosition(
      (pos) => {
        currentCoords.lat = pos.coords.latitude;
        currentCoords.lng = pos.coords.longitude;
        updateUserPosition();
      },
      (err) => {
        console.warn('GPS i paarritshëm, përdoret pozicioni default në Tiranë:', err.message);
        updateUserPosition();
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 5000 }
    );
  } else {
    updateUserPosition();
  }

  function updateUserPosition() {
    if (!userMarker) {
      userMarker = L.marker([currentCoords.lat, currentCoords.lng], { icon: userIcon })
        .addTo(map)
        .bindPopup('<strong>Pozicioni Juaj</strong>');
    } else {
      userMarker.setLatLng([currentCoords.lat, currentCoords.lng]);
    }

    // Përshtat hartën automatikisht kur ndryshon pozicioni yt
    adjustMapViewportAutomatically();

    // Dërgo te serveri
    socket.emit('location:update', currentCoords);
  }

  // Crowd Density (Heatmap Circles - Grumbullimet e Protestuesve)
  socket.on('crowd:density', (clusters) => {
    latestCrowdClusters = clusters || [];
    crowdHeatLayers.clearLayers();
    clusters.forEach(c => {
      const radius = Math.min(100, 25 + (c.count * 15));
      const circle = L.circle([c.lat, c.lng], {
        color: '#ff006e',
        fillColor: '#ff006e',
        fillOpacity: 0.22,
        weight: 1.5,
        radius: radius
      }).addTo(crowdHeatLayers);

      circle.bindPopup(`
        <div style="font-size:0.85rem;">
          <strong style="color:#ff006e;">🔥 GRUMBULLIM PROTESTUESISH</strong><br>
          Dendësia e vlerësuar: <strong>~${c.count * 10}+ protestues</strong><br>
          <span style="font-size:0.75rem;color:#94a3b8;">Zona anonimizuar (~150m) për të mbrojtur identitetin.</span>
        </div>
      `);
    });

    // Përshtat dinamikisht pamjen e hartës sipas qendrës së turmës
    adjustMapViewportAutomatically();
  });

  // Buddy Circle Updates (With Name & Role Display and Minor Protection Badge)
  socket.on('buddy:update', (members) => {
    // Pastro vjetrat
    buddyMarkers.forEach(m => layerBuddiesGroup.removeLayer(m));
    buddyMarkers.clear();

    members.forEach(m => {
      if (m.id === userProfile.userId) return; // mos shfaq veten dy herë
      
      const memberName = escapeHtml(m.nickname || 'Shoku');
      const isMinor = m.isMinor;
      const dotColor = isMinor ? '#ff006e' : '#06d6a0';
      const tagBg = isMinor ? '#ff006e' : '#06d6a0';
      const minorWarning = isMinor ? ' [⚠️ I Ri]' : '';

      const customBuddyIcon = L.divIcon({
        className: `custom-named-buddy ${isMinor ? 'pulse-vanguard' : ''}`,
        html: `
          <div style="display:flex;flex-direction:column;align-items:center;pointer-events:none;">
            <div style="background:${dotColor};width:18px;height:18px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 10px ${dotColor};"></div>
            <div class="buddy-tag" style="background:${tagBg};color:#fff;">${memberName} (${m.role})${minorWarning}</div>
          </div>
        `,
        iconSize: [110, 44],
        iconAnchor: [55, 9]
      });

      const marker = L.marker([m.lat, m.lng], { icon: customBuddyIcon })
        .addTo(layerBuddiesGroup)
        .bindPopup(`
          <strong>${memberName}</strong><br>
          Roli: <strong>${m.role}</strong><br>
          ${isMinor ? '<span style="color:#ff4d6d;font-weight:700;">⚠️ I RI NË PROTESTË (VËMENDJE MAKSIMALE)</span><br>' : ''}
          Pozicion i drejtpërdrejtë në Qelizë
        `);
      buddyMarkers.set(m.id, marker);
    });
  });

  // Proximity Alert (Vibrim dhe Ruajtje ne Inbox)
  socket.on('alert:proximity', (data) => {
    // Shto në Kutinë e Njoftimeve
    addNotificationToInbox({
      type: 'proximity',
      title: '⚠️ ALARM RRUGOR NË AFËRSI!',
      text: data.message || 'Prani policie e konfirmuar në rrezen tuaj!',
      author: 'Sistemi i Sigurisë'
    });

    // Shfaq shkurt një toast diskret në fund që nuk zë qendrën e hartës
    showToast(`⚠️ ${data.message}`, 'error', 4500);

    // Haptic Feedback / Vibrim në pajisje celulare
    if ('vibrate' in navigator) {
      navigator.vibrate([300, 150, 300, 150, 400]);
    }
  });

  // Incident Pin Management
  function renderPin(pin) {
    if (pinMarkers.has(pin.id)) {
      layerPinsGroup.removeLayer(pinMarkers.get(pin.id));
    }

    const emoji = getPinEmoji(pin.type);
    const pinColor = pin.status === 'confirmed' ? '#e63946' : '#f77f00';
    const htmlIcon = `<div style="background:${pinColor};width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;border:2px solid #fff;box-shadow:0 0 10px rgba(0,0,0,0.5);">${emoji}</div>`;

    const customPinIcon = L.divIcon({
      className: 'pin-icon',
      html: htmlIcon,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });

    const marker = L.marker([pin.lat, pin.lng], { icon: customPinIcon }).addTo(layerPinsGroup);

    const popupContent = `
      <div style="font-size:0.9rem;">
        <strong>${emoji} ${escapeHtml(pin.type).toUpperCase().replace('_', ' ')}</strong><br>
        <span style="color:#555;">${escapeHtml(pin.description || 'Pa përshkrim')}</span><br>
        <span style="font-size:0.8rem;color:${pinColor};">Statusi: <strong>${pin.status === 'confirmed' ? 'I KONFIRMUAR' : 'Në Pritje'}</strong> (${pin.confirmationsCount} vota)</span>
        <div style="margin-top:8px;display:flex;gap:4px;">
          <button onclick="window.confirmPin('${pin.id}', 'confirm')" style="background:#06d6a0;color:#fff;border:none;padding:4px 8px;border-radius:4px;cursor:pointer;">✅ Konfirmo</button>
          <button onclick="window.confirmPin('${pin.id}', 'dispute')" style="background:#e63946;color:#fff;border:none;padding:4px 8px;border-radius:4px;cursor:pointer;">❌ Kundërshto</button>
        </div>
      </div>
    `;

    marker.bindPopup(popupContent);
    pinMarkers.set(pin.id, marker);
  }

  socket.on('pin:broadcast', (pin) => {
    renderPin(pin);
  });

  socket.on('pin:error', (msg) => {
    showToast(msg || 'Raportim i pavlefshëm.', 'error');
  });

  socket.on('pin:updated', (pin) => {
    renderPin(pin);
  });

  window.confirmPin = function (pinId, vote) {
    socket.emit('pin:confirm', { pinId, vote });
  };

  // ---- Informatorët / Vëzhguesit e Terrenit (Field Scout Intel Logic) ----
  const intelBanner = document.getElementById('intel-banner');
  const intelBannerTitle = document.getElementById('intel-banner-title');
  const intelBannerUrgency = document.getElementById('intel-banner-urgency');
  const intelBannerStreet = document.getElementById('intel-banner-street');
  const intelBannerText = document.getElementById('intel-banner-text');
  const intelBannerAuthor = document.getElementById('intel-banner-author');

  function getMovementLabel(moveType) {
    switch (moveType) {
      case 'police_incoming': return '🚓 POLICIA PO AFROHET';
      case 'encirclement_warning': return '⚠️ PARALAJMËRIM RRETHIMI';
      case 'water_cannon_moving': return '🚛 UJËHEDHËSJA PO LËVIZ';
      case 'van_reinforcements': return '🚐 PËRFORCIME POLICIE';
      case 'exit_blocked': return '🚧 DALJE E BLLOKUAR';
      case 'corridor_clear': return '✅ KORRIDOR I HAPUR';
      default: return '🔭 LËVIZJE POLICIE';
    }
  }

  function showIntelBanner(intel) {
    if (!intelBanner) return;
    intelBanner.style.display = 'block';
    intelBannerTitle.textContent = `🔭 ${getMovementLabel(intel.movementType)}`;
    intelBannerUrgency.textContent = (intel.urgency || 'high').toUpperCase();
    if (intel.urgency === 'critical') {
      intelBanner.style.background = 'rgba(214, 40, 40, 0.98)';
      intelBannerUrgency.style.background = '#e63946';
    } else {
      intelBanner.style.background = 'rgba(247, 127, 0, 0.95)';
      intelBannerUrgency.style.background = '#000';
    }
    intelBannerStreet.textContent = intel.street ? `📍 ${intel.street}` : '';
    intelBannerText.textContent = intel.text;
    intelBannerAuthor.textContent = `Raportuar nga: ${intel.authorNickname || 'Informator'}`;

    if ('vibrate' in navigator) {
      navigator.vibrate([250, 100, 250]);
    }
  }

  function renderIntelMarker(intel) {
    if (!Number.isFinite(intel.lat) || !Number.isFinite(intel.lng)) return;
    if (intelMarkers.has(intel.id)) {
      layerIntelGroup.removeLayer(intelMarkers.get(intel.id));
    }

    const isCrit = intel.urgency === 'critical';
    const bgCol = isCrit ? '#d62828' : '#f77f00';
    const customIntelIcon = L.divIcon({
      className: `intel-map-marker ${isCrit ? 'pulse-vanguard' : ''}`,
      html: `
        <div style="background:${bgCol};color:#fff;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 0 12px ${bgCol};font-size:16px;">
          🔭
        </div>
      `,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });

    const marker = L.marker([intel.lat, intel.lng], { icon: customIntelIcon }).addTo(layerIntelGroup);
    marker.bindPopup(`
      <div style="font-size:0.9rem;">
        <strong style="color:${bgCol};">🔭 ${escapeHtml(getMovementLabel(intel.movementType))}</strong><br>
        ${intel.street ? `<strong>📍 ${escapeHtml(intel.street)}</strong><br>` : ''}
        <span style="font-size:0.85rem;color:#f8f9fa;">${escapeHtml(intel.text)}</span><br>
        <div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">
          Nga: <strong>${escapeHtml(intel.authorNickname)}</strong> (${intel.authorRole})
        </div>
      </div>
    `);
    intelMarkers.set(intel.id, marker);
  }

  socket.on('intel:broadcast', (intel) => {
    renderIntelMarker(intel);
    addNotificationToInbox({
      id: intel.id,
      type: 'scout',
      title: `🔭 ${getMovementLabel(intel.movementType)}`,
      street: intel.street,
      text: intel.text,
      author: `${intel.authorNickname || 'Informator'} (${intel.authorRole})`,
      timestamp: intel.timestamp
    });
    // Shfaq njoftim të shkurtër në toast pa bllokuar hartën
    showToast(`🔭 [VËZHGUESI]: ${intel.street ? intel.street + ' - ' : ''}${intel.text}`, 'info', 4500);

    if ('vibrate' in navigator) {
      navigator.vibrate([250, 100, 250]);
    }
  });

  socket.on('intel:error', (msg) => {
    showToast(msg || 'Gabim te njoftimi i informatorit.', 'error');
  });

  socket.on('intel:deleted', ({ dispatchId }) => {
    if (intelMarkers.has(dispatchId)) {
      layerIntelGroup.removeLayer(intelMarkers.get(dispatchId));
      intelMarkers.delete(dispatchId);
    }
  });

  // SOS & Arrest Alert Logic
  function showSosBanner(sosData) {
    currentActiveSosId = sosData.id;
    const latStr = (Number.isFinite(sosData.lat) ? sosData.lat : 0).toFixed(4);
    const lngStr = (Number.isFinite(sosData.lng) ? sosData.lng : 0).toFixed(4);
    const locNote = sosData.fuzzy ? ' (pozicion i përafërt)' : '';
    const desc = `Protestues i ndaluar/rrezikuar te koordinatat [${latStr}, ${lngStr}]${locNote}. Roli: ${sosData.role}. Shënim: ${sosData.note || 'Emergjencë!'}`;

    // Shto në Kutinë e Njoftimeve
    addNotificationToInbox({
      id: sosData.id,
      type: 'sos',
      title: '🚨 ALARM ARRESTIMI / NDALIM ME FORCË!',
      text: desc,
      author: `Roli: ${sosData.role}`,
      timestamp: sosData.timestamp || Date.now()
    });

    // Shfaq njoftim të shpejtë në fund (Toast) në vend të shiritit masiv në mes të ekranit
    showToast(`🚨 [SOS ALARM]: Ndalim me forcë! Shih kutinë e njoftimeve.`, 'error', 6000);
    
    // Panik & Vibrim
    if ('vibrate' in navigator) {
      navigator.vibrate([500, 200, 500, 200, 500]);
    }
  }

  socket.on('sos:broadcast', (sosData) => {
    showSosBanner(sosData);
  });

  socket.on('sos:vault_dispatched', (data) => {
    showToast(`[KUTIA E SIGURISË]\n${data.message}\nKontakti i ruajtur: ${data.contact}`, 'info', 7000);
  });

  // Audio Siren / Megaphone Synthesizer (Open Web Audio API - Zero External Dependencies)
  let audioContext = null;
  let sirenOscillator = null;
  let isSirenPlaying = false;
  const btnSoundAlarm = document.getElementById('btn-sound-alarm');

  btnSoundAlarm.addEventListener('click', () => {
    if (!isSirenPlaying) {
      startTacticalSiren();
    } else {
      stopTacticalSiren();
    }
  });

  function startTacticalSiren() {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return showToast('Audio nuk mbështetet në këtë shfletues.', 'error');
      audioContext = new AudioContextClass();
      
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();

      osc.type = 'sawtooth';
      gain.gain.setValueAtTime(0.3, audioContext.currentTime);

      // Modulate frequency between 600Hz and 950Hz (Standard European Emergency Siren)
      const now = audioContext.currentTime;
      for (let i = 0; i < 30; i++) {
        osc.frequency.setValueAtTime(600, now + (i * 0.8));
        osc.frequency.linearRampToValueAtTime(950, now + (i * 0.8) + 0.4);
        osc.frequency.linearRampToValueAtTime(600, now + (i * 0.8) + 0.8);
      }

      osc.connect(gain);
      gain.connect(audioContext.destination);
      osc.start();

      sirenOscillator = osc;
      isSirenPlaying = true;
      btnSoundAlarm.style.background = '#e63946';
      btnSoundAlarm.style.color = '#fff';
      btnSoundAlarm.textContent = '⏹️ Ndalo';

      // Auto stop after 20 seconds
      setTimeout(() => {
        if (isSirenPlaying) stopTacticalSiren();
      }, 20000);
    } catch (e) {
      console.error('Audio error:', e);
    }
  }

  function stopTacticalSiren() {
    if (sirenOscillator) {
      try { sirenOscillator.stop(); } catch (_) {}
      sirenOscillator = null;
    }
    if (audioContext) {
      try { audioContext.close(); } catch (_) {}
      audioContext = null;
    }
    isSirenPlaying = false;
    btnSoundAlarm.style.background = '#2b2d42';
    btnSoundAlarm.style.color = '#ff4d6d';
    btnSoundAlarm.textContent = '📢 Sirenë';
  }

  // Safe Escape Corridor Navigation Logic
  let activeSafeRoutePolyline = null;
  const btnSafeRoute = document.getElementById('btn-safe-route');

  btnSafeRoute.addEventListener('click', () => {
    if (activeSafeRoutePolyline) {
      map.removeLayer(activeSafeRoutePolyline);
      activeSafeRoutePolyline = null;
      btnSafeRoute.style.background = '#14213d';
      btnSafeRoute.textContent = '🧭 Korridor';
      return;
    }

    // Gjej spitalin ose qendrën e ndihmës më të afërt
    let closestHospital = null;
    let minDistance = Infinity;

    TACTICAL_LANDMARKS.hospitals.forEach(h => {
      const d = Math.hypot(currentCoords.lat - h.lat, currentCoords.lng - h.lng);
      if (d < minDistance) {
        minDistance = d;
        closestHospital = h;
      }
    });

    if (closestHospital) {
      activeSafeRoutePolyline = L.polyline(
        [[currentCoords.lat, currentCoords.lng], [closestHospital.lat, closestHospital.lng]],
        {
          color: '#06d6a0',
          weight: 5,
          dashArray: '10, 10',
          opacity: 0.9
        }
      ).addTo(map);

      map.fitBounds(activeSafeRoutePolyline.getBounds(), { padding: [80, 80] });
      btnSafeRoute.style.background = '#06d6a0';
      btnSafeRoute.style.color = '#000';
      btnSafeRoute.textContent = '✖️ Hiq Korridorin';

      showToast(`🧭 KORRIDORI I EVAKUIMIT & NDIHMËS:\nDestinacioni më i afërt: ${closestHospital.name}\n${closestHospital.note}\nNdiqni vijën e gjelbër me ndërprerje në hartë!`, 'info', 6000);
    }
  });

  // User Actions: SOS Trigger
  document.getElementById('btn-trigger-sos').addEventListener('click', () => {
    openSosModal();
  });

  document.getElementById('btn-send-sos').addEventListener('click', () => {
    const note = (document.getElementById('sos-note-input').value || '').trim() || 'Ndalim nga Policia';
    socket.emit('sos:trigger', {
      lat: currentCoords.lat,
      lng: currentCoords.lng,
      alertType: 'arrest_in_progress',
      note: note
    });
    closeModals();
    document.getElementById('sos-note-input').value = '';
  });

  // Tactical Directive Display
  function showDirectiveBanner(directive) {
    // Shto në Kutinë e Njoftimeve
    addNotificationToInbox({
      id: directive.id,
      type: 'directive',
      title: `📢 ${directive.title || 'UDHËZIM NGA ORGANIZATORËT'} (${(directive.actionDirective || 'hold').toUpperCase()})`,
      text: directive.message || '',
      author: directive.author || 'Koordinatori Qendror',
      photoData: directive.photoData || null,
      timestamp: directive.timestamp || Date.now()
    });

    // Shfaq njoftim të shpejtë në fund (Toast) pa bllokuar hartën
    showToast(`📢 [ORGANIZATORI]: ${directive.title || 'Udhëzim i Ri'}!\nKontrolloni Kutinë e Njoftimeve.`, 'info', 4500);

    if ('vibrate' in navigator) {
      navigator.vibrate([200, 100, 200]);
    }
  }

  socket.on('directive:broadcast', (directive) => {
    showDirectiveBanner(directive);
  });

  socket.on('directive:error', (msg) => {
    showToast(`Gabim Organizatori: ${msg}`, 'error');
  });

  // Modal Toggles
  window.closeModals = function () {
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
  };

  document.getElementById('btn-open-report').addEventListener('click', () => {
    document.getElementById('modal-report').classList.add('active');
  });

  document.getElementById('btn-open-buddy').addEventListener('click', () => {
    document.getElementById('modal-buddy').classList.add('active');
  });

  document.getElementById('btn-open-profile').addEventListener('click', () => {
    document.getElementById('modal-profile').classList.add('active');
  });

  document.getElementById('btn-open-organizer').addEventListener('click', () => {
    document.getElementById('modal-organizer').classList.add('active');
  });

  document.getElementById('btn-open-scout').addEventListener('click', () => {
    document.getElementById('modal-scout').classList.add('active');
    populateScoutStreetChips();
  });

  // Street quick chips generator
  const POPULAR_TIRANA_STREETS = [
    'Bulevardi Dëshmorët e Kombit',
    'Rruga Ibrahim Rugova',
    'Ura e Lanës',
    'Sheshi Skënderbej',
    'Parku Rinia (Tajvani)',
    'Piramida e Tiranës',
    'Rruga Myslym Shyri',
    'Rruga Sami Frashëri',
    'Rruga e Durrësit',
    'Rruga e Elbasanit'
  ];

  function populateScoutStreetChips() {
    const container = document.getElementById('scout-quick-streets');
    if (!container || container.children.length > 0) return;
    container.innerHTML = POPULAR_TIRANA_STREETS.map(st => `
      <button type="button" class="btn" style="background:#1e2229;border:1px solid #2e3540;color:#94a3b8;font-size:0.7rem;padding:3px 8px;border-radius:12px;cursor:pointer;" onclick="window.selectScoutStreet('${escapeHtml(st)}')">
        + ${escapeHtml(st)}
      </button>
    `).join('');
  }

  window.selectScoutStreet = function (name) {
    const input = document.getElementById('scout-street');
    if (input) input.value = name;
  };

  // Submit Scout Movement Intel
  document.getElementById('btn-submit-scout').addEventListener('click', () => {
    const movementType = document.getElementById('scout-movement-type').value;
    const street = document.getElementById('scout-street').value;
    const text = document.getElementById('scout-text').value;
    const urgency = document.getElementById('scout-urgency').value;

    if (!text || !text.trim()) {
      return showToast('Ju lutem shkruani mesazhin e vëzhgimit (p.sh. Nga po vjen policia).', 'error');
    }

    socket.emit('intel:create', {
      movementType,
      street,
      text,
      urgency,
      lat: currentCoords.lat,
      lng: currentCoords.lng
    });

    closeModals();
    document.getElementById('scout-text').value = '';
    document.getElementById('scout-street').value = '';
    showToast('Njoftimi i vëzhgimit u transmetua me sukses te të gjithë!', 'success');
  });

  // Organizer role change listener
  const selectRoleEl = document.getElementById('select-role');
  const groupOrganizerCodeEl = document.getElementById('group-organizer-code');
  selectRoleEl.addEventListener('change', () => {
    if (selectRoleEl.value === 'organizer') {
      groupOrganizerCodeEl.style.display = 'block';
    } else {
      groupOrganizerCodeEl.style.display = 'none';
    }
  });

  // Send Organizer Directive
  let uploadedDirectivePhotoBase64 = null;
  const directivePhotoInput = document.getElementById('directive-photo-input');
  const photoPreviewContainer = document.getElementById('photo-preview-container');
  const photoPreviewImg = document.getElementById('photo-preview-img');

  directivePhotoInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = function (event) {
        uploadedDirectivePhotoBase64 = event.target.result;
        photoPreviewImg.src = uploadedDirectivePhotoBase64;
        photoPreviewContainer.style.display = 'block';
      };
      reader.readAsDataURL(file);
    }
  });

  document.getElementById('btn-send-directive').addEventListener('click', () => {
    const actionDirective = document.getElementById('directive-action').value;
    const title = document.getElementById('directive-title-input').value;
    const message = document.getElementById('directive-msg-input').value;
    const priority = document.getElementById('directive-priority').value;

    if (!message) return showToast('Ju lutem shkruani mesazhin e udhëzimit për protestuesit.', 'error');

    // KUSHTI: Verifiko nese eshte levizje para/mbrapa dhe mungon foto
    if ((actionDirective === 'advance' || actionDirective === 'fallback') && !uploadedDirectivePhotoBase64) {
      return showToast('⚠️ KUSHT I DETYRUESHËM:\nPër të dhënë komandë lëvizjeje ("Marsh Para" ose "Tërheqje"), duhet të bashkëngjitni patjetër një foto dëshmi nga terreni!', 'error', 5000);
    }

    socket.emit('directive:create', {
      actionDirective,
      title,
      message,
      priority,
      photoData: uploadedDirectivePhotoBase64
    });

    closeModals();
    document.getElementById('directive-msg-input').value = '';
    uploadedDirectivePhotoBase64 = null;
    directivePhotoInput.value = '';
    photoPreviewContainer.style.display = 'none';
  });

  // Submit Incident Report
  document.getElementById('btn-submit-report').addEventListener('click', () => {
    const type = document.getElementById('report-type').value;
    const desc = document.getElementById('report-desc').value;
    socket.emit('pin:create', {
      type,
      lat: currentCoords.lat,
      lng: currentCoords.lng,
      description: desc
    });
    closeModals();
    document.getElementById('report-desc').value = '';
  });

  // Buddy Group Actions
  // Buddy Group Actions & Kopjimi i ID
  const buddyActiveBox = document.getElementById('buddy-active-box');
  const buddyCurrentName = document.getElementById('buddy-current-name');
  const buddyCurrentId = document.getElementById('buddy-current-id');
  const btnCopyBuddyId = document.getElementById('btn-copy-buddy-id');
  const btnLeaveBuddy = document.getElementById('btn-leave-buddy');

  function updateBuddyModalUI(groupId, groupName) {
    if (groupId) {
      if (buddyActiveBox) buddyActiveBox.style.display = 'block';
      if (buddyCurrentId) buddyCurrentId.textContent = `ID: ${groupId}`;
      if (buddyCurrentName) buddyCurrentName.textContent = groupName ? `Qeliza: "${groupName}"` : `Qeliza Aktive`;
    } else {
      if (buddyActiveBox) buddyActiveBox.style.display = 'none';
    }
  }

  if (userProfile.buddyGroupId) {
    updateBuddyModalUI(userProfile.buddyGroupId, localStorage.getItem('pg_buddy_group_name') || '');
  }

  if (btnCopyBuddyId) {
    btnCopyBuddyId.addEventListener('click', () => {
      if (!userProfile.buddyGroupId) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(userProfile.buddyGroupId).then(() => {
          showToast(`📋 ID e grupit "${userProfile.buddyGroupId}" u kopjua! Dërgojani shokëve.`, 'success', 3500);
        }).catch(() => {
          showToast(`ID: ${userProfile.buddyGroupId}`, 'info', 4000);
        });
      } else {
        showToast(`ID: ${userProfile.buddyGroupId}`, 'info', 4000);
      }
    });
  }

  if (btnLeaveBuddy) {
    btnLeaveBuddy.addEventListener('click', () => {
      userProfile.buddyGroupId = null;
      localStorage.removeItem('pg_buddy_group');
      localStorage.removeItem('pg_buddy_group_name');
      updateHUD();
      updateBuddyModalUI(null);
      buddyMarkers.forEach(m => layerBuddiesGroup.removeLayer(m));
      buddyMarkers.clear();
      socket.emit('user:join', userProfile);
      showToast('U larguat nga qeliza e shokëve.', 'info');
    });
  }

  document.getElementById('btn-create-buddy').addEventListener('click', () => {
    const name = document.getElementById('buddy-group-name').value;
    const passCode = document.getElementById('buddy-passcode').value;
    if (!name || !passCode) return showToast('Plotësoni emrin dhe pin-in e grupit!', 'error');
    socket.emit('buddy:create', { name, passCode });
  });

  socket.on('buddy:created', (data) => {
    userProfile.buddyGroupId = data.groupId;
    localStorage.setItem('pg_buddy_group', data.groupId);
    localStorage.setItem('pg_buddy_group_name', data.name);
    updateHUD();
    updateBuddyModalUI(data.groupId, data.name);
    showToast(`Grupi "${data.name}" u krijua me sukses!\n\nID: ${data.groupId} (PIN: ${data.passCode || 'Sekret'})\nKopjojeni te paneli i grupit!`, 'success', 6000);
    closeModals();
  });

  document.getElementById('btn-join-buddy').addEventListener('click', () => {
    const groupId = document.getElementById('join-group-id').value;
    const passCode = document.getElementById('join-group-pin').value;
    if (!groupId || !passCode) return showToast('Plotësoni ID dhe PIN-in!', 'error');
    socket.emit('buddy:join', { groupId, passCode });
  });

  socket.on('buddy:joined', (data) => {
    userProfile.buddyGroupId = data.groupId;
    localStorage.setItem('pg_buddy_group', data.groupId);
    localStorage.setItem('pg_buddy_group_name', data.name);
    updateHUD();
    updateBuddyModalUI(data.groupId, data.name);
    showToast(`U bashkuat me sukses në grupin "${data.name}"!`, 'success');
    closeModals();
  });

  socket.on('buddy:error', (msg) => {
    showToast(`Gabim: ${msg}`, 'error');
  });

  // Load Initial Profile in Modal Form
  document.getElementById('user-nickname').value = userProfile.nickname || '';
  document.getElementById('select-role').value = userProfile.role;
  document.getElementById('organizer-code').value = userProfile.organizerCode || '';
  document.getElementById('check-frontline').checked = userProfile.isFrontline || false;
  document.getElementById('check-minor').checked = userProfile.isMinor || false;
  if (userProfile.role === 'organizer') {
    groupOrganizerCodeEl.style.display = 'block';
  }
  if (userProfile.emergencyContact) {
    document.getElementById('vault-contact-name').value = userProfile.emergencyContact.name || '';
    document.getElementById('vault-contact-phone').value = userProfile.emergencyContact.phone || '';
  }

  // Profile Save Updated with Frontline & Minor/Vanguard Flag
  document.getElementById('btn-save-profile').addEventListener('click', () => {
    const nickname = document.getElementById('user-nickname').value;
    const role = document.getElementById('select-role').value;
    const organizerCode = document.getElementById('organizer-code').value;
    const isFrontline = document.getElementById('check-frontline').checked;
    const isMinor = document.getElementById('check-minor').checked;
    const contactName = document.getElementById('vault-contact-name').value;
    const contactPhone = document.getElementById('vault-contact-phone').value;

    userProfile.nickname = nickname || 'Shoku';
    userProfile.role = role;
    userProfile.isFrontline = isFrontline || role === 'frontline' || role === 'vanguard';
    userProfile.isMinor = isMinor;
    userProfile.organizerCode = organizerCode || '';
    
    localStorage.setItem('pg_nickname', userProfile.nickname);
    localStorage.setItem('pg_role', role);
    localStorage.setItem('pg_frontline', userProfile.isFrontline);
    localStorage.setItem('pg_is_minor', userProfile.isMinor);
    localStorage.setItem('pg_organizer_code', userProfile.organizerCode);

    if (contactName || contactPhone) {
      userProfile.emergencyContact = { name: contactName, phone: contactPhone };
      localStorage.setItem('pg_vault_contact', JSON.stringify(userProfile.emergencyContact));
    }

    updateHUD();
    socket.emit('user:join', userProfile);
    showToast('Profili, Statusi dhe Kutia e Sigurisë u ruajtën me sukses!', 'success');
    closeModals();
  });

  // Admin Control Center Logic
  document.getElementById('btn-open-admin').addEventListener('click', () => {
    document.getElementById('modal-admin').classList.add('active');
    if (userProfile.adminKey) {
      socket.emit('admin:auth', { adminKey: userProfile.adminKey });
    }
  });

  document.getElementById('btn-submit-admin-auth').addEventListener('click', () => {
    const adminKey = document.getElementById('admin-key-input').value;
    if (!adminKey) return showToast('Vendosni çelësin sekret të administratorit.', 'error');
    userProfile.adminKey = adminKey;
    localStorage.setItem('pg_admin_key', adminKey);
    socket.emit('admin:auth', { adminKey });
  });

  socket.on('admin:auth_success', (data) => {
    document.getElementById('admin-login-view').style.display = 'none';
    document.getElementById('admin-dashboard-view').style.display = 'block';
    renderAdminDashboard(data);
  });

  socket.on('admin:auth_error', (msg) => {
    showToast(`Autentikim i Dështuar: ${msg}`, 'error');
  });

  socket.on('admin:data', (data) => {
    renderAdminDashboard(data);
  });

  document.getElementById('btn-refresh-admin').addEventListener('click', () => {
    socket.emit('admin:refresh_data');
  });

  function renderAdminDashboard(data) {
    if (!data || !data.stats) return;
    document.getElementById('stat-users').textContent = data.stats.totalUsers;
    document.getElementById('stat-frontline').textContent = data.stats.frontlineCount;
    document.getElementById('stat-scouts').textContent = data.stats.scoutsCount || 0;
    document.getElementById('stat-minors').textContent = data.stats.minorsCount || 0;
    document.getElementById('stat-pins').textContent = data.stats.activePins;

    // Render Scout Intel List with Delete Action
    const intelList = document.getElementById('admin-intel-list');
    if (!data.intelDispatches || data.intelDispatches.length === 0) {
      intelList.innerHTML = '<span style="color:#6c757d;">Nuk ka buletine aktive të informatorëve.</span>';
    } else {
      intelList.innerHTML = data.intelDispatches.map(item => `
        <div style="border-bottom:1px solid #2e3540;padding:4px 0;display:flex;justify-content:space-between;align-items:center;">
          <div>
            <strong>[${escapeHtml(item.movementType)}]</strong> ${item.street ? escapeHtml(item.street) + ': ' : ''}${escapeHtml(item.text)}
            <span style="font-size:0.7rem;color:#f77f00;">(${escapeHtml(item.authorNickname)})</span>
          </div>
          <button onclick="window.adminDeleteIntel('${item.id}')" style="background:#e63946;color:#fff;border:none;padding:2px 6px;border-radius:4px;cursor:pointer;">Fshi</button>
        </div>
      `).join('');
    }

    // Render Directives List with Delete Action
    const dirList = document.getElementById('admin-directives-list');
    if (!data.directives || data.directives.length === 0) {
      dirList.innerHTML = '<span style="color:#6c757d;">Nuk ka udhëzime aktive të transmetuara.</span>';
    } else {
      dirList.innerHTML = data.directives.map(d => `
        <div style="border-bottom:1px solid #2e3540;padding:4px 0;display:flex;justify-content:space-between;align-items:center;">
          <div>
            <strong>${escapeHtml(d.title)}</strong> (${escapeHtml(d.author)}) - <em>${escapeHtml(d.actionDirective)}</em>
            ${d.photoData ? ' [📷 me Foto]' : ''}
          </div>
          <button onclick="window.adminDeleteDirective('${d.id}')" style="background:#e63946;color:#fff;border:none;padding:2px 6px;border-radius:4px;cursor:pointer;">Fshi</button>
        </div>
      `).join('');
    }

    // Render SOS List
    const sosList = document.getElementById('admin-sos-list');
    if (!data.sosAlerts || data.sosAlerts.length === 0) {
      sosList.innerHTML = '<span style="color:#6c757d;">Nuk ka alarme arrestimi apo emergjence aktive.</span>';
    } else {
      sosList.innerHTML = data.sosAlerts.map(s => `
        <div style="border-bottom:1px solid #2e3540;padding:4px 0;display:flex;justify-content:space-between;align-items:center;">
          <div>
            <strong>${escapeHtml(s.nickname)}</strong>: ${escapeHtml(s.note || s.alertType)} [${(s.lat != null ? s.lat : 0).toFixed(3)}, ${(s.lng != null ? s.lng : 0).toFixed(3)}]
          </div>
          <button onclick="window.adminResolveSOS('${s.id}')" style="background:#06d6a0;color:#fff;border:none;padding:2px 6px;border-radius:4px;cursor:pointer;">Zgjidh</button>
        </div>
      `).join('');
    }

    // Render Pins List
    const pinsList = document.getElementById('admin-pins-list');
    if (!data.pins || data.pins.length === 0) {
      pinsList.innerHTML = '<span style="color:#6c757d;">Nuk ka pika rreziku aktive.</span>';
    } else {
      pinsList.innerHTML = data.pins.map(p => `
        <div style="border-bottom:1px solid #2e3540;padding:4px 0;display:flex;justify-content:space-between;align-items:center;">
          <div>
            <strong>${escapeHtml(p.type)}</strong>: ${escapeHtml(p.description || 'Pa përshkrim')} (${escapeHtml(p.status)})
          </div>
          <button onclick="window.adminDeletePin('${p.id}')" style="background:#e63946;color:#fff;border:none;padding:2px 6px;border-radius:4px;cursor:pointer;">Hiq Pin</button>
        </div>
      `).join('');
    }
  }

  window.adminDeleteDirective = function (directiveId) {
    socket.emit('admin:delete_directive', { directiveId });
  };

  window.adminDeleteIntel = function (dispatchId) {
    socket.emit('admin:delete_intel', { dispatchId });
  };

  window.adminResolveSOS = function (alertId) {
    socket.emit('admin:resolve_sos', { alertId });
  };

  window.adminDeletePin = function (pinId) {
    socket.emit('admin:delete_pin', { pinId });
  };

  // ---- Bisedat e Grupeve (Group Chats) ----
  const modalChat = document.getElementById('modal-chat');
  const chatListView = document.getElementById('chat-list-view');
  const chatRoomView = document.getElementById('chat-room-view');
  const chatListEl = document.getElementById('chat-list');
  const chatMessagesEl = document.getElementById('chat-messages');
  const chatMembersEl = document.getElementById('chat-members');
  const chatRoomTitleEl = document.getElementById('chat-room-title');
  const chatRoomSubtitleEl = document.getElementById('chat-room-subtitle');
  const chatMessageInput = document.getElementById('chat-message-input');
  const chatCreateSection = document.getElementById('chat-create-section');

  let myChats = [];
  let activeChatId = null;

  function chatTimeLabel(ts) {
    try {
      return new Date(ts).toLocaleTimeString('sq-AL', { hour: '2-digit', minute: '2-digit' });
    } catch (_) {
      return '';
    }
  }

  function renderMyChatList(chats) {
    myChats = chats || [];
    if (!myChats.length) {
      chatListEl.innerHTML = '<div style="color:#6c757d;font-size:0.85rem;text-align:center;padding:12px;">Nuk jeni pjesë e asnjë bisede grupi ende. Bashkohuni me një ID ose krijoni një të re (nëse jeni organizator).</div>';
      return;
    }
    chatListEl.innerHTML = myChats.map(c => `
      <div class="chat-room-item ${c.id === activeChatId ? 'active' : ''}" onclick="window.openChatRoom('${c.id}')">
        <div>
          <div style="font-weight:700;font-size:0.9rem;">💬 ${escapeHtml(c.name)}</div>
          <div style="font-size:0.72rem;color:var(--text-muted);">${c.membersCount} anëtarë${c.hasPassCode ? ' · 🔒 me kod' : ''}</div>
        </div>
        <div style="color:#06d6a0;font-weight:700;font-size:1.1rem;">›</div>
      </div>
    `).join('');
  }

  function showChatListView() {
    activeChatId = null;
    chatRoomView.style.display = 'none';
    chatListView.style.display = 'block';
    socket.emit('chat:list');
  }

  window.openChatRoom = function (chatId) {
    const chat = myChats.find(c => c.id === chatId);
    if (!chat) return;
    activeChatId = chatId;
    chatListView.style.display = 'none';
    chatRoomView.style.display = 'flex';
    renderChatRoom(chat);
  };

  function renderChatRoom(chat) {
    chatRoomTitleEl.textContent = `💬 ${chat.name}`;
    chatRoomSubtitleEl.textContent = `ID: ${chat.id} · ${chat.membersCount} anëtarë${chat.hasPassCode ? ' · 🔒 i mbrojtur me kod' : ''}`;
    chatMembersEl.innerHTML = (chat.members || []).map(m => `
      <span class="chat-member-chip ${m.isOrganizer ? 'chat-member-chip--organizer' : ''}">${m.isOrganizer ? '📢 ' : ''}${escapeHtml(m.nickname)}</span>
    `).join('');
    renderChatMessages(chat.messages || []);
  }

  function renderChatMessages(messages) {
    chatMessagesEl.innerHTML = '';
    (messages || []).forEach(m => appendChatMessage(m));
    scrollChatToBottom();
  }

  function appendChatMessage(m) {
    const isMine = m.authorId === userProfile.userId;
    const isOrganizer = m.authorRole === 'organizer' || m.authorRole === 'admin';
    let cls = 'chat-bubble--other';
    if (isMine) cls = 'chat-bubble--mine';
    else if (isOrganizer) cls = 'chat-bubble--organizer';

    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${cls}`;
    bubble.innerHTML = `
      ${!isMine ? `<div class="chat-bubble-author">${escapeHtml(m.authorNickname)}${isOrganizer ? ' 📢' : ''}</div>` : ''}
      <div>${escapeHtml(m.text)}</div>
      <div class="chat-bubble-time">${chatTimeLabel(m.timestamp)}</div>
    `;
    chatMessagesEl.appendChild(bubble);
  }

  function scrollChatToBottom() {
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  }

  function sendChatMessage() {
    const text = chatMessageInput.value.trim();
    if (!text || !activeChatId) return;
    socket.emit('chat:message', { chatId: activeChatId, text });
    chatMessageInput.value = '';
  }

  document.getElementById('btn-open-chat').addEventListener('click', () => {
    // Seksioni i krijimit shfaqet vetëm për organizatorët e autorizuar
    chatCreateSection.style.display = (userProfile.role === 'organizer' || userProfile.role === 'admin') ? 'block' : 'none';
    showChatListView();
    modalChat.classList.add('active');
  });

  document.getElementById('btn-create-chat').addEventListener('click', () => {
    const name = document.getElementById('chat-create-name').value.trim();
    const passCode = document.getElementById('chat-create-pass').value.trim();
    if (!name) return showToast('Jepni një emër për bisedën.', 'error');
    socket.emit('chat:create', { name, passCode });
  });

  document.getElementById('btn-join-chat').addEventListener('click', () => {
    const chatId = document.getElementById('chat-join-id').value.trim();
    const passCode = document.getElementById('chat-join-pass').value.trim();
    if (!chatId) return showToast('Jepni ID-në e bisedës.', 'error');
    socket.emit('chat:join', { chatId, passCode });
  });

  document.getElementById('btn-send-chat').addEventListener('click', sendChatMessage);
  chatMessageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChatMessage();
  });

  document.getElementById('btn-chat-back').addEventListener('click', showChatListView);
  document.getElementById('btn-chat-leave').addEventListener('click', () => {
    if (!activeChatId) return;
    socket.emit('chat:leave', { chatId: activeChatId });
    showChatListView();
  });

  socket.on('chat:list', (chats) => {
    renderMyChatList(chats);
  });

  socket.on('chat:created', (chat) => {
    myChats = [...myChats.filter(c => c.id !== chat.id), chat];
    renderMyChatList(myChats);
    showToast(`Biseda "${chat.name}" u krijua me sukses!\n\nID e Bisedës: ${chat.id}\nJepjani këtë ID (dhe kodin, nëse e vendosët) anëtarëve.`, 'success', 6500);
    openChatRoom(chat.id);
  });

  socket.on('chat:joined', (chat) => {
    myChats = [...myChats.filter(c => c.id !== chat.id), chat];
    renderMyChatList(myChats);
    showToast(`U bashkuat me sukses në bisedën "${chat.name}"!`, 'success');
    openChatRoom(chat.id);
  });

  socket.on('chat:updated', (chat) => {
    const idx = myChats.findIndex(c => c.id === chat.id);
    if (idx >= 0) {
      myChats = myChats.slice();
      myChats[idx] = chat;
    } else {
      myChats = [...myChats, chat];
    }
    renderMyChatList(myChats);
    if (activeChatId === chat.id) {
      renderChatRoom(chat);
    }
  });

  socket.on('chat:message', ({ chatId, message }) => {
    if (activeChatId === chatId) {
      appendChatMessage(message);
      scrollChatToBottom();
    }
  });

  socket.on('chat:error', (msg) => {
    showToast(`Biseda: ${msg}`, 'error');
  });

  // Register Service Worker for Offline / Network Jamming Resilience
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(err => {
        console.warn('ServiceWorker registration error:', err);
      });
    });
  }

  // ---- Onboarding / Regjistrimi i Parë i Përdoruesit ----
  const modalOnboarding = document.getElementById('modal-onboarding');
  const onboardingNickname = document.getElementById('onboarding-nickname');
  const onboardingRole = document.getElementById('onboarding-role');
  const onboardingOrgGroup = document.getElementById('onboarding-org-group');
  const onboardingOrgCode = document.getElementById('onboarding-org-code');
  const onboardingMinor = document.getElementById('onboarding-minor');
  const btnSubmitOnboarding = document.getElementById('btn-submit-onboarding');

  const hasRegisteredBefore = localStorage.getItem('pg_registered') === 'true';

  if (!hasRegisteredBefore && modalOnboarding) {
    modalOnboarding.classList.add('active');
  }

  if (onboardingRole && onboardingOrgGroup) {
    onboardingRole.addEventListener('change', () => {
      if (onboardingRole.value === 'organizer') {
        onboardingOrgGroup.style.display = 'block';
      } else {
        onboardingOrgGroup.style.display = 'none';
      }
    });
  }

  if (btnSubmitOnboarding) {
    btnSubmitOnboarding.addEventListener('click', () => {
      const nick = (onboardingNickname.value || '').trim() || 'Shoku';
      const role = onboardingRole.value;
      const orgCode = (onboardingOrgCode.value || '').trim();
      const isMinor = onboardingMinor.checked;

      userProfile.nickname = nick;
      userProfile.role = role;
      userProfile.isFrontline = role === 'frontline' || role === 'vanguard';
      userProfile.isMinor = isMinor;
      userProfile.organizerCode = orgCode;

      localStorage.setItem('pg_nickname', nick);
      localStorage.setItem('pg_role', role);
      localStorage.setItem('pg_frontline', userProfile.isFrontline);
      localStorage.setItem('pg_is_minor', isMinor);
      localStorage.setItem('pg_organizer_code', orgCode);
      localStorage.setItem('pg_registered', 'true');

      // Përditëso formën e profilit në modal
      document.getElementById('user-nickname').value = nick;
      document.getElementById('select-role').value = role;
      document.getElementById('check-minor').checked = isMinor;
      document.getElementById('check-frontline').checked = userProfile.isFrontline;

      updateHUD();
      socket.emit('user:join', userProfile);
      if (modalOnboarding) modalOnboarding.classList.remove('active');
      showToast(`Mirë se erdhe, ${nick}! Rrjeti i sigurisë u aktivizua.`, 'success', 4000);
    });
  }

})();

