
import { useState } from "react";
import { BrowserProvider, Contract, keccak256 } from "ethers";
import { FilePlus2, ShieldCheck, Info, CheckCircle, XCircle, LoaderCircle } from "lucide-react";

import {
  CONTRACT_ADDRESS,
  CONTRACT_ABI,
  LOCAL_CHAIN_ID,
} from "../contracts/contractConfig";

export default function IssueCertificate() {
  const [certificateId, setCertificateId] = useState("");
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  async function handleSubmit(event) {
    event.preventDefault();
    setResult(null);

    if (!file) {
      setResult({
        valid: false,
        message: "Please select the certificate file.",
      });
      return;
    }

    if (!window.ethereum) {
      setResult({
        valid: false,
        message: "MetaMask was not detected.",
      });
      return;
    }

    setLoading(true);

    try {
      const provider = new BrowserProvider(window.ethereum);
      const network = await provider.getNetwork();

      if (`0x${network.chainId.toString(16)}` !== LOCAL_CHAIN_ID) {
        throw new Error(
          "Switch MetaMask to Hardhat Local (Chain ID 31337)."
        );
      }

      const signer = await provider.getSigner();

      // Use the same hash algorithm and raw file bytes as VerifyCertificate.jsx.
      const fileBytes = new Uint8Array(await file.arrayBuffer());
      const certificateHash = keccak256(fileBytes);

      const contract = new Contract(
        CONTRACT_ADDRESS,
        CONTRACT_ABI,
        signer
      );

      // The contract checks issuer authorization and duplicate IDs.
      const tx = await contract.issueCertificate(
        certificateId.trim(),
        certificateHash
      );

      setResult({
        valid: true,
        pending: true,
        message: "Transaction submitted. Waiting for blockchain confirmation...",
      });

      await tx.wait();

      setResult({
        valid: true,
        message: "Certificate issued successfully!",
        hash: certificateHash,
        transactionHash: tx.hash,
      });

      setCertificateId("");
      setFile(null);

      const fileInput = document.getElementById("issue-file");
      if (fileInput) fileInput.value = "";
    } catch (error) {
      setResult({
        valid: false,
        message:
          error?.shortMessage ||
          error?.reason ||
          error?.message ||
          "Issuance failed. Check the wallet and blockchain connection.",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="content-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">INSTITUTION SERVICES</div>
          <h1>Issue Certificate</h1>
          <p>
            Register an academic certificate using an authorized institution wallet.
          </p>
        </div>
      </div>

      <section className="panel form-panel">
        <div className="panel-heading">
          <div className="panel-icon green">
            <FilePlus2 size={21} />
          </div>
          <div>
            <h2>New certificate record</h2>
            <p>Select the original certificate file to register its hash.</p>
          </div>
        </div>

        <form className="form-stack" onSubmit={handleSubmit}>
          <label htmlFor="issue-id">Certificate ID</label>
          <input
            id="issue-id"
            value={certificateId}
            onChange={(event) => setCertificateId(event.target.value)}
            placeholder="e.g. UNI-2026-0001"
            required
          />

          <label htmlFor="issue-file">Certificate file</label>
          <input
            id="issue-file"
            type="file"
            accept=".pdf,.png,.jpg,.jpeg"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setResult(null);
            }}
            required
          />

          <p className="field-hint">
            {file
              ? `Selected: ${file.name}`
              : "Choose the exact file that should later be used for verification."}
          </p>

          <div className="info-note">
            <Info size={17} />
            <span>
              Only a wallet authorized by the super-admin can issue certificates.
              The blockchain enforces this rule.
            </span>
          </div>

          <button
            className="primary-button"
            type="submit"
            disabled={loading}
          >
            {loading ? (
              <>
                <LoaderCircle size={18} />
                Issuing...
              </>
            ) : (
              <>
                <ShieldCheck size={18} />
                Issue certificate
              </>
            )}
          </button>
        </form>

        {result && (
          <div
            className={`verification-result ${
              result.valid ? "verification-success" : "verification-error"
            }`}
            role="status"
          >
            <div className="result-heading">
              {result.valid ? <CheckCircle size={22} /> : <XCircle size={22} />}
              <strong>
                {result.pending
                  ? "Transaction pending"
                  : result.valid
                    ? "Issuance successful"
                    : "Issuance failed"}
              </strong>
            </div>

            <p>{result.message}</p>

            {result.hash && (
              <p className="field-hint">
                Stored certificate hash:
                <br />
                <code>{result.hash}</code>
              </p>
            )}

            {result.transactionHash && (
              <p className="field-hint">
                Transaction hash:
                <br />
                <code>{result.transactionHash}</code>
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
