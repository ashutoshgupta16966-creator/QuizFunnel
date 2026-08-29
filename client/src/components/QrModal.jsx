import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

export default function QrModal({ isOpen, onClose }) {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const targetUrl = window.location.origin;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(targetUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content qr-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">📱 Quiz Access QR Code</h3>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close modal">✕</button>
        </div>

        <div className="qr-modal-body">
          <p className="qr-subtitle">
            Scan this QR code with any mobile camera to directly access the Quiz Registration & Entry page!
          </p>

          <div className="qr-code-wrapper" id="printable-qr">
            <QRCodeSVG
              value={targetUrl}
              size={200}
              bgColor="#ffffff"
              fgColor="#0d1b2a"
              level="H"
              includeMargin={true}
            />
            <div className="qr-url-badge">{targetUrl}</div>
          </div>

          <div className="qr-actions">
            <button className="btn btn-secondary btn-sm" onClick={handleCopyLink}>
              {copied ? '✓ Link Copied!' : '📋 Copy Quiz Link'}
            </button>
            <button className="btn btn-primary btn-sm" onClick={handlePrint}>
              🖨️ Print QR Code
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
