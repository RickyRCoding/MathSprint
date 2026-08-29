/**
 * ==========================================================================
 * MathSprint — Dynamic Difficulty Scoring & Global Cloud Leaderboard
 * ==========================================================================
 */

(() => {
  'use strict';

  // ==========================================================================
  // SECTION 1: ENVIRONMENT CONFIGURATION & PERSISTENT AUTH INITIALIZATION
  // ==========================================================================
  const env = window.__ENV__ || {};
  const firebaseConfig = {
    apiKey: env.FIREBASE_API_KEY || "AIzaSyA5EdA0U6o2RQZJ0uGSOEV96WJXUr-miR8",
    authDomain: env.FIREBASE_AUTH_DOMAIN || "mathsprinting.firebaseapp.com",
    projectId: env.FIREBASE_PROJECT_ID || "mathsprinting",
    storageBucket: env.FIREBASE_STORAGE_BUCKET || "mathsprinting.firebasestorage.app",
    messagingSenderId: env.FIREBASE_MESSAGING_SENDER_ID || "661958692573",
    appId: env.FIREBASE_APP_ID || "1:661958692573:web:98c9ce789d52816b331534",
    measurementId: env.FIREBASE_MEASUREMENT_ID || "G-4KX275KHEX"
  };

  let auth = null;
  let db = null;

  try {
    firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    db = firebase.firestore();
    
    // Explicitly set LOCAL persistence so the user stays permanently logged in on this device
    auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
      .then(() => console.log("Device Authentication Persistence set to LOCAL."))
      .catch((err) => console.warn("Persistence config notice:", err));

    console.log("Firebase Auth & Firestore initialized successfully.");
  } catch (e) {
    console.warn("Firebase initialization notice:", e);
  }

  // Local storage cache keys
  const DB_KEY_SAVED_USER = 'mathsprint_cached_username';

  // Streak Freeze Rules & Pricing
  const MAX_FREEZES = 5;
  const FREEZE_COST = 1500;
  const MAX_SAVED_SESSIONS = 5;

  // Active User State
  let currentUser = null;
  let currentUsername = localStorage.getItem(DB_KEY_SAVED_USER) || 'Guest';

  let userProfile = {
    streakCount: 0,
    lastActiveDate: null,
    streakFreezes: 2,
    points: 0,
    totalWorkouts: 0,
    totalQuestions: 0,
    totalCorrect: 0
  };

  // Leaderboard Sort State ('points' or 'streak')
  let leaderboardSortBy = 'points';

  // ==========================================================================
  // SECTION 2: DYNAMIC DIFFICULTY & SMART PAR SPEED FORMULA ENGINE
  // ==========================================================================

  function getOperationMultiplier(op) {
    const multipliers = { '+': 1.0, '-': 1.5, '*': 3.0, '/': 5.0 };
    return multipliers[op] || 1.0;
  }

  function calculateBasePoints(op, op1Digits, op2Digits) {
    const totalDigits = parseInt(op1Digits, 10) + parseInt(op2Digits, 10);
    const mult = getOperationMultiplier(op);
    return Math.round(totalDigits * 5 * mult);
  }

  function calculateTargetTime(op, op1Digits, op2Digits) {
    const totalDigits = parseInt(op1Digits, 10) + parseInt(op2Digits, 10);
    const mult = getOperationMultiplier(op);
    return Math.round(totalDigits * 3 * mult);
  }

  function calculateSpeedMultiplier(avgSeconds, targetSeconds) {
    if (avgSeconds >= targetSeconds || targetSeconds <= 0) {
      return 1.0; // Cutoff: exceeded target time
    }
    const savedRatio = (targetSeconds - avgSeconds) / targetSeconds;
    const bonus = savedRatio * 0.5; // Up to +50% speed bonus
    return Math.round((1.0 + bonus) * 100) / 100;
  }

  function updateSetupPreview() {}

  // ==========================================================================
  // SECTION 3: AUTHENTICATION & USER MANAGEMENT (OAUTH & EMAIL)
  // ==========================================================================
  
  function sanitizeUsername(name) {
    if (!name) return 'Player';
    const cleaned = name.trim();
    if (cleaned.includes('@')) {
      return cleaned.split('@')[0];
    }
    return cleaned;
  }

  if (auth) {
    auth.onAuthStateChanged(async (user) => {
      currentUser = user;
      const btnOpenAuth = document.getElementById('btnOpenAuthModal');
      const btnOpenProfile = document.getElementById('btnOpenProfileSettings');

      if (user) {
        if (user.displayName) {
          currentUsername = sanitizeUsername(user.displayName);
        } else if (user.email) {
          currentUsername = sanitizeUsername(user.email);
        } else {
          currentUsername = 'Player';
        }
        localStorage.setItem(DB_KEY_SAVED_USER, currentUsername);
        
        if (btnOpenAuth) btnOpenAuth.classList.add('hidden');
        if (btnOpenProfile) btnOpenProfile.classList.remove('hidden');

        await syncUserProfileFromFirestore(user.uid);
        evaluateDailyStreak();
      } else {
        currentUsername = 'Guest';
        localStorage.removeItem(DB_KEY_SAVED_USER);
        if (btnOpenAuth) btnOpenAuth.classList.remove('hidden');
        if (btnOpenProfile) btnOpenProfile.classList.add('hidden');

        loadGuestProfile();
      }

      updateUserDisplayEverywhere();
    });
  }

  function loadGuestProfile() {
    const saved = localStorage.getItem('mathsprint_guest_profile');
    if (saved) {
      userProfile = JSON.parse(saved);
    } else {
      userProfile = {
        streakCount: 0,
        lastActiveDate: null,
        streakFreezes: 2,
        points: 0,
        totalWorkouts: 0,
        totalQuestions: 0,
        totalCorrect: 0
      };
    }
  }

  function saveGuestProfile() {
    localStorage.setItem('mathsprint_guest_profile', JSON.stringify(userProfile));
  }

  function updateFreezeShopUI() {
    const freezeCountEl = document.getElementById('profileFreezeCount');
    const btnBuy = document.getElementById('btnBuyStreakFreeze');
    if (!freezeCountEl || !btnBuy) return;

    freezeCountEl.textContent = `${userProfile.streakFreezes} / ${MAX_FREEZES}`;

    if (userProfile.streakFreezes >= MAX_FREEZES) {
      btnBuy.disabled = true;
      btnBuy.className = 'px-3 py-1 rounded bg-[#141619] border border-[#23272e] text-[#646b79] font-bold text-[11px] cursor-not-allowed';
      btnBuy.innerHTML = '<span>Max Capacity (5/5)</span>';
    } else if (userProfile.points < FREEZE_COST) {
      btnBuy.disabled = true;
      btnBuy.className = 'px-3 py-1 rounded bg-[#141619] border border-[#23272e] text-[#646b79] font-bold text-[11px] cursor-not-allowed';
      btnBuy.innerHTML = `<span>Need ${(FREEZE_COST - userProfile.points).toLocaleString()} ★</span>`;
    } else {
      btnBuy.disabled = false;
      btnBuy.className = 'btn-tactile px-3 py-1 rounded bg-[#1a1d21] border border-[#323742] hover:border-cyan-500/50 text-[#f5f2eb] font-bold text-[11px] flex items-center gap-1 cursor-pointer';
      btnBuy.innerHTML = `<span class="material-symbols-rounded text-cyan-400 text-[14px]">add</span><span>Buy (${FREEZE_COST.toLocaleString()} ★)</span>`;
    }
  }

  function updateUserDisplayEverywhere() {
    const headerUsername = document.getElementById('headerUsername');
    const summaryUsername = document.getElementById('summaryUsername');

    if (headerUsername) headerUsername.textContent = currentUsername;
    if (summaryUsername) summaryUsername.textContent = currentUsername;

    updateHeaderUI();
    updateFreezeShopUI();
  }

  async function signInWithEmail(email, password) {
    if (!auth) return;
    try {
      clearAuthError();
      await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
      const result = await auth.signInWithEmailAndPassword(email, password);
      currentUser = result.user;
      
      if (db) {
        const userDoc = await db.collection("users").doc(result.user.uid).get();
        if (userDoc.exists && userDoc.data().username) {
          currentUsername = userDoc.data().username;
        } else {
          currentUsername = result.user.displayName ? sanitizeUsername(result.user.displayName) : sanitizeUsername(email);
        }
        localStorage.setItem(DB_KEY_SAVED_USER, currentUsername);
      }

      await syncUserProfileFromFirestore(result.user.uid);
      evaluateDailyStreak();

      closeAuthModal();
      updateUserDisplayEverywhere();
      showToast(`Welcome back, ${currentUsername}! 👋`);
    } catch (err) {
      showAuthError(err.message);
    }
  }

  async function signUpWithEmail(username, email, password) {
    if (!auth) return;
    try {
      clearAuthError();
      await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
      const cred = await auth.createUserWithEmailAndPassword(email, password);
      currentUser = cred.user;
      
      const cleanUsername = sanitizeUsername(username) || sanitizeUsername(email);
      currentUsername = cleanUsername;
      localStorage.setItem(DB_KEY_SAVED_USER, currentUsername);

      try {
        await cred.user.updateProfile({
          displayName: cleanUsername
        });
      } catch (e) {}

      if (db) {
        await db.collection("users").doc(cred.user.uid).set({
          uid: cred.user.uid,
          username: cleanUsername,
          email: email,
          streakCount: 0,
          streakFreezes: 2,
          points: 0,
          totalWorkouts: 0,
          totalQuestions: 0,
          totalCorrect: 0,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      }

      await syncUserProfileFromFirestore(cred.user.uid);

      closeAuthModal();
      updateUserDisplayEverywhere();
      showToast(`Account created for ${cleanUsername}! 🎉`);
    } catch (err) {
      showAuthError(err.message);
    }
  }

  async function updateCustomUsername(newName) {
    const cleanName = sanitizeUsername(newName);
    if (!cleanName || cleanName === 'Player') {
      showToast("Please enter a valid username.");
      return;
    }

    currentUsername = cleanName;
    localStorage.setItem(DB_KEY_SAVED_USER, currentUsername);
    updateUserDisplayEverywhere();

    if (currentUser && auth) {
      try {
        await currentUser.updateProfile({ displayName: cleanName });
      } catch (e) {}

      if (db) {
        try {
          await db.collection("users").doc(currentUser.uid).set({
            username: cleanName
          }, { merge: true });
        } catch (e) {}
      }
    }

    closeProfileSettingsModal();
    showToast(`Username updated to ${cleanName}! ✨`);
  }

  async function signOutUser() {
    if (!auth) return;
    try {
      await auth.signOut();
      localStorage.removeItem(DB_KEY_SAVED_USER);
      closeProfileSettingsModal();
      showToast("Signed out.");
      navigateHome();
    } catch (err) {
      console.error("Sign out error:", err);
    }
  }

  // ==========================================================================
  // SECTION 4: USER-SCORED FIRESTORE DATABASE SYNCHRONIZATION
  // ==========================================================================
  
  async function syncUserProfileFromFirestore(uid) {
    if (!db || !uid) return;
    try {
      const docRef = db.collection("users").doc(uid);
      const docSnap = await docRef.get();

      if (docSnap.exists) {
        const data = docSnap.data();
        if (data.username) {
          currentUsername = data.username;
          localStorage.setItem(DB_KEY_SAVED_USER, currentUsername);
        }
        userProfile.streakCount = data.streakCount ?? 0;
        userProfile.lastActiveDate = data.lastActiveDate ?? null;
        userProfile.streakFreezes = data.streakFreezes ?? 2;
        userProfile.points = data.points ?? 0;
        userProfile.totalWorkouts = data.totalWorkouts ?? 0;
        userProfile.totalQuestions = data.totalQuestions ?? 0;
        userProfile.totalCorrect = data.totalCorrect ?? 0;
      } else {
        await docRef.set({
          uid: uid,
          username: currentUsername,
          email: currentUser ? currentUser.email : '',
          streakCount: userProfile.streakCount,
          lastActiveDate: userProfile.lastActiveDate,
          streakFreezes: userProfile.streakFreezes,
          points: userProfile.points,
          totalWorkouts: userProfile.totalWorkouts,
          totalQuestions: userProfile.totalQuestions,
          totalCorrect: userProfile.totalCorrect,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      }
      updateUserDisplayEverywhere();
    } catch (err) {
      console.warn("Firestore profile fetch fallback:", err);
    }
  }

  async function saveSessionToFirestore(record) {
    userProfile.totalWorkouts++;
    userProfile.totalQuestions += record.questionsAnswered;
    userProfile.totalCorrect += record.correctCount;
    userProfile.points += record.score;

    // Cache recent session in local history (strictly max 5 items)
    try {
      const history = JSON.parse(localStorage.getItem('mathsprint_recent_sessions') || '[]');
      history.unshift(record);
      while (history.length > MAX_SAVED_SESSIONS) {
        history.pop();
      }
      localStorage.setItem('mathsprint_recent_sessions', JSON.stringify(history));
    } catch (e) {}

    if (!currentUser) {
      saveGuestProfile();
      updateHeaderUI();
      return;
    }

    if (db && currentUser) {
      try {
        const userDocRef = db.collection("users").doc(currentUser.uid);

        // 1. Add new session document
        await userDocRef.collection("sessions").add({
          ...record,
          uid: currentUser.uid,
          username: currentUsername,
          timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });

        // 2. Automatically trim older sessions beyond the latest 5 in Firestore
        try {
          const sessionsSnapshot = await userDocRef.collection("sessions")
            .orderBy("timestamp", "desc")
            .get();

          if (sessionsSnapshot.size > MAX_SAVED_SESSIONS) {
            const batch = db.batch();
            const docsToDelete = sessionsSnapshot.docs.slice(MAX_SAVED_SESSIONS);
            docsToDelete.forEach(doc => {
              batch.delete(doc.ref);
            });
            await batch.commit();
            console.log(`Auto-trimmed ${docsToDelete.length} older session(s) from Firestore to conserve quota.`);
          }
        } catch (trimErr) {
          console.warn("Session trimming note:", trimErr);
        }

        // 3. Update root user profile document
        await userDocRef.set({
          uid: currentUser.uid,
          username: currentUsername,
          streakCount: userProfile.streakCount,
          lastActiveDate: userProfile.lastActiveDate,
          streakFreezes: userProfile.streakFreezes,
          points: userProfile.points,
          totalWorkouts: userProfile.totalWorkouts,
          totalQuestions: userProfile.totalQuestions,
          totalCorrect: userProfile.totalCorrect,
          lastWorkoutAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        console.log("Workout session saved and capped at 5 records in Firestore.");
      } catch (err) {
        console.error("Firestore user session write error:", err);
      }
    }

    updateHeaderUI();
  }

  /**
   * Fetch all users for the Global Leaderboard
   */
  async function fetchGlobalLeaderboardFromFirestore(sortBy = 'points') {
    if (!db) return [];
    try {
      const field = sortBy === 'streak' ? 'streakCount' : 'points';
      const snapshot = await db.collection("users")
        .orderBy(field, "desc")
        .limit(50)
        .get();

      if (!snapshot.empty) {
        return snapshot.docs.map(doc => doc.data());
      }
    } catch (err) {
      console.warn("Firestore leaderboard fetch error:", err);
    }
    return [];
  }

  function updateHeaderUI() {
    document.getElementById('headerStreak').textContent = userProfile.streakCount;
    document.getElementById('headerFreezes').textContent = userProfile.streakFreezes;
    document.getElementById('headerPoints').textContent = userProfile.points.toLocaleString();
  }

  // ==========================================================================
  // SECTION 5: DAILY STREAK & FREEZE SYSTEM
  // ==========================================================================
  function getTodayString() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function evaluateDailyStreak() {
    const today = getTodayString();
    if (!userProfile.lastActiveDate) return;

    const d1 = new Date(userProfile.lastActiveDate + 'T00:00:00');
    const d2 = new Date(today + 'T00:00:00');
    const diffDays = Math.round((d2 - d1) / (1000 * 60 * 60 * 24));

    if (diffDays > 1) {
      if (userProfile.streakFreezes > 0) {
        userProfile.streakFreezes--;
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        userProfile.lastActiveDate = yesterday.toISOString().split('T')[0];
        showToast("Streak Freeze Used to save your streak! ❄️");
      } else {
        userProfile.streakCount = 0;
        showToast("Streak reset. Complete a workout today to restart! 🔥");
      }
      if (currentUser && db) {
        db.collection("users").doc(currentUser.uid).set({
          streakCount: userProfile.streakCount,
          lastActiveDate: userProfile.lastActiveDate,
          streakFreezes: userProfile.streakFreezes
        }, { merge: true });
      } else {
        saveGuestProfile();
      }
      updateHeaderUI();
    }
  }

  let toastTimer = null;

  function showToast(msg) {
    const t = document.getElementById('toastAlert');
    const txt = document.getElementById('toastAlertText');
    if (!t || !txt) return;

    txt.textContent = msg;
    t.classList.remove('hidden');

    if (toastTimer) {
      clearTimeout(toastTimer);
    }

    toastTimer = setTimeout(() => {
      t.classList.add('hidden');
      toastTimer = null;
    }, 2000);
  }

  // ==========================================================================
  // SECTION 6: SYNTHESIZED WEB AUDIO ENGINE
  // ==========================================================================
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  function playTone(freq, type = 'sine', duration = 0.1, gainVal = 0.1) {
    try {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
      gain.gain.setValueAtTime(gainVal, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + duration);
    } catch (e) {}
  }

  function playSound(type) {
    if (type === 'correct') {
      playTone(523.25, 'sine', 0.08, 0.1);
      setTimeout(() => playTone(659.25, 'sine', 0.12, 0.12), 70);
    } else if (type === 'wrong') {
      playTone(220, 'sawtooth', 0.15, 0.1);
    } else if (type === 'fanfare') {
      [523.25, 659.25, 783.99, 1046.50].forEach((f, i) => {
        setTimeout(() => playTone(f, 'triangle', 0.2, 0.15), i * 90);
      });
    } else {
      playTone(440, 'sine', 0.04, 0.05);
    }
  }

  // ==========================================================================
  // SECTION 7: WORKOUT GENERATOR & ENGINE (WITH INFINITE MODE)
  // ==========================================================================
  let workoutConfig = {
    op: '*',
    op1Digits: 3,
    op2Digits: 2,
    count: 10,
    isInfinite: false
  };

  let session = {
    currentQuestion: null,
    answeredCount: 0,
    correctCount: 0,
    startTime: null,
    timerId: null,
    isReviewing: false
  };

  function generateNumber(digits) {
    digits = Math.max(1, Math.min(5, parseInt(digits) || 1));
    if (digits === 1) return Math.floor(Math.random() * 9) + 1;
    const min = Math.pow(10, digits - 1);
    const max = Math.pow(10, digits) - 1;
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function generateQuestion() {
    let op1, op2, answer, symbol;
    switch (workoutConfig.op) {
      case '+':
        op1 = generateNumber(workoutConfig.op1Digits);
        op2 = generateNumber(workoutConfig.op2Digits);
        answer = op1 + op2;
        symbol = '+';
        break;
      case '-':
        op1 = generateNumber(workoutConfig.op1Digits);
        op2 = generateNumber(workoutConfig.op2Digits);
        if (op1 < op2) {
          const tmp = op1;
          op1 = op2;
          op2 = tmp;
        }
        answer = op1 - op2;
        symbol = '−';
        break;
      case '*':
        op1 = generateNumber(workoutConfig.op1Digits);
        op2 = generateNumber(workoutConfig.op2Digits);
        answer = op1 * op2;
        symbol = '×';
        break;
      case '/':
        op2 = generateNumber(workoutConfig.op2Digits);
        if (op2 === 1) op2 = 2;
        const q = generateNumber(workoutConfig.op1Digits);
        op1 = op2 * q;
        answer = q;
        symbol = '÷';
        break;
    }
    return { 
      op1, 
      op2, 
      symbol, 
      answer, 
      text: `${op1.toLocaleString()} ${symbol} ${op2.toLocaleString()} = ?` 
    };
  }

  // ==========================================================================
  // SECTION 8: VIEW CONTROLLER & ROUTING
  // ==========================================================================
  const viewSetup = document.getElementById('viewSetup');
  const viewGameplay = document.getElementById('viewGameplay');
  const viewSummary = document.getElementById('viewSummary');
  const viewLeaderboard = document.getElementById('viewLeaderboard');

  function switchView(target) {
    [viewSetup, viewGameplay, viewSummary, viewLeaderboard].forEach(v => {
      if (v) {
        v.classList.add('hidden');
        v.classList.remove('fade-view');
      }
    });
    target.classList.remove('hidden');
    void target.offsetWidth;
    target.classList.add('fade-view');
  }

  window.navigateHome = () => switchView(viewSetup);

  // ==========================================================================
  // SECTION 9: GAMEPLAY LIFECYCLE & ZERO-DISTRACTION INPUT PROCESSING
  // ==========================================================================
  function startSession() {
    playSound('tap');
    session.answeredCount = 0;
    session.correctCount = 0;
    session.startTime = Date.now();
    session.isReviewing = false;

    const btnFinishInf = document.getElementById('btnFinishInfiniteSession');
    const badgeInf = document.getElementById('badgeInfiniteMode');

    if (workoutConfig.isInfinite) {
      btnFinishInf.classList.remove('hidden');
      badgeInf.classList.remove('hidden');
    } else {
      btnFinishInf.classList.add('hidden');
      badgeInf.classList.add('hidden');
    }

    if (session.timerId) clearInterval(session.timerId);
    session.timerId = setInterval(updateLiveTimer, 1000);
    updateLiveTimer();

    switchView(viewGameplay);
    nextQuestion();
  }

  function updateLiveTimer() {
    if (!session.startTime) return;
    const s = Math.floor((Date.now() - session.startTime) / 1000);
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    document.getElementById('liveTimer').textContent = `${mm}:${ss}`;
  }

  function nextQuestion() {
    session.currentQuestion = generateQuestion();
    const currentNum = session.answeredCount + 1;

    if (workoutConfig.isInfinite) {
      document.getElementById('liveProgress').textContent = `Question #${currentNum} (∞)`;
      document.getElementById('progressBar').style.width = '100%';
    } else {
      document.getElementById('liveProgress').textContent = `${currentNum} / ${workoutConfig.count}`;
      document.getElementById('progressBar').style.width = `${Math.round((currentNum / workoutConfig.count) * 100)}%`;
    }

    document.getElementById('displayEquation').textContent = session.currentQuestion.text;

    const input = document.getElementById('inputAnswer');
    const card = document.getElementById('gameCard');
    const errBox = document.getElementById('errorBox');
    const btnSubmit = document.getElementById('btnSubmit');
    const btnGotIt = document.getElementById('btnGotIt');

    card.classList.remove('shake-anim', 'border-red-900', 'border-emerald-800');
    input.classList.remove('border-red-600', 'border-emerald-600');
    errBox.classList.add('hidden');
    btnSubmit.classList.remove('hidden');
    btnGotIt.classList.add('hidden');

    input.value = '';
    input.disabled = false;
    focusAnswerInput();
    session.isReviewing = false;
  }

  function focusAnswerInput() {
    const input = document.getElementById('inputAnswer');
    if (!input) return;
    input.focus({ preventScroll: true });
    requestAnimationFrame(() => {
      input.focus({ preventScroll: true });
      setTimeout(() => input.focus({ preventScroll: true }), 25);
      setTimeout(() => input.focus({ preventScroll: true }), 80);
    });
  }

  function handleAnswerSubmit() {
    if (session.isReviewing) {
      proceedAfterReview();
      return;
    }

    const input = document.getElementById('inputAnswer');
    const raw = input.value.trim();
    if (raw === '') { 
      focusAnswerInput(); 
      return; 
    }

    const ans = parseInt(raw, 10);
    const q = session.currentQuestion;
    const isCorrect = (ans === q.answer);

    input.disabled = true;

    if (isCorrect) {
      session.correctCount++;
      session.answeredCount++;
      playSound('correct');
      input.classList.add('border-emerald-600');

      setTimeout(() => {
        if (!workoutConfig.isInfinite && session.answeredCount >= workoutConfig.count) {
          completeSession();
        } else {
          nextQuestion();
          focusAnswerInput();
        }
      }, 400);

    } else {
      session.answeredCount++;
      playSound('wrong');
      const card = document.getElementById('gameCard');
      card.classList.add('shake-anim', 'border-red-900');
      input.classList.add('border-red-600');
      document.getElementById('correctAnswerText').textContent = q.answer.toLocaleString();
      document.getElementById('errorBox').classList.remove('hidden');
      document.getElementById('btnSubmit').classList.add('hidden');
      document.getElementById('btnGotIt').classList.remove('hidden');
      session.isReviewing = true;
    }
  }

  function proceedAfterReview() {
    if (!workoutConfig.isInfinite && session.answeredCount >= workoutConfig.count) {
      completeSession();
    } else {
      nextQuestion();
      focusAnswerInput();
    }
  }

  async function completeSession() {
    if (session.timerId) clearInterval(session.timerId);
    const durationSec = Math.max(1, Math.floor((Date.now() - session.startTime) / 1000));
    const total = Math.max(1, session.answeredCount);
    const accuracy = Math.round((session.correctCount / total) * 100);
    const avgSpeedSec = parseFloat((durationSec / total).toFixed(1));
    const mm = String(Math.floor(durationSec / 60)).padStart(2, '0');
    const ss = String(durationSec % 60).padStart(2, '0');

    // Dynamic Mathematical Points & Speed Multiplier Calculations
    const basePtsPerQuestion = calculateBasePoints(workoutConfig.op, workoutConfig.op1Digits, workoutConfig.op2Digits);
    const targetParTimeSec = calculateTargetTime(workoutConfig.op, workoutConfig.op1Digits, workoutConfig.op2Digits);
    const speedMultiplier = calculateSpeedMultiplier(avgSpeedSec, targetParTimeSec);
    const finalPtsPerQuestion = Math.round(basePtsPerQuestion * speedMultiplier);
    const totalScore = session.correctCount * finalPtsPerQuestion;

    // Streak Update & 7-Day Milestone Check
    const today = getTodayString();
    let streakUpdated = false;
    if (userProfile.lastActiveDate !== today) {
      userProfile.streakCount++;
      userProfile.lastActiveDate = today;
      streakUpdated = true;

      // 7-Day Milestone Freeze Reward
      if (userProfile.streakCount > 0 && userProfile.streakCount % 7 === 0) {
        if (userProfile.streakFreezes < MAX_FREEZES) {
          userProfile.streakFreezes++;
          showToast(`🔥 ${userProfile.streakCount}-Day Streak Milestone! Earned +1 Streak Freeze ❄️`);
        } else {
          showToast(`🔥 ${userProfile.streakCount}-Day Streak Milestone reached! (Freezes at max capacity 5/5)`);
        }
      }
    }

    // Session Record Object
    const record = {
      date: today,
      mode: `${workoutConfig.op1Digits}d ${workoutConfig.op} ${workoutConfig.op2Digits}d ${workoutConfig.isInfinite ? '(Infinite)' : `(${workoutConfig.count} Qs)`}`,
      isInfinite: workoutConfig.isInfinite,
      questionsAnswered: total,
      correctCount: session.correctCount,
      basePoints: basePtsPerQuestion,
      targetTimeSeconds: targetParTimeSec,
      speedMultiplier: speedMultiplier,
      score: totalScore,
      accuracy: accuracy,
      speed: `${avgSpeedSec}s`,
      totalTime: `${mm}:${ss}`,
      durationSeconds: durationSec
    };

    // Save record scoped to user in Firestore
    await saveSessionToFirestore(record);

    // Update Summary UI Breakdown
    document.getElementById('summaryUsername').textContent = currentUsername;
    document.getElementById('statAccuracy').textContent = `${accuracy}%`;
    document.getElementById('statScoreText').textContent = `${session.correctCount}/${total} Correct`;
    document.getElementById('statSpeed').textContent = `${avgSpeedSec}s`;
    document.getElementById('statTargetCompare').textContent = `Target: ${targetParTimeSec}.0s / question`;

    // Multiplier & Points Breakdown Text
    const formulaEl = document.getElementById('statPointsFormula');
    if (speedMultiplier > 1.0) {
      const bonusPct = Math.round((speedMultiplier - 1.0) * 100);
      formulaEl.textContent = `${basePtsPerQuestion} Base PTS × ${speedMultiplier}x (+${bonusPct}% Speed Bonus)`;
    } else {
      formulaEl.textContent = `${basePtsPerQuestion} Base PTS × 1.00x (Target Exceeded: No Bonus)`;
    }

    document.getElementById('statPoints').textContent = `+${totalScore.toLocaleString()} PTS`;
    document.getElementById('statStreakNum').textContent = userProfile.streakCount;

    const goalStatus = document.getElementById('statGoalStatus');
    if (streakUpdated) {
      goalStatus.textContent = "Daily Goal Achieved! Streak Extended 🔥";
      launchConfetti();
      playSound('fanfare');
    } else {
      goalStatus.textContent = currentUser ? `Saved for ${currentUsername}` : "Workout Completed";
    }

    switchView(viewSummary);
  }

  // ==========================================================================
  // SECTION 10: "GLOBAL LEADERBOARD" RENDERER
  // ==========================================================================
  
  /**
   * Render Public Global Leaderboard (Sortable by Points or Streak)
   */
  async function renderGlobalLeaderboardList() {
    const listEl = document.getElementById('listGlobalLeaderboard');
    listEl.innerHTML = `<div class="py-16 text-center text-mono-500 text-xs animate-pulse">Loading global leaderboard from Firestore...</div>`;

    const players = await fetchGlobalLeaderboardFromFirestore(leaderboardSortBy);

    if (players.length === 0) {
      listEl.innerHTML = `<div class="py-16 text-center text-mono-500 text-xs">No player profiles found in cloud database.</div>`;
      return;
    }

    listEl.innerHTML = players.map((p, index) => {
      const isCurrent = (currentUser && p.uid === currentUser.uid) || (p.username === currentUsername && currentUsername !== 'Guest');
      const medal = index === 0 ? '🥇' : (index === 1 ? '🥈' : (index === 2 ? '🥉' : `#${index + 1}`));

      return `
        <div class="py-3 px-3 flex justify-between items-center text-xs ${isCurrent ? 'bg-[#1a1d21] border border-[#323742] rounded-lg' : 'hover:bg-[#141619] rounded-lg'} transition-colors">
          <div class="flex items-center gap-3">
            <span class="font-bold text-sm w-7 text-center ${index < 3 ? 'text-lg' : 'text-[#9da3af]'}">${medal}</span>
            <div>
              <div class="font-bold ${isCurrent ? 'text-amber-400' : 'text-[#f5f2eb]'} text-sm flex items-center gap-1.5 font-data">
                <span>${p.username || 'Anonymous'}</span>
                ${isCurrent ? '<span class="text-[9px] px-1.5 py-0.2 rounded bg-amber-400/15 text-amber-300 border border-amber-400/30">YOU</span>' : ''}
              </div>
              <div class="text-[11px] text-[#646b79] font-data">${p.totalWorkouts || 0} workouts completed</div>
            </div>
          </div>

          <div class="text-center font-bold text-[#d1cdc3] font-data flex items-center justify-center gap-1">
            <span class="material-symbols-rounded filled text-amber-500 text-[16px]">local_fire_department</span>
            <span>${p.streakCount || 0}</span>
          </div>

          <div class="text-right font-data">
            <div class="font-bold ${leaderboardSortBy === 'points' ? 'text-[#f5f2eb] text-sm' : 'text-[#9da3af]'} flex items-center justify-end gap-1">
              <span class="material-symbols-rounded filled text-amber-400 text-[14px]">star</span>
              <span>${(p.points || 0).toLocaleString()}</span>
            </div>
            <div class="text-[10px] text-[#646b79] uppercase tracking-wider">PTS</div>
          </div>
        </div>
      `;
    }).join('');
  }

  // ==========================================================================
  // SECTION 11: CONFETTI CELEBRATION SYSTEM
  // ==========================================================================
  const canvas = document.getElementById('confettiCanvas');
  const ctx = canvas.getContext('2d');
  let particles = [];
  let confettiAnimId = null;

  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  function launchConfetti() {
    particles = [];
    const colors = ['#ffffff', '#a1a1aa', '#71717a', '#fbbf24', '#38bdf8'];
    for (let i = 0; i < 70; i++) {
      particles.push({
        x: canvas.width / 2,
        y: canvas.height * 0.45,
        vx: (Math.random() - 0.5) * 12,
        vy: (Math.random() - 0.8) * 14,
        size: Math.random() * 6 + 3,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * 360,
        rotSpeed: (Math.random() - 0.5) * 8,
        alpha: 1
      });
    }
    if (confettiAnimId) cancelAnimationFrame(confettiAnimId);
    animateConfetti();
  }

  function animateConfetti() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let active = false;
    particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.3;
      p.rotation += p.rotSpeed;
      p.alpha -= 0.01;
      if (p.alpha > 0) {
        active = true;
        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        ctx.restore();
      }
    });
    if (active) {
      confettiAnimId = requestAnimationFrame(animateConfetti);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  // ==========================================================================
  // SECTION 12: MODAL & PROFILE SETTINGS UTILITIES
  // ==========================================================================
  const authModal = document.getElementById('authModal');
  const profileSettingsModal = document.getElementById('profileSettingsModal');
  let authMode = 'signin';

  function resetPasswordVisibility() {
    const inputPass = document.getElementById('inputAuthPassword');
    const iconToggle = document.getElementById('iconPasswordToggle');
    const btnToggle = document.getElementById('btnTogglePasswordVisibility');
    if (inputPass) inputPass.type = 'password';
    if (iconToggle) iconToggle.textContent = 'visibility';
    if (btnToggle) btnToggle.title = 'Show password';
  }

  function openAuthModal() {
    authModal.classList.remove('hidden');
    clearAuthError();
    resetPasswordVisibility();
  }

  function closeAuthModal() {
    authModal.classList.add('hidden');
    clearAuthError();
    resetPasswordVisibility();
  }

  async function renderProfileRecentSessions() {
    const listEl = document.getElementById('profileRecentSessionsList');
    if (!listEl) return;

    let sessions = [];

    // Fetch from Firestore if logged in
    if (currentUser && db) {
      try {
        const snapshot = await db.collection("users")
          .doc(currentUser.uid)
          .collection("sessions")
          .orderBy("timestamp", "desc")
          .limit(5)
          .get();
        if (!snapshot.empty) {
          sessions = snapshot.docs.map(doc => doc.data());
        }
      } catch (e) {
        console.warn("Could not fetch remote sessions:", e);
      }
    }

    // Fallback to local recent sessions
    if (sessions.length === 0) {
      try {
        sessions = JSON.parse(localStorage.getItem('mathsprint_recent_sessions') || '[]').slice(0, 5);
      } catch (e) {
        sessions = [];
      }
    }

    if (sessions.length === 0) {
      listEl.innerHTML = '<div class="py-4 text-center text-[#646b79] text-xs font-data">No workout sessions logged yet. Complete a workout to see activity!</div>';
      return;
    }

    listEl.innerHTML = sessions.map(s => {
      const dateStr = s.date || 'Recent';
      const modeStr = s.mode || 'Practice Session';
      const scoreStr = s.score ? `+${s.score.toLocaleString()} PTS` : '+0 PTS';
      const accuracyStr = s.accuracy || '100%';
      const speedStr = s.speed || '';

      return `
        <div class="py-2 px-1 flex items-center justify-between text-xs font-data">
          <div class="space-y-0.5">
            <div class="font-bold text-[#f5f2eb] text-[11px]">${modeStr}</div>
            <div class="text-[10px] text-[#646b79] flex items-center gap-1.5">
              <span>${dateStr}</span>
              <span>·</span>
              <span class="text-emerald-400 font-semibold">${accuracyStr}</span>
              ${speedStr ? `<span>·</span><span>${speedStr} pace</span>` : ''}
            </div>
          </div>
          <div class="text-right">
            <div class="font-bold text-amber-400 text-xs">${scoreStr}</div>
            <div class="text-[9px] text-[#646b79] uppercase tracking-wider">${s.correctCount || 0}/${s.questionsAnswered || 0} correct</div>
          </div>
        </div>
      `;
    }).join('');
  }

  function openProfileSettingsModal() {
    const input = document.getElementById('inputProfileUsername');
    if (input) input.value = currentUsername !== 'Guest' ? currentUsername : '';

    const activeUser = currentUser || (auth && auth.currentUser);
    const emailEl = document.getElementById('profileAccountEmail');
    if (emailEl) {
      emailEl.textContent = (activeUser && activeUser.email) ? activeUser.email : 'Local Guest Account (Sign in to sync cloud data)';
    }

    // Core Metrics
    const totalQ = userProfile.totalQuestions || 0;
    const totalC = userProfile.totalCorrect || 0;
    const totalMiss = Math.max(0, totalQ - totalC);
    const accuracyPct = totalQ > 0 ? ((totalC / totalQ) * 100).toFixed(1) : '100.0';

    document.getElementById('profilePointsBalance').textContent = `${(userProfile.points || 0).toLocaleString()} ★`;
    document.getElementById('profileStreakCount').textContent = `${userProfile.streakCount || 0} Days`;
    document.getElementById('profileLastActiveSubtitle').textContent = userProfile.lastActiveDate ? `Active: ${userProfile.lastActiveDate}` : 'Active today';
    document.getElementById('profileLifetimeAccuracy').textContent = `${accuracyPct}%`;
    document.getElementById('profileAccuracyRatio').textContent = `${totalC.toLocaleString()} / ${totalQ.toLocaleString()} Solved`;
    document.getElementById('profileTotalWorkouts').textContent = (userProfile.totalWorkouts || 0).toLocaleString();
    document.getElementById('profileTotalQuestionsSubtitle').textContent = `${totalQ.toLocaleString()} Problems total`;

    // Accuracy Ratio Bar
    document.getElementById('profileCorrectCountText').textContent = `${totalC.toLocaleString()} Correct`;
    document.getElementById('profileIncorrectCountText').textContent = `${totalMiss.toLocaleString()} Missed`;
    const barFill = document.getElementById('profileAccuracyBarFill');
    if (barFill) {
      barFill.style.width = `${Math.max(4, parseFloat(accuracyPct))}%`;
    }

    updateFreezeShopUI();
    renderProfileRecentSessions();

    profileSettingsModal.classList.remove('hidden');
  }

  function closeProfileSettingsModal() {
    profileSettingsModal.classList.add('hidden');
  }

  function showAuthError(msg) {
    const el = document.getElementById('authErrorMessage');
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  function clearAuthError() {
    const el = document.getElementById('authErrorMessage');
    el.textContent = '';
    el.classList.add('hidden');
  }

  function setAuthMode(mode) {
    authMode = mode;
    const tabIn = document.getElementById('tabAuthSignIn');
    const tabUp = document.getElementById('tabAuthSignUp');
    const fieldUser = document.getElementById('fieldUsername');
    const btnSubmit = document.getElementById('btnSubmitAuthForm');

    clearAuthError();
    resetPasswordVisibility();

    if (mode === 'signup') {
      tabUp.className = 'py-1.5 rounded bg-[#f5f2eb] text-[#0c0d0f] transition-all font-bold';
      tabIn.className = 'py-1.5 rounded text-[#9da3af] hover:text-white transition-all font-bold';
      fieldUser.classList.remove('hidden');
      btnSubmit.textContent = 'Create Account';
    } else {
      tabIn.className = 'py-1.5 rounded bg-[#f5f2eb] text-[#0c0d0f] transition-all font-bold';
      tabUp.className = 'py-1.5 rounded text-[#9da3af] hover:text-white transition-all font-bold';
      fieldUser.classList.add('hidden');
      btnSubmit.textContent = 'Sign In';
    }
  }

  // ==========================================================================
  // SECTION 13: DOM EVENT LISTENERS & BINDINGS
  // ==========================================================================
  function initEvents() {
    const opNames = { 
      '+': 'Addition (+)', 
      '-': 'Subtraction (−)', 
      '*': 'Multiplication (×)', 
      '/': 'Division (÷)' 
    };

    // Operation Pills
    document.querySelectorAll('.btn-op').forEach(btn => {
      btn.addEventListener('click', () => {
        playSound('tap');
        document.querySelectorAll('.btn-op').forEach(b => {
          b.className = 'btn-op py-2.5 lg:py-3 px-3 rounded-lg bg-[#1a1d21] border border-[#23272e] hover:border-[#323742] text-[#d1cdc3] font-data text-base font-bold transition-all active:translate-y-[1px] flex items-center justify-center gap-2';
          const label = b.querySelector('span:last-child');
          if (label) label.className = 'text-xs font-medium text-[#9da3af]';
        });
        btn.className = 'btn-op py-2.5 lg:py-3 px-3 rounded-lg bg-[#f5f2eb] border border-[#ffffff] text-[#0c0d0f] font-data text-base font-bold shadow-sm transition-all active:translate-y-[1px] flex items-center justify-center gap-2';
        const activeLabel = btn.querySelector('span:last-child');
        if (activeLabel) activeLabel.className = 'text-xs font-medium text-[#0c0d0f]';
        workoutConfig.op = btn.getAttribute('data-op');
        document.getElementById('labelSelectedOp').textContent = opNames[workoutConfig.op];
      });
    });

    // Operand 1 Slider
    const s1 = document.getElementById('sliderOp1');
    const l1 = document.getElementById('labelOp1');
    s1.addEventListener('input', (e) => {
      const val = parseInt(e.target.value);
      workoutConfig.op1Digits = val;
      const min = val === 1 ? 1 : Math.pow(10, val - 1);
      const max = Math.pow(10, val) - 1;
      l1.innerHTML = `${val} Digits <span class="text-[#646b79] font-normal text-[11px]">(${min.toLocaleString()} – ${max.toLocaleString()})</span>`;
    });

    // Operand 2 Slider
    const s2 = document.getElementById('sliderOp2');
    const l2 = document.getElementById('labelOp2');
    s2.addEventListener('input', (e) => {
      const val = parseInt(e.target.value);
      workoutConfig.op2Digits = val;
      const min = val === 1 ? 1 : Math.pow(10, val - 1);
      const max = Math.pow(10, val) - 1;
      l2.innerHTML = `${val} Digits <span class="text-[#646b79] font-normal text-[11px]">(${min.toLocaleString()} – ${max.toLocaleString()})</span>`;
    });

    // Question Count & Infinite Mode Buttons
    document.querySelectorAll('.btn-count').forEach(btn => {
      btn.addEventListener('click', () => {
        playSound('tap');
        const val = btn.getAttribute('data-count');
        const customBox = document.getElementById('customCountBox');
        
        document.querySelectorAll('.btn-count').forEach(b => {
          b.className = 'btn-count py-2 rounded-lg bg-[#1a1d21] border border-[#23272e] hover:border-[#323742] text-[#d1cdc3] text-xs font-data font-bold transition-all active:translate-y-[1px]';
        });

        if (val === 'infinite') {
          btn.className = 'btn-count py-2 rounded-lg bg-[#f5f2eb] border border-[#ffffff] text-[#0c0d0f] text-xs font-data font-bold shadow-sm transition-all active:translate-y-[1px]';
          customBox.classList.add('hidden');
          workoutConfig.isInfinite = true;
          document.getElementById('labelSelectedCount').textContent = '∞ Infinite Questions';
        } else if (val) {
          btn.className = 'btn-count py-2 rounded-lg bg-[#f5f2eb] border border-[#ffffff] text-[#0c0d0f] text-xs font-data font-bold shadow-sm transition-all active:translate-y-[1px]';
          customBox.classList.add('hidden');
          workoutConfig.isInfinite = false;
          workoutConfig.count = parseInt(val, 10);
          document.getElementById('labelSelectedCount').textContent = `${val} Questions`;
        } else {
          btn.className = 'btn-count py-2 rounded-lg bg-[#f5f2eb] border border-[#ffffff] text-[#0c0d0f] text-xs font-data font-bold shadow-sm transition-all active:translate-y-[1px]';
          customBox.classList.remove('hidden');
          document.getElementById('inputCustomQuestions').focus();
        }
      });
    });

    // Custom Count Apply
    document.getElementById('btnApplyCustomQuestions').addEventListener('click', () => {
      const v = parseInt(document.getElementById('inputCustomQuestions').value, 10);
      if (v && v >= 1 && v <= 500) {
        workoutConfig.isInfinite = false;
        workoutConfig.count = v;
        document.getElementById('labelSelectedCount').textContent = `${v} Questions`;
        playSound('tap');
      }
    });

    // Gameplay Actions
    document.getElementById('btnStartPractice').addEventListener('click', startSession);
    document.getElementById('btnSubmit').addEventListener('click', handleAnswerSubmit);
    document.getElementById('btnGotIt').addEventListener('click', () => {
      playSound('tap');
      proceedAfterReview();
    });

    // Finish Infinite Workout
    document.getElementById('btnFinishInfiniteSession').addEventListener('click', () => {
      if (session.answeredCount === 0) {
        showToast("Answer at least 1 question to record your workout.");
        return;
      }
      playSound('tap');
      completeSession();
    });

    document.getElementById('inputAnswer').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAnswerSubmit();
      }
    });

    document.getElementById('gameCard').addEventListener('click', (e) => {
      if (!e.target.closest('button')) {
        focusAnswerInput();
      }
    });

    document.getElementById('btnQuitSession').addEventListener('click', () => {
      if (confirm("Quit current workout?")) {
        playSound('tap');
        if (session.timerId) clearInterval(session.timerId);
        switchView(viewSetup);
      }
    });

    document.getElementById('btnPlayAgain').addEventListener('click', () => {
      playSound('tap');
      switchView(viewSetup);
    });

    // Leaderboard Primary Navigation
    document.getElementById('btnNavLeaderboard').addEventListener('click', () => {
      playSound('tap');
      renderGlobalLeaderboardList();
      switchView(viewLeaderboard);
    });

    document.getElementById('btnViewLeaderboardFromSummary').addEventListener('click', () => {
      playSound('tap');
      renderGlobalLeaderboardList();
      switchView(viewLeaderboard);
    });

    document.getElementById('btnBackFromLeaderboard').addEventListener('click', () => {
      playSound('tap');
      switchView(viewSetup);
    });

    document.getElementById('btnReturnSetup').addEventListener('click', () => {
      playSound('tap');
      switchView(viewSetup);
    });

    document.getElementById('btnRefreshLeaderboard').addEventListener('click', () => {
      playSound('tap');
      renderGlobalLeaderboardList();
    });

    // Leaderboard Sort Buttons (Points vs Streak)
    const btnSortPoints = document.getElementById('btnSortLeaderboardPoints');
    const btnSortStreak = document.getElementById('btnSortLeaderboardStreak');

    btnSortPoints.addEventListener('click', () => {
      playSound('tap');
      leaderboardSortBy = 'points';
      btnSortPoints.className = 'px-3 py-1 rounded-lg bg-[#f5f2eb] text-[#0c0d0f] font-bold text-[11px] transition-all flex items-center gap-1';
      btnSortStreak.className = 'px-3 py-1 rounded-lg bg-[#141619] border border-[#23272e] text-[#9da3af] hover:text-white font-bold text-[11px] transition-all flex items-center gap-1';
      renderGlobalLeaderboardList();
    });

    btnSortStreak.addEventListener('click', () => {
      playSound('tap');
      leaderboardSortBy = 'streak';
      btnSortStreak.className = 'px-3 py-1 rounded-lg bg-[#f5f2eb] text-[#0c0d0f] font-bold text-[11px] transition-all flex items-center gap-1';
      btnSortPoints.className = 'px-3 py-1 rounded-lg bg-[#141619] border border-[#23272e] text-[#9da3af] hover:text-white font-bold text-[11px] transition-all flex items-center gap-1';
      renderGlobalLeaderboardList();
    });

    // Auth Modal Triggers
    document.getElementById('btnOpenAuthModal').addEventListener('click', openAuthModal);
    document.getElementById('btnCloseAuthModal').addEventListener('click', closeAuthModal);

    document.getElementById('tabAuthSignIn').addEventListener('click', () => setAuthMode('signin'));
    document.getElementById('tabAuthSignUp').addEventListener('click', () => setAuthMode('signup'));

    // Password Visibility Toggle
    const btnTogglePass = document.getElementById('btnTogglePasswordVisibility');
    if (btnTogglePass) {
      btnTogglePass.addEventListener('click', () => {
        const inputPass = document.getElementById('inputAuthPassword');
        const iconToggle = document.getElementById('iconPasswordToggle');
        if (!inputPass || !iconToggle) return;
        const isMasked = inputPass.type === 'password';
        inputPass.type = isMasked ? 'text' : 'password';
        iconToggle.textContent = isMasked ? 'visibility_off' : 'visibility';
        btnTogglePass.title = isMasked ? 'Hide password' : 'Show password';
      });
    }

    // Profile Settings Triggers
    document.getElementById('btnOpenProfileSettings').addEventListener('click', openProfileSettingsModal);
    document.getElementById('btnCloseProfileSettings').addEventListener('click', closeProfileSettingsModal);
    document.getElementById('btnProfileSignOut').addEventListener('click', signOutUser);

    document.getElementById('btnSaveProfileUsername').addEventListener('click', () => {
      const val = document.getElementById('inputProfileUsername').value;
      updateCustomUsername(val);
    });

    // Buy Streak Freeze in Profile Store
    document.getElementById('btnBuyStreakFreeze').addEventListener('click', () => {
      if (userProfile.streakFreezes >= MAX_FREEZES) {
        showToast("You are already at max Streak Freeze capacity (5/5).");
        return;
      }
      if (userProfile.points < FREEZE_COST) {
        showToast(`You need at least ${FREEZE_COST.toLocaleString()} points to purchase a Freeze.`);
        return;
      }
      userProfile.points -= FREEZE_COST;
      userProfile.streakFreezes++;
      playSound('correct');
      showToast("Purchased 1 Streak Freeze for 1,500 Points! ❄️");
      saveGuestProfile();
      if (currentUser && db) {
        db.collection("users").doc(currentUser.uid).set({
          points: userProfile.points,
          streakFreezes: userProfile.streakFreezes
        }, { merge: true });
      }
      updateUserDisplayEverywhere();
      updateFreezeShopUI();
    });

    // Email/Password Form Submit
    document.getElementById('authForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const email = document.getElementById('inputAuthEmail').value.trim();
      const password = document.getElementById('inputAuthPassword').value;

      if (authMode === 'signup') {
        const username = document.getElementById('inputAuthUsername').value.trim();
        signUpWithEmail(username, email, password);
      } else {
        signInWithEmail(email, password);
      }
    });
  }

  // ==========================================================================
  // SECTION 14: INITIALIZATION
  // ==========================================================================
  function init() {
    loadGuestProfile();
    updateUserDisplayEverywhere();
    evaluateDailyStreak();
    initEvents();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
