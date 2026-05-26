import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, query, getDocs, serverTimestamp, doc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

let lastSyncMeta = {
  source: "unknown",
  migratedCount: 0,
  total: 0,
  message: "",
  updatedAt: null
};

function setLastSyncMeta(meta) {
  lastSyncMeta = {
    ...lastSyncMeta,
    ...meta,
    updatedAt: new Date().toISOString()
  };
}

export function getLastSyncMeta() {
  return { ...lastSyncMeta };
}

/**
 * Saves exam results to Firebase (per user) and localStorage
 * @param {Object} examData - { difficulty, score, totalQuestions, timestamp, duration, type }
 */
export async function saveExamResult(examData) {
  // Keep a local copy first so the latest attempt is never lost.
  saveToLocalStorage(examData);

  try {
    const user = await getCurrentUserWithWait();
    if (!user) {
      console.log("User not authenticated, saved to localStorage only");
      return;
    }

    // Update local entry with user id when available.
    saveToLocalStorage(examData, user.uid);

    // Save to Firestore in user's subcollection
    const userDocRef = doc(db, "users", user.uid);
    const docRef = await addDoc(collection(userDocRef, "exam_results"), {
      ...examData,
      timestamp: examData.timestamp || new Date().toISOString(),
      serverTimestamp: serverTimestamp()
    });

    console.log("Exam result saved with ID:", docRef.id);

    return docRef.id;
  } catch (error) {
    console.error("Error saving exam result:", error);
    // localStorage already done at function start
  }
}

/**
 * Saves exam result to localStorage
 */
function saveToLocalStorage(examData, userId = null) {
  try {
    // Test localStorage availability (important on mobile)
    const testKey = "__test_ls__";
    localStorage.setItem(testKey, "test");
    localStorage.removeItem(testKey);

    const results = JSON.parse(localStorage.getItem("exam_results") || "[]");
    results.push({
      ...examData,
      timestamp: examData.timestamp || new Date().toISOString(),
      userId
    });
    localStorage.setItem("exam_results", JSON.stringify(results));
    console.log("✅ Saved to localStorage");
  } catch (error) {
    console.warn("localStorage unavailable (private mode or full):", error.message);
    // Fallback: store in memory (lost on page refresh but better than nothing)
    if (!window.__exam_results_memory) {
      window.__exam_results_memory = [];
    }
    window.__exam_results_memory.push({
      ...examData,
      timestamp: examData.timestamp || new Date().toISOString(),
      userId
    });
  }
}

function getLocalResults(type = null, userId = null) {
  try {
    const localResults = JSON.parse(localStorage.getItem("exam_results") || "[]");
    return localResults.filter(r => {
      const typeOk = !type || r.type === type;
      const userOk = !userId || !r.userId || r.userId === userId;
      return typeOk && userOk;
    });
  } catch (error) {
    // Fallback to memory storage if localStorage fails
    const memoryResults = window.__exam_results_memory || [];
    return memoryResults.filter(r => {
      const typeOk = !type || r.type === type;
      const userOk = !userId || !r.userId || r.userId === userId;
      return typeOk && userOk;
    });
  }
}

async function getCurrentUserWithWait(timeoutMs = 5000) {
  // On mobile, increase timeout
  const isMobile = /iPhone|iPad|Android|webOS|BlackBerry|Windows Phone/i.test(navigator.userAgent);
  const actualTimeout = isMobile ? Math.max(timeoutMs, 8000) : timeoutMs;

  if (auth.currentUser) {
    return auth.currentUser;
  }

  return new Promise((resolve) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        unsubscribe();
        console.warn(`Auth timeout after ${actualTimeout}ms, using fallback`);
        resolve(auth.currentUser || null);
      }
    }, actualTimeout);

    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      unsubscribe();
      resolve(user || null);
    });
  });
}

function buildResultKey(result) {
  return [
    result.type || "",
    result.score || 0,
    result.totalQuestions || 0,
    result.timestamp || "",
    result.duration || 0
  ].join("|");
}

async function migrateLocalResultsToFirestore(user, existingFirestoreResults, localResults) {
  try {
    if (!localResults.length) {
      return 0;
    }

    const existingKeys = new Set(existingFirestoreResults.map(buildResultKey));
    const userDocRef = doc(db, "users", user.uid);

    let migratedCount = 0;
    for (const item of localResults) {
      const key = buildResultKey(item);
      if (existingKeys.has(key)) {
        continue;
      }

      await addDoc(collection(userDocRef, "exam_results"), {
        ...item,
        timestamp: item.timestamp || new Date().toISOString(),
        serverTimestamp: serverTimestamp(),
        migratedFromLocal: true
      });

      existingKeys.add(key);
      migratedCount += 1;
    }

    return migratedCount;
  } catch (error) {
    console.warn("Could not migrate local results to Firestore:", error);
    return 0;
  }
}

/**
 * Gets all exam results for the current user
 * @param {string} type - Filter by type (e.g., "complete", "theme")
 * @returns {Promise<Array>}
 */
export async function getExamResults(type = null) {
  try {
    // Wait for auth to be ready - use authStateReady for reliability
    const user = await getCurrentUserWithWait();

    let results = [];

    // Try to get from Firestore first
    if (user) {
      const userDocRef = doc(db, "users", user.uid);
      const q = query(collection(userDocRef, "exam_results"));
      const querySnapshot = await getDocs(q);
      results = querySnapshot.docs.map(docSnapshot => ({
        id: docSnapshot.id,
        ...docSnapshot.data()
      }));

      const localResults = getLocalResults(type, user.uid);

      // Sync pending local attempts even if Firestore already has historical data.
      const migratedCount = await migrateLocalResultsToFirestore(user, results, localResults);
      if (migratedCount > 0) {
        const refreshedSnapshot = await getDocs(q);
        results = refreshedSnapshot.docs.map(docSnapshot => ({
          id: docSnapshot.id,
          ...docSnapshot.data()
        }));
        console.log(`✅ Migrated ${migratedCount} local result(s) to Firestore`);
      }

      // Merge local + firestore to make the latest attempt visible immediately.
      const mergedMap = new Map();
      [...results, ...localResults].forEach((item) => {
        mergedMap.set(buildResultKey(item), item);
      });
      results = Array.from(mergedMap.values());

      setLastSyncMeta({
        source: "firestore",
        migratedCount,
        total: results.length,
        message: migratedCount > 0
          ? `Synchronise avec migration de ${migratedCount} test(s)`
          : "Synchroniser"
      });

      console.log(`✅ Fetched ${results.length} results from Firestore for user ${user.uid}`);
    } else {
      // Fallback to localStorage
      console.log("⚠️  No user authenticated, fetching from localStorage (fallback)");
      results = getLocalResults();
      setLastSyncMeta({
        source: "local",
        migratedCount: 0,
        total: results.length,
        message: "Mode local (hors connexion utilisateur)"
      });
    }

    // Filter by type if specified
    if (type) {
      results = results.filter(r => r.type === type);
    }

    // Sort by timestamp descending
    results.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    return results;
  } catch (error) {
    console.error("Error getting exam results from Firestore:", error);
    // Fallback to localStorage
    try {
      console.log("Falling back to localStorage");
      let results = getLocalResults();
      if (type) {
        results = results.filter(r => r.type === type);
      }
      results.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      setLastSyncMeta({
        source: "fallback",
        migratedCount: 0,
        total: results.length,
        message: "Fallback local (erreur Firestore)"
      });
      return results;
    } catch {
      setLastSyncMeta({
        source: "error",
        migratedCount: 0,
        total: 0,
        message: "Erreur de chargement des statistiques"
      });
      return [];
    }
  }
}

/**
 * Calculate statistics for exam results
 * @param {Array} results - Array of exam results
 * @returns {Object} Statistics object
 */
export function calculateStats(results) {
  if (!results || results.length === 0) {
    return {
      totalAttempts: 0,
      averageScore: 0,
      successRate: 0,
      bestScore: 0,
      worstScore: 0,
      scores: [],
      dates: []
    };
  }

  const scores = results.map(r => (r.score / r.totalQuestions) * 100);
  const successCount = results.filter(r => (r.score / r.totalQuestions) >= 0.6).length;

  return {
    totalAttempts: results.length,
    averageScore: Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100,
    successRate: Math.round((successCount / results.length) * 100),
    bestScore: Math.max(...scores),
    worstScore: Math.min(...scores),
    scores: scores,
    dates: results.map(r => {
      const date = new Date(r.timestamp);
      return `${date.getDate()}/${date.getMonth() + 1}`;
    }),
    rawResults: results
  };
}

/**
 * Initialize Chart.js if not already loaded
 */
export async function ensureChartJS() {
  if (typeof Chart !== 'undefined') {
    return;
  }

  // Load Chart.js from CDN
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Chart.js'));
    document.head.appendChild(script);
  });
}

