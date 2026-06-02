const router = require("express").Router();
const jwt    = require("jsonwebtoken");
const { Admin } = require("../models");
const { protect } = require("../middleware/auth");

const signToken = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRE });

// POST /api/auth/login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ success: false, message: "Email and password required." });

    const admin = await Admin.findOne({ email }).select("+password");
    if (!admin || !(await admin.matchPassword(password)))
      return res.status(401).json({ success: false, message: "Invalid credentials." });

    admin.lastLogin = new Date();
    await admin.save({ validateBeforeSave: false });

    const token = signToken(admin._id);
    res.json({
      success: true,
      token,
      admin: { id: admin._id, name: admin.name, email: admin.email, role: admin.role },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/auth/me  (protected)
router.get("/me", protect, (req, res) => {
  const { _id, name, email, role, lastLogin } = req.admin;
  res.json({ success: true, admin: { id: _id, name, email, role, lastLogin } });
});

// POST /api/auth/logout
router.post("/logout", protect, (req, res) => {
  res.json({ success: true, message: "Logged out successfully." });
});

// POST /api/auth/change-password  (protected)
router.post("/change-password", protect, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const admin = await Admin.findById(req.admin._id).select("+password");
    if (!(await admin.matchPassword(currentPassword)))
      return res.status(400).json({ success: false, message: "Current password is incorrect." });
    admin.password = newPassword;
    await admin.save();
    res.json({ success: true, message: "Password updated successfully." });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
