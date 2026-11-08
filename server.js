
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const crypto = require("crypto");
const { promisify } = require("util");
const db = require("./database.js");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const scrypt = promisify(crypto.scrypt);
const SESSION_DAYS = 7;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname)));

const isProduction = process.env.NODE_ENV === "production";

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function getCookie(req, name) {
  const cookies = (req.headers.cookie || "").split(";");

  for (const cookie of cookies) {
    const index = cookie.indexOf("=");
    if (index < 0) continue;

    const key = cookie.slice(0, index).trim();
    const value = cookie.slice(index + 1).trim();

    if (key === name) return decodeURIComponent(value);
  }

  return null;
}

function setSessionCookie(res, token) {
  const parts = [
    `ideasphere_session=${encodeURIComponent(token)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${SESSION_DAYS * 24 * 60 * 60}`
  ];

  if (isProduction) parts.push("Secure");

  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearSessionCookie(res) {
  const parts = [
    "ideasphere_session=",
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=0"
  ];

  if (isProduction) parts.push("Secure");

  res.setHeader("Set-Cookie", parts.join("; "));
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    collegeName: user.college_name,
    department: user.department || "",
    bio: user.bio || ""
  };
}

function requireAuth(req, res, next) {
  const token = getCookie(req, "ideasphere_session");

  if (!token) {
    return res.status(401).json({ message: "Please log in first." });
  }

  const tokenHash = hashToken(token);

  const session = db.prepare(`
    SELECT sessions.user_id, users.id, users.name, users.email,
           users.college_name, users.department, users.bio
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).get(tokenHash, Date.now());

  if (!session) {
    return res.status(401).json({
      message: "Your session has expired. Please log in again."
    });
  }

  req.user = session;
  next();
}

async function createSession(userId, res) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;

  db.prepare(`
    INSERT INTO sessions (token_hash, user_id, expires_at)
    VALUES (?, ?, ?)
  `).run(hashToken(token), userId, expiresAt);

  setSessionCookie(res, token);
}

db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());

// AUTH: REGISTER
app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password, collegeName, department } = req.body;

    if (
      typeof name !== "string" ||
      typeof email !== "string" ||
      typeof password !== "string" ||
      typeof collegeName !== "string" ||
      !name.trim() ||
      !email.trim() ||
      !password ||
      !collegeName.trim()
    ) {
      return res.status(400).json({
        message: "Please fill in all required fields."
      });
    }

    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();
    const cleanCollege = collegeName.trim();
    const cleanDepartment =
      typeof department === "string" ? department.trim() : "";

    if (
      cleanName.length > 100 ||
      cleanEmail.length > 254 ||
      cleanCollege.length > 200 ||
      cleanDepartment.length > 100
    ) {
      return res.status(400).json({
        message: "One or more fields are too long."
      });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({
        message: "Please enter a valid email address."
      });
    }

    if (password.length < 10 || password.length > 128) {
      return res.status(400).json({
        message: "Password must contain 10 to 128 characters."
      });
    }

    const existing = db.prepare(
      "SELECT id FROM users WHERE email = ?"
    ).get(cleanEmail);

    if (existing) {
      return res.status(409).json({
        message: "This email is already registered."
      });
    }

    const salt = crypto.randomBytes(16);
    const derivedKey = await scrypt(password, salt, 64);

    const storedPassword =
      `${salt.toString("hex")}:${derivedKey.toString("hex")}`;

    const result = db.prepare(`
      INSERT INTO users
      (name, email, password, college_name, department)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      cleanName,
      cleanEmail,
      storedPassword,
      cleanCollege,
      cleanDepartment
    );

    const user = db.prepare(
      "SELECT * FROM users WHERE id = ?"
    ).get(Number(result.lastInsertRowid));

    await createSession(user.id, res);

    res.status(201).json({
      message: "Registration successful!",
      user: publicUser(user)
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({
      message: "Unable to register right now."
    });
  }
});

// AUTH: LOGIN
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (
      typeof email !== "string" ||
      typeof password !== "string"
    ) {
      return res.status(400).json({
        message: "Enter your email and password."
      });
    }

    const user = db.prepare(
      "SELECT * FROM users WHERE email = ?"
    ).get(email.trim().toLowerCase());

    if (!user) {
      return res.status(401).json({
        message: "Invalid email or password."
      });
    }

    const parts = user.password.split(":");

    if (parts.length !== 2) {
      return res.status(500).json({
        message: "This account needs a password reset."
      });
    }

    const salt = Buffer.from(parts[0], "hex");
    const savedKey = Buffer.from(parts[1], "hex");
    const enteredKey = await scrypt(password, salt, savedKey.length);

    if (
      savedKey.length !== enteredKey.length ||
      !crypto.timingSafeEqual(savedKey, enteredKey)
    ) {
      return res.status(401).json({
        message: "Invalid email or password."
      });
    }

    await createSession(user.id, res);

    res.json({
      message: "Login successful!",
      user: publicUser(user)
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({
      message: "Unable to log in right now."
    });
  }
});

// AUTH: CURRENT USER
app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

// AUTH: LOGOUT
app.post("/api/auth/logout", (req, res) => {
  const token = getCookie(req, "ideasphere_session");

  if (token) {
    db.prepare(
      "DELETE FROM sessions WHERE token_hash = ?"
    ).run(hashToken(token));
  }

  clearSessionCookie(res);
  res.json({ message: "Logged out successfully." });
});

// Convert a post row into the format used by the frontend.
function getPostById(id) {
  const post = db.prepare(`
    SELECT id, author, department, title, description, category,
           likes_count, created_at
    FROM posts WHERE id = ?
  `).get(id);

  if (!post) return null;

  const comments = db.prepare(`
    SELECT id, author, content AS text,
           created_at AS createdAt
    FROM comments
    WHERE post_id = ?
    ORDER BY id ASC
  `).all(id);

  return {
    id: post.id,
    author: post.author,
    department: post.department || "",
    title: post.title,
    description: post.description,
    category: post.category || "Other",
    likes: post.likes_count,
    comments,
    createdAt: post.created_at
  };
}

function getAllPosts() {
  const ids = db.prepare(
    "SELECT id FROM posts ORDER BY id DESC"
  ).all();

  return ids.map(row => getPostById(row.id));
}

// GET IDEAS
app.get("/api/posts", (req, res) => {
  res.json(getAllPosts());
});

// CREATE IDEA — logged-in students only
app.post("/api/posts", requireAuth, (req, res) => {
  const { title, description, category } = req.body;

  if (
    typeof title !== "string" ||
    typeof description !== "string" ||
    !title.trim() ||
    !description.trim()
  ) {
    return res.status(400).json({
      message: "Please enter a title and description."
    });
  }

  if (title.length > 200 || description.length > 5000) {
    return res.status(400).json({
      message: "Title or description is too long."
    });
  }

  const result = db.prepare(`
    INSERT INTO posts
    (user_id, author, department, title, description, category, likes_count)
    VALUES (?, ?, ?, ?, ?, ?, 0)
  `).run(
    req.user.id,
    req.user.name,
    req.user.department || "",
    title.trim(),
    description.trim(),
    typeof category === "string" && category.trim()
      ? category.trim()
      : "Other"
  );

  const newPost = getPostById(Number(result.lastInsertRowid));

  io.emit("newPost", newPost);
  res.status(201).json(newPost);
});

// LIKE IDEA — logged-in students only
app.post("/api/posts/:id/like", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const post = getPostById(id);

  if (!Number.isInteger(id) || !post) {
    return res.status(404).json({ message: "Idea not found." });
  }

  const alreadyLiked = db.prepare(`
    SELECT id FROM likes WHERE user_id = ? AND post_id = ?
  `).get(req.user.id, id);

  if (alreadyLiked) {
    db.prepare("DELETE FROM likes WHERE id = ?").run(alreadyLiked.id);
    db.prepare(`
      UPDATE posts SET likes_count = MAX(0, likes_count - 1)
      WHERE id = ?
    `).run(id);
  } else {
    db.prepare(`
      INSERT INTO likes (user_id, post_id) VALUES (?, ?)
    `).run(req.user.id, id);

    db.prepare(`
      UPDATE posts SET likes_count = likes_count + 1
      WHERE id = ?
    `).run(id);
  }

  const updatedPost = getPostById(id);

  io.emit("postLiked", {
    id: updatedPost.id,
    likes: updatedPost.likes
  });

  res.json(updatedPost);
});

// ADD COMMENT — logged-in students only
app.post("/api/posts/:id/comments", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const post = getPostById(id);
  const { text } = req.body;

  if (!Number.isInteger(id) || !post) {
    return res.status(404).json({ message: "Idea not found." });
  }

  if (typeof text !== "string" || !text.trim()) {
    return res.status(400).json({
      message: "Please enter a comment."
    });
  }

  if (text.length > 2000) {
    return res.status(400).json({
      message: "Your comment is too long."
    });
  }

  const result = db.prepare(`
    INSERT INTO comments (user_id, post_id, author, content)
    VALUES (?, ?, ?, ?)
  `).run(req.user.id, id, req.user.name, text.trim());

  const comment = db.prepare(`
    SELECT id, author, content AS text,
           created_at AS createdAt
    FROM comments WHERE id = ?
  `).get(Number(result.lastInsertRowid));

  io.emit("newComment", { postId: id, comment });

  res.status(201).json(comment);
});

// SOCKET CONNECTIONS
io.on("connection", socket => {
  console.log("Socket connected:", socket.id);

  socket.on("disconnect", () => {
    console.log("Socket disconnected:", socket.id);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`IdeaSphere is running on port ${PORT}`);
  console.log(`Local address: http://localhost:${PORT}`);
});
