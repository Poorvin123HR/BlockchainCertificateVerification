
import { useState } from "react";
import {
  BrowserProvider,
  Contract,
} from "ethers";

import {
  FileX2,
  AlertTriangle,
  ShieldCheck,
  Search,
  Wallet,
  CheckCircle2,
  LoaderCircle,
} from "lucide-react";

import {
  CONTRACT_ADDRESS,
  CONTRACT_ABI,
  LOCAL_CHAIN_ID,
} from "../contracts/contractConfig";

const API_BASE_URL = "http://127.0.0.1:8000/api/v1";

export default function RevokeCertificate() {
  const [certificateId, setCertificateId] = useState("");
  const [certificateDetails, setCertificateDetails] = useState(null);

  const [loading, setLoading] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [transactionHash, setTransactionHash] = useState("");
  const [revoked, setRevoked] = useState(false);

  async function readApiError(response) {
    try {
      const data = await response.json();

      return (
        data.detail ||
        data.message ||
        "The backend request failed."
      );
    } catch {
      return "Could not read the backend response.";
    }
  }

  async function handleLoadCertificate(event) {
    event.preventDefault();

    setError("");
    setMessage("");
    setCertificateDetails(null);
    setTransactionHash("");
    setRevoked(false);

    const id = certificateId.trim();

    if (!id) {
      setError("Please enter a certificate ID.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(
        `${API_BASE_URL}/certificates/${encodeURIComponent(id)}/revocation-details`
      );

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      const data = await response.json();

      setCertificateDetails(data);
      setMessage(
        "Certificate found. Review the details before revoking it."
      );
    } catch (err) {
      setError(
        err.message ||
          "Could not retrieve certificate details. Check the backend."
      );
    } finally {
      setLoading(false);
    }
  }

  async function synchronizeWithBackend(txHash) {
    setSyncing(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/certificates/${encodeURIComponent(
          certificateDetails.certificate_id
        )}/revoke`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            transaction_hash: txHash,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      const data = await response.json();

      setRevoked(true);
      setMessage(data.message || "Certificate revoked successfully.");
    } catch (err) {
      setError(
        `The blockchain transaction was confirmed, but backend synchronization failed: ${err.message}`
      );
    } finally {
      setSyncing(false);
    }
  }

  async function handleRevoke() {
    setError("");
    setMessage("");

    if (!certificateDetails) {
      setError("Load a registered certificate first.");
      return;
    }

    if (!window.ethereum) {
      setError(
        "MetaMask was not detected. Please install or enable MetaMask."
      );
      return;
    }

    setRevoking(true);

    try {
      // Connect to MetaMask.
      const provider = new BrowserProvider(window.ethereum);

      await provider.send("eth_requestAccounts", []);

      // Confirm the selected blockchain network.
      const network = await provider.getNetwork();

      if (network.chainId !== BigInt(LOCAL_CHAIN_ID)) {
        throw new Error(
          "Please switch MetaMask to Hardhat Local (Chain ID 31337)."
        );
      }

      // Get the currently connected wallet.
      const signer = await provider.getSigner();
      const connectedAddress = await signer.getAddress();

      // Only the institution that issued this batch can revoke it.
      if (
        connectedAddress.toLowerCase() !==
        certificateDetails.issuer.toLowerCase()
      ) {
        throw new Error(
          "Wrong wallet connected. Please connect the institution issuer wallet."
        );
      }

      // Connect to the CertificateRegistry smart contract.
      const contract = new Contract(
        CONTRACT_ADDRESS,
        CONTRACT_ABI,
        signer
      );

      setMessage("Please review and approve the transaction in MetaMask.");

      // Submit the individual certificate revocation transaction.
      const transaction = await contract.revokeBatchCertificate(
        certificateDetails.batch_id,
        certificateDetails.certificate_id,
        certificateDetails.certificate_hash,
        certificateDetails.proof
      );

      setTransactionHash(transaction.hash);
      setMessage(
        "Transaction submitted. Waiting for blockchain confirmation..."
      );

      // Wait until the transaction is mined.
      const receipt = await transaction.wait();

      if (!receipt || receipt.status !== 1) {
        throw new Error("The blockchain transaction failed.");
      }

      setMessage(
        "Blockchain confirmed the revocation. Synchronizing with the backend..."
      );

      // Backend independently verifies the transaction before
      // changing the SQLite certificate status.
      await synchronizeWithBackend(transaction.hash);
    } catch (err) {
      setError(
        err.shortMessage ||
          err.reason ||
          err.message ||
          "Certificate revocation failed."
      );
    } finally {
      setRevoking(false);
    }
  }

  async function handleRetrySynchronization() {
    if (!transactionHash || !certificateDetails) {
      return;
    }

    await synchronizeWithBackend(transactionHash);
  }

  return (
    <div className="content-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">INSTITUTION SERVICES</div>
          <h1>Revoke Certificate</h1>
          <p>
            Individually revoke a certificate issued by your institution.
          </p>
        </div>
      </div>

      <section className="panel form-panel">
        <div className="panel-heading">
          <div className="panel-icon orange">
            <FileX2 size={21} />
          </div>

          <div>
            <h2>Certificate revocation</h2>
            <p>
              Enter the certificate ID to retrieve its blockchain details.
            </p>
          </div>
        </div>

        <div className="warning-box">
          <AlertTriangle size={20} />

          <div>
            <strong>Revocation is an important action</strong>
            <p>
              The selected certificate will become invalid.
              Other certificates in the same batch will remain valid.
              This action cannot be undone through the current smart contract.
            </p>
          </div>
        </div>

        <form
          className="form-stack"
          onSubmit={handleLoadCertificate}
        >
          <label htmlFor="revoke-id">Certificate ID</label>

          <input
            id="revoke-id"
            value={certificateId}
            onChange={(event) => setCertificateId(event.target.value)}
            placeholder="e.g. CERT-9C1B1853C69A"
            required
            disabled={revoking || syncing || revoked}
          />

          <button
            className="primary-button"
            type="submit"
            disabled={loading || revoking || syncing || revoked}
          >
            {loading ? (
              <>
                <LoaderCircle size={18} className="spin" />
                Loading certificate...
              </>
            ) : (
              <>
                <Search size={18} />
                Load certificate
              </>
            )}
          </button>
        </form>

        {certificateDetails && (
          <div className="revocation-details">
            <div className="panel-heading">
              <div className="panel-icon">
                <ShieldCheck size={21} />
              </div>

              <div>
                <h2>Certificate details</h2>
                <p>Review the information before proceeding.</p>
              </div>
            </div>

            <div className="info-note">
              <div>
                <strong>Certificate ID</strong>
                <p>{certificateDetails.certificate_id}</p>

                <strong>Batch ID</strong>
                <p>{certificateDetails.batch_id}</p>

                <strong>Institution issuer</strong>
                <p>{certificateDetails.issuer}</p>
              </div>
            </div>

            {!revoked && (
              <button
                className="danger-button"
                type="button"
                onClick={handleRevoke}
                disabled={revoking || syncing}
              >
                {revoking ? (
                  <>
                    <LoaderCircle size={18} className="spin" />
                    Processing revocation...
                  </>
                ) : (
                  <>
                    <Wallet size={18} />
                    Revoke through MetaMask
                  </>
                )}
              </button>
            )}
          </div>
        )}

        {message && (
          <div className="info-note">
            {revoked ? (
              <CheckCircle2 size={19} />
            ) : (
              <ShieldCheck size={19} />
            )}
            <span>{message}</span>
          </div>
        )}

        {error && (
          <div className="warning-box">
            <AlertTriangle size={20} />
            <div>
              <strong>Action requires attention</strong>
              <p>{error}</p>
            </div>
          </div>
        )}

        {transactionHash && (
          <div className="info-note">
            <div>
              <strong>Transaction hash</strong>
              <p style={{ wordBreak: "break-all" }}>
                {transactionHash}
              </p>
            </div>
          </div>
        )}

        {transactionHash && !revoked && !syncing && !revoking && (
          <button
            className="primary-button"
            type="button"
            onClick={handleRetrySynchronization}
          >
            Retry backend synchronization
          </button>
        )}

        <div className="info-note">
          <ShieldCheck size={17} />
          <span>
            Only the institution that originally issued the certificate
            can revoke it. The smart contract enforces this permission.
          </span>
        </div>
      </section>
    </div>
  );
}
