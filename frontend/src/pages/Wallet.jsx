
import { useEffect, useState } from "react";
import { Wallet, ShieldCheck, Network, Copy, RefreshCw } from "lucide-react";

const LOCAL_CHAIN_ID = "0x7a69"; // 31337 in hexadecimal

export default function WalletPage() {
  const [account, setAccount] = useState("");
  const [chainId, setChainId] = useState("");
  const [status, setStatus] = useState("Not connected");
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState(false);

  async function readWallet() {
    if (!window.ethereum) {
      setError("MetaMask was not detected. Please install or enable the extension.");
      return;
    }

    try {
      const accounts = await window.ethereum.request({
        method: "eth_accounts",
      });
      const currentChain = await window.ethereum.request({
        method: "eth_chainId",
      });

      setAccount(accounts[0] || "");
      setChainId(currentChain);
      setError("");

      if (accounts.length > 0) {
        setStatus(
          currentChain === LOCAL_CHAIN_ID
            ? "Connected to Hardhat Local"
            : "Connected — select Hardhat Local in MetaMask"
        );
      } else {
        setStatus("Not connected");
      }
    } catch {
      setError("Could not read wallet details. Please try again.");
    }
  }

  async function connectWallet() {
    setError("");

    if (!window.ethereum) {
      setError("MetaMask is not detected. Please install or enable it.");
      return;
    }

    setConnecting(true);

    try {
      const accounts = await window.ethereum.request({
        method: "eth_requestAccounts",
      });

      const currentChain = await window.ethereum.request({
        method: "eth_chainId",
      });

      setAccount(accounts[0] || "");
      setChainId(currentChain);

      if (currentChain !== LOCAL_CHAIN_ID) {
        setStatus("Wallet connected, but the network is incorrect.");
        setError("Open MetaMask and select Hardhat Local, then try again.");
      } else {
        setStatus("Connected to Hardhat Local");
      }
    } catch (err) {
      if (err.code === 4001) {
        setError("You rejected the MetaMask connection request.");
      } else {
        setError(err.message || "Could not connect to MetaMask.");
      }
    } finally {
      setConnecting(false);
    }
  }

  useEffect(() => {
    readWallet();

    if (!window.ethereum) return;

    const handleAccountsChanged = (accounts) => {
      setAccount(accounts[0] || "");
      if (accounts.length === 0) {
        setStatus("Not connected");
      } else {
        readWallet();
      }
    };

    const handleChainChanged = () => {
      readWallet();
    };

    window.ethereum.on("accountsChanged", handleAccountsChanged);
    window.ethereum.on("chainChanged", handleChainChanged);

    return () => {
      window.ethereum.removeListener(
        "accountsChanged",
        handleAccountsChanged
      );
      window.ethereum.removeListener(
        "chainChanged",
        handleChainChanged
      );
    };
  }, []);

  const correctNetwork = chainId === LOCAL_CHAIN_ID;

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <span className="eyebrow">ACCOUNT SETTINGS</span>
          <h1>Wallet &amp; Institution</h1>
          <p>Connect your wallet to access certificate services.</p>
        </div>
      </div>

      <section className="wallet-panel">
        <div className="panel-heading">
          <div className="feature-icon">
            <Wallet size={22} />
          </div>
          <div>
            <h2>MetaMask wallet</h2>
            <p>Manage your blockchain connection.</p>
          </div>
        </div>

        <div className="wallet-info-grid">
          <div>
            <span className="field-label">Connection status</span>
            <strong>{status}</strong>
          </div>

          <div>
            <span className="field-label">Network</span>
            <strong>
              {chainId
                ? correctNetwork
                  ? "Hardhat Local"
                  : `Chain ID: ${parseInt(chainId, 16)}`
                : "Not detected"}
            </strong>
          </div>
        </div>

        <div className="form-stack">
          <span className="field-label">Wallet address</span>

          <div className="wallet-address">
            <span>
              {account
                ? `${account.slice(0, 8)}...${account.slice(-6)}`
                : "No wallet connected"}
            </span>

            {account && (
              <button
                type="button"
                className="secondary-button"
                onClick={() => navigator.clipboard.writeText(account)}
              >
                <Copy size={16} />
                Copy address
              </button>
            )}
          </div>

          <div className="button-row">
            <button
              type="button"
              className="primary-button"
              onClick={connectWallet}
              disabled={connecting}
            >
              <Wallet size={17} />
              {connecting
                ? "Connecting..."
                : account
                  ? "Reconnect wallet"
                  : "Connect MetaMask"}
            </button>

            <button
              type="button"
              className="secondary-button"
              onClick={readWallet}
            >
              <RefreshCw size={16} />
              Refresh
            </button>
          </div>
        </div>

        {error && (
          <div className="warning-box" role="alert">
            {error}
          </div>
        )}

        {account && correctNetwork && !error && (
          <div className="info-note">
            <ShieldCheck size={18} />
            Wallet detected on your local development network.
          </div>
        )}

        {account && !correctNetwork && (
          <div className="warning-box">
            Select Hardhat Local in MetaMask before using the local contract.
          </div>
        )}
      </section>

      <section className="wallet-panel">
        <div className="panel-heading">
          <div className="feature-icon">
            <Network size={22} />
          </div>
          <div>
            <h2>Institution access</h2>
            <p>Certificate permissions are enforced by the smart contract.</p>
          </div>
        </div>

        <div className="info-note">
          Connecting a wallet does not automatically authorize it to issue
          or revoke certificates. The contract checks institution permissions
          separately.
        </div>
      </section>
    </div>
  );
}
