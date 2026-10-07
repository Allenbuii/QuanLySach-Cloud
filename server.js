require("dotenv").config();

const path = require("path");
const express = require("express");
const mongoose = require("mongoose");
const session = require("express-session");
const { MongoStore } = require("connect-mongo");
const { engine } = require("express-handlebars");

const app = express();
const PORT = 3000;

app.engine(
  "hbs",
  engine({
    extname: ".hbs",
    defaultLayout: "main",
    helpers: {
      formatNumber: value =>
        new Intl.NumberFormat("vi-VN").format(value)
    }
  })
);

app.set("view engine", "hbs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const dbOptions = {
  maxPoolSize: 5,
  minPoolSize: 0,
  maxConnecting: 1,
  serverSelectionTimeoutMS: 10000,
  connectTimeoutMS: 10000
};

const readerDB = mongoose.createConnection(
  process.env.MONGODB_READER_URI,
  dbOptions
);

const writerDB = mongoose.createConnection(
  process.env.MONGODB_WRITER_URI,
  dbOptions
);

readerDB.on("connected", () => {
  console.log("MongoDB READER connected");
});

writerDB.on("connected", () => {
  console.log("MongoDB WRITER connected");
});

readerDB.on("error", err => {
  console.error("READER:", err.message);
});

writerDB.on("error", err => {
  console.error("WRITER:", err.message);
});

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.MONGODB_WRITER_URI,
      collectionName: "sessions",
      mongoOptions: {
        maxPoolSize: 5,
        minPoolSize: 0,
        maxConnecting: 1,
        serverSelectionTimeoutMS: 10000,
        connectTimeoutMS: 10000
      }
    }),
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60
    }
  })
);

const bookSchema = new mongoose.Schema(
  {
    productCode: {
      type: String,
      required: true,
      trim: true
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    price: {
      type: Number,
      required: true,
      min: 0
    },
    vat: {
      type: Number,
      required: true
    },
    finalPrice: {
      type: Number,
      required: true
    }
  },
  { timestamps: true }
);

const ReaderBook = readerDB.model(
  "Book",
  bookSchema,
  "books"
);

const WriterBook = writerDB.model(
  "Book",
  bookSchema,
  "books"
);

const getPrefix = () => process.env.MSSV.slice(-3);

const getVAT = () =>
  Number(process.env.MSSV.slice(-1)) + 4;

app.get("/", async (req, res) => {
  try {
    const books = await ReaderBook
      .find()
      .sort({ createdAt: -1 })
      .lean();

    const message = req.session.message || null;
    req.session.message = null;

    res.render("index", {
      books,
      fullName: process.env.FULL_NAME,
      mssv: process.env.MSSV,
      prefix: getPrefix(),
      vat: getVAT(),
      message
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Lỗi đọc dữ liệu");
  }
});

app.post("/books", async (req, res) => {
  try {
    const { productCode, name, price } = req.body;

    if (!productCode || !name || price === "") {
      req.session.message = "Vui lòng nhập đầy đủ thông tin";
      return res.redirect("/");
    }

    const numericPrice = Number(price);

    if (Number.isNaN(numericPrice) || numericPrice < 0) {
      req.session.message = "Giá không hợp lệ";
      return res.redirect("/");
    }

    if (!productCode.startsWith(getPrefix())) {
      req.session.message =
        `Mã sản phẩm phải bắt đầu bằng ${getPrefix()}`;
      return res.redirect("/");
    }

    const vat = getVAT();

    await WriterBook.create({
      productCode,
      name,
      price: numericPrice,
      vat,
      finalPrice: numericPrice * (1 + vat / 100)
    });

    req.session.message = "Thêm sách thành công";
    res.redirect("/");
  } catch (err) {
    console.error(err);
    req.session.message = "Lỗi khi thêm sách";
    res.redirect("/");
  }
});

app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    mssv: process.env.MSSV,
    vat: getVAT()
  });
});

app.listen(PORT, () => {
  console.log(`Server chạy tại http://localhost:${PORT}`);
});