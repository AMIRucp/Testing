import axios from 'axios';
import fs from 'fs';
import path from 'path';

// Solana Mainnet HTTP RPC endpoint
const RPC_URL = 'https://api.mainnet-beta.solana.com';

// Function to fetch the last 100 transactions from a recent block
async function getLast100Transactions() {
    try {
        // Step 1: Get the latest finalized slot
        const slotResponse = await axios.post(RPC_URL, {
            jsonrpc: '2.0',
            id: 1,
            method: 'getSlot',
            params: [{ commitment: 'finalized' }]
        });
        const latestSlot = slotResponse.data.result;
        console.log(`Latest Finalized Slot: ${latestSlot}`);

        // Step 2: Fetch the latest block
        const blockResponse = await axios.post(RPC_URL, {
            jsonrpc: '2.0',
            id: 1,
            method: 'getBlock',
            params: [
                latestSlot,
                {
                    encoding: 'jsonParsed',
                    transactionDetails: 'full',
                    rewards: false,
                    commitment: 'finalized',
                    maxSupportedTransactionVersion: 0 // Ensure compatibility
                }
            ]
        });

        if (!blockResponse.data.result || !blockResponse.data.result.transactions) {
            throw new Error(`No transactions found in slot ${latestSlot}`);
        }

        const transactions = blockResponse.data.result.transactions;
        console.log(`Fetched ${transactions.length} transactions from slot ${latestSlot}`);

        // Step 3: Take the last 100 transactions (or all if < 100)
        const last100Txs = transactions.slice(0, Math.min(1000, transactions.length));
        console.log(`\n--- Last ${last100Txs.length} Transactions ---`);

        // Array to store significant transactions (> 5 SOL)
        const significantTransactions = [];

        // Step 4: Process each transaction
        last100Txs.forEach((tx, index) => {
            const signature = tx.transaction.signatures[0];
            const preBalances = tx.meta.preBalances;
            const postBalances = tx.meta.postBalances;
            const accountKeys = tx.transaction.message.accountKeys.map(acc => acc.pubkey);

            console.log(`Transaction ${index + 1}:`);
            console.log(`  Signature: ${signature}`);

            // Calculate balance changes and track token information
            const balanceChanges = [];
            accountKeys.forEach((account, idx) => {
                const balanceChange = postBalances[idx] - preBalances[idx];
                const balanceChangeSOL = balanceChange / 1_000_000_000;
                if (balanceChange !== 0) {
                    console.log(`  Account: ${account}`);
                    console.log(`    Balance Change: ${balanceChangeSOL} SOL (${balanceChange} lamports)`);
                    balanceChanges.push({
                        account,
                        balanceChangeSOL,
                        balanceChangeLamports: balanceChange
                    });
                }
            });

            // Estimated transaction amount (payer's outgoing amount)
            const senderChange = preBalances[0] - postBalances[0];
            const amountSOL = senderChange > 0 ? (senderChange / 1_000_000_000) : 0;
            console.log(`  Estimated Transaction Amount: ${amountSOL} SOL`);
            console.log('---');

            // If transaction amount is greater than 5 SOL, store it
            if (amountSOL > 0.5) {
                // Initialize token info array
                const tokenInfo = [];

                // Track token transfers and identify buy/sell actions
                if (tx.meta && tx.meta.preTokenBalances && tx.meta.postTokenBalances) {
                    const preBalances = new Map();
                    const postBalances = new Map();
                    
                    // Process pre-balances with owner information
                    tx.meta.preTokenBalances.forEach(token => {
                        const key = `${token.mint}-${token.owner}`;
                        preBalances.set(key, {
                            amount: token.uiTokenAmount.uiAmount,
                            decimals: token.uiTokenAmount.decimals,
                            owner: token.owner
                        });
                    });
                    
                    // Process post-balances with owner information
                    tx.meta.postTokenBalances.forEach(token => {
                        const key = `${token.mint}-${token.owner}`;
                        postBalances.set(key, {
                            amount: token.uiTokenAmount.uiAmount,
                            decimals: token.uiTokenAmount.decimals,
                            owner: token.owner
                        });
                    });
                    
                    // Track all unique token-owner combinations
                    const allKeys = new Set([...preBalances.keys(), ...postBalances.keys()]);
                    
                    allKeys.forEach(key => {
                        const [mint, owner] = key.split('-');
                        const pre = preBalances.get(key) || { amount: 0, decimals: postBalances.get(key)?.decimals };
                        const post = postBalances.get(key) || { amount: 0, decimals: preBalances.get(key)?.decimals };
                        
                        const change = post.amount - pre.amount;
                        
                        if (change !== 0) {
                            tokenInfo.push({
                                type: 'token_trade',
                                action: change > 0 ? 'buy' : 'sell',
                                mint: mint,
                                amount: Math.abs(change),
                                decimals: pre.decimals || post.decimals,
                                owner: owner,
                                preBalance: pre.amount,
                                postBalance: post.amount
                            });
                        }
                    });
                // Include program instructions for context
                if (tx.meta && tx.meta.logMessages) {
                    const relevantInstructions = tx.meta.logMessages
                        .filter(log => log.includes('Program log: Instruction:') &&
                                     (log.includes('Transfer') || log.includes('Swap') || 
                                      log.includes('Exchange') || log.includes('Trade')));
                    
                    relevantInstructions.forEach(instruction => {
                        tokenInfo.push({
                            type: 'instruction',
                            data: instruction
                        });
                    });
                }
                }

                // Store simplified transaction data
                significantTransactions.push({
                    signature,
                    timestamp: new Date().toISOString(),
                    amountSOL,
                    sourceAccount: tx.transaction.message.accountKeys[0].pubkey,
                    tokens: tokenInfo
                });
            }
        });

        // Save significant transactions to a JSON file
        if (significantTransactions.length > 0) {
            const filePath = path.join(process.cwd(), 'significant_transactions.json');
            fs.writeFileSync(filePath, JSON.stringify(significantTransactions, null, 2));
            console.log(`\nSaved ${significantTransactions.length} significant transactions to significant_transactions.json`);
        } else {
            console.log('\nNo transactions over 5 SOL found in this block.');
        }

    } catch (error) {
        if (error.response && error.response.status === 429) {
            console.error('Rate limit exceeded (429). Try again later or use a premium endpoint.');
        } else {
            console.error('Error fetching transactions:', error.message);
        }
    }
}

// Run the function
getLast100Transactions();
