// ─────────────────────────────────────────────────────────────────────────────
//  routes/events.js
// ─────────────────────────────────────────────────────────────────────────────
const evRouter = require("express").Router();
const { Event } = require("../models");
const { protect } = require("../middleware/auth");
const { uploadEvent } = require("../middleware/upload");

// GET /api/events  (public)
evRouter.get("/", async (req, res) => {
  try {
    const { status, category, featured } = req.query;
    const filter = {};
    if (status)   filter.status   = status;
    if (category) filter.category = category;
    if (featured) filter.featured = true;
    const events = await Event.find(filter).sort({ date: 1 });
    res.json({ success: true, count: events.length, events });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// POST /api/events/register/:id  (public - visitor registers for event)
evRouter.post("/register/:id", async (req, res) => {
  try {
    const { name, email, phone } = req.body;
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ success: false, message: "Event not found." });
    if (event.maxAttendees && event.registrations.length >= event.maxAttendees)
      return res.status(400).json({ success: false, message: "Event is fully booked." });
    event.registrations.push({ name, email, phone });
    await event.save();
    res.json({ success: true, message: "Registered successfully!" });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
});

// ── Admin CRUD ────────────────────────────────────────────────────────────────
evRouter.post("/", protect, uploadEvent, async (req, res) => {
  try {
    const data = { ...req.body };
    if (req.file) { data.image = req.file.path; data.imagePublicId = req.file.filename; }
    const event = await Event.create(data);
    res.status(201).json({ success: true, event });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
});

evRouter.put("/:id", protect, uploadEvent, async (req, res) => {
  try {
    const data = { ...req.body };
    if (req.file) { data.image = req.file.path; data.imagePublicId = req.file.filename; }
    const event = await Event.findByIdAndUpdate(req.params.id, data, { new: true, runValidators: true });
    if (!event) return res.status(404).json({ success: false, message: "Event not found." });
    res.json({ success: true, event });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
});

evRouter.delete("/:id", protect, async (req, res) => {
  try {
    await Event.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Event deleted." });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
//  routes/programs.js
// ─────────────────────────────────────────────────────────────────────────────
const pgRouter = require("express").Router();
const { Program } = require("../models");

pgRouter.get("/", async (req, res) => {
  try {
    const programs = await Program.find({ active: true }).sort({ order: 1 });
    res.json({ success: true, programs });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

pgRouter.post("/", protect, async (req, res) => {
  try {
    const program = await Program.create(req.body);
    res.status(201).json({ success: true, program });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
});

pgRouter.put("/:id", protect, async (req, res) => {
  try {
    const program = await Program.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!program) return res.status(404).json({ success: false, message: "Program not found." });
    res.json({ success: true, program });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
});

pgRouter.delete("/:id", protect, async (req, res) => {
  try {
    await Program.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Program deleted." });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Reorder programs
pgRouter.put("/reorder/bulk", protect, async (req, res) => {
  try {
    // req.body = [{ id, order }, ...]
    await Promise.all(req.body.map(({ id, order }) => Program.findByIdAndUpdate(id, { order })));
    res.json({ success: true, message: "Programs reordered." });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
//  routes/gallery.js
// ─────────────────────────────────────────────────────────────────────────────
const glRouter = require("express").Router();
const { Gallery } = require("../models");
const { uploadGallery, cloudinary } = require("../middleware/upload");

glRouter.get("/", async (req, res) => {
  try {
    const { category } = req.query;
    const filter = category && category !== "All" ? { category } : {};
    const items = await Gallery.find(filter).sort({ order: 1, createdAt: -1 });
    res.json({ success: true, items });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

glRouter.post("/", protect, uploadGallery, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "Image file required." });
    const item = await Gallery.create({
      ...req.body,
      imageUrl: req.file.path,
      publicId: req.file.filename,
    });
    res.status(201).json({ success: true, item });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
});

glRouter.put("/:id", protect, uploadGallery, async (req, res) => {
  try {
    const data = { ...req.body };
    if (req.file) {
      // delete old image from cloudinary
      const old = await Gallery.findById(req.params.id);
      if (old?.publicId) await cloudinary.uploader.destroy(old.publicId);
      data.imageUrl = req.file.path;
      data.publicId = req.file.filename;
    }
    const item = await Gallery.findByIdAndUpdate(req.params.id, data, { new: true });
    res.json({ success: true, item });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
});

glRouter.delete("/:id", protect, async (req, res) => {
  try {
    const item = await Gallery.findById(req.params.id);
    if (item?.publicId) await cloudinary.uploader.destroy(item.publicId);
    await Gallery.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Gallery item deleted." });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
//  routes/volunteers.js
// ─────────────────────────────────────────────────────────────────────────────
const vlRouter = require("express").Router();
const { Volunteer } = require("../models");
const { sendVolunteerWelcome } = require("../utils/mailer");

// Public - submit volunteer application
vlRouter.post("/apply", async (req, res) => {
  try {
    const volunteer = await Volunteer.create(req.body);
    sendVolunteerWelcome(volunteer).catch(console.error); // async, non-blocking
    res.status(201).json({ success: true, message: "Application submitted! We'll contact you soon." });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
});

// Admin routes
vlRouter.get("/", protect, async (req, res) => {
  try {
    const { status, interest, search } = req.query;
    const filter = {};
    if (status)   filter.status   = status;
    if (interest) filter.interest = interest;
    if (search)   filter.$or = [
      { name: { $regex: search, $options: "i" } },
      { email:{ $regex: search, $options: "i" } },
    ];
    const volunteers = await Volunteer.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, count: volunteers.length, volunteers });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

vlRouter.put("/:id", protect, async (req, res) => {
  try {
    const vol = await Volunteer.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!vol) return res.status(404).json({ success: false, message: "Volunteer not found." });
    res.json({ success: true, volunteer: vol });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
});

vlRouter.delete("/:id", protect, async (req, res) => {
  try {
    await Volunteer.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Volunteer deleted." });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
//  routes/settings.js
// ─────────────────────────────────────────────────────────────────────────────
const stRouter = require("express").Router();
const { Settings } = require("../models");

stRouter.get("/", protect, async (req, res) => {
  try {
    const all = await Settings.find();
    // Convert to key-value map grouped by group
    const grouped = all.reduce((acc, s) => {
      if (!acc[s.group]) acc[s.group] = {};
      acc[s.group][s.key] = s.value;
      return acc;
    }, {});
    res.json({ success: true, settings: grouped });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// PUT /api/settings  { group: "trust", data: { trustName: "...", pan: "..." } }
stRouter.put("/", protect, async (req, res) => {
  try {
    const { group, data } = req.body;
    await Promise.all(
      Object.entries(data).map(([key, value]) =>
        Settings.findOneAndUpdate({ key, group }, { key, value, group }, { upsert: true, new: true })
      )
    );
    res.json({ success: true, message: "Settings saved." });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
//  routes/content.js  — editable homepage text (hero, about, stats)
// ─────────────────────────────────────────────────────────────────────────────
const ctRouter = require("express").Router();
const { Content } = require("../models");

// GET all content sections (public)
ctRouter.get("/", async (req, res) => {
  try {
    const sections = await Content.find();
    const map = sections.reduce((a, s) => { a[s.section] = { en: s.en, gu: s.gu }; return a; }, {});
    res.json({ success: true, content: map });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// GET single section (public)
ctRouter.get("/:section", async (req, res) => {
  try {
    const doc = await Content.findOne({ section: req.params.section });
    if (!doc) return res.status(404).json({ success: false, message: "Section not found." });
    res.json({ success: true, content: doc });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// PUT /api/content/:section  (admin)
ctRouter.put("/:section", protect, async (req, res) => {
  try {
    const { en, gu } = req.body;
    const doc = await Content.findOneAndUpdate(
      { section: req.params.section },
      { en, gu, updatedBy: req.admin._id },
      { upsert: true, new: true, runValidators: true }
    );
    res.json({ success: true, content: doc });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
});

module.exports = { evRouter, pgRouter, glRouter, vlRouter, stRouter, ctRouter };
