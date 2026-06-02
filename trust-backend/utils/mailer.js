const nodemailer = require("nodemailer");
const PDFDocument = require("pdfkit");

// ── Mailer ────────────────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

exports.sendDonationReceipt = async (donation, pdfBuffer) => {
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#FDF8F0;border-radius:12px;">
      <div style="text-align:center;padding:20px 0;border-bottom:2px solid #E8650A;">
        <h2 style="color:#0D4B5E;font-size:1.4rem;margin:0;">🕉️ Vidya Gohil Charitable Trust</h2>
        <p style="color:#888;font-size:0.85rem;margin:4px 0;">Serving Humanity, Spreading Light</p>
      </div>
      <div style="padding:24px 0;">
        <p style="color:#1C1C1C;font-size:1rem;">Dear <strong>${donation.donorName}</strong>,</p>
        <p style="color:#4A4A4A;line-height:1.7;">Thank you for your generous donation. Your contribution directly supports our programs and helps transform lives across Gujarat.</p>
        <div style="background:#E8F4F8;border-radius:8px;padding:16px;margin:20px 0;border-left:4px solid #0D4B5E;">
          <table style="width:100%;font-size:0.9rem;">
            <tr><td style="color:#888;padding:4px 0;">Receipt No.</td>   <td style="font-weight:700;text-align:right;color:#0D4B5E;">${donation.receiptNumber}</td></tr>
            <tr><td style="color:#888;padding:4px 0;">Amount</td>        <td style="font-weight:700;text-align:right;color:#E8650A;font-size:1.1rem;">₹${donation.amount.toLocaleString("en-IN")}</td></tr>
            <tr><td style="color:#888;padding:4px 0;">Program</td>       <td style="font-weight:600;text-align:right;">${donation.program}</td></tr>
            <tr><td style="color:#888;padding:4px 0;">Date</td>          <td style="text-align:right;">${new Date(donation.createdAt).toLocaleDateString("en-IN",{day:"2-digit",month:"long",year:"numeric"})}</td></tr>
            ${donation.pan ? `<tr><td style="color:#888;padding:4px 0;">PAN</td><td style="text-align:right;">${donation.pan}</td></tr>` : ""}
          </table>
        </div>
        <p style="color:#4A4A4A;font-size:0.875rem;">This donation is eligible for tax deduction under <strong>Section 80G</strong> of the Income Tax Act. The attached PDF receipt is your official certificate.</p>
      </div>
      <div style="background:#0D4B5E;color:white;padding:16px;border-radius:8px;text-align:center;font-size:0.8rem;">
        <p style="margin:0;">📞 +91 98765 43210 &nbsp;|&nbsp; ✉️ info@vidyagohiltrust.org</p>
        <p style="margin:6px 0 0;opacity:0.7;">Registered under Gujarat Public Trust Act | 80G Certified | FCRA Registered</p>
      </div>
    </div>`;

  await transporter.sendMail({
    from:        process.env.EMAIL_FROM,
    to:          donation.email,
    subject:     `Donation Receipt – ${donation.receiptNumber} | Vidya Gohil Charitable Trust`,
    html,
    attachments: [{
      filename:    `Receipt_${donation.receiptNumber.replace(/\//g, "_")}.pdf`,
      content:     pdfBuffer,
      contentType: "application/pdf",
    }],
  });
};

exports.sendVolunteerWelcome = async (volunteer) => {
  await transporter.sendMail({
    from:    process.env.EMAIL_FROM,
    to:      volunteer.email,
    subject: "Welcome to Vidya Gohil Charitable Trust – Volunteer Application Received",
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
        <h2 style="color:#0D4B5E;">🙏 Thank you, ${volunteer.name}!</h2>
        <p>We've received your volunteer application for the <strong>${volunteer.interest}</strong> team.</p>
        <p>Our coordinator will review your application and contact you within 2–3 working days.</p>
        <p style="color:#888;font-size:0.85rem;">Vidya Gohil Charitable Trust | +91 98765 43210</p>
      </div>`,
  });
};

// ── PDF Receipt Generator ─────────────────────────────────────────────────────
exports.generateReceiptPDF = (donation) => {
  return new Promise((resolve, reject) => {
    const doc    = new PDFDocument({ size: "A4", margin: 50 });
    const chunks = [];

    doc.on("data",  c => chunks.push(c));
    doc.on("end",   () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageW = doc.page.width;
    const margin = 50;

    // Header band
    doc.rect(0, 0, pageW, 120).fill("#0D4B5E");
    doc.fill("white")
      .fontSize(20).font("Helvetica-Bold")
      .text("Vidya Gohil Charitable Trust", margin, 28, { align: "center", width: pageW - margin * 2 });
    doc.fontSize(10).font("Helvetica")
      .text("Serving Humanity, Spreading Light | Estd. 2004", margin, 56, { align: "center", width: pageW - margin * 2 });
    doc.fontSize(9)
      .text("Reg. No: GUJ/CHT/2004/045678 | 80G Cert: CIT(E)/12A/2004/123 | FCRA Registered", margin, 74, { align: "center", width: pageW - margin * 2 });

    // Saffron accent bar
    doc.rect(0, 120, pageW, 8).fill("#E8650A");

    // Receipt heading
    doc.fill("#0D4B5E").fontSize(16).font("Helvetica-Bold")
      .text("DONATION RECEIPT", margin, 148, { align: "center", width: pageW - margin * 2 });

    doc.moveTo(margin, 175).lineTo(pageW - margin, 175).strokeColor("#E8DDD0").stroke();

    // Two-column info
    const col1 = margin, col2 = pageW / 2 + 10, rowH = 22, startY = 188;
    const field = (label, val, x, y) => {
      doc.fill("#888888").fontSize(9).font("Helvetica").text(label, x, y);
      doc.fill("#1C1C1C").fontSize(10).font("Helvetica-Bold").text(val, x, y + 11);
    };

    field("RECEIPT NUMBER",  donation.receiptNumber,                                         col1, startY);
    field("DATE",            new Date(donation.createdAt).toLocaleDateString("en-IN",{day:"2-digit",month:"long",year:"numeric"}), col2, startY);
    field("DONOR NAME",      donation.donorName,                                              col1, startY + rowH * 2);
    field("PAN NUMBER",      donation.pan || "Not Provided",                                  col2, startY + rowH * 2);
    field("EMAIL",           donation.email,                                                  col1, startY + rowH * 4);
    field("PHONE",           donation.phone,                                                  col2, startY + rowH * 4);
    field("PROGRAM",         donation.program,                                                col1, startY + rowH * 6);
    field("PAYMENT MODE",    donation.razorpayPaymentId ? "Online (Razorpay)" : "Manual",    col2, startY + rowH * 6);

    // Amount box
    const amtY = startY + rowH * 9;
    doc.rect(margin, amtY, pageW - margin * 2, 56).fill("#FFF4EC").stroke("#FDDBB8");
    doc.fill("#888888").fontSize(9).font("Helvetica")
      .text("DONATION AMOUNT", margin + 16, amtY + 10);
    doc.fill("#E8650A").fontSize(24).font("Helvetica-Bold")
      .text(`₹${donation.amount.toLocaleString("en-IN")}`, margin + 16, amtY + 22);
    doc.fill("#0D4B5E").fontSize(9).font("Helvetica")
      .text(`Rupees: ${amountInWords(donation.amount)} Only`, pageW / 2, amtY + 28, { width: pageW / 2 - margin });

    // 80G note
    const noteY = amtY + 72;
    doc.rect(margin, noteY, pageW - margin * 2, 44).fill("#E8F4F8").stroke("#B8D8E8");
    doc.fill("#0D4B5E").fontSize(9).font("Helvetica")
      .text("This donation qualifies for income tax deduction under Section 80G of the Income Tax Act, 1961. Please retain this receipt for your tax records.", margin + 12, noteY + 8, { width: pageW - margin * 2 - 24 });

    // Signature area
    const sigY = noteY + 60;
    doc.moveTo(margin, sigY + 30).lineTo(margin + 120, sigY + 30).strokeColor("#1C1C1C").stroke();
    doc.fill("#1C1C1C").fontSize(9).font("Helvetica").text("Authorised Signatory", margin, sigY + 34);
    doc.fill("#888888").fontSize(8).text("Vidya Gohil Charitable Trust", margin, sigY + 46);

    // Footer
    doc.rect(0, doc.page.height - 55, pageW, 55).fill("#0D4B5E");
    doc.fill("white").fontSize(8).font("Helvetica")
      .text("📞 +91 98765 43210  |  ✉️ info@vidyagohiltrust.org  |  12, Gokuldham Society, Ahmedabad – 380 006, Gujarat", margin, doc.page.height - 40, { align: "center", width: pageW - margin * 2 });

    // Razorpay ref
    if (donation.razorpayPaymentId) {
      doc.fill("rgba(255,255,255,0.6)").fontSize(7)
        .text(`Razorpay Payment ID: ${donation.razorpayPaymentId}`, margin, doc.page.height - 25, { align: "center", width: pageW - margin * 2 });
    }

    doc.end();
  });
};

// Simple number-to-words (Indian system, up to crores)
function amountInWords(n) {
  const a = ["","One","Two","Three","Four","Five","Six","Seven","Eight","Nine","Ten","Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen","Seventeen","Eighteen","Nineteen"];
  const b = ["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"];
  const inWords = (num) => {
    if (num < 20)  return a[num];
    if (num < 100) return b[Math.floor(num/10)] + (num%10 ? " "+a[num%10] : "");
    if (num < 1000)return a[Math.floor(num/100)] + " Hundred" + (num%100 ? " "+inWords(num%100) : "");
    if (num < 100000) return inWords(Math.floor(num/1000)) + " Thousand" + (num%1000 ? " "+inWords(num%1000) : "");
    if (num < 10000000) return inWords(Math.floor(num/100000)) + " Lakh" + (num%100000 ? " "+inWords(num%100000) : "");
    return inWords(Math.floor(num/10000000)) + " Crore" + (num%10000000 ? " "+inWords(num%10000000) : "");
  };
  return inWords(Math.floor(n));
}
