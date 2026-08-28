# MathSprint — Mental Math Practice with Dynamic Scoring & Global Leaderboard

A clean, responsive, modern web application for mental math training featuring **Dynamic Points Per Digit**, **Operation Multipliers**, **Smart Par Speed Bonuses**, **Global Cloud Leaderboard**, and **Cloud Firestore** synchronization — deployed on **Vercel**.

---

## 📂 Project Structure

```
MathSprint/
├── index.html        # Semantic HTML layout (Setup, Gameplay, Summary, Global Leaderboard, Auth, Profile)
├── style.css         # Minimalist physical styling, Google Icons integration, animations, and sliders
├── app.js            # Dynamic difficulty engine, par speed calculator, global leaderboard & cloud sync
├── vercel.json       # Vercel deployment configuration & security headers
└── README.md         # Project documentation & setup instructions
```

---

## 🚀 Deployment (Vercel)

This application is configured for deployment on **Vercel**.

### Deploy with Vercel CLI:
```bash
# Install Vercel CLI (if not already installed)
npm install -g vercel

# Deploy directly
vercel
```

Or connect your GitHub repository to [Vercel Dashboard](https://vercel.com) for automatic CI/CD on every push.

---

## 💻 Local Quick Start

Open [`index.html`](file:///Users/ricardorizk/Desktop/Code/Web%20develoment/MathSprint/index.html) in your browser:
```bash
open "/Users/ricardorizk/Desktop/Code/Web develoment/MathSprint/index.html"
```

---

## ✨ Features & Architecture

### 1. 🏆 Global Leaderboard
- **Public Player Rankings**: Displays all user profiles from Cloud Firestore with ranking medals (`🥇`, `🥈`, `🥉`, `#4`...).
- **Sort by Points (★)**: Ranks players from highest to lowest lifetime points earned.
- **Sort by Streak (🔥)**: Ranks players by current daily streak length.
- **Active User Highlight**: Tags your profile with a sleek `YOU` badge.

### 2. 🧮 Dynamic Points Per Digit & Multipliers
$$\text{Base Points} = \Big( (d_1 + d_2) \times 5 \text{ pts} \Big) \times M_{\text{op}}$$
- ➕ **Addition (`+`)**: `1.0x` Multiplier *(Baseline)*
- ➖ **Subtraction (`−`)**: `1.5x` Multiplier *(Borrowing)*
- ✖️ **Multiplication (`×`)**: `3.0x` Multiplier *(Grid calculation)*
- ➗ **Division (`÷`)**: `5.0x` Multiplier *(Long division)*

### 3. ⚡ Smart Par Speed Multiplier (with Cutoff)
- **Target Par Time**: $T_{\text{par}} = (d_1 + d_2) \times 3\text{s} \times M_{\text{op}}$
- **Beating Target Time ($t < T_{\text{par}}$)**: Scales up to **`1.50x` (+50% bonus points)**.
- **Exceeding Target Time ($t \ge T_{\text{par}}$)**: **`1.00x`** (100% of base points awarded with 0 bonus multiplier).

### 4. 🎯 Ultra-Clean Zero-Distraction Gameplay
- No popups, meters, or distracting badges while solving equations.
- Calculation screen focuses solely on the large crisp equation and numeric input.
