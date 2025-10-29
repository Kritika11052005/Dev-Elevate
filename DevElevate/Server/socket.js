import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import User from "./model/UserModel.js";

let io;

export const initSocketIO = (server) => {
  io = new Server(server, {
    cors: {
      // ✅ FIXED: Use FRONTEND_URL to match your server.js CORS config
      origin: process.env.FRONTEND_URL || "http://localhost:5173",
      methods: ["GET", "POST"],
      credentials: true,
    },
    // ✅ ADD: Socket.IO path configuration
    path: "/socket.io/",
    // ✅ ADD: Transports configuration for better compatibility
    transports: ["websocket", "polling"],
  });

  // Socket authentication middleware
  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth.token ||
        socket.handshake.headers.authorization?.split(" ")[1];

      if (!token) {
        // Allow connection without auth, but will have limited access
        socket.user = null;
        return next();
      }

      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Get user from token
      const user = await User.findById(decoded.id).select("-password");

      if (!user) {
        return next(new Error("User not found"));
      }

      // Attach user to socket
      socket.user = user;
      next();
    } catch (error) {
      // Still allow connection but without user data
      socket.user = null;
      next();
    }
  });

  io.on("connection", (socket) => {
    // Join contest room for real-time updates
    socket.on("join-contest", (contestId) => {
      const roomName = `contest-${contestId}`;
      socket.join(roomName);
      // Emit join event to room for connected users count
      io.to(roomName).emit("user-joined", {
        count: io.sockets.adapter.rooms.get(roomName)?.size || 1,
      });
    });

    // Leave contest room
    socket.on("leave-contest", (contestId) => {
      const roomName = `contest-${contestId}`;
      socket.leave(roomName);
      // Emit leave event to room for connected users count
      io.to(roomName).emit("user-left", {
        count: io.sockets.adapter.rooms.get(roomName)?.size || 0,
      });
    });

    // Get active participants count
    socket.on("get-active-count", (contestId) => {
      const roomName = `contest-${contestId}`;
      const count = io.sockets.adapter.rooms.get(roomName)?.size || 0;
      socket.emit("active-count", { contestId, count });
    });

    socket.on("disconnect", () => {});
  });
  return io;
};

// Add contest submission notification
export const notifyContestSubmission = (
  contestId,
  userId,
  problemId,
  status
) => {
  try {
    if (!io) {
      return;
    }

    if (typeof io.to !== "function") {
      return;
    }

    io.to(`contest-${contestId}`).emit("submission-update", {
      contestId,
      userId,
      problemId,
      status,
      timestamp: new Date(),
    });
  } catch (error) {}
};

export { io };
