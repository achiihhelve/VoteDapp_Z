import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface VoteData {
  id: string;
  title: string;
  description: string;
  creator: string;
  timestamp: number;
  encryptedValue: string;
  publicValue1: number;
  publicValue2: number;
  isVerified: boolean;
  decryptedValue: number;
  category: string;
}

interface VoteStats {
  totalVotes: number;
  verifiedVotes: number;
  activeProposals: number;
  userVotes: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [votes, setVotes] = useState<VoteData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingVote, setCreatingVote] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newVoteData, setNewVoteData] = useState({ 
    title: "", 
    description: "", 
    voteValue: "",
    category: "general"
  });
  const [selectedVote, setSelectedVote] = useState<VoteData | null>(null);
  const [stats, setStats] = useState<VoteStats>({
    totalVotes: 0,
    verifiedVotes: 0,
    activeProposals: 0,
    userVotes: 0
  });
  const [userHistory, setUserHistory] = useState<VoteData[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized) return;
      
      try {
        console.log('Initializing FHEVM for voting system...');
        await initialize();
        console.log('FHEVM initialized successfully');
      } catch (error) {
        console.error('Failed to initialize FHEVM:', error);
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadVotes();
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadVotes = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const votesList: VoteData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          votesList.push({
            id: businessId,
            title: businessData.name,
            description: businessData.description,
            creator: businessData.creator,
            timestamp: Number(businessData.timestamp),
            encryptedValue: businessId,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0,
            category: "vote"
          });
        } catch (e) {
          console.error('Error loading vote data:', e);
        }
      }
      
      setVotes(votesList);
      updateStats(votesList);
      if (address) {
        setUserHistory(votesList.filter(vote => vote.creator.toLowerCase() === address.toLowerCase()));
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load votes" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const updateStats = (votesList: VoteData[]) => {
    const totalVotes = votesList.length;
    const verifiedVotes = votesList.filter(v => v.isVerified).length;
    const activeProposals = votesList.filter(v => Date.now()/1000 - v.timestamp < 60 * 60 * 24 * 7).length;
    const userVotes = address ? votesList.filter(v => v.creator.toLowerCase() === address.toLowerCase()).length : 0;
    
    setStats({
      totalVotes,
      verifiedVotes,
      activeProposals,
      userVotes
    });
  };

  const createVote = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingVote(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating encrypted vote with FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const voteValue = parseInt(newVoteData.voteValue) || 1;
      const businessId = `vote-${Date.now()}`;
      
      const encryptedResult = await encrypt(await contract.getAddress(), address, voteValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newVoteData.title,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        voteValue,
        0,
        newVoteData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Encrypted vote created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadVotes();
      setShowCreateModal(false);
      setNewVoteData({ title: "", description: "", voteValue: "", category: "general" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Creation failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingVote(false); 
    }
  };

  const decryptVote = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const voteData = await contractRead.getBusinessData(businessId);
      if (voteData.isVerified) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Vote already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        return Number(voteData.decryptedValue);
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        await contractWrite.getAddress(),
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadVotes();
      
      setTransactionStatus({ visible: true, status: "success", message: "Vote decrypted and verified!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Vote is already verified" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        await loadVotes();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const available = await contract.isAvailable();
      if (available) {
        setTransactionStatus({ visible: true, status: "success", message: "FHE system is available!" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredVotes = votes.filter(vote => {
    const matchesSearch = vote.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         vote.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = filterCategory === "all" || vote.category === filterCategory;
    return matchesSearch && matchesCategory;
  });

  const renderStatsPanel = () => {
    return (
      <div className="stats-panels">
        <div className="stat-panel gold-panel">
          <div className="stat-icon">🗳️</div>
          <div className="stat-content">
            <h3>Total Votes</h3>
            <div className="stat-value">{stats.totalVotes}</div>
            <div className="stat-trend">FHE Encrypted</div>
          </div>
        </div>
        
        <div className="stat-panel silver-panel">
          <div className="stat-icon">✅</div>
          <div className="stat-content">
            <h3>Verified</h3>
            <div className="stat-value">{stats.verifiedVotes}</div>
            <div className="stat-trend">On-chain Verified</div>
          </div>
        </div>
        
        <div className="stat-panel bronze-panel">
          <div className="stat-icon">🔥</div>
          <div className="stat-content">
            <h3>Active</h3>
            <div className="stat-value">{stats.activeProposals}</div>
            <div className="stat-trend">This Week</div>
          </div>
        </div>
        
        <div className="stat-panel copper-panel">
          <div className="stat-icon">👤</div>
          <div className="stat-content">
            <h3>Your Votes</h3>
            <div className="stat-value">{stats.userVotes}</div>
            <div className="stat-trend">Participation</div>
          </div>
        </div>
      </div>
    );
  };

  const renderUserHistory = () => {
    if (userHistory.length === 0) return null;
    
    return (
      <div className="history-section">
        <h3>Your Voting History</h3>
        <div className="history-list">
          {userHistory.slice(0, 5).map((vote, index) => (
            <div key={index} className="history-item">
              <div className="history-title">{vote.title}</div>
              <div className="history-status">
                {vote.isVerified ? "✅ Verified" : "⏳ Pending"}
              </div>
              <div className="history-date">
                {new Date(vote.timestamp * 1000).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderFHEProcess = () => {
    return (
      <div className="fhe-process">
        <div className="process-step">
          <div className="step-number">1</div>
          <div className="step-content">
            <h4>Encrypt Vote</h4>
            <p>Vote value encrypted with FHE before submission</p>
          </div>
        </div>
        <div className="process-arrow">→</div>
        <div className="process-step">
          <div className="step-number">2</div>
          <div className="step-content">
            <h4>Store on-chain</h4>
            <p>Encrypted data stored with public verification flag</p>
          </div>
        </div>
        <div className="process-arrow">→</div>
        <div className="process-step">
          <div className="step-number">3</div>
          <div className="step-content">
            <h4>Decrypt Offline</h4>
            <p>Client-side decryption using FHEVM relayer</p>
          </div>
        </div>
        <div className="process-arrow">→</div>
        <div className="process-step">
          <div className="step-number">4</div>
          <div className="step-content">
            <h4>Verify On-chain</h4>
            <p>Submit proof for FHE signature validation</p>
          </div>
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo-section">
            <div className="logo-icon">🗳️</div>
            <h1>Private Voting DApp</h1>
            <span className="tagline">FHE Encrypted Voting</span>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="prompt-content">
            <div className="prompt-icon">🔐</div>
            <h2>Connect Your Wallet to Vote Privately</h2>
            <p>Experience fully encrypted voting with FHE technology. Your votes remain private while being verifiable.</p>
            <div className="feature-steps">
              <div className="feature-step">
                <span className="step-number">1</span>
                <div className="step-content">
                  <strong>Connect Wallet</strong>
                  <p>Use the button above to connect your crypto wallet</p>
                </div>
              </div>
              <div className="feature-step">
                <span className="step-number">2</span>
                <div className="step-content">
                  <strong>FHE Initialization</strong>
                  <p>Automatic setup of fully homomorphic encryption</p>
                </div>
              </div>
              <div className="feature-step">
                <span className="step-number">3</span>
                <div className="step-content">
                  <strong>Private Voting</strong>
                  <p>Cast encrypted votes that only you can decrypt</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized) {
    return (
      <div className="loading-screen">
        <div className="encryption-spinner"></div>
        <p>Initializing FHE Voting System...</p>
        <p className="status-text">Status: {status}</p>
        <p className="loading-note">Setting up encrypted voting environment</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="encryption-spinner"></div>
      <p>Loading Private Voting System...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo-section">
          <div className="logo-icon">🗳️</div>
          <div className="logo-text">
            <h1>Private Voting DApp</h1>
            <span className="tagline">FHE Encrypted • Zero Knowledge</span>
          </div>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-vote-btn"
          >
            + New Vote
          </button>
          <button 
            onClick={checkAvailability} 
            className="check-availability-btn"
          >
            Check FHE
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>

      <div className="main-content">
        <div className="sidebar">
          {renderUserHistory()}
          
          <div className="fhe-info-panel">
            <h3>FHE Voting Process</h3>
            {renderFHEProcess()}
          </div>

          <div className="stats-sidebar">
            <h3>Voting Statistics</h3>
            <div className="sidebar-stats">
              <div className="sidebar-stat">
                <span>Encrypted Votes</span>
                <strong>{stats.totalVotes}</strong>
              </div>
              <div className="sidebar-stat">
                <span>Verified Results</span>
                <strong>{stats.verifiedVotes}</strong>
              </div>
              <div className="sidebar-stat">
                <span>Your Participation</span>
                <strong>{stats.userVotes}</strong>
              </div>
            </div>
          </div>
        </div>

        <div className="content-area">
          <div className="dashboard-section">
            <h2>Encrypted Voting Dashboard</h2>
            {renderStatsPanel()}
          </div>

          <div className="votes-section">
            <div className="section-header">
              <h2>Active Votes</h2>
              <div className="controls">
                <div className="search-box">
                  <input 
                    type="text" 
                    placeholder="Search votes..." 
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
                <select 
                  value={filterCategory} 
                  onChange={(e) => setFilterCategory(e.target.value)}
                  className="filter-select"
                >
                  <option value="all">All Categories</option>
                  <option value="general">General</option>
                  <option value="governance">Governance</option>
                  <option value="proposal">Proposal</option>
                </select>
                <button 
                  onClick={loadVotes} 
                  className="refresh-btn" 
                  disabled={isRefreshing}
                >
                  {isRefreshing ? "🔄" : "Refresh"}
                </button>
              </div>
            </div>
            
            <div className="votes-list">
              {filteredVotes.length === 0 ? (
                <div className="no-votes">
                  <div className="no-votes-icon">🗳️</div>
                  <p>No encrypted votes found</p>
                  <button 
                    className="create-first-btn" 
                    onClick={() => setShowCreateModal(true)}
                  >
                    Create First Vote
                  </button>
                </div>
              ) : filteredVotes.map((vote, index) => (
                <div 
                  className={`vote-item ${vote.isVerified ? "verified" : "encrypted"}`}
                  key={index}
                  onClick={() => setSelectedVote(vote)}
                >
                  <div className="vote-header">
                    <h3 className="vote-title">{vote.title}</h3>
                    <span className={`vote-status ${vote.isVerified ? "verified" : "encrypted"}`}>
                      {vote.isVerified ? "✅ Verified" : "🔒 Encrypted"}
                    </span>
                  </div>
                  <p className="vote-description">{vote.description}</p>
                  <div className="vote-meta">
                    <span>By: {vote.creator.substring(0, 6)}...{vote.creator.substring(38)}</span>
                    <span>{new Date(vote.timestamp * 1000).toLocaleDateString()}</span>
                  </div>
                  {vote.isVerified && (
                    <div className="vote-result">
                      Decrypted Result: <strong>{vote.decryptedValue}</strong>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {showCreateModal && (
        <CreateVoteModal 
          onSubmit={createVote} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingVote} 
          voteData={newVoteData} 
          setVoteData={setNewVoteData}
          isEncrypting={isEncrypting}
        />
      )}

      {selectedVote && (
        <VoteDetailModal 
          vote={selectedVote} 
          onClose={() => setSelectedVote(null)} 
          isDecrypting={fheIsDecrypting} 
          decryptVote={() => decryptVote(selectedVote.id)}
        />
      )}

      {transactionStatus.visible && (
        <div className={`transaction-toast ${transactionStatus.status}`}>
          <div className="toast-content">
            <div className="toast-icon">
              {transactionStatus.status === "pending" && <div className="loading-spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <span>{transactionStatus.message}</span>
          </div>
        </div>
      )}
    </div>
  );
};

const CreateVoteModal: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  voteData: any;
  setVoteData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, voteData, setVoteData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (name === 'voteValue') {
      const intValue = value.replace(/[^\d]/g, '');
      setVoteData({ ...voteData, [name]: intValue });
    } else {
      setVoteData({ ...voteData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-vote-modal">
        <div className="modal-header">
          <h2>Create Encrypted Vote</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="encryption-notice">
            <div className="notice-icon">🔐</div>
            <div className="notice-content">
              <strong>FHE Encrypted Voting</strong>
              <p>Your vote value will be encrypted using Fully Homomorphic Encryption</p>
            </div>
          </div>
          
          <div className="form-group">
            <label>Vote Title *</label>
            <input 
              type="text" 
              name="title" 
              value={voteData.title} 
              onChange={handleChange} 
              placeholder="Enter vote title..." 
            />
          </div>
          
          <div className="form-group">
            <label>Description</label>
            <textarea 
              name="description" 
              value={voteData.description} 
              onChange={handleChange} 
              placeholder="Describe what is being voted on..."
              rows={3}
            />
          </div>
          
          <div className="form-group">
            <label>Vote Value (Integer) *</label>
            <input 
              type="number" 
              name="voteValue" 
              value={voteData.voteValue} 
              onChange={handleChange} 
              placeholder="Enter your vote value..." 
              min="0"
              step="1"
            />
            <div className="input-hint">FHE Encrypted Integer Value</div>
          </div>
          
          <div className="form-group">
            <label>Category</label>
            <select name="category" value={voteData.category} onChange={handleChange}>
              <option value="general">General</option>
              <option value="governance">Governance</option>
              <option value="proposal">Proposal</option>
            </select>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !voteData.title || !voteData.voteValue} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting and Creating..." : "Create Encrypted Vote"}
          </button>
        </div>
      </div>
    </div>
  );
};

const VoteDetailModal: React.FC<{
  vote: VoteData;
  onClose: () => void;
  isDecrypting: boolean;
  decryptVote: () => Promise<number | null>;
}> = ({ vote, onClose, isDecrypting, decryptVote }) => {

  return (
    <div className="modal-overlay">
      <div className="vote-detail-modal">
        <div className="modal-header">
          <h2>Vote Details</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="vote-info">
            <div className="info-row">
              <span>Title:</span>
              <strong>{vote.title}</strong>
            </div>
            <div className="info-row">
              <span>Creator:</span>
              <strong>{vote.creator.substring(0, 6)}...{vote.creator.substring(38)}</strong>
            </div>
            <div className="info-row">
              <span>Created:</span>
              <strong>{new Date(vote.timestamp * 1000).toLocaleString()}</strong>
            </div>
            <div className="info-row">
              <span>Status:</span>
              <strong className={vote.isVerified ? "verified" : "encrypted"}>
                {vote.isVerified ? "✅ On-chain Verified" : "🔒 FHE Encrypted"}
              </strong>
            </div>
          </div>
          
          <div className="description-section">
            <h3>Description</h3>
            <p>{vote.description || "No description provided"}</p>
          </div>
          
          <div className="encryption-section">
            <h3>Encrypted Vote Data</h3>
            <div className="data-row">
              <div className="data-label">Vote Value:</div>
              <div className="data-value">
                {vote.isVerified ? 
                  `${vote.decryptedValue} (Verified on-chain)` : 
                  "🔒 FHE Encrypted Integer"
                }
              </div>
            </div>
            
            <div className="fhe-explanation">
              <div className="fhe-badge">FHE 🔐</div>
              <p>This vote is encrypted using Fully Homomorphic Encryption. 
                 The actual value is hidden on-chain and can only be revealed through proper decryption.</p>
            </div>
          </div>
          
          {!vote.isVerified && (
            <div className="decryption-section">
              <button 
                className={`decrypt-btn ${isDecrypting ? "decrypting" : ""}`}
                onClick={decryptVote}
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  <>
                    <div className="decrypt-spinner"></div>
                    Decrypting...
                  </>
                ) : (
                  "🔓 Decrypt Vote"
                )}
              </button>
              <p className="decryption-note">
                This will perform offline decryption and on-chain verification using FHE signatures
              </p>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!vote.isVerified && (
            <button 
              onClick={decryptVote}
              disabled={isDecrypting}
              className="verify-btn"
            >
              {isDecrypting ? "Verifying..." : "Verify on-chain"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;

