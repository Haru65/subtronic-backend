# Deployment Guide - Render & Vercel

## Overview
This guide covers deploying the Subtronics IoT Platform:
- **Backend**: Render (Node.js + WebSocket)
- **Frontend**: Vercel (Vue.js + Vite)

---

## Backend Deployment (Render)

### Prerequisites
- GitHub account with repository access
- Render account (free tier available)
- MQTT broker credentials

### Step 1: Prepare Repository

Ensure your `subtronic-backend` folder has:
```
subtronic-backend/
├── index.js
├── package.json
├── .env.example
└── README.md
```

### Step 2: Create Render Web Service

1. **Go to Render Dashboard**
   - Visit: https://dashboard.render.com
   - Click "New +" → "Web Service"

2. **Connect Repository**
   - Select your GitHub repository
   - Grant Render access if needed

3. **Configure Service**
   ```
   Name: subtronic-backend
   Region: Choose closest to your users
   Branch: main (or your default branch)
   Root Directory: subtronic-backend
   Runtime: Node
   Build Command: npm install
   Start Command: node index.js
   ```

4. **Set Instance Type**
   - Free tier: Good for testing
   - Starter: Recommended for production
   - Standard: For high traffic

### Step 3: Environment Variables

Add these in Render dashboard:

```bash
# MQTT Configuration
MQTT_BROKER=mqtt://broker.zeptac.com:1883
MQTT_USERNAME=zeptac_iot
MQTT_PASSWORD=ZepIOT@123
MQTT_TOPIC_SUBTRONICS=SubTronics/data

# Server Configuration
HTTP_PORT=3002

# CORS - Add your Vercel URL after frontend deployment
ALLOWED_ORIGINS=https://your-app.vercel.app,http://localhost:3000
```

### Step 4: Deploy

1. Click "Create Web Service"
2. Wait for build to complete (2-5 minutes)
3. Note your backend URL: `https://your-backend.onrender.com`

### Step 5: Verify Deployment

Test health endpoint:
```bash
curl https://your-backend.onrender.com/health
```

Expected response:
```json
{
  "status": "healthy",
  "mqtt_connected": true,
  "devices_count": 0,
  "subtronics_devices": 0,
  "timestamp": "2026-01-27T..."
}
```

---

## Frontend Deployment (Vercel)

### Prerequisites
- GitHub account with repository access
- Vercel account (free tier available)
- Backend URL from Render

### Step 1: Prepare Repository

Ensure your `ZEPTAC-IOT-PLATFORM` folder has:
```
ZEPTAC-IOT-PLATFORM/
├── src/
├── public/
├── index.html
├── package.json
├── vite.config.ts
└── .env.example
```

### Step 2: Create Vercel Project

1. **Go to Vercel Dashboard**
   - Visit: https://vercel.com/dashboard
   - Click "Add New..." → "Project"

2. **Import Repository**
   - Select your GitHub repository
   - Grant Vercel access if needed

3. **Configure Project**
   ```
   Framework Preset: Vite
   Root Directory: ZEPTAC-IOT-PLATFORM
   Build Command: npm run build
   Output Directory: dist
   Install Command: npm install
   Node Version: 18.x
   ```

### Step 3: Environment Variables

Add in Vercel project settings:

```bash
# Backend API URL (use your Render URL)
VITE_SUBTRONICS_API_URL=https://your-backend.onrender.com

# Optional: Other environment variables
VITE_APP_NAME=Zeptac IoT Platform
VITE_APP_VERSION=1.0.0
```

### Step 4: Deploy

1. Click "Deploy"
2. Wait for build (3-7 minutes)
3. Note your frontend URL: `https://your-app.vercel.app`

### Step 5: Update Backend CORS

Go back to Render and update `ALLOWED_ORIGINS`:
```bash
ALLOWED_ORIGINS=https://your-app.vercel.app,http://localhost:3000
```

Then redeploy backend.

### Step 6: Verify Deployment

1. Open `https://your-app.vercel.app`
2. Navigate to Subtronics device page
3. Open browser console
4. Look for: `✅ WebSocket connected`

---

## Post-Deployment Configuration

### 1. Custom Domain (Optional)

#### Render
1. Go to Settings → Custom Domain
2. Add your domain (e.g., `api.yourdomain.com`)
3. Update DNS records as instructed

#### Vercel
1. Go to Settings → Domains
2. Add your domain (e.g., `app.yourdomain.com`)
3. Update DNS records as instructed

### 2. SSL/TLS Certificates

Both Render and Vercel provide automatic SSL certificates.
- Render: Automatic via Let's Encrypt
- Vercel: Automatic for all domains

### 3. Update Environment Variables

After adding custom domains, update:

**Render:**
```bash
ALLOWED_ORIGINS=https://app.yourdomain.com,http://localhost:3000
```

**Vercel:**
```bash
VITE_SUBTRONICS_API_URL=https://api.yourdomain.com
```

---

## Monitoring & Maintenance

### Render Monitoring

1. **Logs**
   - Dashboard → Your Service → Logs
   - Real-time log streaming
   - Filter by severity

2. **Metrics**
   - CPU usage
   - Memory usage
   - Request count
   - Response time

3. **Alerts**
   - Set up email alerts
   - Monitor uptime
   - Track errors

### Vercel Monitoring

1. **Analytics**
   - Dashboard → Analytics
   - Page views
   - Performance metrics
   - Web Vitals

2. **Logs**
   - Dashboard → Deployments → View Function Logs
   - Real-time logs
   - Error tracking

3. **Speed Insights**
   - Enable in project settings
   - Track Core Web Vitals
   - Performance recommendations

---

## Scaling Considerations

### Backend (Render)

**Vertical Scaling:**
- Upgrade instance type
- More CPU/RAM
- Better for WebSocket connections

**Horizontal Scaling:**
- Add Redis for session storage
- Use load balancer
- Multiple instances

### Frontend (Vercel)

**Automatic Scaling:**
- Vercel handles automatically
- Edge network distribution
- No configuration needed

**Optimization:**
- Enable caching
- Optimize images
- Code splitting

---

## Troubleshooting

### Backend Issues

**Service Won't Start**
```bash
# Check logs in Render dashboard
# Common issues:
- Missing environment variables
- Port binding (use process.env.PORT)
- Node version mismatch
```

**MQTT Connection Failed**
```bash
# Verify credentials
# Check firewall rules
# Test MQTT broker accessibility
```

**WebSocket Not Working**
```bash
# Check CORS configuration
# Verify WebSocket transport enabled
# Test with polling fallback
```

### Frontend Issues

**Build Failed**
```bash
# Check Node version (18.x recommended)
# Verify all dependencies installed
# Check for TypeScript errors
```

**WebSocket Connection Failed**
```bash
# Verify VITE_SUBTRONICS_API_URL
# Check CORS on backend
# Test with browser console
```

**Environment Variables Not Working**
```bash
# Must start with VITE_
# Redeploy after changes
# Check in browser: import.meta.env
```

---

## Rollback Procedure

### Render
1. Go to Deployments
2. Find previous successful deployment
3. Click "Redeploy"

### Vercel
1. Go to Deployments
2. Find previous deployment
3. Click "..." → "Promote to Production"

---

## Cost Estimation

### Render (Backend)

**Free Tier:**
- 750 hours/month
- Spins down after inactivity
- Good for testing

**Starter ($7/month):**
- Always on
- 512 MB RAM
- Recommended for production

**Standard ($25/month):**
- 2 GB RAM
- Better performance
- High traffic

### Vercel (Frontend)

**Hobby (Free):**
- 100 GB bandwidth
- Unlimited deployments
- Good for small projects

**Pro ($20/month):**
- 1 TB bandwidth
- Team collaboration
- Analytics included

---

## Security Checklist

- [ ] HTTPS enabled (automatic)
- [ ] Environment variables secured
- [ ] CORS properly configured
- [ ] MQTT credentials not in code
- [ ] API rate limiting (future)
- [ ] Input validation enabled
- [ ] Error messages sanitized
- [ ] Logs don't contain secrets

---

## Backup Strategy

### Backend Data
- Use database for persistence
- Regular database backups
- Export device configurations

### Frontend Assets
- Git repository is source of truth
- Vercel keeps deployment history
- Download build artifacts if needed

---

## Support & Resources

### Render
- Docs: https://render.com/docs
- Status: https://status.render.com
- Support: support@render.com

### Vercel
- Docs: https://vercel.com/docs
- Status: https://vercel-status.com
- Support: https://vercel.com/support

### Project
- GitHub Issues
- Internal documentation
- Team communication channels

---

## Maintenance Schedule

**Weekly:**
- Check error logs
- Monitor performance metrics
- Review alerts

**Monthly:**
- Update dependencies
- Review security advisories
- Optimize performance

**Quarterly:**
- Capacity planning
- Cost optimization
- Feature updates

---

## Next Steps

1. ✅ Deploy backend to Render
2. ✅ Deploy frontend to Vercel
3. ✅ Configure environment variables
4. ✅ Test WebSocket connection
5. ✅ Set up monitoring
6. ✅ Configure custom domains (optional)
7. ✅ Enable alerts
8. ✅ Document for team

---

## Quick Reference

### Backend URL
```
Development: http://localhost:3002
Production: https://your-backend.onrender.com
```

### Frontend URL
```
Development: http://localhost:3000
Production: https://your-app.vercel.app
```

### Health Check
```bash
curl https://your-backend.onrender.com/health
```

### WebSocket Test
```javascript
const socket = io('https://your-backend.onrender.com');
socket.on('connect', () => console.log('Connected!'));
```

---

**Last Updated:** January 27, 2026
**Version:** 1.0.0
