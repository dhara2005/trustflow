import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import {
  PlusCircle,
  Briefcase,
  User,
  ShieldCheck,
  RefreshCw,

  Lock,
  X,
  Clock,
  Wallet,
  ArrowUpRight,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  Zap,
  DollarSign,
  Users,
  Paperclip,
  FileText,
  Eye,
  Download,
  MessageCircle,
  Send,
  History,
  LogOut,
} from 'lucide-react';
import abi from './abi.json';
import './App.css';

const SEPOLIA_CHAIN_ID = '0xaa36a7';
const DEFAULT_CONTRACT = "0x67D11D4d6A2031409Ddd7AFa6e36b4C2E1CAf2bD";

const Status = { Open: 0, InProgress: 1, Completed: 2, Disputed: 3, Released: 4, Cancelled: 5 } as const;

const STATUS_LABELS: Record<number, string> = {
  0: 'Open',
  1: 'In Progress',
  2: 'Completed',
  3: 'Disputed',
  4: 'Released',
  5: 'Cancelled',
};

interface EIP6963ProviderDetail {
  info: { uuid: string; name: string; icon: string; rdns: string; };
  provider: any;
}

interface Escrow {
  escrowId: number;
  employer: string;
  employee: string;
  jobDesc: string;
  amount: string;
  status: number;
  timestamp: number;
}

interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error';
}

function timeAgo(ts: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - ts;
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(ts * 1000).toLocaleDateString();
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function parseError(err: any): string {
  // Try to extract the actual revert reason from ethers.js error objects
  if (err?.revert?.args?.[0]) return err.revert.args[0];
  if (err?.reason && err.reason !== 'require(false)' && err.reason !== 'unknown') return err.reason;
  if (err?.info?.error?.message) return err.info.error.message;
  if (err?.shortMessage && !err.shortMessage.includes('require(false)')) return err.shortMessage;
  // Try to decode the error data manually
  if (err?.data && typeof err.data === 'string' && err.data.startsWith('0x08c379a0')) {
    try {
      const decoded = ethers.AbiCoder.defaultAbiCoder().decode(['string'], '0x' + err.data.slice(10));
      if (decoded[0]) return decoded[0];
    } catch { /* ignore decode failure */ }
  }
  // Fall back to message
  return err?.message || 'Transaction failed';
}

function App() {
  const [providers, setProviders] = useState<EIP6963ProviderDetail[]>([]);
  const [currentProvider, setCurrentProvider] = useState<any>(null);
  const [account, setAccount] = useState<string>('');
  const [chainId, setChainId] = useState<string>('');
  const [showModal, setShowModal] = useState(false);

  const [contractAddress] = useState<string>(() => localStorage.getItem('escrow_contract') || DEFAULT_CONTRACT);

  const [contract, setContract] = useState<ethers.Contract | null>(null);
  const [owner, setOwner] = useState<string>('');
  const [isPaused, setIsPaused] = useState<boolean>(false);

  const [escrows, setEscrows] = useState<Escrow[]>([]);
  const [myEarnings, setMyEarnings] = useState<string>('0');
  const [platformFee, setPlatformFee] = useState<string>('5');

  const [loading, setLoading] = useState<boolean>(false);
  const [txLoading, setTxLoading] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'create' | 'client' | 'freelancer'>('create');
  const [form, setForm] = useState({ description: '', freelancer: '', amount: '' });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [disputeId, setDisputeId] = useState<number | null>(null);
  const [disputeReason, setDisputeReason] = useState('');
  const [submitWorkId, setSubmitWorkId] = useState<number | null>(null);
  const [submitWorkText, setSubmitWorkText] = useState('');
  const [submitWorkFiles, setSubmitWorkFiles] = useState<{ name: string; dataUrl: string; type: string }[]>([]);
  const [lightboxImg, setLightboxImg] = useState<string | null>(null);
  const [openChatId, setOpenChatId] = useState<number | null>(null);
  const [chatInput, setChatInput] = useState('');

  // IPFS submission cache: escrowId -> submission data
  const [ipfsSubmissions, setIpfsSubmissions] = useState<Record<number, any>>({});

  const isSepolia = chainId === SEPOLIA_CHAIN_ID;
  const isOwner = account && owner && account.toLowerCase() === owner.toLowerCase();

  // Fetch a work submission: try localStorage first, then IPFS
  const getSubmission = useCallback((escrowId: number): any | null => {
    // Check in-memory IPFS cache first
    if (ipfsSubmissions[escrowId]) return ipfsSubmissions[escrowId];
    // Check localStorage (legacy + CID-based)
    const raw = localStorage.getItem(`work_submission_${escrowId}`);
    if (raw) {
      try { return JSON.parse(raw); } catch { /* ignore */ }
    }
    return null;
  }, [ipfsSubmissions]);

  // Load IPFS submission by searching Pinata for escrowId
  const fetchingRef = useState<Set<number>>(() => new Set())[0];
  const loadIpfsSubmission = useCallback(async (escrowId: number) => {
    if (ipfsSubmissions[escrowId]) return; // Already loaded
    if (fetchingRef.has(escrowId)) return; // Already fetching
    fetchingRef.add(escrowId);
    try {
      // Try CID from localStorage first (fast path)
      const cid = localStorage.getItem(`work_cid_${escrowId}`);
      const url = cid
        ? `/api/submission?cid=${cid}`
        : `/api/submission?escrowId=${escrowId}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setIpfsSubmissions(prev => ({ ...prev, [escrowId]: data }));
      }
    } catch (err) {
      console.warn(`Failed to fetch IPFS submission for escrow ${escrowId}:`, err);
    } finally {
      fetchingRef.delete(escrowId);
    }
  }, [ipfsSubmissions, fetchingRef]);

  // Toast helpers
  const addToast = (message: string, type: 'success' | 'error') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4500);
  };

  // Switch to Sepolia network
  const switchToSepolia = async (provider?: any) => {
    const p = provider || currentProvider;
    if (!p) return;
    try {
      await p.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: SEPOLIA_CHAIN_ID }],
      });
    } catch (switchError: any) {
      // Error code 4902 = chain not added yet
      if (switchError.code === 4902) {
        try {
          await p.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: SEPOLIA_CHAIN_ID,
              chainName: 'Sepolia Testnet',
              nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 },
              rpcUrls: ['https://rpc.sepolia.org'],
              blockExplorerUrls: ['https://sepolia.etherscan.io'],
            }],
          });
        } catch (addError: any) {
          addToast('Failed to add Sepolia network: ' + (addError.message || ''), 'error');
        }
      } else {
        addToast('Failed to switch network: ' + (switchError.message || ''), 'error');
      }
    }
  };

  // Wallet Discovery
  useEffect(() => {
    const onAnnouncement = (event: any) => {
      setProviders(prev => prev.find(p => p.info.uuid === event.detail.info.uuid) ? prev : [...prev, event.detail]);
    };
    window.addEventListener("eip6963:announceProvider", onAnnouncement);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    return () => window.removeEventListener("eip6963:announceProvider", onAnnouncement);
  }, []);

  // Init temp contract address


  const connectToWallet = async (detail: EIP6963ProviderDetail) => {
    try {
      setLoading(true);
      const accounts = await detail.provider.request({ method: 'eth_requestAccounts' });
      const network = await detail.provider.request({ method: 'eth_chainId' });
      const browserProvider = new ethers.BrowserProvider(detail.provider);
      const signer = await browserProvider.getSigner();

      setCurrentProvider(detail.provider);

      // Auto-switch to Sepolia if on wrong network
      if (network !== SEPOLIA_CHAIN_ID) {
        switchToSepolia(detail.provider);
      }
      setAccount(accounts[0]);
      setChainId(network);
      setContract(new ethers.Contract(contractAddress, abi, signer));
      console.log('[App] Connected to contract at:', contractAddress);
      setShowModal(false);
      addToast('Wallet connected successfully', 'success');

      detail.provider.on('accountsChanged', async (accs: string[]) => {
        setAccount(accs[0] || '');
        if (accs[0]) {
          const bp = new ethers.BrowserProvider(detail.provider);
          const s = await bp.getSigner();
          setContract(new ethers.Contract(contractAddress, abi, s));
        } else {
          setContract(null);
        }
      });
      detail.provider.on('chainChanged', async (cid: string) => {
        setChainId(cid);
        const bp = new ethers.BrowserProvider(detail.provider);
        const s = await bp.getSigner();
        setContract(new ethers.Contract(contractAddress, abi, s));
      });
    } catch (err: any) {
      addToast(err.message || "Connection failed", 'error');
    }
    finally { setLoading(false); }
  };

  const disconnectWallet = () => {
    setAccount('');
    setChainId('');
    setCurrentProvider(null);
    setContract(null);
    setOwner('');
    setEscrows([]);
    setMyEarnings('0');
    addToast('Wallet disconnected', 'success');
  };

  const loadContractData = useCallback(async () => {
    if (!contract) return;
    const addr = await contract.getAddress();
    console.log('[App] loadContractData called, contract target:', addr);
    try {
      const [o, p] = await Promise.all([
        contract.owner().catch(() => ''),
        contract.isItPaused().catch(() => false),
      ]);
      setOwner(o);
      setIsPaused(p);

      // Read platformFee directly from storage slot 1
      // (the deployed contract doesn't expose platformFee as a public getter)
      try {
        const provider = contract.runner?.provider;
        if (provider) {
          const raw = await provider.getStorage(addr, 1);
          const fee = Number(BigInt(raw));
          console.log('[App] platformFee from storage slot 1:', fee);
          if (fee > 0 && fee <= 100) {
            setPlatformFee(fee.toString());
          }
        }
      } catch (feeErr: any) {
        console.error('[App] platformFee storage read FAILED:', feeErr?.message || feeErr);
      }
    } catch (e) { console.error("Config load failed", e); }
  }, [contract]);

  const loadUserEscrows = useCallback(async () => {
    if (!contract || !account) return;
    setLoading(true);
    try {
      const [cIds, fIds, earn] = await Promise.all([
        contract.getMyClientEscrows().catch((err: any) => { console.warn("getMyClientEscrows failed:", err); return []; }),
        contract.getMyFreelancerEscrows().catch((err: any) => { console.warn("getMyFreelancerEscrows failed:", err); return []; }),
        contract.getMyEarnings().catch(() => 0n)
      ]);

      setMyEarnings(ethers.formatEther(earn));

      // Convert BigInt IDs to numbers before deduplication
      const clientIds: number[] = Array.from(cIds).map((id: any) => Number(id));
      const freelancerIds: number[] = Array.from(fIds).map((id: any) => Number(id));
      const allIds = Array.from(new Set([...clientIds, ...freelancerIds]));

      console.log("Loading escrows - client IDs:", clientIds, "freelancer IDs:", freelancerIds, "merged:", allIds);

      const results = await Promise.all(allIds.map(async (id: number) => {
        try {
          const d = await contract.getEscrow(id);
          return {
            escrowId: Number(d.escrowId), employer: d.employer, employee: d.employee,
            jobDesc: d.jobDesc, amount: ethers.formatEther(d.amount),
            status: Number(d.status), timestamp: Number(d.timestamp)
          };
        } catch (err) {
          console.warn(`getEscrow(${id}) failed:`, err);
          return null;
        }
      }));

      const valid = results.filter((e): e is Escrow => e !== null).sort((a, b) => b.timestamp - a.timestamp);
      console.log("Loaded escrows:", valid.length);
      setEscrows(valid);
    } catch (err) { console.error("Escrow load failed", err); }
    finally { setLoading(false); }
  }, [contract, account]);

  useEffect(() => {
    if (contract) {
      loadContractData();
      if (account) loadUserEscrows();
    }
  }, [contract, account, chainId, loadContractData, loadUserEscrows]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contract || isPaused) return;

    if (form.description.length <= 10) return addToast("Description must be more than 10 characters.", 'error');
    if (form.freelancer.toLowerCase() === account.toLowerCase()) return addToast("You cannot be the freelancer for your own project.", 'error');
    if (parseFloat(form.amount) <= 0) return addToast("Amount must be greater than 0 ETH.", 'error');
    if (!ethers.isAddress(form.freelancer)) return addToast("Invalid freelancer address.", 'error');

    try {
      setTxLoading(true);
      const tx = await contract.createEscrow(form.description, form.freelancer, { value: ethers.parseEther(form.amount) });
      await tx.wait();
      // Small delay to let the RPC node update its state
      await new Promise(resolve => setTimeout(resolve, 1000));
      setForm({ description: '', freelancer: '', amount: '' });
      await loadContractData();
      await loadUserEscrows();
      setActiveTab('client');
      addToast('Escrow created successfully!', 'success');
    } catch (err: any) {
      console.error('Create escrow error:', err);
      addToast(parseError(err), 'error');
    } finally {
      setTxLoading(false);
    }
  };

  const executeAction = async (id: number, action: string) => {
    if (!contract) return;
    try {
      setTxLoading(true);
      let tx;
      if (action === 'accept') tx = await contract.acceptEscrow(id);
      if (action === 'submit') tx = await contract.submitWork(id);
      if (action === 'approve') tx = await contract.approveAndRelease(id);
      if (action === 'dispute') tx = await contract.dispute(id);
      if (action === 'cancel') tx = await contract.cancelEscrow(id);
      if (action === 'withdraw') tx = await contract.withdrawEarnings();


      if (tx) {
        await tx.wait();
        // Small delay to let the RPC node update its state
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      await loadContractData();
      await loadUserEscrows();
      addToast(`Action "${action}" completed!`, 'success');
    } catch (err: any) {
      console.error(`Action "${action}" error:`, err);
      addToast(parseError(err), 'error');
    }
    finally { setTxLoading(false); }
  };

  const feeAmount = form.amount ? (parseFloat(form.amount) * parseInt(platformFee) / 100) : 0;
  const freelancerReceives = form.amount ? parseFloat(form.amount) - feeAmount : 0;

  const clientEscrows = escrows.filter(e => e.employer.toLowerCase() === account.toLowerCase());
  const freelancerEscrows = escrows.filter(e => e.employee.toLowerCase() === account.toLowerCase());

  const isActiveStatus = (s: number) => s === Status.Open || s === Status.InProgress || s === Status.Completed || s === Status.Disputed;
  const isHistoryStatus = (s: number) => s === Status.Released || s === Status.Cancelled;

  const getActive = (list: Escrow[]) => list.filter(e => isActiveStatus(e.status));
  const getHistory = (list: Escrow[]) => list.filter(e => isHistoryStatus(e.status));

  const [showHistory, setShowHistory] = useState(false);

  return (
    <div className="app-layout">
      {/* â”€â”€â”€ TX LOADING OVERLAY â”€â”€â”€ */}
      {txLoading && (
        <div className="loading-overlay">
          <div className="loading-spinner" />
        </div>
      )}

      {/* â”€â”€â”€ TOAST â”€â”€â”€ */}
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            {t.type === 'success' ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
            {t.message}
          </div>
        ))}
      </div>

      {/* â”€â”€â”€ WALLET MODAL â”€â”€â”€ */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Connect Wallet</h3>
              <button onClick={() => setShowModal(false)}><X size={18} /></button>
            </div>
            <div className="wallet-list">
              {providers.length === 0 && (
                <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1rem', fontSize: '0.9rem' }}>
                  No wallets detected. Install MetaMask or another EIP-6963 compatible wallet.
                </p>
              )}
              {providers.map(p => (
                <button key={p.info.uuid} className="wallet-item" onClick={() => connectToWallet(p)}>
                  <img src={p.info.icon} alt={p.info.name} />
                  <span>{p.info.name}</span>
                  <ArrowUpRight size={16} style={{ marginLeft: 'auto', color: 'var(--text-dim)' }} />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* â”€â”€â”€ SIDEBAR â”€â”€â”€ */}
      <aside className="sidebar">
        <div className="logo">
          <ShieldCheck size={30} />
          <span>TrustFlow</span>
        </div>
        <nav>
          {[
            { key: 'create' as const, icon: <PlusCircle size={18} />, label: 'Create Escrow' },
            { key: 'client' as const, icon: <Briefcase size={18} />, label: 'My Hires' },
            { key: 'freelancer' as const, icon: <User size={18} />, label: 'My Jobs' },
          ].map(t => (
            <button
              key={t.key}
              className={activeTab === t.key ? 'active' : ''}
              onClick={() => setActiveTab(t.key)}
            >
              {t.icon}{t.label}
            </button>
          ))}

        </nav>

        <div className="wallet-card">
          {!account ? (
            <button className="connect-btn" onClick={() => setShowModal(true)}>
              <Wallet size={16} /> Connect Wallet
            </button>
          ) : (
            <div className="user-profile">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div className="label">Connected</div>
                <button
                  className="disconnect-btn"
                  onClick={disconnectWallet}
                  title="Disconnect wallet"
                >
                  <LogOut size={14} />
                </button>
              </div>
              <div className="addr">{shortAddr(account)}</div>
              <div className="label mt">Your Earnings</div>
              <div className="val">{parseFloat(myEarnings).toFixed(4)} <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>ETH</span></div>
              <button
                className="withdraw-btn"
                onClick={() => executeAction(0, 'withdraw')}
                disabled={loading || txLoading || parseFloat(myEarnings) === 0}
              >
                <DollarSign size={14} /> Withdraw Earnings
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Mobile wallet bar - visible only on mobile */}
      <div className="mobile-wallet-bar">
        {!account ? (
          <button className="connect-btn" onClick={() => setShowModal(true)}>
            <Wallet size={16} /> Connect Wallet
          </button>
        ) : (
          <div className="mobile-wallet-info">
            <div className="mobile-wallet-left">
              <span className="mobile-wallet-addr">{shortAddr(account)}</span>
              <span className="mobile-wallet-earnings">{parseFloat(myEarnings).toFixed(4)} ETH</span>
            </div>
            <div className="mobile-wallet-right">
              <button
                className="withdraw-btn"
                onClick={() => executeAction(0, 'withdraw')}
                disabled={loading || txLoading || parseFloat(myEarnings) === 0}
                style={{ margin: 0, padding: '0.5rem 0.75rem', fontSize: '0.75rem' }}
              >
                <DollarSign size={12} /> Withdraw
              </button>
              <button
                className="disconnect-btn"
                onClick={disconnectWallet}
                title="Disconnect wallet"
              >
                <LogOut size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* â”€â”€â”€ MAIN CONTENT â”€â”€â”€ */}
      <main className="content">
        <header className="content-header">
          <div className="title">
            <h2>
              {activeTab === 'create' && 'Create Escrow'}
              {activeTab === 'client' && 'My Hires'}
              {activeTab === 'freelancer' && 'My Jobs'}

            </h2>
            {isPaused && <span className="tag-paused">Paused</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {account && (
              <button
                className={`refresh-btn ${loading ? 'spinning' : ''}`}
                onClick={() => { loadContractData(); loadUserEscrows(); }}
                title="Refresh data"
              >
                <RefreshCw size={16} />
              </button>
            )}
            {account && (
              <div
                className={`net-badge ${isSepolia ? 'ok' : 'warn'}`}
                onClick={!isSepolia ? () => switchToSepolia() : undefined}
                style={!isSepolia ? { cursor: 'pointer' } : undefined}
                title={!isSepolia ? 'Click to switch to Sepolia' : 'Connected to Sepolia'}
              >
                {isSepolia ? 'Sepolia' : '⚠ Switch to Sepolia'}
              </div>
            )}
          </div>
        </header>

        {isPaused && !isOwner && (
          <div className="banner-error">
            <AlertTriangle size={18} />
            The platform is temporarily paused by the admin. Transactions are disabled.
          </div>
        )}

        {!account ? (
          <div className="empty-center">
            <Lock size={48} />
            <p>Connect your wallet to access the TrustFlow escrow platform and manage your projects.</p>
            <button className="primary" onClick={() => setShowModal(true)}>
              <Wallet size={16} /> Connect Wallet
            </button>
          </div>
        ) : (
          <>
            {/* â•â•â• CREATE TAB â•â•â• */}
            {activeTab === 'create' && (
              <section className="view">
                <div className="card-form">
                  <h3>Deposit to Escrow</h3>
                  <p className="form-subtitle">
                    Lock funds in a secure smart contract. The freelancer receives payment only after you approve the work.
                  </p>
                  <form onSubmit={handleCreate}>
                    <div className="field">
                      <label>Job Description</label>
                      <textarea
                        value={form.description}
                        onChange={e => setForm({ ...form, description: e.target.value })}
                        required
                        placeholder="Describe the work to be done..."
                      />
                      <div className={`char-count ${form.description.length > 0 && form.description.length <= 10 ? 'warn' : ''}`}>
                        {form.description.length} / min 11 characters
                      </div>
                    </div>
                    <div className="field">
                      <label>Freelancer Address</label>
                      <input
                        value={form.freelancer}
                        onChange={e => setForm({ ...form, freelancer: e.target.value })}
                        required
                        placeholder="0x..."
                      />
                    </div>
                    <div className="field">
                      <label>Project Budget (ETH)</label>
                      <input
                        type="number"
                        step="0.0001"
                        min="0"
                        value={form.amount}
                        onChange={e => setForm({ ...form, amount: e.target.value })}
                        required
                      />
                    </div>

                    {form.amount && parseFloat(form.amount) > 0 && (
                      <div className="fee-preview">
                        <div className="fee-row">
                          <span>Budget</span>
                          <span>{parseFloat(form.amount).toFixed(4)} ETH</span>
                        </div>
                        <div className="fee-row">
                          <span>Platform Fee ({platformFee}%)</span>
                          <span>-{feeAmount.toFixed(4)} ETH</span>
                        </div>
                        <div className="fee-row total">
                          <span>Freelancer Receives</span>
                          <span>{freelancerReceives.toFixed(4)} ETH</span>
                        </div>
                      </div>
                    )}

                    <button type="submit" className="primary" disabled={txLoading || isPaused} style={{ width: '100%' }}>
                      {txLoading ? (
                        <><Loader2 size={16} style={{ animation: 'spin 0.7s linear infinite' }} /> Confirming...</>
                      ) : (
                        <><Zap size={16} /> Create Escrow</>
                      )}
                    </button>
                  </form>
                </div>
              </section>
            )}

            {/* â•â•â• CLIENT / FREELANCER TABS â•â•â• */}
            {(activeTab === 'client' || activeTab === 'freelancer') && (
              <section className="view">
                {loading ? (
                  <div className="escrow-grid">
                    {[1, 2, 3].map(i => <div key={i} className="skeleton skeleton-card" />)}
                  </div>
                ) : (() => {
                  const all = activeTab === 'client' ? clientEscrows : freelancerEscrows;
                  const activeList = getActive(all);
                  const historyList = getHistory(all);
                  return (
                    <>
                      {activeList.length > 0 && (
                        <div className="escrow-grid">
                          {activeList.map(e => {
                            const statusClass = STATUS_LABELS[e.status].toLowerCase().replace(' ', '');
                            return (
                              <div key={e.escrowId} className={`escrow-card status-${statusClass}`}>
                                <div className="card-top">
                                  <span className={`status s-${statusClass}`}>{STATUS_LABELS[e.status]}</span>
                                  <span className="id">#{e.escrowId}</span>
                                </div>
                                <h4>{e.jobDesc}</h4>
                                {e.status === Status.Disputed && (() => {
                                  const reason = localStorage.getItem(`dispute_reason_${e.escrowId}`);
                                  return reason ? (
                                    <div style={{ padding: '0.6rem 0.85rem', marginBottom: '0.5rem', background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.15)', borderRadius: 'var(--radius-md)', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                                      <span style={{ fontWeight: 700, color: 'var(--danger)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: '0.25rem' }}>Dispute Reason</span>
                                      {reason}
                                    </div>
                                  ) : null;
                                })()}
                                {(e.status >= Status.Completed) && (() => {
                                  const sub = getSubmission(e.escrowId);
                                  // Auto-fetch from IPFS if no local data
                                  if (!sub) {
                                    loadIpfsSubmission(e.escrowId);
                                    return null;
                                  }
                                  return (
                                    <div className="work-submission-box">
                                      <span className="work-submission-label">
                                        <FileText size={11} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />Work Submitted
                                      </span>
                                      {sub.text && <div style={{ marginBottom: sub.files?.length ? '0.4rem' : 0 }}>{sub.text}</div>}
                                      {sub.files?.length > 0 && (
                                        <div className="file-preview-grid">
                                          {sub.files.map((f: any, i: number) => {
                                            const isOldFormat = typeof f === 'string';
                                            const fileName = isOldFormat ? f : f.name;
                                            const fileType = isOldFormat ? '' : f.type;
                                            const dataUrl = isOldFormat ? null : f.dataUrl;
                                            const isImage = fileType.startsWith('image/');
                                            if (isImage && dataUrl) {
                                              return (
                                                <div key={i} className="file-preview-thumb" onClick={() => setLightboxImg(dataUrl)}>
                                                  <img src={dataUrl} alt={fileName} />
                                                  <div className="file-preview-overlay"><Eye size={16} /></div>
                                                  <span className="file-preview-name">{fileName}</span>
                                                </div>
                                              );
                                            }
                                            if (dataUrl) {
                                              return (<a key={i} href={dataUrl} download={fileName} className="file-preview-download"><Download size={14} /><span>{fileName}</span></a>);
                                            }
                                            return (<span key={i} className="file-preview-tag"><Paperclip size={10} />{fileName}</span>);
                                          })}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })()}
                                <div className="card-meta">
                                  <div className="meta-row">
                                    <Users size={14} />
                                    <span>{activeTab === 'client' ? 'Freelancer:' : 'Client:'}</span>
                                    <span className="addr-short">{shortAddr(activeTab === 'client' ? e.employee : e.employer)}</span>
                                  </div>
                                  <div className="meta-row">
                                    <Clock size={14} />
                                    <span>{timeAgo(e.timestamp)}</span>
                                  </div>
                                </div>
                                <div className="amount">{parseFloat(e.amount).toFixed(4)} <span>ETH</span></div>
                                <div className="card-actions">
                                  {e.status === Status.Open && activeTab === 'freelancer' && (
                                    <button className="primary" onClick={() => executeAction(e.escrowId, 'accept')}><CheckCircle2 size={14} /> Accept Job</button>
                                  )}
                                  {e.status === Status.Open && activeTab === 'client' && (
                                    <button className="outline" onClick={() => executeAction(e.escrowId, 'cancel')}><XCircle size={14} /> Cancel</button>
                                  )}
                                  {e.status === Status.InProgress && activeTab === 'freelancer' && (
                                    <button className="primary" onClick={() => { setSubmitWorkId(e.escrowId); setSubmitWorkText(''); setSubmitWorkFiles([]); }}>
                                      <ArrowUpRight size={14} /> Submit Work
                                    </button>
                                  )}
                                  {e.status === Status.Completed && activeTab === 'client' && (() => {
                                    const sub = getSubmission(e.escrowId);
                                    if (!sub) {
                                      loadIpfsSubmission(e.escrowId);
                                      return null;
                                    }
                                    const images = (sub.files || []).filter((f: any) => typeof f !== 'string' && f.type?.startsWith('image/'));
                                    if (images.length === 0) return null;
                                    return (<button className="outline" onClick={() => setLightboxImg(images[0].dataUrl)}><Eye size={14} /> Review Files</button>);
                                  })()}
                                  {e.status === Status.Completed && activeTab === 'client' && (
                                    <button className="success" onClick={() => executeAction(e.escrowId, 'approve')}><CheckCircle2 size={14} /> Approve & Pay</button>
                                  )}
                                  {((e.status === Status.InProgress) || (e.status === Status.Completed && activeTab === 'client')) && disputeId !== e.escrowId && (
                                    <button className="danger" onClick={() => setDisputeId(e.escrowId)}><AlertTriangle size={14} /> Dispute</button>
                                  )}
                                  {disputeId === e.escrowId && (
                                    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                      <textarea value={disputeReason} onChange={ev => setDisputeReason(ev.target.value)} placeholder="Why are you disputing this escrow?"
                                        style={{ width: '100%', padding: '0.65rem 0.85rem', minHeight: '70px', resize: 'vertical', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 'var(--radius-md)', background: 'var(--bg-glass)', color: 'var(--text-primary)', fontFamily: 'inherit', fontSize: '0.82rem', outline: 'none' }} />
                                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                                        <button className="danger" onClick={() => {
                                          if (!disputeReason.trim()) return addToast('Please provide a reason for the dispute.', 'error');
                                          localStorage.setItem(`dispute_reason_${e.escrowId}`, disputeReason.trim());
                                          executeAction(e.escrowId, 'dispute'); setDisputeId(null); setDisputeReason('');
                                        }} style={{ flex: 1 }}><AlertTriangle size={14} /> Confirm Dispute</button>
                                        <button className="outline" onClick={() => { setDisputeId(null); setDisputeReason(''); }} style={{ flex: 1 }}>Cancel</button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                                {/* â”€â”€â”€ CHAT â”€â”€â”€ */}
                                {e.status !== Status.Open && (() => {
                                  const chatKey = `chat_${e.escrowId}`;
                                  const isChatOpen = openChatId === e.escrowId;
                                  const isChatActive = e.status !== Status.Released && e.status !== Status.Cancelled;
                                  const rawChat = localStorage.getItem(chatKey);
                                  const messages: { sender: string; text: string; timestamp: string }[] = rawChat ? (() => { try { return JSON.parse(rawChat).messages || []; } catch { return []; } })() : [];
                                  return (
                                    <>
                                      <button className={`chat-toggle ${isChatOpen ? 'open' : ''}`} onClick={() => { setOpenChatId(isChatOpen ? null : e.escrowId); setChatInput(''); }}>
                                        <MessageCircle size={14} />
                                        Chat {messages.length > 0 && <span className="chat-count">{messages.length}</span>}
                                        {!isChatActive && <span className="chat-ended-tag">Ended</span>}
                                      </button>
                                      {isChatOpen && (
                                        <div className="chat-panel">
                                          <div className="chat-messages">
                                            {messages.length === 0 && (<div className="chat-empty">No messages yet. Start the conversation.</div>)}
                                            {messages.map((m, i) => {
                                              const isMe = m.sender.toLowerCase() === account.toLowerCase();
                                              return (
                                                <div key={i} className={`chat-msg ${isMe ? 'mine' : 'theirs'}`}>
                                                  <div className="chat-msg-bubble">{m.text}</div>
                                                  <div className="chat-msg-meta">{shortAddr(m.sender)} | {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                                                </div>
                                              );
                                            })}
                                          </div>
                                          {isChatActive ? (
                                            <div className="chat-input-bar">
                                              <input value={chatInput} onChange={ev => setChatInput(ev.target.value)} onKeyDown={ev => {
                                                if (ev.key === 'Enter' && chatInput.trim()) {
                                                  const newMsg = { sender: account, text: chatInput.trim(), timestamp: new Date().toISOString() };
                                                  localStorage.setItem(chatKey, JSON.stringify({ messages: [...messages, newMsg] }));
                                                  setChatInput(''); setOpenChatId(null); setTimeout(() => setOpenChatId(e.escrowId), 0);
                                                }
                                              }} placeholder="Type a message..." />
                                              <button onClick={() => {
                                                if (!chatInput.trim()) return;
                                                const newMsg = { sender: account, text: chatInput.trim(), timestamp: new Date().toISOString() };
                                                localStorage.setItem(chatKey, JSON.stringify({ messages: [...messages, newMsg] }));
                                                setChatInput(''); setOpenChatId(null); setTimeout(() => setOpenChatId(e.escrowId), 0);
                                              }}><Send size={14} /></button>
                                            </div>
                                          ) : (<div className="chat-ended">This chat has ended.</div>)}
                                        </div>
                                      )}
                                    </>
                                  );
                                })()}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {all.length === 0 && (
                        <div className="empty-center">
                          {activeTab === 'client' ? <Briefcase size={44} /> : <User size={44} />}
                          <p>{activeTab === 'client' ? "You haven't created any escrows yet. Start by depositing funds for a project." : "No jobs assigned to you yet. Share your wallet address with clients."}</p>
                          {activeTab === 'client' && (<button className="primary" onClick={() => setActiveTab('create')}><PlusCircle size={16} /> Create Escrow</button>)}
                        </div>
                      )}

                      {activeList.length === 0 && all.length > 0 && (
                        <div className="empty-center">
                          <CheckCircle2 size={44} />
                          <p>No active {activeTab === 'client' ? 'hires' : 'jobs'}. Check your history below.</p>
                        </div>
                      )}

                      {historyList.length > 0 && (
                        <div className="history-section">
                          <button className={`history-toggle ${showHistory ? 'open' : ''}`} onClick={() => setShowHistory(!showHistory)}>
                            <History size={16} />
                            <span>History</span>
                            <span className="history-count">{historyList.length}</span>
                          </button>
                          {showHistory && (
                            <div className="escrow-grid history-grid">
                              {historyList.map(e => {
                                const statusClass = STATUS_LABELS[e.status].toLowerCase().replace(' ', '');
                                return (
                                  <div key={e.escrowId} className={`escrow-card status-${statusClass} history-card`}>
                                    <div className="card-top">
                                      <span className={`status s-${statusClass}`}>{STATUS_LABELS[e.status]}</span>
                                      <span className="id">#{e.escrowId}</span>
                                    </div>
                                    <h4>{e.jobDesc}</h4>
                                    <div className="card-meta">
                                      <div className="meta-row">
                                        {activeTab === 'client' ? <User size={14} /> : <Briefcase size={14} />}
                                        <span>{shortAddr(activeTab === 'client' ? e.employee : e.employer)}</span>
                                      </div>
                                      <div className="meta-row">
                                        <Clock size={14} />
                                        <span>{timeAgo(e.timestamp)}</span>
                                      </div>
                                    </div>
                                    <div className="amount">{parseFloat(e.amount).toFixed(4)} <span>ETH</span></div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  );
                })()}
              </section>
            )}


          </>
        )}
      </main >

      {/* ═══ SUBMIT WORK MODAL ═══ */}
      {
        submitWorkId !== null && (
          <div style={{
            position: 'fixed', inset: 0, zIndex: 999,
            background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '1rem',
          }} onClick={() => setSubmitWorkId(null)}>
            <div style={{
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)', padding: '2rem', maxWidth: '520px', width: '100%',
              boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
            }} onClick={ev => ev.stopPropagation()}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
                <h3 style={{ margin: 0, fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <ArrowUpRight size={20} /> Submit Work - Escrow #{submitWorkId}
                </h3>
                <button onClick={() => setSubmitWorkId(null)} style={{
                  background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '0.25rem',
                }}><X size={18} /></button>
              </div>

              <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.4rem' }}>
                Describe the work you've completed
              </label>
              <textarea
                value={submitWorkText}
                onChange={ev => setSubmitWorkText(ev.target.value)}
                placeholder="Explain what you've done, include links, notes, etc."
                style={{
                  width: '100%', padding: '0.75rem', minHeight: '100px', resize: 'vertical',
                  border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-glass)', color: 'var(--text-primary)', fontFamily: 'inherit',
                  fontSize: '0.85rem', outline: 'none', marginBottom: '1rem',
                  boxSizing: 'border-box',
                }}
              />

              <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.4rem' }}>
                <Paperclip size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                Attach files (optional)
              </label>
              <input
                type="file"
                multiple
                onChange={ev => {
                  const files = ev.target.files;
                  if (!files) return;
                  Array.from(files).forEach(file => {
                    const reader = new FileReader();
                    reader.onload = () => {
                      setSubmitWorkFiles(prev => [...prev, {
                        name: file.name,
                        dataUrl: reader.result as string,
                        type: file.type,
                      }]);
                    };
                    reader.readAsDataURL(file);
                  });
                  ev.target.value = '';
                }}
                style={{
                  width: '100%', padding: '0.5rem', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)', background: 'var(--bg-glass)', color: 'var(--text-primary)',
                  fontSize: '0.82rem', marginBottom: '0.5rem', boxSizing: 'border-box',
                }}
              />
              {submitWorkFiles.length > 0 && (
                <div className="submit-file-list">
                  {submitWorkFiles.map((f, i) => (
                    <div key={i} className="submit-file-item">
                      {f.type.startsWith('image/') ? (
                        <img src={f.dataUrl} alt={f.name} className="submit-file-thumb" />
                      ) : (
                        <div className="submit-file-icon"><FileText size={18} /></div>
                      )}
                      <span className="submit-file-name">{f.name}</span>
                      <button onClick={() => setSubmitWorkFiles(prev => prev.filter((_, j) => j !== i))} className="submit-file-remove">
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  className="primary"
                  style={{ flex: 1 }}
                  onClick={async () => {
                    if (!submitWorkText.trim() && submitWorkFiles.length === 0) {
                      return addToast('Please describe the work or attach files.', 'error');
                    }
                    const submission = {
                      text: submitWorkText.trim(),
                      files: submitWorkFiles,
                      submittedAt: new Date().toISOString(),
                    };
                    // Save to localStorage as fallback
                    localStorage.setItem(`work_submission_${submitWorkId}`, JSON.stringify(submission));

                    // Upload to IPFS via serverless API
                    try {
                      const res = await fetch('/api/upload', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          text: submission.text,
                          files: submission.files,
                          escrowId: submitWorkId,
                          submitter: account,
                        }),
                      });
                      if (res.ok) {
                        const { cid } = await res.json();
                        localStorage.setItem(`work_cid_${submitWorkId}`, cid);
                        console.log('[IPFS] Submission uploaded, CID:', cid);
                      } else {
                        console.warn('[IPFS] Upload failed, using localStorage fallback');
                      }
                    } catch (ipfsErr) {
                      console.warn('[IPFS] Upload error, using localStorage fallback:', ipfsErr);
                    }

                    const id = submitWorkId;
                    setSubmitWorkId(null);
                    setSubmitWorkText('');
                    setSubmitWorkFiles([]);
                    executeAction(id, 'submit');
                  }}
                >
                  <CheckCircle2 size={14} /> Confirm & Submit On-Chain
                </button>
                <button
                  className="outline"
                  style={{ flex: 0.6 }}
                  onClick={() => { setSubmitWorkId(null); setSubmitWorkText(''); setSubmitWorkFiles([]); }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )
      }

      {/* ═══ LIGHTBOX ═══ */}
      {
        lightboxImg && (
          <div className="lightbox-overlay" onClick={() => setLightboxImg(null)}>
            <button className="lightbox-close" onClick={() => setLightboxImg(null)}>
              <X size={24} />
            </button>
            <img src={lightboxImg} alt="Preview" className="lightbox-img" onClick={ev => ev.stopPropagation()} />
          </div>
        )
      }
    </div >
  );
}

export default App;
