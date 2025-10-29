import VisitingWebsite from "../model/VisitingWebsite.js";
import User from "../model/UserModel.js";
import Feedback from "../model/Feedback.js";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import moment from "moment";
import sendWelcomeEmail, { sendOtpEmail } from "../utils/mailer.js";
import OtpToken from "../model/OtpToken.js";
import generateWelcomeEmail from "../utils/welcomeTemplate.js";
dotenv.config();
import { createNotification } from "./notificationController.js";
export const registerUser = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser)
      return res.status(400).json({ message: "User already exists" });

    if (!password || password.length < 8) {
      return res
        .status(400)
        .json({ message: "Password must be at least 8 characters long" });
    }

    // Hash password for temporary storage
    const hashedPassword = await bcrypt.hash(password, 10);

    // Generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    // Upsert OTP token for this email (one active per email)
    await OtpToken.findOneAndUpdate(
      { email },
      { email, name, role, passwordHash: hashedPassword, otpHash, expiresAt },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // Send OTP email
    await sendOtpEmail(email, otp, 5);

    return res.status(200).json({
      message: "OTP sent to email. Please verify to complete signup.",
    });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Something went wrong", error: error.message });
  }
};

export const verifySignupOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ message: "Email and OTP are required" });
    }

    const tokenDoc = await OtpToken.findOne({ email });
    if (!tokenDoc) {
      return res
        .status(400)
        .json({ message: "OTP not found. Please re-register." });
    }

    if (new Date() > tokenDoc.expiresAt) {
      await OtpToken.deleteOne({ _id: tokenDoc._id });
      return res
        .status(400)
        .json({ message: "OTP expired. Please request a new one." });
    }

    const otpMatch = await bcrypt.compare(otp, tokenDoc.otpHash);
    if (!otpMatch) {
      return res
        .status(400)
        .json({ message: "Invalid OTP. Please try again." });
    }

    // Create the user
    const existingUser = await User.findOne({ email: tokenDoc.email });
    if (existingUser) {
      await OtpToken.deleteOne({ _id: tokenDoc._id });
      return res.status(400).json({ message: "User already exists" });
    }

    const newUser = new User({
      name: tokenDoc.name,
      email: tokenDoc.email,
      role: tokenDoc.role,
      password: tokenDoc.passwordHash,
    });

    await newUser.save();

    // Cleanup OTP doc
    await OtpToken.deleteOne({ _id: tokenDoc._id });

    // Send welcome email (non-blocking if fails)
    try {
      const html = generateWelcomeEmail(newUser.name);
      await sendWelcomeEmail(newUser.email, html);
    } catch (emailError) {
      console.error("⚠️ Welcome email failed:", emailError.message);
    }

    // Create notification for registration success
    await createNotification(
      newUser._id,
      "Welcome! Your account has been created.",
      "success"
    );

    // Auto-login: issue JWT and set cookie
    const JWT_SECRET = process.env.JWT_SECRET;
    const JWT_EXPIRES = "3d";
    const payLode = { userId: newUser._id };
    const token = jwt.sign(payLode, JWT_SECRET, { expiresIn: JWT_EXPIRES });

    res.cookie("token", token, {
      httpOnly: true,
      secure: true,
      sameSite: "None",
      maxAge: 3 * 24 * 60 * 60 * 1000,
    });

    return res.status(201).json({
      message: "User registered successfully",
      userId: newUser._id,
      token: token,
      user: {
        id: newUser._id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
      },
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Something went wrong", error: error.message });
  }
};
// Replace your loginUser function in userAuthController.js with this

export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

  
    
    // Check for hidden characters
    if (password) {
      console.log('Password chars:');
      for (let i = 0; i < password.length; i++) {
        console.log(`  [${i}]: '${password[i]}' (code: ${password.charCodeAt(i)})`);
      }
    }

    const user = await User.findOne({ email });
    if (!user) {
      console.log('❌ User not found for email:', email);
      return res.status(404).json({ message: "User not found" });
    }

   

    
    const isMatch = await bcrypt.compare(password, user.password);
    
    console.log('✅ bcrypt.compare result:', isMatch);

    if (!isMatch) {
      console.log('❌ Password mismatch - authentication failed');
      
      // Extra debug: try comparing with the test hash from your quickHash.js
      const testHash = '$2b$10$fZirYv9iJS92OaUnI6vC2evpDUpIBP6Le49W2GRKqtFFTVZ3w/wpS';
      const testMatch = await bcrypt.compare(password, testHash);
      console.log('🧪 Test against known hash:', testMatch);
      
      return res.status(401).json({ message: "Invalid credentials" });
    }

    console.log('✅ Password match successful - proceeding with login');

    const JWT_SECRET = process.env.JWT_SECRET;
    const JWT_EXPIRES = "3d";
    
    // Create JWT token
    const payLode = {
      userId: user._id,
    };
    const token = jwt.sign(payLode, JWT_SECRET, { expiresIn: JWT_EXPIRES });

    // Set token in cookie
    res.cookie("token", token, {
      httpOnly: true,
      secure: true,
      sameSite: "None",
      maxAge: 3 * 24 * 60 * 60 * 1000,
    });

    // Create notification for login success
    await createNotification(
      user._id,
      "Login successful! Welcome back.",
      "success"
    );

    console.log('✅ Login completed successfully');
    console.log('=== END LOGIN ATTEMPT ===\n');

    res.status(200).json({
      message: "Login successful",
      userId: user._id,
      token: token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error('🔥 LOGIN ERROR:', error);
    console.error('Error stack:', error.stack);
    res
      .status(500)
      .json({ message: "Something went wrong", error: error.message });
  }
};
/*export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch)
      return res.status(401).json({ message: "Invalid credentials" });
    const JWT_SECRET = process.env.JWT_SECRET;
    const JWT_EXPIRES = "3d";
    // Create JWT token
    const payLode = {
      userId: user._id,
    };
    const token = jwt.sign(payLode, JWT_SECRET, { expiresIn: JWT_EXPIRES });

    // Set token in cookie
    res.cookie("token", token, {
      httpOnly: true,
      secure: true,
      sameSite: "None", // ✅ Needed for cross-origin cookies (Vercel ↔ Render)
      maxAge: 3 * 24 * 60 * 60 * 1000,
    });

    // Create notification for login success
    await createNotification(
      user._id,
      "Login successful! Welcome back.",
      "success"
    );

    res.status(200).json({
      message: "Login successful",
      userId: user._id,
      token: token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Something went wrong", error: error.message });
  }
};*/

//  googleUser function 


export const googleUser = async (req, res) => {
  try {
    const { name, email, role } = req.body;

    console.log("\n=== GOOGLE LOGIN DEBUG ===");
    console.log("Request data:", { name, email, role });

    // ✅ Check if user already exists
    let user = await User.findOne({ email });

    if (user) {
      console.log("✅ Existing user found:", user.name, "- ID:", user._id);
      console.log("   Current role:", user.role);
      
      // ✅ CRITICAL FIX: Don't change existing user's role
      // Only update name if it's different (e.g., user changed their Google name)
      if (user.name !== name) {
        console.log("   Updating name from", user.name, "to", name);
        user.name = name;
        await user.save();
      }
      
      // ✅ Check if this user should NOT be admin
      // Only officialdevelevate@gmail.com should be admin
      if (user.role === "admin" && email !== "officialdevelevate@gmail.com") {
        console.log("⚠️  WARNING: Regular user has admin role, fixing...");
        user.role = "user";
        await user.save();
        console.log("✅ Role updated to 'user'");
      }
      
    } else {
      console.log("📝 Creating new user...");
      
      // ✅ CRITICAL: Always create new users with 'user' role
      // Only make admin if email is officialdevelevate@gmail.com
      const userRole = email === "officialdevelevate@gmail.com" ? "admin" : "user";
      
      user = new User({
        name,
        email,
        role: userRole, // ✅ Use determined role, not from request
        password: "google-oauth-" + Math.random().toString(36).substring(7), // Random password
        bio: "",
        socialLinks: {
          github: "",
          linkedin: "",
          twitter: "",
        },
      });

      await user.save();
      
      console.log("✅ New user created:");
      console.log("   ID:", user._id);
      console.log("   Name:", user.name);
      console.log("   Email:", user.email);
      console.log("   Role:", user.role);

      // Create welcome notification
      try {
        await createNotification(
          user._id,
          "Welcome to DevElevate! Your account has been created successfully.",
          "success"
        );
      } catch (notifError) {
        console.error("Notification creation failed:", notifError.message);
      }
    }

    // ✅ Generate JWT token with user ID
    const JWT_SECRET = process.env.JWT_SECRET;
    const JWT_EXPIRES = "3d";
    
    // Include multiple ID formats for compatibility
    const payload = { 
      userId: user._id,
      id: user._id,
      _id: user._id,
      email: user.email,
      role: user.role 
    };
    
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });

    console.log("✅ JWT token generated");
    console.log("   Token payload:", payload);

    // Set cookie
    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "None" : "Lax",
      maxAge: 3 * 24 * 60 * 60 * 1000, // 3 days
    });

    console.log("✅ Google login successful for:", user.name);
    console.log("=== END GOOGLE LOGIN ===\n");

    // Return user data
    return res.status(200).json({
      success: true,
      message: "Google login successful",
      userId: user._id,
      token: token,
      user: {
        id: user._id,
        _id: user._id, // Include both formats
        name: user.name,
        email: user.email,
        role: user.role,
        bio: user.bio || "",
        socialLinks: user.socialLinks || {},
        createdAt: user.createdAt,
      },
    });
    
  } catch (error) {
    console.error("❌ Google login error:", error);
    console.error("Stack trace:", error.stack);
    
    return res.status(500).json({
      success: false,
      message: "Something went wrong",
      error: error.message
    });
  }
};

export const logout = async (req, res) => {
  try {
    const token = req.cookies.token;

    if (!token) {
      return res.status(401).json({ message: "User already logout" });
    }

    res.clearCookie("token", {
      httpOnly: true,
      secure: true,
      sameSite: "None",
    });

    return res.status(200).json({
      message: "Logout successful",
    });
  } catch (error) {
    return res.status(500).json({
      message: "Something went wrong",
      error: error.message,
    });
  }
};

export const currentStreak = async (req, res) => {
  try {
    
    const userId = req.user._id.toString();
    

    const user = await User.findById(userId).populate("dayStreak");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const today = moment().startOf("day");
    const alreadyVisited = user.dayStreak.some((visit) =>
      moment(visit.dateOfVisiting).isSame(today, "day")
    );

    if (!alreadyVisited) {
      const visit = await VisitingWebsite.create({
        user: userId,
        dateOfVisiting: Date.now(),
        visit: true,
      });

      user.dayStreak.push(visit);
    }

    const sortedVisits = user.dayStreak
      .map((v) => moment(v.dateOfVisiting).startOf("day"))
      .sort((a, b) => a.valueOf() - b.valueOf());

    let currentStreakCount = 0;
    let longestStreakCount = 0;

    if (sortedVisits.length > 0) {
      const lastVisit = sortedVisits[sortedVisits.length - 1];
      const daysSinceLastVisit = today.diff(lastVisit, "days");

      if (daysSinceLastVisit <= 1) {
        currentStreakCount = 1;
        for (let i = sortedVisits.length - 2; i >= 0; i--) {
          const diff = sortedVisits[i + 1].diff(sortedVisits[i], "days");
          if (diff === 1) {
            currentStreakCount++;
          } else if (diff > 1) {
            break;
          }
        }
      } else {
        currentStreakCount = 0;
      }

      longestStreakCount = 1;
      let runningStreak = 1;
      for (let i = 1; i < sortedVisits.length; i++) {
        const diff = sortedVisits[i].diff(sortedVisits[i - 1], "days");
        if (diff === 1) {
          runningStreak++;
        } else if (diff > 1) {
          if (runningStreak > longestStreakCount) {
            longestStreakCount = runningStreak;
          }
          runningStreak = 1;
        }
      }
      if (runningStreak > longestStreakCount) {
        longestStreakCount = runningStreak;
      }
    }

    user.currentStreak = currentStreakCount;
    user.longestStreak = Math.max(user.longestStreak || 0, longestStreakCount);
    await user.save();

    return res.status(200).json({
      message: `✅ Welcome back, ${user.name}`,
      currentStreakData: {
        currentStreak: user.currentStreak,
        longestStreak: user.longestStreak,
        totalDays: user.dayStreak.length,
        dayStreak: user.dayStreak,
      },
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

export const feedback = async (req, res) => {
  try {
    const { message } = req.body;
    const { userId } = req.user;

    const newFeedback = await Feedback.create({
      message: message,
      userId: userId,
    });

    return res.status(200).json({
      newFeedback,
    });
  } catch (error) {
    console.error(error.message);
  }
};

// latestNewsController.js
export const latestNews = async (req, res) => {
  try {
    const apiKey = "5197b7b314d04c1080a2092f0496c165"; // You can move this to process.env later
    const url = `https://newsapi.org/v2/top-headlines?sources=bbc-news&pageSize=9&apiKey=${apiKey}`;

    const response = await fetch(url);

    // Check if the response status is not OK (e.g., 401, 403, 404)
    if (!response.ok) {
      const errorText = await response.text(); // Get raw error response
      console.error("News API error:", errorText);
      return res.status(response.status).json({
        message: "Failed to fetch news",
        status: response.status,
        error: errorText,
      });
    }

    // Check if content-type is actually JSON
    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
      const rawText = await response.text();
      console.error("Unexpected response (not JSON):", rawText);
      return res.status(500).json({ message: "Invalid content type received" });
    }

    const data = await response.json();

    res.json(data);
  } catch (error) {
    console.error("Error fetching latest news:", error);
    res
      .status(500)
      .json({ message: "Internal Server Error", error: error.message });
  }
};

export const updateProfile = async (req, res) => {
  try {
    const { name, bio, socialLinks } = req.body;
    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      { name, bio, socialLinks },
      { new: true }
    ).select("-password -refreshToken");

    res.json(updatedUser);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};

export const getProfile = async (req, res) => {
  try {
    const userId = req.user._id;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const user = await User.findById(userId).select("-password"); // exclude password
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(user);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};


export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user._id;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await User.findByIdAndUpdate(userId, { password: hashedPassword }, { new: true });
    return res.status(200).json({
      message: "Password changed successfully",
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: error.message || "Server error" });
  }
};

