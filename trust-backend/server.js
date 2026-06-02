require("dotenv").config();
const express     = require("express");
const cors        = require("cors");
const helmet      = require("helmet");
const rateLimit   = require("express-rate-limit");
const connectDB   = require("./config/db");
const { Admin }   = require("./models");

// ── Route imports ─────────────────────────────────────────────────────────────
const authRoutes = require("./routes/auth");
const donationRoutes = require("./routes/donations");
const { evRouter, pgRouter, glRouter, vlRouter, stRouter, ctRouter } = require("./routes/all");

const app = express();

// ── Security middleware ───────────────────────────────────────────────────────
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({
  origin: [process.env.CLIENT_URL, "http://localhost:3000", "http://localhost:5173"],
  credentials: true,
}));

// ── Rate limiting ─────────────────────────────────────────────────────────────
app.use("/api/auth",  rateLimit({ windowMs: 15*60*1000, max: 20,  message: { success:false, message:"Too many login attempts. Try again in 15 minutes." } }));
app.use("/api/donations/create-order", rateLimit({ windowMs: 60*1000, max: 10 }));
app.use("/api/",      rateLimit({ windowMs: 60*1000, max: 200 }));

// ── Body parsers ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/api/health", (_, res) =>
  res.json({ success: true, message: "Vidya Gohil Trust API is running 🕉️", env: process.env.NODE_ENV })
);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/api/auth",       authRoutes);
app.use("/api/donations",  donationRoutes);
app.use("/api/events",     evRouter);
app.use("/api/programs",   pgRouter);
app.use("/api/gallery",    glRouter);
app.use("/api/volunteers", vlRouter);
app.use("/api/settings",   stRouter);
app.use("/api/content",    ctRouter);

// ── Analytics summary (admin only) ───────────────────────────────────────────
const { protect } = require("./middleware/auth");
const { Donation, Event, Volunteer, Gallery } = require("./models");

app.get("/api/dashboard/summary", protect, async (req, res) => {
  try {
    const [donations, events, volunteers, gallery, monthly] = await Promise.all([
      Donation.aggregate([
        { $match: { status: "Verified" } },
        { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } },
      ]),
      Event.countDocuments({ status: "Upcoming" }),
      Volunteer.countDocuments({ status: "Active" }),
      Gallery.countDocuments(),
      Donation.aggregate([
        { $match: { status: "Verified", createdAt: { $gte: new Date(new Date().setMonth(new Date().getMonth() - 6)) } } },
        { $group: { _id: { month: { $month: "$createdAt" }, year: { $year: "$createdAt" } }, total: { $sum: "$amount" }, count: { $sum: 1 } } },
        { $sort: { "_id.year": 1, "_id.month": 1 } },
      ]),
    ]);
    res.json({
      success: true,
      summary: {
        totalDonations:  donations[0]?.total || 0,
        donationCount:   donations[0]?.count || 0,
        upcomingEvents:  events,
        activeVolunteers:volunteers,
        galleryItems:    gallery,
        monthlyTrend:    monthly,
      },
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use("*", (req, res) => res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found.` }));

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error("❌ Server Error:", err.stack);
  res.status(err.status || 500).json({ success: false, message: err.message || "Internal server error." });
});

// ── Seed admin & start ────────────────────────────────────────────────────────
const seedAdmin = async () => {
  try {
    const exists = await Admin.findOne({ email: process.env.ADMIN_EMAIL });
    if (!exists) {
      await Admin.create({
        name:     "Super Admin",
        email:    process.env.ADMIN_EMAIL,
        password: process.env.ADMIN_PASSWORD,
        role:     "superadmin",
      });
      console.log(`✅ Admin seeded: ${process.env.ADMIN_EMAIL}`);
    }
  } catch (e) { console.error("Seed error:", e.message); }
};

const seedContent = async () => {
  const { Content, Program } = require("./models");
  const contentExists = await Content.findOne({ section: "hero" });
  if (!contentExists) {
    await Content.insertMany([
      { section: "hero",
        en: { title: "Empowering Lives Through Education & Compassion", subtitle: "For over 20 years, we have been uplifting underprivileged communities." },
        gu: { title: "શિક્ષણ અને કરુણા દ્વારા જીવન સશક્ત", subtitle: "20 વર્ષોથી, અમે સમુદાયોને ઉપર ઉઠાવ્યા છે." }
      },
      { section: "stats",
        en: [{ num:"12,400+", label:"Lives Impacted" },{ num:"₹2.8 Cr", label:"Funds Raised" },{ num:"340+", label:"Volunteers" },{ num:"28", label:"Active Programs" }],
        gu: [{ num:"12,400+", label:"જીવો પ્રભાવિત" },{ num:"₹2.8 Cr", label:"ભંડોળ એકત્ર" },{ num:"340+", label:"સ્વયંસેવકો" },{ num:"28", label:"સક્રિય કાર્યક્રમો" }]
      },
      { section: "about",
        en: { heading: "Rooted in Compassion, Driven by Purpose", body1: "The Vidya Gohil Charitable Trust was founded in 2004 by Vidyaben Gohil...", body2: "Our work spans education, healthcare, women's empowerment, environmental conservation, and disaster relief." },
        gu: { heading: "કરુણામાં મૂળ, ઉદ્દેશ્ય દ્વારા ચાલિત", body1: "...", body2: "..." }
      },
    ]);
    console.log("✅ Default content seeded");
  }
  const programsExist = await Program.findOne();
  if (!programsExist) {
    await Program.insertMany([
      { icon:"📚", title:"Education for All",   subtitle:"Scholarships & learning centers for underprivileged children", color:"#FFF4EC", borderColor:"#FDDBB8", order:1 },
      { icon:"🏥", title:"Health & Wellness",    subtitle:"Free medical camps, medicines & health awareness drives",       color:"#E8F4F8", borderColor:"#B8D8E8", order:2 },
      { icon:"🌾", title:"Livelihood Support",   subtitle:"Skill development & micro-finance for rural communities",       color:"#EDFAF1", borderColor:"#B8E8CC", order:3 },
      { icon:"👩‍👧", title:"Women Empowerment",  subtitle:"Self-help groups, vocational training & legal aid",            color:"#F9F0FF", borderColor:"#D8B8E8", order:4 },
      { icon:"🌊", title:"Disaster Relief",      subtitle:"Rapid response support for flood & earthquake victims",        color:"#FEF9EC", borderColor:"#F5E8B8", order:5 },
      { icon:"🌱", title:"Environment",          subtitle:"Tree plantation drives & clean water initiatives",             color:"#EDFAF1", borderColor:"#B8E8CC", order:6 },
    ]);
    console.log("✅ Default programs seeded");
  }
};

connectDB().then(async () => {
  await seedAdmin();
  await seedContent();
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () =>
    console.log(`\n🚀 Server running on http://localhost:${PORT}\n📋 API Docs: http://localhost:${PORT}/api/health\n`)
  );
});
