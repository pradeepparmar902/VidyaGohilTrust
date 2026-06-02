const mongoose = require("mongoose");
const bcrypt   = require("bcryptjs");

// ── Admin User ────────────────────────────────────────────────────────────────
const AdminSchema = new mongoose.Schema({
  name:      { type: String, required: true },
  email:     { type: String, required: true, unique: true, lowercase: true },
  password:  { type: String, required: true, minlength: 6, select: false },
  role:      { type: String, enum: ["superadmin", "editor"], default: "editor" },
  avatar:    { type: String },
  lastLogin: { type: Date },
}, { timestamps: true });

AdminSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});
AdminSchema.methods.matchPassword = function (plain) {
  return bcrypt.compare(plain, this.password);
};

// ── Donation ─────────────────────────────────────────────────────────────────
const DonationSchema = new mongoose.Schema({
  donorName:    { type: String, required: true, trim: true },
  email:        { type: String, required: true, lowercase: true },
  phone:        { type: String, required: true },
  pan:          { type: String, uppercase: true },
  amount:       { type: Number, required: true, min: 1 },
  program:      { type: String, default: "General", enum: ["General","Education","Healthcare","Women","Environment","Relief"] },
  recurring:    { type: Boolean, default: false },
  status:       { type: String, enum: ["Pending","Verified","Failed","Refunded"], default: "Pending" },
  // Razorpay
  razorpayOrderId:   { type: String },
  razorpayPaymentId: { type: String },
  razorpaySignature: { type: String },
  // Receipt
  receiptNumber: { type: String, unique: true, sparse: true },
  receiptSent:   { type: Boolean, default: false },
  receiptUrl:    { type: String },
  // 80G
  eligible80G:  { type: Boolean, default: true },
  notes:        { type: String },
}, { timestamps: true });

// Auto-generate receipt number on verification
DonationSchema.pre("save", async function (next) {
  if (this.isModified("status") && this.status === "Verified" && !this.receiptNumber) {
    const count = await mongoose.model("Donation").countDocuments();
    const year  = new Date().getFullYear();
    this.receiptNumber = `VGCT/${year}/${String(count + 1).padStart(5, "0")}`;
  }
  next();
});

// ── Event ─────────────────────────────────────────────────────────────────────
const EventSchema = new mongoose.Schema({
  title:       { type: String, required: true, trim: true },
  description: { type: String },
  date:        { type: Date, required: true },
  endDate:     { type: Date },
  location:    { type: String, required: true },
  category:    { type: String, enum: ["Health","Education","Environment","Empowerment","Relief","Community"], required: true },
  image:       { type: String },
  imagePublicId: { type: String },
  maxAttendees: { type: Number },
  registrations: [{ name: String, email: String, phone: String, registeredAt: { type: Date, default: Date.now } }],
  status:      { type: String, enum: ["Upcoming","Ongoing","Completed","Cancelled"], default: "Upcoming" },
  featured:    { type: Boolean, default: false },
}, { timestamps: true });

// ── Program ──────────────────────────────────────────────────────────────────
const ProgramSchema = new mongoose.Schema({
  icon:        { type: String, required: true },
  title:       { type: String, required: true, trim: true },
  subtitle:    { type: String, required: true },
  description: { type: String },
  color:       { type: String, default: "#FFF4EC" },
  borderColor: { type: String, default: "#FDDBB8" },
  order:       { type: Number, default: 0 },
  active:      { type: Boolean, default: true },
  stats: [{
    label: String,
    value: String,
  }],
}, { timestamps: true });

// ── Gallery ──────────────────────────────────────────────────────────────────
const GallerySchema = new mongoose.Schema({
  title:       { type: String, required: true, trim: true },
  category:    { type: String, required: true, enum: ["Events","Health","Environment","Women","Education","Relief","General"] },
  imageUrl:    { type: String, required: true },
  publicId:    { type: String },
  emoji:       { type: String, default: "🖼️" },
  color:       { type: String, default: "#0D4B5E" },
  featured:    { type: Boolean, default: false },
  order:       { type: Number, default: 0 },
}, { timestamps: true });

// ── Volunteer ─────────────────────────────────────────────────────────────────
const VolunteerSchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true },
  email:       { type: String, required: true, lowercase: true },
  phone:       { type: String, required: true },
  city:        { type: String },
  role:        { type: String },
  interest:    { type: String, enum: ["Education","Healthcare","Field Work","IT & Digital","Fundraising","General"] },
  status:      { type: String, enum: ["Active","Inactive","Pending"], default: "Pending" },
  joinedDate:  { type: Date, default: Date.now },
  eventsCount: { type: Number, default: 0 },
  notes:       { type: String },
}, { timestamps: true });

// ── Settings ─────────────────────────────────────────────────────────────────
const SettingsSchema = new mongoose.Schema({
  key:   { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed },
  group: { type: String, enum: ["trust","razorpay","email","seo","social"], default: "trust" },
  label: { type: String },
}, { timestamps: true });

// ── Content (hero, about, etc.) ───────────────────────────────────────────────
const ContentSchema = new mongoose.Schema({
  section:  { type: String, required: true, unique: true }, // e.g. "hero", "about", "stats"
  en:       { type: mongoose.Schema.Types.Mixed },           // English content
  gu:       { type: mongoose.Schema.Types.Mixed },           // Gujarati content
  updatedBy:{ type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
}, { timestamps: true });

module.exports = {
  Admin:     mongoose.model("Admin",     AdminSchema),
  Donation:  mongoose.model("Donation",  DonationSchema),
  Event:     mongoose.model("Event",     EventSchema),
  Program:   mongoose.model("Program",   ProgramSchema),
  Gallery:   mongoose.model("Gallery",   GallerySchema),
  Volunteer: mongoose.model("Volunteer", VolunteerSchema),
  Settings:  mongoose.model("Settings",  SettingsSchema),
  Content:   mongoose.model("Content",   ContentSchema),
};
