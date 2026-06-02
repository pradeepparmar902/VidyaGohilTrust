# Vidya Gohil Charitable Trust — Backend API

## ⚙️ Setup (5 Minutes)

```bash
# 1. Install dependencies
npm install

# 2. Create your .env file
cp .env.example .env
# Fill in MONGO_URI, JWT_SECRET, RAZORPAY keys, etc.

# 3. Start dev server
npm run dev
# → Server: http://localhost:5000
# → First run auto-seeds admin user and default content
```

---

## 🔐 Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | Admin login → returns JWT token |
| GET  | `/api/auth/me` | Get current admin (requires token) |
| POST | `/api/auth/logout` | Logout |
| POST | `/api/auth/change-password` | Change password |

**Login body:**
```json
{ "email": "admin@vidyagohiltrust.org", "password": "Admin@1234" }
```
**Response:** `{ token: "eyJ..." }` — send as `Authorization: Bearer <token>` header.

---

## 💰 Donations

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/donations/create-order` | ❌ | Create Razorpay order, returns orderId |
| POST | `/api/donations/verify-payment` | ❌ | Verify payment signature, mark Verified, auto-send 80G receipt |
| GET  | `/api/donations` | ✅ | List all (filter: status, program, search, page, limit, startDate, endDate) |
| GET  | `/api/donations/:id` | ✅ | Get single donation |
| PUT  | `/api/donations/:id` | ✅ | Update status/notes |
| POST | `/api/donations/:id/send-receipt` | ✅ | Resend 80G receipt email |
| GET  | `/api/donations/:id/receipt-pdf` | ✅ | Download receipt PDF |
| POST | `/api/donations/manual` | ✅ | Add offline/cash donation |
| DELETE | `/api/donations/:id` | ✅ | Delete donation |

---

## 📅 Events

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET  | `/api/events` | ❌ | List events (filter: status, category, featured) |
| POST | `/api/events/register/:id` | ❌ | Register visitor for event |
| POST | `/api/events` | ✅ | Create event (multipart: image file + fields) |
| PUT  | `/api/events/:id` | ✅ | Update event |
| DELETE | `/api/events/:id` | ✅ | Delete event |

---

## 📋 Programs

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET  | `/api/programs` | ❌ | List active programs |
| POST | `/api/programs` | ✅ | Create program |
| PUT  | `/api/programs/:id` | ✅ | Update program |
| DELETE | `/api/programs/:id` | ✅ | Delete program |
| PUT  | `/api/programs/reorder/bulk` | ✅ | Reorder: `[{id, order}]` |

---

## 🖼️ Gallery

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET  | `/api/gallery` | ❌ | List gallery (filter: category) |
| POST | `/api/gallery` | ✅ | Upload image + create item (multipart) |
| PUT  | `/api/gallery/:id` | ✅ | Update item (optional new image) |
| DELETE | `/api/gallery/:id` | ✅ | Delete + removes from Cloudinary |

---

## 🤝 Volunteers

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/volunteers/apply` | ❌ | Submit volunteer application |
| GET  | `/api/volunteers` | ✅ | List all (filter: status, interest, search) |
| PUT  | `/api/volunteers/:id` | ✅ | Update (approve: set status="Active") |
| DELETE | `/api/volunteers/:id` | ✅ | Delete |

---

## ✏️ Content (Editable Homepage Text)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET  | `/api/content` | ❌ | All content sections |
| GET  | `/api/content/:section` | ❌ | Single section (hero, about, stats) |
| PUT  | `/api/content/:section` | ✅ | Update section (en + gu) |

**Sections:** `hero` · `about` · `stats`

---

## ⚙️ Settings

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET  | `/api/settings` | ✅ | All settings grouped |
| PUT  | `/api/settings` | ✅ | Update group: `{ group: "trust", data: { key: val } }` |

**Groups:** `trust` · `razorpay` · `email` · `seo` · `social`

---

## 📊 Dashboard

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET  | `/api/dashboard/summary` | ✅ | Total donations, volunteers, events, monthly trend |

---

## 💳 Razorpay Integration Flow

```
Frontend                          Backend                         Razorpay
   |                                 |                               |
   |-- POST /create-order ---------> |                               |
   |                                 |-- Create Order -------------> |
   |                                 |<-- { orderId, amount } ------- |
   |<-- { orderId, keyId } --------- |                               |
   |                                 |                               |
   |-- Open Razorpay Checkout ---------------------------------->   |
   |<-- { paymentId, signature } <--------------------------------- |
   |                                 |                               |
   |-- POST /verify-payment -------> |                               |
   |                                 |-- Verify signature            |
   |                                 |-- Mark Verified               |
   |                                 |-- Generate PDF receipt        |
   |                                 |-- Send email                  |
   |<-- { success: true } ---------- |                               |
```

---

## 🚀 Deployment

### Render / Railway
1. Push code to GitHub
2. Connect repo → set environment variables
3. Build command: `npm install`  Start command: `npm start`

### Vercel (serverless — not recommended for this backend)
Use Render or Railway instead for persistent MongoDB connections.

### Environment Variables Required
```
MONGO_URI, JWT_SECRET, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET,
CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET,
SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS,
ADMIN_EMAIL, ADMIN_PASSWORD, CLIENT_URL
```
