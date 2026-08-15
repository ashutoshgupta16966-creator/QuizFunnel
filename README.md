# QuizFunnel

A full-stack, elimination-style multi-level quiz application built for college orientation to shortlist first-year students for activities like presentations and public speaking.

---

## 🌟 Key Features

- **4-Level Elimination Funnel**:
  - **Level 1**: 20 Questions (GK, Technical, Reasoning, Aptitude) — Cutoff: **15/20** (15 mins)
  - **Level 2**: 15 Questions (Technical, Reasoning, Aptitude) — Cutoff: **10/15** (12 mins)
  - **Level 3**: 10 Questions (Technical/Coding, Reasoning) — Cutoff: **7/10** (8 mins)
  - **Level 4**: 5 Questions (Mixed Hardest) — **Final Round** (5 mins)
- **Youthful, Polished UI**: Built with modern CSS design tokens, smooth animations, option selection ripple feedback, timer bar countdowns, and celebratory level transition screens.
- **Entry & Resume Flow**: Students register with Name, 10-digit Mobile Number (unique ID), and Branch (`CSE`, `CSE-AIML`, `MBA`). Mobile number allows resuming existing attempts while locking completed levels.
- **Server-Side Option Shuffling**: Shuffles 4 option choices per question individually for each student session. Correct answer indexing is mapped server-side to prevent cheating.
- **Tie-Break Leaderboard Logic**: Ranks final Level 4 completers using:
  1. `totalScore` **DESC** (highest score)
  2. `totalTimeTaken` **ASC** (fastest completion time)
- **Admin Dashboard**: Password-protected interface (`/admin`) with live stats, student status filters, CSV export, and Level 4 leaderboard.
- **Fault-Tolerant Network Handling**: Auto-retry with exponential backoff on network issues and floating toast status banners.

---

## 📁 Project Structure

```text
QuizFunnel/
├── client/                 # React + Vite Frontend
│   ├── src/
│   │   ├── api/            # Axios API wrapper with retry logic
│   │   ├── components/     # QuestionCard, TimerBar, ProgressBar, Toast
│   │   ├── context/        # QuizContext (localStorage persistence)
│   │   ├── pages/          # EntryForm, Quiz, LevelTransition, Results, Admin
│   │   ├── config.js       # Timing & level configuration
│   │   ├── App.jsx         # App router setup
│   │   ├── index.css       # Full custom CSS design system
│   │   └── main.jsx
│   ├── .env.example
│   ├── package.json
│   └── vite.config.js
│
├── server/                 # Express + MongoDB Backend
│   ├── config/             # levels.js (single source of truth for timing & cutoffs)
│   ├── middleware/         # adminAuth.js, errorHandler.js
│   ├── models/             # Question.js, Student.js (Mongoose schemas)
│   ├── routes/             # students.js, quiz.js, admin.js
│   ├── index.js            # Express app server entry point
│   ├── .env.example
│   └── package.json
│
├── seed.js                 # Database seeder script (50 pre-built questions)
└── README.md
```

---

## 🚀 Local Development Setup

### Prerequisites
- Node.js (v18+)
- MongoDB running locally (`mongodb://localhost:27017/freshers-quiz`) or a MongoDB Atlas URI.

### 1. Backend Setup (`server/`)
```bash
cd server
npm install

# Copy environment template
cp .env.example .env
```

Configure `server/.env`:
```env
MONGO_URI=mongodb://localhost:27017/freshers-quiz
PORT=5000
ADMIN_PASSWORD=admin123
CLIENT_URL=http://localhost:5173
```

Start the backend:
```bash
npm run dev
```

### 2. Seed Database (`seed.js`)
From the root directory:
```bash
node seed.js
```
This loads 50 questions across all 4 levels and sections into your MongoDB database.

### 3. Frontend Setup (`client/`)
```bash
cd client
npm install

# Copy environment template
cp .env.example .env
```

Configure `client/.env`:
```env
VITE_API_URL=http://localhost:5000
```

Start the frontend:
```bash
npm run dev
```
Open `http://localhost:5173` in your browser.

---

## 🔒 Admin Dashboard

Access the password-protected Admin Dashboard at:
`http://localhost:5173/admin`

Enter the password configured in `ADMIN_PASSWORD` (default: `admin123`).

**Features:**
- View real-time participation statistics (Total, In-Progress, Advanced, Eliminated, Completed).
- Filter students by branch or status.
- Search students by name or mobile number.
- View the **Level 4 Leaderboard** sorted by score and time.
- Download a full **CSV Export** (`↓ Export CSV`).

---

## 🚢 Deployment Guide

### Frontend Deployment (Vercel)
1. Push your repository to GitHub.
2. In Vercel, create a new project and select the `client` directory as the Root Directory.
3. Build Command: `npm run build`
4. Output Directory: `dist`
5. Environment Variables:
   - `VITE_API_URL`: Your deployed backend Render URL (e.g. `https://freshers-quiz-api.onrender.com`)

### Backend Deployment (Render)
1. Create a new **Web Service** on Render connected to your repository.
2. Root Directory: `server`
3. Environment: `Node`
4. Build Command: `npm install`
5. Start Command: `node index.js`
6. Environment Variables:
   - `MONGO_URI`: Your MongoDB Atlas Connection String
   - `PORT`: `10000` (or Render's default)
   - `ADMIN_PASSWORD`: Secure password for orientation admin
   - `CLIENT_URL`: Your Vercel frontend URL (e.g. `https://freshers-quiz.vercel.app`)

---

## 📝 Modifying Questions & Timers

- **Questions**: You can modify `seed.js` or write a custom question script inserting into the `questions` collection with schema:
  `{ level, section, questionText, options: [4], correctAnswerIndex: 0-3, difficulty }`
- **Level Timers & Cutoffs**: Update `server/config/levels.js` and `client/src/config.js`.
