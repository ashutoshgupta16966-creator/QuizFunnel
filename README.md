# 🎯 QuizFunnel - AI Powered Quiz Platform

An interactive, responsive, and dynamic web application designed to take customized quiz assessments with level breakdown, smooth UI/UX animations, and performance tracking.

---

## ✨ Features

- **Interactive Quiz Flow:** Smooth animations, horizontal/vertical transitions, and micro-interactions.
- **Dynamic Question Generation:** AI-assisted logic to serve fresh questions by difficulty level.
- **Performance Analytics:** Detailed attempt history modal with score, accuracy %, time breakdown, and level summaries.
- **Secure Architecture:** Environment variable protection for API keys and database credentials.
- **IBM Db2 Dual-Write Add-on:** Non-blocking secondary analytics storage with automated table provisioning and read-only endpoints.

---

## 🛠️ Tech Stack

- **Frontend:** React.js, Tailwind CSS / Custom CSS, Lucide Icons
- **Backend:** Node.js, Express.js
- **Primary Database:** MongoDB
- **Optional Secondary Storage:** IBM Db2
- **AI Integration:** Google Gemini API

---

## 🗄️ IBM Db2 Integration (Optional Dual-Write)

QuizFunnel supports an optional IBM Db2 secondary data store via dual-write synchronization. When enabled, rooms, participants, submitted answers, and quiz results are mirrored into Db2 non-blockingly without impacting primary quiz latency or reliability.

### Configuration
Set the following environment variables in `server/.env`:
```env
DB2_ENABLED=true
DB2_CONN_STRING=DATABASE=BLUDB;HOSTNAME=<hostname>;PORT=50000;PROTOCOL=TCPIP;UID=<username>;PWD=<password>;
```

If `DB2_ENABLED` is `false` or unset, Db2 integration is inactive and the app operates exclusively on MongoDB with zero overhead.

### Db2 Tables
On startup with `DB2_ENABLED=true`, tables are created automatically:
- `QUIZ_ROOMS` — Live room metadata and lifecycle statuses
- `PARTICIPANTS` — Room participant profiles (`PK (ROOM_ID, PARTICIPANT_ID)`)
- `ANSWERS` — Individual question submissions with unique constraint `(ROOM_ID, PARTICIPANT_ID, QUESTION_ID)`
- `RESULTS` — Per-level participant scores and durations (`PK (ROOM_ID, PARTICIPANT_ID, LEVEL_NUM)`)

### Read-Only Endpoints
- `GET /api/db2/health` — Connection health and enabled state
- `GET /api/db2/leaderboard/:roomId` — Top room scores aggregated directly from Db2
- `GET /api/db2/stats/:roomId` — Room participant count, answer count, and average score
