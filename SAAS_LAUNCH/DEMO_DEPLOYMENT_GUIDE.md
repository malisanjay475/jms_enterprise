# Demo Deployment Guide — FlowNex360
## Get a Live Demo Link in 30 Minutes

---

## Option A — Use Your Existing Hostinger VPS (FASTEST — 20 min)

You already have a VPS running. Just add a demo subdomain.

### Step 1 — Add DNS Record (5 min)
Go to Hostinger → Domains → DNS Manager:
```
Type: A
Name: demo
Value: [your VPS IP address]
TTL: 300
```
→ demo.flownex360.com (or demo.yourdomain.com) will point to your VPS

### Step 2 — Create Demo Container on VPS (10 min)
SSH into your VPS and run:

```bash
# Pull current image and run as demo instance
docker run -d \
  --name flowmes-demo \
  -p 3001:3000 \
  -e NODE_ENV=production \
  -e SERVER_TYPE=MAIN \
  -e DB_NAME=jms_demo \
  -e DEMO_MODE=true \
  your-existing-image:latest

# Or if using docker-compose, add a demo service
```

### Step 3 — Add Nginx Config for demo subdomain
```nginx
server {
    listen 80;
    server_name demo.flownex360.com;
    
    location / {
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### Step 4 — Seed Demo Data
```sql
-- Run this on your demo DB to add sample data
-- Machines
INSERT INTO machines (name, code) VALUES 
  ('Injection Machine 1', 'INJ-01'),
  ('Injection Machine 2', 'INJ-02'),
  ('Injection Machine 3', 'INJ-03'),
  ('Assembly Line A', 'ASM-A');

-- Products  
INSERT INTO products (name, code) VALUES
  ('Chair Leg - Black', 'PROD-001'),
  ('Table Top - White', 'PROD-002'),
  ('Container Lid - Red', 'PROD-003');

-- Add sample DPR entries for last 7 days
-- Add sample planning entries
-- Add sample employees
```

---

## Option B — Railway.app (FREE — 25 min, no credit card)

Perfect if you want a clean separate demo environment.

### Step 1 — Push to GitHub
```bash
cd BACKEND
git init (if not already)
git add .
git commit -m "demo deployment"
git push origin main
```

### Step 2 — Deploy on Railway
1. Go to https://railway.app
2. Click "New Project" → "Deploy from GitHub"
3. Select your repo
4. Add environment variables:
   - `NODE_ENV=production`
   - `PORT=3000`
   - `DATABASE_URL` (Railway provides free PostgreSQL)
5. Click Deploy

### Step 3 — Get Your URL
Railway gives you: `https://flowmes-demo.up.railway.app`
Share this link!

---

## Option C — Render.com (FREE — 30 min)

Same as Railway, alternative option:
1. https://render.com → New Web Service
2. Connect GitHub repo
3. Add env vars
4. Deploy → get `https://flowmes-demo.onrender.com`

---

## Demo Login Credentials (set these up)

Create these demo accounts before the meeting:

| Role | Username | Password |
|------|----------|----------|
| CEO / Admin | admin@demo.com | Demo@2025 |
| Production Manager | manager@demo.com | Demo@2025 |
| Operator | operator@demo.com | Demo@2025 |

---

## Demo Data Checklist

Before the meeting, verify these are visible on the demo:

- [ ] At least 4-5 machines configured
- [ ] At least 6-8 products in masters
- [ ] Planning board has jobs scheduled for today
- [ ] DPR has entries for last 3 days
- [ ] Supervisor dashboard shows production numbers
- [ ] At least 5-10 employees in HR
- [ ] 2-3 purchase orders
- [ ] Reports generate without errors

---

## Quick Test Before Meeting

Open these URLs and verify they load:
```
/login.html          → Login page
/supervisor.html     → Factory dashboard  
/planning.html       → Planning board
/dpr.html            → DPR entry form
/QCSupervisor.html   → QC dashboard
/masters.html        → Master data
/hr.html             → HR module
/reports.html        → Reports
```

---

## If Demo Goes Wrong During Meeting

**Backup plan 1:** Have localhost running on your laptop (`node server.js`)
**Backup plan 2:** Have screenshots of every module saved as images
**Backup plan 3:** Show the presentation PDF — "Let me show you the live version after we finalize"

---

*Pro tip: Test the demo from your phone's data hotspot — that's the real internet test.*
