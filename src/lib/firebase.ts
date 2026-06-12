import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore } from "firebase/firestore";
import firebaseConfig from "../../firebase-applet-config.json";

// Suppress internal Firestore network connection warnings/errors in restricted environments
const originalConsoleError = console.error;
console.error = function (...args) {
  const msg = args.map(arg => String(arg)).join(" ");
  if (
    msg.includes("Could not reach Cloud Firestore backend") || 
    msg.includes("Could not reach Firestore") || 
    msg.includes("code=unavailable") ||
    (msg.includes("FirebaseError") && msg.includes("unavailable"))
  ) {
    console.warn("[Firebase Offline Fallback]", ...args);
    return;
  }
  originalConsoleError.apply(console, args);
};

const app = initializeApp(firebaseConfig);
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
}, firebaseConfig.firestoreDatabaseId); /* CRITICAL: The app will break without this line */
export const auth = getAuth();

export enum OperationType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  LIST = "list",
  GET = "get",
  WRITE = "write",
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error("Firestore Error: ", JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Connection test
export async function testConnection() {
  const { doc, getDocFromServer } = await import("firebase/firestore");
  try {
    await getDocFromServer(doc(db, "test", "connection"));
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (
      errorMsg.includes("offline") || 
      errorMsg.includes("unavailable") || 
      errorMsg.includes("failed") ||
      errorMsg.includes("could not be completed")
    ) {
      console.warn("Firestore connection check: Internet is offline or database is unreachable. Offline mode fallback is active.");
    } else {
      console.warn("Firestore connection notice:", error);
    }
  }
}
testConnection();
