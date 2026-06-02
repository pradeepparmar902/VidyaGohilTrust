const router   = require("express").Router();
const Razorpay = require("razorpay");
const crypto   = require("crypto");
const { Donation } = require("../models");
const { protect } = require("../middleware/auth");
const { generateReceiptPDF, sendDonationReceipt } = require("../utils/mailer");

const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ── Public: Create Razorpay order ────────────────────────────────────────────
// POST /api/donations/create-order
router.post("/create-order", async (req, res) => {
  try {
    const { amount, program, donorName, email, phone, pan, recurring } = req.body;
    if (!amount || amount < 1)
      return res.status(400).json({ success: false, message: "Invalid donation amount." });

    const order = await razorpay.orders.create({
      amount:   Math.round(amount * 100), // paise
      currency: "INR",
      receipt:  `trust_${Date.now()}`,
      notes:    { donorName, email, program },
    });

    // Create a pending donation record
    const donation = await Donation.create({
      donorName, email, phone, pan, amount, program,
      recurring: !!recurring,
      razorpayOrderId: order.id,
    });

    res.json({
      success: true,
      orderId:   order.id,
      amount:    order.amount,
      currency:  order.currency,
      donationId: donation._id,
      keyId:     process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── Public: Verify payment ───────────────────────────────────────────────────
// POST /api/donations/verify-payment
router.post("/verify-payment", async (req, res) => {
  try {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature, donationId } = req.body;

    const expected = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest("hex");

    if (expected !== razorpaySignature)
      return res.status(400).json({ success: false, message: "Payment verification failed." });

    const donation = await Donation.findByIdAndUpdate(
      donationId,
      { razorpayPaymentId, razorpaySignature, status: "Verified" },
      { new: true, runValidators: true }
    );

    // Generate & send 80G receipt asynchronously
    (async () => {
      try {
        const pdf = await generateReceiptPDF(donation);
        await sendDonationReceipt(donation, pdf);
        await Donation.findByIdAndUpdate(donationId, { receiptSent: true });
      } catch (e) { console.error("Receipt send error:", e.message); }
    })();

    res.json({ success: true, message: "Payment verified. Receipt will be emailed shortly.", donation });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── Public: Event/volunteer registration donation ────────────────────────────
// POST /api/donations/manual  (for cash/cheque entries by admin)
router.post("/manual", protect, async (req, res) => {
  try {
    const donation = await Donation.create({ ...req.body, status: "Verified" });
    res.status(201).json({ success: true, donation });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ── Admin: Get all donations ─────────────────────────────────────────────────
// GET /api/donations?status=Verified&program=Education&page=1&limit=20
router.get("/", protect, async (req, res) => {
  try {
    const { status, program, search, page = 1, limit = 20, startDate, endDate } = req.query;
    const filter = {};
    if (status)  filter.status  = status;
    if (program) filter.program = program;
    if (search)  filter.$or = [
      { donorName: { $regex: search, $options: "i" } },
      { email:     { $regex: search, $options: "i" } },
      { receiptNumber: { $regex: search, $options: "i" } },
    ];
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate)   filter.createdAt.$lte = new Date(endDate);
    }

    const total     = await Donation.countDocuments(filter);
    const donations = await Donation.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    // Summary stats
    const stats = await Donation.aggregate([
      { $match: { status: "Verified" } },
      { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]);

    res.json({ success: true, total, page: Number(page), donations, stats: stats[0] || { total: 0, count: 0 } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/donations/:id
router.get("/:id", protect, async (req, res) => {
  try {
    const donation = await Donation.findById(req.params.id);
    if (!donation) return res.status(404).json({ success: false, message: "Donation not found." });
    res.json({ success: true, donation });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/donations/:id  (admin can update status, notes, etc.)
router.put("/:id", protect, async (req, res) => {
  try {
    const allowed = ["status","notes","pan","eligible80G"];
    const updates = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

    const donation = await Donation.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
    if (!donation) return res.status(404).json({ success: false, message: "Donation not found." });
    res.json({ success: true, donation });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// POST /api/donations/:id/send-receipt  (resend receipt)
router.post("/:id/send-receipt", protect, async (req, res) => {
  try {
    const donation = await Donation.findById(req.params.id);
    if (!donation)          return res.status(404).json({ success: false, message: "Donation not found." });
    if (donation.status !== "Verified") return res.status(400).json({ success: false, message: "Can only send receipt for verified donations." });

    const pdf = await generateReceiptPDF(donation);
    await sendDonationReceipt(donation, pdf);
    await Donation.findByIdAndUpdate(donation._id, { receiptSent: true });

    res.json({ success: true, message: "Receipt sent successfully." });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/donations/:id/receipt-pdf  (download PDF)
router.get("/:id/receipt-pdf", protect, async (req, res) => {
  try {
    const donation = await Donation.findById(req.params.id);
    if (!donation) return res.status(404).json({ success: false, message: "Donation not found." });

    const pdf = await generateReceiptPDF(donation);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="Receipt_${donation.receiptNumber?.replace(/\//g,"_") || donation._id}.pdf"`);
    res.send(pdf);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/donations/:id
router.delete("/:id", protect, async (req, res) => {
  try {
    await Donation.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Donation deleted." });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
