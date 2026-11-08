import { useCallback, useEffect, useState } from "react";
import {
  RefreshCw,
  Layers3,
  FileCheck,
  FileText,
  ShieldCheck,
  ShieldAlert,
  Eye,
  X,
  AlertCircle,
  Clock3,
  Wallet,
  ExternalLink,
} from "lucide-react";
import { BrowserProvider, Contract } from "ethers";

import {
  CONTRACT_ADDRESS,
  CONTRACT_ABI,
  LOCAL_CHAIN_ID,
} from "../contracts/contractConfig";

import "./BatchManagement.css";

const API_BASE_URL = "http://127.0.0.1:8000/api/v1";

export default function BatchManagement() {
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [certificates, setCertificates] = useState([]);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState("");

  const [registrationLoading, setRegistrationLoading] = useState(false);
  const [registrationError, setRegistrationError] = useState("");
  const [registrationMessage, setRegistrationMessage] = useState("");
  const [pendingRegistration, setPendingRegistration] = useState(null);

  const fetchBatches = useCallback(async (showRefresh = false) => {
    if (showRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    setError("");

    try {
      const response = await fetch(`${API_BASE_URL}/batches/`);

      if (!response.ok) {
        throw new Error(`Server returned status ${response.status}.`);
      }

      const data = await response.json();

      if (!data.success) {
        throw new Error("Could not retrieve batch information.");
      }

      setBatches(data.batches || []);
    } catch (err) {
      setError(
        err.message ||
          "Unable to connect to the backend. Check that FastAPI is running."
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchBatches();
  }, [fetchBatches]);

  async function openBatchDetails(batchId) {
    setSelectedBatch(null);
    setCertificates([]);
    setDetailsError("");
    setRegistrationError("");
    setRegistrationMessage("");
    setDetailsLoading(true);

    try {
      const [batchResponse, certificateResponse] = await Promise.all([
        fetch(
          `${API_BASE_URL}/batches/${encodeURIComponent(batchId)}`
        ),
        fetch(
          `${API_BASE_URL}/batches/${encodeURIComponent(batchId)}/certificates`
        ),
      ]);

      if (!batchResponse.ok || !certificateResponse.ok) {
        throw new Error("Could not retrieve the selected batch details.");
      }

      const batchData = await batchResponse.json();
      const certificateData = await certificateResponse.json();

      if (!batchData.success || !certificateData.success) {
        throw new Error("The backend returned an unsuccessful response.");
      }

      setSelectedBatch(batchData.batch);
      setCertificates(certificateData.certificates || []);
    } catch (err) {
      setDetailsError(
        err.message || "Unable to load batch details."
      );
    } finally {
      setDetailsLoading(false);
    }
  }

  async function synchronizeRegistration(batchId, transactionHash) {
    const response = await fetch(
      `${API_BASE_URL}/batches/${encodeURIComponent(batchId)}/register`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          transaction_hash: transactionHash,
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.detail || "Backend could not verify the registration transaction."
      );
    }

    if (!data.success) {
      throw new Error("Backend registration synchronization failed.");
    }

    return data;
  }

  async function handleRegisterBatch() {
    if (!selectedBatch) return;

    const batchId = selectedBatch.batch_id;

    setRegistrationLoading(true);
    setRegistrationError("");
    setRegistrationMessage("");

    try {
      let transactionHash =
        pendingRegistration?.batchId === batchId
          ? pendingRegistration.transactionHash
          : null;

      // If a transaction hash is already saved, retry only
      // the backend synchronization. Do not submit another transaction.
      if (!transactionHash) {
        if (!window.ethereum) {
          throw new Error(
            "MetaMask was not detected. Install or enable the MetaMask extension."
          );
        }

        const provider = new BrowserProvider(window.ethereum);

        await provider.send("eth_requestAccounts", []);

        const network = await provider.getNetwork();

        if (
          `0x${network.chainId.toString(16)}`.toLowerCase() !==
          LOCAL_CHAIN_ID.toLowerCase()
        ) {
          throw new Error(
            "Wrong network. Please select Hardhat Local (Chain ID 31337) in MetaMask."
          );
        }

        const signer = await provider.getSigner();
        const connectedAddress = await signer.getAddress();

        if (
          connectedAddress.toLowerCase() !==
          selectedBatch.issuer.toLowerCase()
        ) {
          throw new Error(
            `Wrong wallet connected. Connect the institution wallet: ${selectedBatch.issuer}`
          );
        }

        const contract = new Contract(
          CONTRACT_ADDRESS,
          CONTRACT_ABI,
          signer
        );

        // The new contract requires the number of certificates in the batch.
        const certificateCount = Number(selectedBatch.certificate_count);

        if (!Number.isSafeInteger(certificateCount) || certificateCount <= 0) {
          throw new Error(
            "The batch certificate count is missing or invalid. Refresh the batch details and try again."
          );
        }

        // Submit the batch registration transaction.
        const transaction = await contract.registerBatch(
          selectedBatch.batch_id,
          selectedBatch.merkle_root,
          certificateCount
        );

        transactionHash = transaction.hash;

        // Save the hash immediately so backend synchronization
        // can be retried without submitting another transaction.
        setPendingRegistration({
          batchId,
          transactionHash,
        });

        setRegistrationMessage(
          "Transaction submitted. Waiting for blockchain confirmation..."
        );

        const receipt = await transaction.wait();

        if (!receipt || receipt.status !== 1) {
          throw new Error(
            "The blockchain transaction failed or was reverted."
          );
        }
      }

      // Confirm the transaction with our FastAPI backend.
      setRegistrationMessage(
        "Blockchain transaction confirmed. Synchronizing with the backend..."
      );

      const result = await synchronizeRegistration(
        batchId,
        transactionHash
      );

      setPendingRegistration(null);

      setRegistrationMessage(
        `Success! Batch registered with ${result.certificate_count ?? 5} certificates.`
      );

      // Refresh the batch list and the currently open details.
      await fetchBatches(true);
      await openBatchDetails(batchId);
    } catch (err) {
      setRegistrationError(
        err.message || "Batch registration failed."
      );
    } finally {
      setRegistrationLoading(false);
    }
  }

  const totalBatches = batches.length;

  const registeredBatches = batches.filter(
    (batch) => batch.status === "REGISTERED"
  ).length;

  const revokedBatches = batches.filter(
    (batch) => batch.status === "REVOKED"
  ).length;

  const totalCertificates = batches.reduce(
    (total, batch) => total + (batch.certificate_count || 0),
    0
  );

  function formatDate(dateString) {
    if (!dateString) return "â€”";

    const date = new Date(dateString.replace(" ", "T"));

    if (Number.isNaN(date.getTime())) return dateString;

    return date.toLocaleString();
  }

  function shortenAddress(address) {
    if (!address) return "â€”";

    return `${address.slice(0, 8)}...${address.slice(-6)}`;
  }

  function StatusBadge({ status }) {
    const normalizedStatus = status || "UNKNOWN";

    return (
      <span
        className={`batch-status status-${normalizedStatus.toLowerCase()}`}
      >
        <span className="status-indicator" />
        {normalizedStatus.replaceAll("_", " ")}
      </span>
    );
  }

  const canRegister =
    selectedBatch?.status === "PREPARED" &&
    !selectedBatch?.exists_on_blockchain;

  const canRetrySynchronization =
    pendingRegistration?.batchId === selectedBatch?.batch_id;

  return (
    <div className="batch-page">
      <div className="page-heading batch-page-heading">
        <div>
          <div className="eyebrow">CERTIFICATE OPERATIONS</div>
          <h1>Batch Management</h1>
          <p>
            Monitor blockchain batches and view the certificates registered
            within each batch.
          </p>
        </div>

        <button
          className="secondary-button batch-refresh-button"
          onClick={() => fetchBatches(true)}
          disabled={loading || refreshing}
        >
          <RefreshCw
            size={17}
            className={refreshing ? "spinning" : ""}
          />
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <section className="batch-stats-grid">
        <StatCard
          label="Total batches"
          value={totalBatches}
          icon={Layers3}
          color="blue"
        />

        <StatCard
          label="Registered batches"
          value={registeredBatches}
          icon={ShieldCheck}
          color="green"
        />

        <StatCard
          label="Revoked batches"
          value={revokedBatches}
          icon={ShieldAlert}
          color="orange"
        />

        <StatCard
          label="Total certificates"
          value={totalCertificates}
          icon={FileCheck}
          color="purple"
        />
      </section>

      <section className="panel batch-table-panel">
        <div className="batch-panel-heading">
          <div>
            <div className="batch-panel-title">
              <Layers3 size={19} />
              <h2>All batches</h2>
            </div>
            <p>Batch records synchronized with the blockchain.</p>
          </div>

          <span className="batch-count">
            {totalBatches} {totalBatches === 1 ? "batch" : "batches"}
          </span>
        </div>

        {error && (
          <div className="batch-error">
            <AlertCircle size={19} />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="batch-loading">
            <RefreshCw size={22} className="spinning" />
            <span>Loading batch information...</span>
          </div>
        ) : !error && batches.length === 0 ? (
          <div className="batch-empty">
            <div className="batch-empty-icon">
              <Layers3 size={28} />
            </div>
            <h3>No batches found</h3>
            <p>
              Registered certificate batches will appear here.
            </p>
          </div>
        ) : (
          !error && (
            <div className="batch-table-wrapper">
              <table className="batch-table">
                <thead>
                  <tr>
                    <th>Batch ID</th>
                    <th>Issuer</th>
                    <th>Certificates</th>
                    <th>Created</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>

                <tbody>
                  {batches.map((batch) => (
                    <tr key={batch.batch_id}>
                      <td>
                        <div className="batch-id-cell">
                          <span className="batch-id-icon">
                            <Layers3 size={17} />
                          </span>
                          <strong>{batch.batch_id}</strong>
                        </div>
                      </td>

                      <td>
                        <span
                          className="batch-address"
                          title={batch.issuer}
                        >
                          {shortenAddress(batch.issuer)}
                        </span>
                      </td>

                      <td>
                        <span className="batch-certificate-count">
                          <FileText size={15} />
                          {batch.certificate_count ?? 0}
                        </span>
                      </td>

                      <td>
                        <span className="batch-date">
                          {formatDate(batch.created_at)}
                        </span>
                      </td>

                      <td>
                        <StatusBadge status={batch.status} />
                      </td>

                      <td>
                        <button
                          className="batch-view-button"
                          onClick={() => openBatchDetails(batch.batch_id)}
                        >
                          <Eye size={16} />
                          Details
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </section>

      {detailsLoading && (
        <div className="batch-modal-overlay">
          <div className="batch-modal batch-modal-loading">
            <RefreshCw size={25} className="spinning" />
            <p>Loading batch details...</p>
          </div>
        </div>
      )}

      {detailsError && (
        <div className="batch-modal-overlay">
          <div className="batch-modal batch-error-modal">
            <button
              className="batch-modal-close"
              onClick={() => setDetailsError("")}
              aria-label="Close error"
            >
              <X size={20} />
            </button>

            <AlertCircle size={30} />
            <h2>Unable to load details</h2>
            <p>{detailsError}</p>
            <button
              className="primary-button"
              onClick={() => setDetailsError("")}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {selectedBatch && (
        <div
          className="batch-modal-overlay"
          onClick={() => setSelectedBatch(null)}
        >
          <div
            className="batch-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="batch-modal-header">
              <div>
                <div className="eyebrow">BATCH INFORMATION</div>
                <h2>Batch details</h2>
                <p>{selectedBatch.batch_id}</p>
              </div>

              <button
                className="batch-modal-close"
                onClick={() => setSelectedBatch(null)}
                aria-label="Close details"
              >
                <X size={20} />
              </button>
            </div>

            <div className="batch-detail-grid">
              <DetailItem
                label="Batch status"
                value={<StatusBadge status={selectedBatch.status} />}
              />

              <DetailItem
                label="Certificate count"
                value={selectedBatch.certificate_count ?? 0}
              />

              <DetailItem
                label="Issuer address"
                value={selectedBatch.issuer || "â€”"}
                full
              />

              <DetailItem
                label="Merkle root"
                value={selectedBatch.merkle_root || "â€”"}
                full
              />

              <DetailItem
                label="Transaction hash"
                value={selectedBatch.transaction_hash || "â€”"}
                full
              />

              <DetailItem
                label="Created at"
                value={
                  <span className="batch-detail-date">
                    <Clock3 size={15} />
                    {formatDate(selectedBatch.created_at)}
                  </span>
                }
              />

              <DetailItem
                label="Blockchain record"
                value={
                  selectedBatch.exists_on_blockchain
                    ? "Confirmed"
                    : "Not found"
                }
              />
            </div>

            <div className="batch-certificates-section">
              <div className="batch-certificates-heading">
                <div>
                  <h3>Certificates in this batch</h3>
                  <p>
                    {certificates.length}{" "}
                    {certificates.length === 1
                      ? "certificate"
                      : "certificates"}
                  </p>
                </div>
              </div>

              {certificates.length === 0 ? (
                <div className="batch-no-certificates">
                  No certificates found in this batch.
                </div>
              ) : (
                <div className="batch-certificates-list">
                  {certificates.map((certificate) => (
                    <div
                      className="batch-certificate-item"
                      key={certificate.certificate_id}
                    >
                      <div className="batch-certificate-icon">
                        <FileCheck size={19} />
                      </div>

                      <div className="batch-certificate-info">
                        <strong>{certificate.certificate_id}</strong>
                        <span>{certificate.filename}</span>
                      </div>

                      <StatusBadge status={certificate.status} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {canRegister && (
              <div className="batch-registration-section">
                <div className="batch-registration-info">
                  <Wallet size={20} />
                  <div>
                    <strong>Ready for blockchain registration</strong>
                    <p>
                      Connect the institution wallet in MetaMask to register
                      this batch.
                    </p>
                  </div>
                </div>

                {registrationError && (
                  <div className="batch-error">
                    <AlertCircle size={19} />
                    <span>{registrationError}</span>
                  </div>
                )}

                {registrationMessage && (
                  <div className="batch-registration-message">
                    <ShieldCheck size={18} />
                    <span>{registrationMessage}</span>
                  </div>
                )}

                <button
                  className="primary-button"
                  onClick={handleRegisterBatch}
                  disabled={registrationLoading}
                >
                  {registrationLoading ? (
                    <>
                      <RefreshCw size={17} className="spinning" />
                      Processing...
                    </>
                  ) : canRetrySynchronization ? (
                    <>
                      <RefreshCw size={17} />
                      Retry Backend Synchronization
                    </>
                  ) : (
                    <>
                      <Wallet size={17} />
                      Register on Blockchain
                    </>
                  )}
                </button>

                {canRetrySynchronization && (
                  <p className="batch-registration-hint">
                    A transaction was already submitted for this batch.
                    Retrying will reuse its transaction hash.
                  </p>
                )}
              </div>
            )}

            <div className="batch-modal-footer">
              <span>
                <ShieldCheck size={16} />
                Blockchain status checked by backend
              </span>

              <button
                className="secondary-button"
                onClick={() => setSelectedBatch(null)}
              >
                Close details
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, icon: Icon, color }) {
  return (
    <article className="stat-card batch-stat-card">
      <div className="stat-card-top">
        <span>{label}</span>
        <div className={`stat-icon ${color}`}>
          <Icon size={19} />
        </div>
      </div>

      <strong className="stat-value">{value}</strong>
      <span className="stat-note">Live backend data</span>
    </article>
  );
}

function DetailItem({ label, value, full = false }) {
  return (
    <div className={`batch-detail-item ${full ? "detail-full" : ""}`}>
      <span>{label}</span>
      <div>{value}</div>
    </div>
  );
}
