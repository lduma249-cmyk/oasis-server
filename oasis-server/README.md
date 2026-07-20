# Oasis Laundry Management System

Local server for the Oasis Glenwood branch management system.

## Quick Start

```bash
# Install dependencies (first time only)
npm install

# Start the server
npm start
```

Then open **http://localhost:3000** in your browser.

---

## Structure

```
oasis-server/
├── server.js          ← Express server (start here)
├── package.json
├── node_modules/
└── public/            ← All browser files
    ├── index.html         Login page
    ├── owner.html         Owner dashboard
    ├── counter.html       Counter dashboard
    ├── cleaning.html      Cleaning workstation
    └── *.mp4              Background video
```

## Pages

| URL | Role |
|-----|------|
| `/` | Login |
| `/owner.html` | Owner |
| `/counter.html` | Counter |
| `/cleaning.html` | Cleaning |

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Server health check |
| `GET /api/info` | System info + page map |

## Requirements

- **Node.js** v18 or newer
- Internet connection (for Supabase backend + Google Fonts)

## Demo Logins

| Role | Email | PIN |
|------|-------|-----|
| Owner | nk@oasis.co.za | owner123 |
| Counter | ayanda@oasis.co.za | counter123 |
| Cleaning | bongani@oasis.co.za | cleaning123 |
