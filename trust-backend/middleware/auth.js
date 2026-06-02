const jwt    = require("jsonwebtoken");
const { Admin } = require("../models");

exports.protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization?.startsWith("Bearer ")) {
    token = req.headers.authorization.split(" ")[1];
  } else if (req.cookies?.token) {
    token = req.cookies.token;
  }

  if (!token) {
    return res.status(401).json({ success: false, message: "Not authorized. Please log in." });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.admin = await Admin.findById(decoded.id);
    if (!req.admin) return res.status(401).json({ success: false, message: "Admin not found." });
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: "Invalid or expired token." });
  }
};

exports.superAdminOnly = (req, res, next) => {
  if (req.admin?.role !== "superadmin") {
    return res.status(403).json({ success: false, message: "Super admin access required." });
  }
  next();
};
