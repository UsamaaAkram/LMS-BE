require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http"); // For Socket.IO support

const app = express();

// Middleware
app.use(express.json());
app.use(cors());

// Database Connection
const connectDB = require("./config/db");
connectDB();

// Auth Routes
app.use("/api/auth", require("./routes/auth"));

// Instructor Routes
app.use("/api/instructor", require("./routes/instructor"));

// Course Routes
app.use("/api/courses", require("./routes/course"));

// Assignment Routes
app.use("/api/assignments", require("./routes/assignment"));

// Quiz Routes
app.use("/api/quizzes", require("./routes/quiz"));

// Ticket Routes
app.use("/api/tickets", require("./routes/ticket"));

// Student Routes
app.use("/api/students", require("./routes/student"));

// CHAT MODULE ROUTES
app.use("/api/chat", require("./routes/chatRoutes"));
app.use("/api/chat", require("./routes/chatUserRoutes"));
app.use("/api/messages", require("./routes/messageRoutes"));
app.use("/api/moderation", require("./routes/muteBlockReportRoutes"));

// Socket.IO Setup
const server = http.createServer(app);
const socketIo = require("socket.io");
const io = socketIo(server, { cors: { origin: "*" } });

//Invoice Routes
app.use("/api/invoices", require("./routes/invoice"));

const { chatSocket, getSocketIdByUserId } = require("./sockets/chatSocket");
chatSocket(io);

app.set("io", io);
app.set("getSocketIdByUserId", getSocketIdByUserId);

// Export both app and server
module.exports = { app, server };
