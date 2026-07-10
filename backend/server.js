const dns = require("dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]); // Memaksa Node.js menggunakan DNS Google agar terhindar dari pemblokiran provider lokal

const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const cors = require("cors");
const path = require("path");
const jwt = require("jsonwebtoken"); // Tambahan: Pustaka untuk membuat dan memverifikasi Token Pengaman (JWT)
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 5000;

// ==========================================
// KREDENSIAL LOGIN ADMIN (Bisa diatur di .env)
// ==========================================
const ADMIN_USER = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASS = process.env.ADMIN_PASSWORD || "tangen123";
const JWT_SECRET =
  process.env.JWT_SECRET || "kunci_rahasia_laboratorium_kopi_tangan_tengen";

// ==========================================
// 1. MIDDLEWARE
// ==========================================
app.use(cors()); // Mengizinkan HTML frontend mengakses API ini
app.use(express.json()); // Mengizinkan server membaca data berformat JSON
// Membuat folder 'uploads' dapat diakses secara publik lewat URL
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Middleware Pengaman: Memeriksa apakah admin memiliki token resmi yang valid
const verifikasiToken = (req, res, next) => {
  const tokenHeader = req.headers["authorization"];
  if (!tokenHeader) {
    return res
      .status(401)
      .json({ message: "Akses ditolak. Token tidak ditemukan." });
  }

  // Format header: "Bearer <token>"
  const token = tokenHeader.split(" ")[1];
  try {
    const verified = jwt.verify(token, JWT_SECRET);
    req.admin = verified; // Menyimpan data admin yang berhasil didekripsi ke request
    next(); // Lanjut ke proses berikutnya
  } catch (err) {
    res.status(403).json({ message: "Token kadaluarsa atau tidak sah." });
  }
};

// ==========================================
// 2. KONEKSI DATABASE (MongoDB)
// ==========================================
const mongoURI =
  process.env.MONGO_URI || "mongodb://127.0.0.1:27017/tangantengen"; // Menggunakan IP lokal 127.0.0.1 agar lebih stabil
mongoose
  .connect(mongoURI)
  .then(() => console.log("✅ MongoDB Sukses Terhubung..."))
  .catch((err) => console.error("❌ Gagal koneksi ke MongoDB:", err));

// ==========================================
// 3. STRUKTUR DATA / SCHEMA (Mongoose)
// ==========================================
const ProductSchema = new mongoose.Schema(
  {
    nama: { type: String, required: true },
    gambar: { type: String, required: true },
    deskripsi: String,
    kategori: {
      type: String,
      enum: ["Arabika", "Robusta", "Teh", "Other"],
      default: "Arabika",
    },
  },
  { timestamps: true },
);

const Product = mongoose.model("Product", ProductSchema);

// ==========================================
// 4. KONFIGURASI UPLOAD GAMBAR (Multer)
// ==========================================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/"); // File foto akan disimpan di folder ini
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({ storage: storage });

// ==========================================
// 5. API ROUTES (AUTH)
// ==========================================

// [POST] - Proses Login Admin & Pembuatan Token Akses
app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body;

  if (username === ADMIN_USER && password === ADMIN_PASS) {
    // Buat token akses resmi berdurasi 1 hari
    const token = jwt.sign({ username: ADMIN_USER }, JWT_SECRET, {
      expiresIn: "1d",
    });
    return res.json({ token });
  }

  res.status(401).json({ message: "Username atau Password salah!" });
});

// [GET] - Verifikasi Keabsahan Token (Dipakai saat memuat halaman dashboard admin)
app.get("/api/auth/verify", verifikasiToken, (req, res) => {
  res.json({ valid: true, admin: req.admin });
});

// ==========================================
// 6. API ROUTES (PRODUCT CRUD)
// ==========================================

// [GET] - Ambil Semua Produk (Terbuka untuk umum/pembeli di katalog)
app.get("/api/products", async (req, res) => {
  try {
    const products = await Product.find().sort({ createdAt: -1 }); // Urutkan dari yang terbaru
    res.json(products);
  } catch (err) {
    res
      .status(500)
      .json({ message: "Terjadi kesalahan server", error: err.message });
  }
});

// [POST] - Tambah Produk Baru (DIPROTEKSI: Hanya Admin Terverifikasi yang Bisa)
app.post(
  "/api/products",
  verifikasiToken,
  upload.single("gambar"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({ message: "Gambar produk wajib diunggah!" });
      }

      const newProduct = new Product({
        nama: req.body.nama,
        gambar: req.file.filename,
        deskripsi: req.body.deskripsi,
        kategori: req.body.kategori,
      });

      const savedProduct = await newProduct.save();
      console.log("✅ PRODUK SUKSES MASUK MONGODB:", savedProduct);
      res
        .status(201)
        .json({ message: "Produk berhasil ditambahkan", data: savedProduct });
    } catch (err) {
      res
        .status(400)
        .json({ message: "Gagal menambahkan produk", error: err.message });
    }
  },
);

// [PUT] - Edit/Update Produk Berdasarkan ID (DIPROTEKSI: Hanya Admin Terverifikasi yang Bisa)
app.put(
  "/api/products/:id",
  verifikasiToken,
  upload.single("gambar"),
  async (req, res) => {
    try {
      const product = await Product.findById(req.params.id);
      if (!product) {
        return res.status(404).json({ message: "Produk tidak ditemukan" });
      }

      const updateData = {
        nama: req.body.nama || product.nama,
        deskripsi: req.body.deskripsi || product.deskripsi,
        kategori: req.body.kategori || product.kategori,
      };

      // Jika admin mengunggah gambar baru, ganti nama gambarnya
      if (req.file) {
        updateData.gambar = req.file.filename;
      }

      const updatedProduct = await Product.findByIdAndUpdate(
        req.params.id,
        updateData,
        { new: true },
      );
      res.json({ message: "Produk berhasil diperbarui", data: updatedProduct });
    } catch (err) {
      res
        .status(400)
        .json({ message: "Gagal memperbarui produk", error: err.message });
    }
  },
);

// [DELETE] - Hapus Produk Berdasarkan ID (DIPROTEKSI: Hanya Admin Terverifikasi yang Bisa)
app.delete("/api/products/:id", verifikasiToken, async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) {
      return res.status(404).json({ message: "Produk tidak ditemukan" });
    }
    res.json({ message: "Produk berhasil dihapus" });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Gagal menghapus produk", error: err.message });
  }
});

// Jalankan Server
app.listen(PORT, () => {
  console.log(
    `🚀 Server Tangan Tengen Roastery berjalan di http://localhost:${PORT}`,
  );
});
