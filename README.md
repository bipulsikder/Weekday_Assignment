# Board-App Production Deployment Guide (Cost-Optimised)

Target scale: 1 L sign-ups, 10 k DAU, < $150 / month.

---

## 0.  TL;DR Checklist
- [ ] Vercel Pro (or Hobby + usage)  
- [ ] Supabase Pro (or Starter + usage)  
- [ ] Upstash Redis 1 GB (free tier)  
- [ ] Sentry Team (free 50 k errors)  
- [ ] Postmark 10 k emails free  
- [ ] Google Gemini PAYG  
- [ ] Worker container (Fly.io free tier)  
- [ ] All env vars set  
- [ ] DB migrations pushed  
- [ ] Worker running  
- [ ] Health probe green  
- [ ] Load test 1 k concurrent  

---

## 1.  Infrastructure (no Site24x7)

| Service | Plan | Monthly Cost | Purpose |
|---------|------|--------------|---------|
| Vercel | Pro | $20 | Next.js hosting |
| Supabase | Pro | $25 | Postgres, Auth, Storage |
| Upstash Redis | 1 GB | $0 | Rate-limit, cache, queue |
| Sentry | Team | $0 (< 50 k errors) | Error tracking |
| Postmark | 10 k emails | $0 | Transactional email |
| Google Gemini | PAYG | ~$20 (1 M tokens) | Resume parsing |
| Fly.io | 1 shared-CPU | $0 (< 230 h) | Worker container |
| **Total** | | **~$65** | |

---

## 2.  Create Projects & Keys

### 2.1  Supabase
1. Dashboard → New project → copy:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
2. Storage → Create buckets:
   - `resume-files` (private)
   - `candidate-avatars` (public)
3. SQL Editor → run:
```sql
CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON jobs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_candidates_auth_user_id ON candidates(auth_user_id);
```

### 2.2  Upstash Redis
1. Upstash console → Create database → region = same as Vercel (iad/bom)  
2. Copy **REST URL** → set as `REDIS_URL` (looks like `https://...upstash.io`)

### 2.3  Sentry
1. Sign-up → Create project (Next.js)  
2. Settings → Client Keys → copy **DSN** → `SENTRY_DSN`

### 2.4  Postmark
1. Create server → copy **Server API token** → `POSTMARK_SERVER_TOKEN`  
2. Add sender signature (domain) → add DNS records

### 2.5  Google Gemini
1. Google Cloud → APIs → Enable **Generative Language API**  
2. Credentials → Create API Key → `GEMINI_API_KEY`

### 2.6  OpenRouter (optional fallback)
1. Dashboard → copy **API Key** → `OPENROUTER_API_KEY`

---

## 3.  Vercel Project

### 3.1  Link repo
GitHub → Import → root = `board-app` folder → Deploy

### 3.2  Environment Variables (all production)
Paste exactly:
```
NEXT_PUBLIC_SUPABASE_URL=<from 2.1>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<from 2.1>
SUPABASE_SERVICE_ROLE_KEY=<from 2.1>
REDIS_URL=<from 2.2>
SENTRY_DSN=<from 2.3>
POSTMARK_SERVER_TOKEN=<from 2.4>
GEMINI_API_KEY=<from 2.5>
OPENROUTER_API_KEY=<optional>
BOARD_APP_ADMIN_KEY=<random 32-char>
WORKER_ID=vercel-prod-1
WORKER_POLL_MS=3000
WORKER_BATCH_SIZE=10
WORKER_MAX_ATTEMPTS=3
```

### 3.3  Build settings (auto-detected)
Framework = Next.js  
Build command = `npm run build`  
Output dir = `.next`  
Install = `npm ci`

---

## 4.  Database Migrations
```bash
npm i -g supabase
supabase link --project-ref <your-ref>
supabase db push   # pushes supabase/migrations/*.sql
```

---

## 5.  Worker Container (Fly.io – free tier)

### 5.1  Install CLI
```bash
curl -L https://fly.io/install.sh | sh
fly auth login
```

### 5.2  Create app
```bash
fly launch --name board-worker --region bom --vm-size shared-cpu-1x --memory 512 --no-deploy
```

### 5.3  Dockerfile (save as `board-app/Dockerfile.worker`)
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
CMD ["node", "workers/resume-queue-worker.js"]
```

### 5.4  fly.toml (auto-generated, tweak)
```toml
app = "board-worker"
primary_region = "bom"
[build]
  dockerfile = "Dockerfile.worker"
[env]
  WORKER_ID = "fly-prod-1"
[experimental]
  auto_stop_machines = false   # always on
  auto_start_machines = true
[[services]]
  internal_port = 8080
  protocol = "tcp"
  [[services.ports]]
    port = 443
```

### 5.5  Secrets
```bash
fly secrets set REDIS_URL=<same as Vercel> SUPABASE_SERVICE_ROLE_KEY=<same>
```

### 5.6  Deploy
```bash
fly deploy --wait-timeout 300
fly logs   # watch start-up
```

---

## 6.  Health & Uptime (free)

### 6.1  Sentry Crons (free 50 k check-ins)
Add file `app/api/cron/route.ts`:
```ts
import { NextResponse } from 'next/server'
export async function GET() {
  return NextResponse.json({ ok: true, ts: Date.now() })
}
```
Set cron monitor in Sentry → URL `https://yourdomain.com/api/cron` every 5 min.

### 6.2  Worker heartbeat (same cron)
Inside worker loop, ping:
```ts
await fetch(`https://yourdomain.com/api/cron?source=worker`)
```

### 6.3  Alert rules (Sentry)
- Issue > 100 events in 1 h → Slack
- Cron missed 2 pings → Slack

---

## 7.  Rate-Limit & Cache (code drop-in)

### 7.1  Install
```bash
npm i @upstash/redis @upstash/ratelimit bullmq pino pino-pretty
```

### 7.2  Redis client (`lib/redis.ts`)
```ts
import { Redis } from '@upstash/redis'
export const redis = new Redis({ url: process.env.REDIS_URL! })
```

### 7.3  Rate-limiter (`lib/rateLimit.ts`)
```ts
import { Ratelimit } from '@upstash/ratelimit'
import { redis } from './redis'
export const searchRL = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, '1 m'),
  prefix: 'rl_search',
})
```

### 7.4  Wrap public search (`app/api/public/jobs/search/route.ts`)
```ts
import { searchRL } from '@/lib/rateLimit'
export async function GET(req: NextRequest) {
  const ip = req.ip ?? 'unknown'
  const { success } = await searchRL.limit(ip)
  if (!success) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  ...
}
```

### 7.5  Cache helper (`lib/cache.ts`)
```ts
import { redis } from './redis'
export const cache = {
  get: async (k: string) => {
    const v = await redis.get(k)
    return v ? JSON.parse(v as string) : null
  },
  set: (k: string, v: any, ttl = 120) => redis.setex(k, ttl, JSON.stringify(v)),
}
```

Use inside search:
```ts
const cacheKey = `search:${hash(queryObj)}`
let data = await cache.get(cacheKey)
if (!data) {
  data = await runQuery(...)
  await cache.set(cacheKey, data, 120)
}
```

---

## 8.  Email Service (Postmark)
Create `lib/email.ts`:
```ts
import postmark from 'postmark'
const client = postmark.ServerClient(process.env.POSTMARK_SERVER_TOKEN!)
export const sendEmail = async (to: string, subject: string, html: string) => {
  await client.sendEmail({ From: 'noreply@yourdomain.com', To: to, Subject: subject, HtmlBody: html })
}
```
Call wherever you need (invite, notification, etc.).

---

## 9.  Logging (structured, cheap)
Create `lib/logger.ts`:
```ts
import pino from 'pino'
export const logger = pino({ level: process.env.LOG_LEVEL || 'info', transport: { target: 'pino-pretty' } })
```
Replace all `console.log` with:
```ts
logger.info({ candidateId, fileName }, 'resume parsing start')
logger.error({ err, candidateId }, 'resume parsing failed')
```
Sentry will auto-capture errors; logs go to stdout (Fly.io/Vercel retain 7 days).

---

## 10.  Load Test (free)
Install k6:
```bash
brew install k6   # mac
```
Create `load/search.js`:
```js
import http from 'k6/http'
export let options = { stages: [{ duration: '2m', target: 1000 }] }
export default function () {
  http.get('https://yourdomain.com/api/public/jobs/search?text=react')
}
```
Run:
```bash
k6 run load/search.js
```
Pass criteria: p95 < 600 ms, error rate < 1 %, CPU < 80 % (Vercel function metrics).

---

## 11.  Roll-back Plan
- Vercel → Deployments → Promote previous release (1-click)  
- Fly.io → `fly deploy --image registry.fly.io/board-worker:<previous-sha>`  
- Supabase → migrations are forward-only; keep DDL small & backwards-compatible

---

## 12.  Post-Launch Scaling Triggers
| Metric | Threshold | Action |
|--------|-----------|--------|
| Vercel function CPU > 80 % | 5 min | Enable “Pro” concurrency add-on |
| Supabase DB CPU > 70 % | 5 min | Enable read-replica ($20) |
| Redis memory > 90 % | 1 min | Upgrade to 3 GB ($15) |
| Worker queue lag > 60 s | 1 min | Scale Fly.io to 2 VMs |
| Sentry quota > 80 % | 1 h | Bump plan ($26 → $80) |

---

## 13.  Security Quick Wins
- All buckets private by default; serve resumes via signed URLs (already implemented)  
- Rotate `BOARD_APP_ADMIN_KEY` after deploy  
- Enable 2FA on every dashboard account  
- Use Vercel “Trusted IPs” for admin routes (Settings → Security)

---

## 14.  Cost Optimisation Levers
- Drop OpenRouter if Gemini alone suffices → save ~$10  
- Reduce worker batch size → lower CPU → stay on free tier longer  
- Shorten cache TTL if memory pressure  
- Archive old resumes to cold storage (Supabase → S3 lifecycle)

---

## 15.  Day-2 Operations: What to Watch After Go-Live

### 15.1 Daily Health Checks (5 min)
1. Open **Sentry** → Issues → filter `is:unresolved` → triage new errors.  
2. Open **Vercel** → Functions → sort by 5xx → investigate spikes.  
3. Open **Supabase** → Database → CPU graph → > 70 % for 5 min = scale trigger.  
4. Open **Fly.io** → Metrics → Worker memory → > 90 % = scale count.  
5. Check **Postmark** → Bounce rate → > 5 % = investigate sender reputation.

### 15.2 Weekly Review (30 min)
- Download **k6 cloud** report (or run `k6 run load/search.js` locally) → p95 < 600 ms.  
- Review **Redis eviction** count (Upstash dashboard) → > 0 = increase memory or lower TTL.  
- Audit **storage buckets** → move resumes older than 90 days to Glacier (lifecycle rule).  
- Rotate `BOARD_APP_ADMIN_KEY` (Vercel → Settings → Env Vars → edit & redeploy).

### 15.3 Monthly Housekeeping (1 h)
- **Dependency updates**: `npm audit && npm outdated` → schedule PR.  
- **Backup test**: restore Supabase project to staging → verify worker still parses resumes.  
- **Cost audit**: export Vercel + Supabase invoices → tag any unexpected spike.  
- **Disaster drill**: intentionally crash worker VM → confirm Fly.io auto-restart & Sentry alert.

### 15.4 Incident Run-Books

#### A. Search API 5xx Spike
1. Check Sentry for stack trace.  
2. If Redis down → degrade: bypass cache, hit DB directly.  
3. If DB CPU high → enable read-replica (Supabase dashboard).  
4. If still failing → rate-limit harder (drop to 10 req/min/IP).  
5. Communicate: post status on `/api/health` → returns `{"degraded": true}`.

#### B. Resume Parsing Queue Backlog
1. Metric: `resume_parse_jobs.status = queued` count > 1 000.  
2. Scale worker: `fly scale count 2 --region bom`.  
3. If Gemini quota → switch env `GEMINI_API_KEY` to secondary key.  
4. If still stuck → pause new uploads (return 503) until queue < 100.

#### C. Storage Bucket Public Exposure
1. Alert: Sentry logs `getPublicUrl` outside allowed flow.  
2. Immediate: set bucket public to false (Supabase Storage settings).  
3. Audit: list all signed URLs → expire any > 1 h old.  
4. Post-mortem: rotate `SUPABASE_SERVICE_ROLE_KEY` & redeploy.

#### D. Admin Key Leak
1. Rotate `BOARD_APP_ADMIN_KEY` in Vercel → immediate redeploy.  
2. Check access logs (Supabase → Auth) for suspicious JWT.  
3. Force password reset on affected admin accounts.  
4. Enable Vercel “Trusted IPs” whitelist for admin routes.

### 15.5 Escalation Matrix
| Severity | Definition | Who | Channel |
|---|---|---|---|
| **SEV-1** | Site down or payments broken | On-call engineer | Phone + Slack |
| **SEV-2** | Core feature degraded > 25 % | Backend lead | Slack |
| **SEV-3** | Minor feature bug or slow | Any dev | GitHub issue |

---

## 16.  Final Sign-Off
Once every box in TL;DR is ticked **and** you have completed one full **disaster drill**, email stakeholders:

> Subject: Board-App is production-ready for 100 k users.  
> Monthly cost: ₹5 500.  
> Roll-back time: < 2 min.  
> Next scaling review: when we hit 50 k MAU.

You are now production-ready for 1 L sign-ups & 10 k DAU without surprise bills. 🚀
