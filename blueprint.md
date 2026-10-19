# 📐 PROJECT BLUEPRINT: PROTESTGUARD ALBANIA

### *Architecture Blueprint, System Flowcharts, Database Schema & Operational Protocols*

---

## 1. Përmbledhja e Sistemit (System Architecture Overview)

Aplikacioni mbështetet mbi një arkitekturë modulare me latencë të ulët, e ndarë në 4 shtylla kryesore:

1. **Frontend Mobil & Web (Cross-Platform Client):**
   * UI me temë të errët për kursim baterie dhe dukshmëri të reduktuar natën.
   * Hartë interaktive (Leaflet / OpenStreetMap / MapLibre).
   * Menaxhim i sensorëve: GPS, Haptic Engine (vibrime alarmi), Ruajtje e Kriptuar Lokale (Secure Storage).
2. **Backend Server (Node.js + Express + Socket.io):**
   * Përpunim i ngjarjeve në kohë reale: transmetimi i pozicioneve gjeografike, pin-eve të rrezikut, kërkesave për mjekë/juristë dhe sinjaleve SOS.
   * Motor gjeografik: llogaritja e distancave (Haversine/Geofence) për alarme afërsie dhe shkëputje shoku.
3. **Shtresa e Shpejtësisë (In-Memory State - Redis):**
   * Menaxhim i prezencës (online status) dhe koordinatave GPS me jetëgjatësi të shkurtër (TTL 30-60 sekonda).
   * Llogaritje e shpejtë e densitetit të turmës pa ngarkuar diskun.
4. **Shtresa e Persistencës (PostgreSQL + PostGIS):**
   * Ruajtje e auditueshme por anonime: sesione, ftesa ditore, raporte rreziku të konfirmuara, historik alarmi SOS.

---

## 2. Diagrama e Plotë e Rrjedhës së Sistemit (System Flowchart)

```
                       +---------------------------------------+
                       |       PËRDORUESI / PROTESTUESI        |
                       +---------------------------------------+
                                           |
                       +-------------------+-------------------+
                       |                                       |
         +-------------v-------------+           +-------------v-------------+
         |     Zgjedhja e Rolit      |           |    Aktivizim Ftese /      |
         |  (Mjek / Jurist / Civil   |           |    Krijim Buddy Circle    |
         |     / Logjistikë)         |           |    (Kodi Ditor / QR)      |
         +-------------+-------------+           +-------------+-------------+
                       |                                       |
                       +-------------------+-------------------+
                                           |
                                 +---------v---------+
                                 |  Ekrani i Hartës  |
                                 |   (OpenStreetMap) |
                                 +---------+---------+
                                           |
       +--------------------+--------------+--------------+--------------------+
       |                    |                             |                    |
+------v------+      +------v------+               +------v------+      +------v------+
| GPS Radari  |      | Raporto     |               | Kërko Ndihmë|      | Butoni SOS  |
| Shokët/Turma|      | Polici/Gaz  |               | Mjek/Jurist |      | Arrest Alert|
+------+------+      +------+------+               +------+------+      +------+------+
       |                    |                             |                    |
       +--------------------+--------------+--------------+--------------------+
                                           |
                        (WebSocket / Socket.io Event Stream)
                                           |
                                 +---------v---------+
                                 |  Serveri Backend  |
                                 |  (Node.js / API)  |
                                 +---------+---------+
                                           |
         +-------------------------+-------+-------+-------------------------+
         |                         |               |                         |
+--------v--------+       +--------v--------+      |                +--------v--------+
| Gjeo-Distanca & |       | Verifikimi Anti |      |                | Njoftim Emergjence
| Alarmi i Xhepit |       | Fake (Konsensus)|      |                | Rrethit & Familjes
| (Vibrim Proximity)     | (2-3 Konfirmime)|      |                | (Emergency Vault)
+-----------------+       +-----------------+      |                +-----------------+
                                                   |
                                         +---------v---------+
                                         | Broadcaster Live  |
                                         | te të gjithë në   |
                                         | rrezen përkatëse  |
                                         +-------------------+
```

---

## 3. Struktura e Plotë e Bazës së Të Dhënave (Database Schema)

### A. Tabela e Përdoruesve Anonimë (`users`)
```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_token VARCHAR(64) UNIQUE NOT NULL,
    device_fingerprint VARCHAR(128) NOT NULL,
    role VARCHAR(32) DEFAULT 'civilian' CHECK (role IN ('civilian', 'medic', 'legal', 'logistics')),
    buddy_group_id UUID REFERENCES buddy_groups(id) ON DELETE SET NULL,
    trust_score INT DEFAULT 10,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### B. Tabela e Grupeve të Shokëve të Besuar (`buddy_groups`)
```sql
CREATE TABLE buddy_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(64) NOT NULL,
    passcode_hash VARCHAR(128) NOT NULL,
    created_by UUID,
    max_members INT DEFAULT 5,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### C. Tabela e Ftesave Ditore (`invite_tokens`)
```sql
CREATE TABLE invite_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(16) UNIQUE NOT NULL,
    created_by UUID REFERENCES users(id),
    used_by UUID REFERENCES users(id),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### D. Tabela e Raporteve të Rrezikut (`incident_pins`)
```sql
CREATE TABLE incident_pins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reported_by UUID REFERENCES users(id),
    incident_type VARCHAR(32) NOT NULL CHECK (
        incident_type IN ('police_cordon', 'plainclothes_police', 'teargas', 'water_cannon', 'blocked_street', 'medic_needed', 'lawyer_needed')
    ),
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    status VARCHAR(16) DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'dismissed', 'expired')),
    confirmations_count INT DEFAULT 1,
    description TEXT,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### E. Tabela e Verifikimeve Komunitare (`pin_confirmations`)
```sql
CREATE TABLE pin_confirmations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pin_id UUID REFERENCES incident_pins(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    vote VARCHAR(10) CHECK (vote IN ('confirm', 'dispute')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(pin_id, user_id)
);
```

### F. Tabela e Alarmeve SOS dhe Ndalimeve (`sos_alerts`)
```sql
CREATE TABLE sos_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    buddy_group_id UUID REFERENCES buddy_groups(id),
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    alert_type VARCHAR(32) DEFAULT 'arrest_in_progress' CHECK (alert_type IN ('arrest_in_progress', 'medical_emergency', 'cornered')),
    status VARCHAR(16) DEFAULT 'active' CHECK (status IN ('active', 'acknowledged', 'resolved')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    resolved_at TIMESTAMP WITH TIME ZONE
);
```

---

## 4. Protokollet e Komunikimit WebSocket (Socket.io Event API)

| Eventi (Emit / Listen) | Drejtimi | Përshkrimi | Payload Shembull |
|---|---|---|---|
| `user:join` | Client → Server | Regjistrim i sesionit me rolin dhe grupin | `{ sessionToken, role, buddyGroupId }` |
| `location:update` | Client → Server | Dërgim i koordinatave periodike | `{ lat: 41.3275, lng: 19.8187, accuracy: 5 }` |
| `buddy:update` | Server → Client | Pozicionet e sakta vetëm për anëtarët e grupit | `[{ userId, lat, lng, lastSeen }]` |
| `crowd:density` | Server → Client | Koordinata të përgjithësuara për hartën e gjerë | `[{ lat, lng, weight }]` |
| `pin:create` | Client → Server | Raportim i ri (polici, gaz, bllokim) | `{ type, lat, lng, description }` |
| `pin:confirm` | Client → Server | Votim/konfirmim i një pike ekzistuese | `{ pinId, vote: 'confirm' }` |
| `pin:broadcast` | Server → Client | Njoftim për pikë të re ose të konfirmuar | `{ pinId, type, lat, lng, status, confirmations }` |
| `sos:trigger` | Client → Server | Alarmi urgjent i arrestimit ose ndihmës | `{ lat, lng, alertType, note }` |
| `sos:broadcast` | Server → Client | Transmetim alarmi te shokët e afërt dhe mjekët/juristët | `{ sosId, userId, role, lat, lng, time }` |
