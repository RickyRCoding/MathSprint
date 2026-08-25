# MathSprint — Minimalist Android App & Database Leaderboard

An ultra-minimalist, distraction-free Android math training application with local & global database leaderboards and 4-letter arcade player tags (e.g. `RITA`).

---

## 📱 Features
- **Ultra-Minimalist Aesthetic**: Monochrome dark theme focused purely on speed, typography, and clean calculation.
- **4-Letter Player Tag**: Changeable player username tag (default: `RITA`) for competitive records.
- **Dual Leaderboards**:
  - **Personal Leaderboard (Default)**: Tracks all your personal session history, accuracy %, speed, dates, and high scores.
  - **Public Leaderboard (Global)**: View global rankings and records.
- **Custom Math Workouts**: Addition, subtraction, multiplication, and division with clean integer outputs and 1–5 digit sliders.
- **Streak & Freeze System**: Daily streak tracker with freeze protection.

---

## ⚡ How to Get the APK (0 MB Disk Space on Your Computer)

You can build the `.apk` in 90 seconds in the cloud using GitHub Actions without downloading gigabytes of Android SDKs to your Mac:

1. Create a private GitHub repository for this folder:
   ```bash
   git init
   git add .
   git commit -m "Initial commit for MathSprint Android App"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/MathSprint.git
   git push -u origin main
   ```
2. On GitHub, go to the **Actions** tab.
3. The workflow **"Build Minimalist Android APK"** will run automatically.
4. Once finished (~1-2 min), click on the run and download **`MathSprint-Minimalist-APK`** containing your `app-debug.apk`.
5. Upload `app-debug.apk` to your Google Drive and install it directly on your Android phone!
