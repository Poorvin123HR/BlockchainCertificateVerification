
import { useState } from "react";
import {
  FileCheck,
  Search,
  ShieldCheck,
  Info,
  CheckCircle,
  XCircle,
  LoaderCircle,
} from "lucide-react";

const API_BASE_URL = "http://127.0.0.1:8000/api/v1";

export default function VerifyCertificate() {
  const [certificateId, setCertificateId] = useState("");
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  async function handleSubmit(event) {
    event.preventDefault();
    setResult(null);

    if (!file) {
      setResult({
        status: "ERROR",
        message: "Please select the original certificate file.",
      });
      return;
    }

    if (!certificateId.trim()) {
      setResult({
        status: "ERROR",
        message: "Please enter the certificate ID.",
      });
      return;
    }

    setLoading(true);

    try {
      // Send the certificate ID and original PDF to the backend.
      // The backend calculates SHA-256 and verifies the Merkle proof
      // and the certificate's blockchain revocation status.
      const formData = new FormData();
      formData.append("certificate_id", certificateId.trim());
      formData.append("file", file);

      const response = await fetch(
        `${API_BASE_URL}/certificates/verify`,
        {
          method: "POST",
          body: formData,
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.detail ||
            data.message ||
            "The verification request could not be completed."
        );
      }

      setResult({
        status: data.status || (data.verified ? "VALID" : "INVALID"),
        valid: data.verified === true,
        message:
          data.message ||
          (data.verified
            ? "The certificate is valid."
            : "The certificate could not be verified."),
        certificateId: data.certificate_id,
        batchId: data.batch_id,
        hash: data.sha256 || data.calculated_hash,
      });
    } catch (error) {
      setResult({
        status: "ERROR",
        message:
          error.message ||
          "Unable to connect to the backend. Check that FastAPI is running.",
      });
    } finally {
      setLoading(false);
    }
  }

  const isValid = result?.valid === true;
  const isRevoked = result?.status === "REVOKED";

  return (
    <div className="content-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">CERTIFICATE SERVICES</div>
          <h1>Verify Certificate</h1>
          <p>
            Check whether an academic certificate matches its blockchain record.
          </p>
        </div>
      </div>

      <div className="form-layout">
        <section className="panel">
          <div className="panel-heading">
            <div className="panel-icon blue">
              <Search size={21} />
            </div>
            <div>
              <h2>Certificate verification</h2>
              <p>Enter the certificate ID and select the original file.</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="form-stack">
            <label htmlFor="certificate-id">Certificate ID</label>
            <input
              id="certificate-id"
              value={certificateId}
              onChange={(event) => {
                setCertificateId(event.target.value);
                setResult(null);
              }}
              placeholder="e.g. CERT-LOCAL-001"
              required
            />

            <label htmlFor="certificate-file">
              Original certificate file
            </label>
            <input
              id="certificate-file"
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
                : "Select the exact file that was used when the certificate was issued."}
            </p>

            <button
              className="primary-button"
              type="submit"
              disabled={loading}
            >
              {loading ? (
                <>
                  <LoaderCircle size={18} />
                  Verifying...
                </>
              ) : (
                <>
                  <ShieldCheck size={18} />
                  Verify certificate
                </>
              )}
            </button>
          </form>

          {result && (
            <div
              className={`verification-result ${
                isValid
                  ? "verification-success"
                  : "verification-error"
              }`}
              role="status"
            >
              <div className="result-heading">
                {isValid ? (
                  <CheckCircle size={22} />
                ) : (
                  <XCircle size={22} />
                )}

                <strong>
                  {isValid
                    ? "Certificate verified"
                    : isRevoked
                    ? "Certificate revoked"
                    : "Verification failed"}
                </strong>
              </div>

              <p>{result.message}</p>

              {result.status && (
                <p className="field-hint">
                  Status: <strong>{result.status}</strong>
                </p>
              )}

              {result.certificateId && (
                <p className="field-hint">
                  Certificate ID: {result.certificateId}
                </p>
              )}

              {result.batchId && (
                <p className="field-hint">
                  Batch ID: {result.batchId}
                </p>
              )}

              {result.hash && (
                <p className="field-hint">
                  Calculated SHA-256:
                  <br />
                  <code>{result.hash}</code>
                </p>
              )}
            </div>
          )}
        </section>

        <aside className="panel info-panel">
          <div className="info-illustration">
            <FileCheck size={36} />
          </div>

          <h2>How verification works</h2>

          <p>
            The application sends the selected file to the backend.
            The backend calculates its SHA-256 hash and checks its
            Merkle proof against the registered blockchain batch.
          </p>

          <ul className="feature-list">
            <li>Checks the certificate ID</li>
            <li>Compares the original SHA-256 file hash</li>
            <li>Verifies the Merkle proof on the blockchain</li>
            <li>Checks individual and batch revocation status</li>
          </ul>

          <div className="info-note">
            <Info size={17} />
            <span>
              Verification is read-only. It does not create a blockchain
              transaction or require MetaMask.
            </span>
          </div>
        </aside>
      </div>
    </div>
  );
}
